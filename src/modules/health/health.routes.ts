import type { FastifyInstance } from 'fastify';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async () => {
    return {
      success: true,
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    };
  });
}
