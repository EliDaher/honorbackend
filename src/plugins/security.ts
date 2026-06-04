import type { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import compress from '@fastify/compress';
import jwt from '@fastify/jwt';
import { env } from '../config/env.js';

export async function registerSecurityPlugins(app: FastifyInstance) {
  await app.register(helmet);

  await app.register(cors, {
    origin: env.CORS_ORIGIN.split(',').map((origin) => origin.trim()),
    credentials: true
  });

  await app.register(rateLimit, {
    max: 120,
    timeWindow: '1 minute'
  });

  await app.register(compress);

  await app.register(jwt, {
    secret: env.JWT_SECRET
  });
}
