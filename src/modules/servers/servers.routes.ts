import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../config/firebase.js';
import { AppError } from '../../utils/app-error.js';
import { requireAuth } from '../auth/auth.middleware.js';

type ManagedServer = {
  id: string;
  name: string;
  apiBaseUrl: string;
  username: string;
  password: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

type SafeManagedServer = Omit<ManagedServer, 'password'> & {
  hasPassword: boolean;
};

type PingStatus = 'online' | 'degraded' | 'offline' | 'auth_error' | 'error';

type ServerPingSummary = {
  address: string;
  count: number;
  avgMs: number | null;
  received: number;
  transmitted: number;
  lossPercent: number;
  status: PingStatus;
};

const serverCreateSchema = z.object({
  name: z.string().trim().min(1),
  apiBaseUrl: z.string().trim().min(1),
  username: z.string().trim().min(1),
  password: z.string().min(1),
  notes: z.string().trim().optional().default('')
});

const serverUpdateSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    apiBaseUrl: z.string().trim().min(1).optional(),
    username: z.string().trim().min(1).optional(),
    password: z.string().optional(),
    notes: z.string().trim().optional()
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required'
  });

const pingSchema = z.object({
  address: z.string().trim().min(1),
  count: z.coerce.number().int().min(1).max(20)
});

function requireDb() {
  if (!db) throw new AppError('Firebase Realtime Database is not configured', 503, 'FIREBASE_NOT_CONFIGURED');
  return db;
}

function now() {
  return new Date().toISOString();
}

function collectionToArray<T extends { id: string }>(value: Record<string, Omit<T, 'id'>> | null | undefined) {
  return Object.entries(value ?? {})
    .map(([id, item]) => ({ id, ...item }) as T)
    .sort((a, b) => {
      const aDate = 'createdAt' in a && typeof a.createdAt === 'string' ? a.createdAt : '';
      const bDate = 'createdAt' in b && typeof b.createdAt === 'string' ? b.createdAt : '';
      return bDate.localeCompare(aDate);
    });
}

function normalizeApiBaseUrl(input: string) {
  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch {
    throw new AppError('Invalid server API URL', 400, 'INVALID_SERVER_URL');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new AppError('Server API URL must start with http:// or https://', 400, 'INVALID_SERVER_URL');
  }

  const segments = parsed.pathname.split('/').filter(Boolean);
  const restIndex = segments.findIndex((segment) => segment.toLowerCase() === 'rest');
  if (restIndex >= 0) {
    parsed.pathname = `/${segments.slice(0, restIndex + 1).join('/')}`;
  } else if (segments.length === 0) {
    parsed.pathname = '/rest';
  } else {
    parsed.pathname = `/${segments.join('/')}`;
  }
  parsed.search = '';
  parsed.hash = '';

  return parsed.toString().replace(/\/$/, '');
}

function safeServer(server: ManagedServer): SafeManagedServer {
  const { password: _password, ...rest } = server;
  return {
    ...rest,
    hasPassword: Boolean(server.password)
  };
}

async function getServer(id: string) {
  const snapshot = await requireDb().ref(`network/servers/${id}`).get();
  const value = snapshot.val() as Omit<ManagedServer, 'id'> | null;
  return value ? ({ id, ...value } as ManagedServer) : null;
}

