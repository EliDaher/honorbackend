import Fastify from 'fastify';
import { errorHandler } from './middlewares/error-handler.js';
import { registerSecurityPlugins } from './plugins/security.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { usersRoutes } from './modules/users/users.routes.js';
import { firebaseRoutes } from './modules/firebase/firebase.routes.js';
import { inventoryRoutes } from './modules/inventory/inventory.routes.js';
import { accountingRoutes } from './modules/accounting/accounting.routes.js';
import { serversRoutes } from './modules/servers/servers.routes.js';

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.NODE_ENV === 'production' ? 'info' : 'debug'
    }
  });

  app.setErrorHandler(errorHandler);

  await registerSecurityPlugins(app);

  await app.register(healthRoutes, { prefix: '/api' });
  await app.register(authRoutes, { prefix: '/api' });
  await app.register(usersRoutes, { prefix: '/api' });
  await app.register(firebaseRoutes, { prefix: '/api' });
  await app.register(inventoryRoutes, { prefix: '/api' });
  await app.register(accountingRoutes, { prefix: '/api/accounting' });
  await app.register(serversRoutes, { prefix: '/api' });

  app.get('/', async () => {
    return {
      success: true,
      message: 'Fastify TypeScript Backend is running'
    };
  });

  return app;
}
