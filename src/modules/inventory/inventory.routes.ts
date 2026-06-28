import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth/auth.middleware.js';
import { cablesRoutes } from './routes/cables.routes.js';
import { categoriesRoutes } from './routes/categories.routes.js';
import { contactsRoutes } from './routes/contacts.routes.js';
import { customersRoutes } from './routes/customers.routes.js';
import { dashboardRoutes } from './routes/dashboard.routes.js';
import { holdReceiptsRoutes } from './routes/hold-receipts.routes.js';
import { holdsRoutes } from './routes/holds.routes.js';
import { paymentsRoutes } from './routes/payments.routes.js';
import { productsRoutes } from './routes/products.routes.js';
import { salesRoutes } from './routes/sales.routes.js';
import { workersRoutes } from './routes/workers.routes.js';

export async function inventoryRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  await app.register(categoriesRoutes);
  await app.register(productsRoutes);
  await app.register(contactsRoutes);
  await app.register(workersRoutes);
  await app.register(customersRoutes);
  await app.register(holdReceiptsRoutes);
  await app.register(holdsRoutes);
  await app.register(salesRoutes);
  await app.register(paymentsRoutes);
  await app.register(cablesRoutes);
  await app.register(dashboardRoutes);
}
