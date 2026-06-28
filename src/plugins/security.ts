import type { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import compress from '@fastify/compress';
import jwt from '@fastify/jwt';
import { env } from '../config/env.js';

export async function registerSecurityPlugins(app: FastifyInstance) {
  await app.register(helmet);

  const corsOrigins = env.CORS_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean);
  const corsOrigin = corsOrigins.includes('*') ? '*' : corsOrigins;

  await app.register(cors, {
<<<<<<< HEAD
    origin: env.CORS_ORIGIN.split(',').map((origin) => origin.trim()),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
=======
    origin: corsOrigin,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true
>>>>>>> 3aacbf3129cb094cfe388cac6f8c3e3fe0897c44
  });

  await app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: '1 minute'
  });

  await app.register(compress);

  await app.register(jwt, {
    secret: env.JWT_SECRET
  });
}
