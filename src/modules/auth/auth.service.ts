import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../../utils/app-error.js';
import type { LoginInput } from './auth.schema.js';

// Replace this demo user with Firebase / PostgreSQL / MongoDB lookup.
const demoUser = {
  id: '1',
  username: 'admin',
  // password: admin1234
  passwordHash: '$2b$10$9jp8Lb.vp0bYay5ud6fe8eOtg7Bwhi71VCzrihyWzbIE0xHJmjAVC',
  role: 'admin' as const,
  isActive: true
};

export async function loginService(app: FastifyInstance, input: LoginInput) {
  if (input.username !== demoUser.username) {
    throw new AppError('Invalid username or password', 401, 'INVALID_CREDENTIALS');
  }

  const validPassword = await bcrypt.compare(input.password, demoUser.passwordHash);

  if (!validPassword) {
    throw new AppError('Invalid username or password', 401, 'INVALID_CREDENTIALS');
  }

  if (!demoUser.isActive) {
    throw new AppError('User is not active', 403, 'USER_DISABLED');
  }

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
