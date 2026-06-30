import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import { db } from '../../config/firebase.js';
import { AppError } from '../../utils/app-error.js';
import type { LoginInput } from './auth.schema.js';

export type AppUserRole = 'admin' | 'worker';

export type AppUser = {
  id: string;
  username: string;
  passwordHash: string;
  role: AppUserRole;
  contactId?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SafeAppUser = Omit<AppUser, 'passwordHash'> & {
  hasPassword: boolean;
};

const demoUser = {
  id: '1',
  username: 'admin',
  // password: admin1234
  passwordHash: '$2b$10$9jp8Lb.vp0bYay5ud6fe8eOtg7Bwhi71VCzrihyWzbIE0xHJmjAVC',
  role: 'admin' as const,
  isActive: true
};

function now() {
  return new Date().toISOString();
}

function requireUsersDb() {
  if (!db) throw new AppError('Firebase Realtime Database is not configured', 503, 'FIREBASE_NOT_CONFIGURED');
  return db;
}

export function safeUser(user: AppUser): SafeAppUser {
  const { passwordHash: _passwordHash, ...rest } = user;
  return {
    ...rest,
    hasPassword: Boolean(user.passwordHash)
  };
}

function collectionToUsers(value: Record<string, Omit<AppUser, 'id'>> | null | undefined) {
  return Object.entries(value ?? {})
    .map(([id, user]) => ({ id, ...user }) as AppUser)
    .sort((a, b) => a.username.localeCompare(b.username));
}

async function getStoredUserByUsername(username: string) {
  if (!db) return null;

  const snapshot = await db.ref('users').get();
  const users = collectionToUsers(snapshot.val());
  return users.find((user) => user.username === username) ?? null;
}

export async function getUser(userId: string) {
  const snapshot = await requireUsersDb().ref(`users/${userId}`).get();
  const value = snapshot.val() as Omit<AppUser, 'id'> | null;
  return value ? ({ id: userId, ...value } as AppUser) : null;
}

export async function getUsers() {
  const snapshot = await requireUsersDb().ref('users').get();
  return collectionToUsers(snapshot.val()).map(safeUser);
}

export async function createUser(input: {
  username: string;
  password: string;
  role: AppUserRole;
  contactId?: string;
  isActive?: boolean;
}) {
  const existing = await getStoredUserByUsername(input.username);
  if (existing) throw new AppError('Username already exists', 400, 'USERNAME_EXISTS');

  const timestamp = now();
  const ref = requireUsersDb().ref('users').push();
  const user: Omit<AppUser, 'id'> = {
    username: input.username,
    passwordHash: await bcrypt.hash(input.password, 10),
    role: input.role,
    contactId: input.contactId || undefined,
    isActive: input.isActive ?? true,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  await ref.set(user);
  return safeUser({ id: ref.key!, ...user });
}

export async function updateUser(
  userId: string,
  input: Partial<{
    username: string;
    password: string;
    role: AppUserRole;
    contactId: string;
    isActive: boolean;
  }>
) {
  const existing = await getUser(userId);
  if (!existing) throw new AppError('User not found', 404, 'USER_NOT_FOUND');

  if (input.username && input.username !== existing.username) {
    const sameUsername = await getStoredUserByUsername(input.username);
    if (sameUsername && sameUsername.id !== userId) throw new AppError('Username already exists', 400, 'USERNAME_EXISTS');
  }

  const next: AppUser = {
    ...existing,
    username: input.username ?? existing.username,
    role: input.role ?? existing.role,
    contactId: input.contactId ?? existing.contactId,
    isActive: input.isActive ?? existing.isActive,
    passwordHash: input.password ? await bcrypt.hash(input.password, 10) : existing.passwordHash,
    updatedAt: now()
  };

  await requireUsersDb().ref(`users/${userId}`).set({
    username: next.username,
    passwordHash: next.passwordHash,
    role: next.role,
    contactId: next.contactId,
    isActive: next.isActive,
    createdAt: next.createdAt,
    updatedAt: next.updatedAt
  });

  return safeUser(next);
}

async function validatePassword(user: Pick<AppUser, 'passwordHash' | 'isActive'>, password: string) {
  const validPassword = await bcrypt.compare(password, user.passwordHash);
  if (!validPassword) throw new AppError('Invalid username or password', 401, 'INVALID_CREDENTIALS');
  if (!user.isActive) {
    throw new AppError('User is not active', 403, 'USER_DISABLED');
  }
}

export async function loginService(app: FastifyInstance, input: LoginInput) {
  const storedUser = await getStoredUserByUsername(input.username);

  if (storedUser) {
    await validatePassword(storedUser, input.password);

    const token = app.jwt.sign({
      id: storedUser.id,
      username: storedUser.username,
      role: storedUser.role,
      contactId: storedUser.contactId
    });

    return {
      token,
      user: safeUser(storedUser)
    };
  }

  if (input.username !== demoUser.username) {
    throw new AppError('Invalid username or password', 401, 'INVALID_CREDENTIALS');
  }

  await validatePassword(demoUser, input.password);

  const token = app.jwt.sign({
    id: demoUser.id,
    username: demoUser.username,
    role: demoUser.role
  });

  return {
    token,
    user: {
      id: demoUser.id,
      username: demoUser.username,
      role: demoUser.role
    }
  };
}
