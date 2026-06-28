import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/auth.middleware.js';
import { expenseCreateSchema, expenseUpdateSchema, purchaseCreateSchema, purchaseUpdateSchema } from './accounting.schema.js';
import {
  createExpense,
  createPurchase,
  deleteExpense,
  deletePurchase,
  getAccountingDashboard,
  getAccounts,
  getExpenses,
  getFinancialStatements,
  getJournalEntries,
  getPurchases,
  runAccountingBackfill,
  updateExpense,
  updatePurchase
} from './accounting.service.js';

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

  app.patch('/expenses/:id', async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const input = expenseUpdateSchema.parse(request.body);
    return {
      success: true,
      data: await updateExpense(id, input)
    };
  });

  app.delete('/expenses/:id', async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    return {
      success: true,
      data: await deleteExpense(id)
    };
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

  app.patch('/purchases/:id', async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const input = purchaseUpdateSchema.parse(request.body);
    return {
      success: true,
      data: await updatePurchase(id, input)
    };
  });

  app.delete('/purchases/:id', async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    return {
      success: true,
      data: await deletePurchase(id)
    };
  });

  app.post('/backfill', async (request, reply) => {
    const result = await runAccountingBackfill();
    return reply.status(201).send({ success: true, data: result });
  });
}