function buildServerUrl(server: ManagedServer, path: string) {
  return `${server.apiBaseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}

function numberFromValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;

  const normalized = value.replace(',', '.').trim().toLowerCase();
  const durationMatches = Array.from(normalized.matchAll(/(\d+(?:\.\d+)?)\s*(ms|us|µs|s)/g));
  if (durationMatches.length > 0) {
    const totalMs = durationMatches.reduce((sum, match) => {
      const amount = Number(match[1]);
      if (!Number.isFinite(amount)) return sum;

      if (match[2] === 's') return sum + amount * 1000;
      if (match[2] === 'us' || match[2] === 'µs') return sum + amount / 1000;
      return sum + amount;
    }, 0);
    return Number.isFinite(totalMs) ? totalMs : null;
  }

  const match = normalized.match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;

  const number = Number(match[1]);
  return Number.isFinite(number) ? number : null;
}

function collectPingRows(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) {
    return result.flatMap((item) => collectPingRows(item));
  }

  if (!result || typeof result !== 'object') return [];

  const object = result as Record<string, unknown>;
  const nestedKeys = ['data', 'result', 'results', 'rows'];
  const nestedRows = nestedKeys.flatMap((key) => collectPingRows(object[key]));
  return [object, ...nestedRows];
}

function numberFromRows(rows: Record<string, unknown>[], fields: string[], direction: 'first' | 'last' = 'first') {
  const orderedRows = direction === 'last' ? [...rows].reverse() : rows;

  for (const row of orderedRows) {
    for (const field of fields) {
      const value = numberFromValue(row[field]);
      if (value !== null) return value;
    }
  }

  return null;
}

function summarizePing(result: unknown, address: string, count: number, statusOverride?: PingStatus): ServerPingSummary {
  const rows = collectPingRows(result);
  const avgFields = ['avg-rtt', 'avgRtt', 'avg', 'average'];
  const timeFields = ['time', 'rtt', 'latency'];
  const explicitTransmitted = numberFromRows(rows, ['transmitted', 'sent', 'packet-count', 'packetCount', 'packets'], 'last');
  const explicitReceived = numberFromRows(rows, ['received', 'packet-received', 'packetReceived', 'replies'], 'last');
  const explicitLoss = numberFromRows(rows, ['packet-loss', 'packetLoss', 'loss', 'lossPercent'], 'last');
  const transmitted = Math.max(count, explicitTransmitted ?? rows.length ?? 0);
  const replyRows = rows.filter((row) => {
    const status = typeof row.status === 'string' ? row.status.toLowerCase() : '';
    return !status || status === 'reply' || status === 'ok' || status === 'success';
  });
  const times = rows
    .flatMap((row) => timeFields.map((field) => numberFromValue(row[field])))
    .filter((value): value is number => value !== null);
  const summaryAvg = numberFromRows(rows, avgFields, 'last');
  const avgMs = summaryAvg ?? (times.length > 0 ? times.reduce((sum, value) => sum + value, 0) / times.length : null);
  const received = explicitReceived ?? (times.length > 0 ? times.length : replyRows.length);
  const calculatedLoss = transmitted > 0 ? ((transmitted - received) / transmitted) * 100 : 100;
  const lossPercent = Math.max(0, Math.min(100, explicitLoss ?? calculatedLoss));
  const status: PingStatus =
    statusOverride ??
    (received === 0
      ? 'offline'
      : avgMs !== null && avgMs > 150
        ? 'degraded'
        : 'online');

  return {
    address,
    count,
    avgMs: avgMs === null ? null : Math.round(avgMs * 10) / 10,
    received,
    transmitted,
    lossPercent: Math.round(lossPercent * 10) / 10,
    status
  };
}

async function fetchRouterJson(server: ManagedServer, path: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(buildServerUrl(server, path), {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: `Basic ${Buffer.from(`${server.username}:${server.password}`).toString('base64')}`,
        Accept: 'application/json',
        ...init.headers
      }
    });

    const text = await response.text();

    if (!response.ok && (response.status === 401 || response.status === 403)) {
      throw new AppError('Server authentication failed', 401, 'SERVER_AUTH_FAILED');
    }

    let data: unknown;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      throw new AppError('Server returned a non-JSON response', 502, 'SERVER_NON_JSON_RESPONSE');
    }

    if (!response.ok) {
      throw new AppError(`Server request failed with status ${response.status}`, 502, 'SERVER_REQUEST_FAILED');
    }

    return data;
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new AppError('Server request timed out', 504, 'SERVER_REQUEST_TIMEOUT');
    }
    throw new AppError('Server is unreachable from the backend', 502, 'SERVER_UNREACHABLE');
  } finally {
    clearTimeout(timeout);
  }
}

export async function serversRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/servers', async () => {
    const snapshot = await requireDb().ref('network/servers').get();
    return {
      success: true,
      data: collectionToArray<ManagedServer>(snapshot.val()).map(safeServer)
    };
  });

  app.post('/servers', async (request, reply) => {
    const input = serverCreateSchema.parse(request.body);
    const timestamp = now();
    const ref = requireDb().ref('network/servers').push();
    const server: Omit<ManagedServer, 'id'> = {
      name: input.name,
      apiBaseUrl: normalizeApiBaseUrl(input.apiBaseUrl),
      username: input.username,
      password: input.password,
      notes: input.notes,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    await ref.set(server);
    return reply.status(201).send({
      success: true,
      data: safeServer({ id: ref.key!, ...server })
    });
  });

  app.patch('/servers/:id', async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const input = serverUpdateSchema.parse(request.body);
    const existing = await getServer(id);
    if (!existing) throw new AppError('Server not found', 404, 'SERVER_NOT_FOUND');

    const next: Omit<ManagedServer, 'id'> = {
      name: input.name ?? existing.name,
      apiBaseUrl: input.apiBaseUrl ? normalizeApiBaseUrl(input.apiBaseUrl) : existing.apiBaseUrl,
      username: input.username ?? existing.username,
      password: input.password && input.password.length > 0 ? input.password : existing.password,
      notes: input.notes ?? existing.notes,
      createdAt: existing.createdAt,
      updatedAt: now()
    };

    await requireDb().ref(`network/servers/${id}`).set(next);
    return {
      success: true,
      data: safeServer({ id, ...next })
    };
  });

  app.delete('/servers/:id', async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const existing = await getServer(id);
    if (!existing) throw new AppError('Server not found', 404, 'SERVER_NOT_FOUND');
    await requireDb().ref(`network/servers/${id}`).remove();
    return {
      success: true,
      data: { id }
    };
  });

  app.get('/servers/:id/resource', async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const server = await getServer(id);
    if (!server) throw new AppError('Server not found', 404, 'SERVER_NOT_FOUND');
    const result = await fetchRouterJson(server, '/system/resource');
    return {
      success: true,
      data: {
        fetchedAt: now(),
        result
      }
    };
  });

  app.post('/servers/:id/ping', async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const input = pingSchema.parse(request.body);
    const server = await getServer(id);
    if (!server) throw new AppError('Server not found', 404, 'SERVER_NOT_FOUND');

    let result: unknown = null;
    let summary: ServerPingSummary;
    let error: { code: string; message: string } | undefined;

    try {
      result = await fetchRouterJson(server, '/ping', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(input)
      });
      summary = summarizePing(result, input.address, input.count);
    } catch (requestError) {
      if (!(requestError instanceof AppError)) throw requestError;

      const status = requestError.code === 'SERVER_AUTH_FAILED' ? 'auth_error' : 'error';
      summary = summarizePing(null, input.address, input.count, status);
      error = {
        code: requestError.code,
        message: requestError.message
      };
    }

    return {
      success: true,
      data: {
        fetchedAt: now(),
        result,
        summary,
        error
      }
    };
  });
}
