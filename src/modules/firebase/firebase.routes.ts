import type { FastifyInstance } from 'fastify';
import { db } from '../../config/firebase.js';
import { AppError } from '../../utils/app-error.js';

const FIREBASE_READ_TIMEOUT_MS = 15_000;

function getRootKeys(data: unknown) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return [];
  }

  return Object.keys(data);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timeout: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(
            new AppError(
              'Firebase Realtime Database read timed out',
              504,
              'FIREBASE_READ_TIMEOUT'
            )
          );
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

export async function firebaseRoutes(app: FastifyInstance) {
  app.get('/firebase/realtime-database-test', async () => {
    if (!db) {
      throw new AppError(
        'Firebase Realtime Database is not configured',
        503,
        'FIREBASE_NOT_CONFIGURED'
      );
    }

    let snapshot;

    try {
      snapshot = await withTimeout(db.ref('/').get(), FIREBASE_READ_TIMEOUT_MS);
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      const message = error instanceof Error ? error.message : 'Unknown Firebase error';
      throw new AppError(
        `Firebase Realtime Database read failed: ${message}`,
        502,
        'FIREBASE_READ_FAILED'
      );
    }

    const data = snapshot.val();
    const rootKeys = getRootKeys(data);

    return {
      success: true,
      message: 'Firebase Realtime Database read succeeded',
      data,
      meta: {
        path: '/',
        exists: snapshot.exists(),
        rootKeyCount: rootKeys.length,
        rootKeys,
        timestamp: new Date().toISOString()
      }
    };
  });
}
