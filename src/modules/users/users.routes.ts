import type { FastifyInstance } from 'fastify';
import { requireAuth, requireRole } from '../auth/auth.middleware.js';

export async function usersRoutes(app: FastifyInstance) {
  app.get('/users/me', { preHandler: requireAuth }, async (request) => {
    return {
      success: true,
      data: request.user
    };
  });

  app.get('/users/admin-only', { preHandler: requireRole(['admin']) }, async () => {
    return {
      success: true,
      message: 'Only admin can access this endpoint'
    };
  });
}
