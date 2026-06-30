import type { FastifyInstance } from 'fastify';
import { requireAuth, requireRole } from '../auth/auth.middleware.js';
import { cablesRoutes } from './routes/cables.routes.js';
import { categoriesRoutes } from './routes/categories.routes.js';
import { contactsRoutes } from './routes/contacts.routes.js';
import { customersRoutes } from './routes/customers.routes.js';
import { dashboardRoutes } from './routes/dashboard.routes.js';
import { holdReceiptsRoutes } from './routes/hold-receipts.routes.js';
import { holdRequestsRoutes } from './routes/hold-requests.routes.js';
import { holdsRoutes } from './routes/holds.routes.js';
import { paymentsRoutes } from './routes/payments.routes.js';
import { productsRoutes } from './routes/products.routes.js';
import { salesRoutes } from './routes/sales.routes.js';
import { workerPortalRoutes } from './routes/worker-portal.routes.js';
import { workersRoutes } from './routes/workers.routes.js';

export async function inventoryRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  await app.register(holdRequestsRoutes);
  await app.register(workerPortalRoutes);

  await app.register(async (adminApp) => {
    adminApp.addHook('preHandler', requireRole(['admin']));

    await adminApp.register(categoriesRoutes);
    await adminApp.register(productsRoutes);
    await adminApp.register(contactsRoutes);
    await adminApp.register(workersRoutes);
    await adminApp.register(customersRoutes);
    await adminApp.register(holdReceiptsRoutes);
    await adminApp.register(holdsRoutes);
    await adminApp.register(salesRoutes);
    await adminApp.register(paymentsRoutes);
    await adminApp.register(cablesRoutes);
    await adminApp.register(dashboardRoutes);
  });
}
