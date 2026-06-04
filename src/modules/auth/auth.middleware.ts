import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../../utils/app-error.js';

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch {
    throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
  }
}

export function requireRole(roles: Array<'admin' | 'employee' | 'user'>) {
  return async function roleGuard(request: FastifyRequest) {
    await request.jwtVerify();

    if (!roles.includes(request.user.role)) {
      throw new AppError('Forbidden', 403, 'FORBIDDEN');
    }
  };
}
