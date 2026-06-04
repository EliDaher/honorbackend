import type { FastifyInstance } from 'fastify';
import { loginSchema } from './auth.schema.js';
import { loginService } from './auth.service.js';

export async function authRoutes(app: FastifyInstance) {
  app.post('/auth/login', async (request, reply) => {
    const input = loginSchema.parse(request.body);
    const result = await loginService(app, input);

    return reply.send({
      success: true,
      data: result
    });
  });
}
