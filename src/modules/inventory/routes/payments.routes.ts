import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { recordPaymentAccounting } from '../../accounting/accounting.service.js';
import { paymentCreateSchema, paymentUpdateSchema } from '../inventory.schema.js';
import type { Payment } from '../inventory.types.js';
import { applyHoldPayment, applySalePayment, collectionToArray, createPaymentRecord, deletePayment, money, requireDb, updatePayment } from '../inventory.service.js';

export async function paymentsRoutes(app: FastifyInstance) {
  app.get('/payments', async () => {
    const snapshot = await requireDb().ref('inventory/payments').get();
    return {
      success: true,
      data: collectionToArray<Payment>(snapshot.val())
    };
  });

  app.post('/payments', async (request, reply) => {
    const input = paymentCreateSchema.parse(request.body);
    if (input.targetType === 'sale') {
      const result = await applySalePayment(input.targetId, input);
      return reply.status(201).send({
        success: true,
        data: result
      });
    }

    if (input.targetType === 'hold') {
      const result = await applyHoldPayment(input.targetId, input);
      return reply.status(201).send({ success: true, data: result });
    }

    const payment = await createPaymentRecord({
      targetType: input.targetType,
      targetId: input.targetId,
      customerId: input.customerId,
      contactId: input.contactId,
      amount: money(input.amount, input.currency),
      date: input.date,
      note: input.note
    });
    await recordPaymentAccounting({
      sourceId: payment.id,
      amount: payment.amount,
      partyId: payment.customerId || payment.contactId || payment.targetId,
      memo: input.note || 'Direct payment',
      date: payment.date || payment.createdAt
    });

    return reply.status(201).send({
      success: true,
      data: payment
    });
  });

  app.patch('/payments/:id', async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const input = paymentUpdateSchema.parse(request.body);
    return {
      success: true,
      data: await updatePayment(id, input)
    };
  });

  app.delete('/payments/:id', async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    return {
      success: true,
      data: await deletePayment(id)
    };
  });
}
