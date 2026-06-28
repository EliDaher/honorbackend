import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../../utils/app-error.js';
import { deleteJournalEntry, recordSaleAccounting, updateJournalEntryMetadata } from '../../accounting/accounting.service.js';
import { paymentSchema, saleCreateSchema, saleUpdateSchema } from '../inventory.schema.js';
import type { Sale } from '../inventory.types.js';
import { addMovement, applySalePayment, collectionToArray, enrichSale, getContact, getProduct, getSale, money, moveProductQuantity, now, removeMovementsForReference, requireDb, withoutId } from '../inventory.service.js';

export async function salesRoutes(app: FastifyInstance) {
  app.get('/sales', async () => {
    const snapshot = await requireDb().ref('inventory/sales').get();
    return {
      success: true,
      data: collectionToArray<Sale>(snapshot.val()).map(enrichSale)
    };
  });

  app.post('/sales', async (request, reply) => {
    const input = saleCreateSchema.parse(request.body);
    if (!input.productId) throw new AppError('productId is required for product sales', 400, 'PRODUCT_REQUIRED');
    const product = await getProduct(input.productId);
    if (!product) throw new AppError('Product not found', 404, 'PRODUCT_NOT_FOUND');
    if (product.quantityOnHand < input.quantity) throw new AppError('Not enough quantity on hand', 400, 'INSUFFICIENT_STOCK');
    if (input.responsibleContactId && !(await getContact(input.responsibleContactId))) throw new AppError('Responsible contact not found', 404, 'CONTACT_NOT_FOUND');
    if (input.finalCustomerId && !(await getContact(input.finalCustomerId))) throw new AppError('Final customer not found', 404, 'CUSTOMER_NOT_FOUND');

    const movement = await moveProductQuantity(input.productId, (current) => {
      if (current.quantityOnHand < input.quantity) return;
      return {
        ...current,
        quantityOnHand: current.quantityOnHand - input.quantity,
        updatedAt: now()
      };
    });

    const ref = requireDb().ref('inventory/sales').push();
    const timestamp = now();
    const total = money(input.quantity * input.unitPrice, input.currency);
    const sale: Omit<Sale, 'id'> = {
      productId: input.productId,
      cableRollId: '',
      cableCutId: '',
      responsibleContactId: input.responsibleContactId,
      finalCustomerId: input.finalCustomerId,
      quantity: input.quantity,
      unitPrice: money(input.unitPrice, input.currency),
      total,
      paidAmount: money(0, input.currency),
      status: 'unpaid',
      note: input.note,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    await ref.set(sale);
    await addMovement({
      productId: input.productId,
      type: 'direct_sale',
      quantity: input.quantity,
      beforeQuantity: movement.beforeQuantity,
      afterQuantity: movement.afterQuantity,
      referenceType: 'sale',
      referenceId: ref.key!,
      note: input.note
    });
    await recordSaleAccounting({
      sourceType: 'sale',
      sourceId: ref.key!,
      productId: input.productId,
      partyId: input.finalCustomerId || input.responsibleContactId,
      quantity: input.quantity,
      total,
      costPerUnit: product.costPrice,
      costCurrency: product.currency,
      memo: input.note || 'Direct product sale',
      date: timestamp
    });

    return reply.status(201).send({
      success: true,
      data: enrichSale({ id: ref.key!, ...sale })
    });
  });

  app.patch('/sales/:id', async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const input = saleUpdateSchema.parse(request.body);
    const sale = await getSale(id);
    if (!sale) throw new AppError('Sale not found', 404, 'SALE_NOT_FOUND');
    if (input.responsibleContactId && !(await getContact(input.responsibleContactId))) throw new AppError('Responsible contact not found', 404, 'CONTACT_NOT_FOUND');
    if (input.finalCustomerId && !(await getContact(input.finalCustomerId))) throw new AppError('Final customer not found', 404, 'CUSTOMER_NOT_FOUND');

    const timestamp = now();
    const nextSale: Sale = {
      ...sale,
      responsibleContactId: input.responsibleContactId ?? sale.responsibleContactId,
      finalCustomerId: input.finalCustomerId ?? sale.finalCustomerId,
      note: input.note ?? sale.note,
      updatedAt: timestamp
    };

    await requireDb().ref(`inventory/sales/${id}`).set(withoutId(nextSale));
    if (nextSale.cableCutId) {
      await requireDb().ref(`inventory/cableCuts/${nextSale.cableCutId}`).update({
        responsibleContactId: nextSale.responsibleContactId,
        finalCustomerId: nextSale.finalCustomerId,
        note: nextSale.note
      });
    }
    await updateJournalEntryMetadata({
      sourceType: nextSale.cableRollId ? 'cable_sale' : 'sale',
      sourceId: id,
      memo: nextSale.note || (nextSale.cableRollId ? 'Cable sale' : 'Direct product sale'),
      partyId: nextSale.finalCustomerId || nextSale.responsibleContactId
    });

    return {
      success: true,
      data: enrichSale(nextSale)
    };
  });

  app.delete('/sales/:id', async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const sale = await getSale(id);
    if (!sale) throw new AppError('Sale not found', 404, 'SALE_NOT_FOUND');
    if (sale.paidAmount.amount > 0) throw new AppError('Sale has payments and cannot be deleted', 400, 'SALE_HAS_PAYMENTS');
    if (sale.cableRollId || sale.cableCutId) throw new AppError('Cable sales cannot be deleted from the sales page', 400, 'CABLE_SALE_DELETE_BLOCKED');

    await moveProductQuantity(sale.productId, (product) => ({
      ...product,
      quantityOnHand: product.quantityOnHand + sale.quantity,
      updatedAt: now()
    }));
    await requireDb().ref(`inventory/sales/${id}`).remove();
    await removeMovementsForReference('sale', id);
    await deleteJournalEntry('sale', id, 'created');

    return {
      success: true,
      data: { id }
    };
  });

  app.post('/sales/:id/payment', async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const input = paymentSchema.parse(request.body);
    const result = await applySalePayment(id, input);
    return {
      success: true,
      data: result
    };
  });
}
