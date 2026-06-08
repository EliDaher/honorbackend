import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/auth.middleware.js';
import {
  createExpense,
  createPurchase,
  getAccountingDashboard,
  getAccounts,
  getExpenses,
  getFinancialStatements,
  getJournalEntries,
  getPurchases,
  runAccountingBackfill
} from './accounting.service.js';

const currencySchema = z.enum(['USD', 'SYP']).default('USD');
const paidStatusSchema = z.enum(['paid', 'unpaid']).default('paid');

const expenseCreateSchema = z.object({
  category: z.string().trim().min(1).default('Operating expense'),
  vendorContactId: z.string().trim().optional().default(''),
  amount: z.coerce.number().positive(),
  currency: currencySchema,
  paidStatus: paidStatusSchema,
  note: z.string().trim().optional().default('')
});

const purchaseCreateSchema = z.object({
  productId: z.string().trim().min(1),
  supplierContactId: z.string().trim().optional().default(''),
  quantity: z.coerce.number().positive(),
  unitCost: z.coerce.number().min(0),
  currency: currencySchema,
  paidStatus: paidStatusSchema,
  note: z.string().trim().optional().default('')
});

export async function accountingRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/accounts', async () => ({
    success: true,
    data: await getAccounts()
  }));

  app.get('/dashboard', async () => ({
    success: true,
    data: await getAccountingDashboard()
  }));

  app.get('/statements', async () => ({
    success: true,
    data: await getFinancialStatements()
  }));

  app.get('/transactions', async () => ({
    success: true,
    data: await getJournalEntries()
  }));

  app.get('/expenses', async () => ({
    success: true,
    data: await getExpenses()
  }));

  app.post('/expenses', async (request, reply) => {
    const input = expenseCreateSchema.parse(request.body);
    const expense = await createExpense(input);
    return reply.status(201).send({ success: true, data: expense });
  });

  app.get('/purchases', async () => ({
    success: true,
    data: await getPurchases()
  }));

  app.post('/purchases', async (request, reply) => {
    const input = purchaseCreateSchema.parse(request.body);
    const purchase = await createPurchase(input);
    return reply.status(201).send({ success: true, data: purchase });
  });

  app.post('/backfill', async (request, reply) => {
    const result = await runAccountingBackfill();
    return reply.status(201).send({ success: true, data: result });
  });
}
