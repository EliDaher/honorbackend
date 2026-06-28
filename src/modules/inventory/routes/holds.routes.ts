import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../../utils/app-error.js';
import { recordSaleAccounting } from '../../accounting/accounting.service.js';
import { holdCreateSchema, holdQuantitySchema, holdUpdateSchema, paymentSchema } from '../inventory.schema.js';
import type { Hold } from '../inventory.types.js';
import { addMovement, applyHoldPayment, calculateHoldStatus, collectionToArray, enrichHold, getContact, getHold, getHoldReceipt, getProduct, money, moveProductQuantity, normalizeHold, now, removeMovementsForReference, requireDb, withoutId } from '../inventory.service.js';

export async function holdsRoutes(app: FastifyInstance) {
  app.get('/holds', async () => {
    const snapshot = await requireDb().ref('inventory/holds').get();
    return {
      success: true,
      data: collectionToArray<Hold>(snapshot.val())
        .map((hold) => normalizeHold(hold.id, withoutId(hold) as Omit<Hold, 'id'>))
        .map(enrichHold)
    };
  });

  app.post('/holds', async (request, reply) => {
    const input = holdCreateSchema.parse(request.body);
    const product = await getProduct(input.productId);
    const contact = await getContact(input.contactId);
    if (!product) throw new AppError('Product not found', 404, 'PRODUCT_NOT_FOUND');
    if (!contact) throw new AppError('Contact not found', 404, 'CONTACT_NOT_FOUND');
    if (input.finalCustomerId && !(await getContact(input.finalCustomerId))) throw new AppError('Final customer not found', 404, 'CUSTOMER_NOT_FOUND');
    if (product.quantityOnHand < input.quantity) throw new AppError('Not enough quantity on hand', 400, 'INSUFFICIENT_STOCK');

    const movement = await moveProductQuantity(input.productId, (current) => {
      if (current.quantityOnHand < input.quantity) return;
      return {
        ...current,
        quantityOnHand: current.quantityOnHand - input.quantity,
        quantityOnHold: current.quantityOnHold + input.quantity,
        updatedAt: now()
      };
    });

    const ref = requireDb().ref('inventory/holds').push();
    const timestamp = now();
    const hold: Omit<Hold, 'id'> = {
      productId: input.productId,
      contactId: input.contactId,
      finalCustomerId: input.finalCustomerId || undefined,
      quantityHeld: input.quantity,
      quantitySold: 0,
      quantityReturned: 0,
      unitPrice: input.unitPrice,
      currency: input.currency,
      paidAmount: 0,
      status: 'active',
      note: input.note,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    await ref.set(hold);
    await addMovement({
      productId: input.productId,
      type: 'hold_out',
      quantity: input.quantity,
      beforeQuantity: movement.beforeQuantity,
      afterQuantity: movement.afterQuantity,
      referenceType: 'hold',
      referenceId: ref.key!,
      note: input.note
    });

    return reply.status(201).send({
      success: true,
      data: enrichHold({ id: ref.key!, ...hold })
    });
  });

  app.patch('/holds/:id', async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const input = holdUpdateSchema.parse(request.body);
    const hold = await getHold(id);
    if (!hold) throw new AppError('Hold not found', 404, 'HOLD_NOT_FOUND');
    if (input.contactId && !(await getContact(input.contactId))) throw new AppError('Contact not found', 404, 'CONTACT_NOT_FOUND');
    if (input.finalCustomerId && !(await getContact(input.finalCustomerId))) throw new AppError('Final customer not found', 404, 'CUSTOMER_NOT_FOUND');

    const hasFinancialActivity = hold.quantitySold > 0 || hold.paidAmount > 0;
    if (hasFinancialActivity && (input.contactId !== undefined || input.finalCustomerId !== undefined || input.unitPrice !== undefined || input.currency !== undefined)) {
      throw new AppError('Hold financial fields cannot be changed after sale or payment activity', 400, 'HOLD_HAS_ACTIVITY');
    }

    const timestamp = now();
    const nextHold: Hold = {
      ...hold,
      contactId: input.contactId ?? hold.contactId,
      finalCustomerId: input.finalCustomerId ?? hold.finalCustomerId ?? '',
      unitPrice: input.unitPrice ?? hold.unitPrice,
      currency: input.currency ?? hold.currency,
      note: input.note ?? hold.note,
      status: calculateHoldStatus({
        ...hold,
        unitPrice: input.unitPrice ?? hold.unitPrice
      }),
      updatedAt: timestamp
    };
    if (nextHold.status === 'settled') nextHold.settledAt = nextHold.settledAt ?? timestamp;
    else delete nextHold.settledAt;

    await requireDb().ref(`inventory/holds/${id}`).set(withoutId(nextHold));
    return {
      success: true,
      data: enrichHold(nextHold)
    };
  });

  app.delete('/holds/:id', async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const hold = await getHold(id);
    if (!hold) throw new AppError('Hold not found', 404, 'HOLD_NOT_FOUND');
    if (hold.quantitySold > 0 || hold.quantityReturned > 0 || hold.paidAmount > 0) {
      throw new AppError('Hold has sale, return, or payment activity and cannot be deleted', 400, 'HOLD_HAS_ACTIVITY');
    }

    await moveProductQuantity(hold.productId, (product) => ({
      ...product,
      quantityOnHand: product.quantityOnHand + hold.quantityHeld,
      quantityOnHold: Math.max(0, product.quantityOnHold - hold.quantityHeld),
      updatedAt: now()
    }));
    await requireDb().ref(`inventory/holds/${id}`).remove();
    await removeMovementsForReference('hold', id);
    if (hold.receiptId) {
      const receipt = await getHoldReceipt(hold.receiptId);
      if (receipt) {
        const itemIds = (receipt.itemIds ?? []).filter((itemId) => itemId !== id);
        if (itemIds.length > 0) {
          await requireDb().ref(`inventory/holdReceipts/${hold.receiptId}`).set({
            ...withoutId(receipt),
            itemIds,
            updatedAt: now()
          });
        } else {
          await requireDb().ref(`inventory/holdReceipts/${hold.receiptId}`).remove();
        }
      }
    }

    return {
      success: true,
      data: { id }
    };
  });

  app.post('/holds/:id/sell', async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const input = holdQuantitySchema.parse(request.body);
    const hold = await getHold(id);
    if (!hold) throw new AppError('Hold not found', 404, 'HOLD_NOT_FOUND');

    const remainingQuantity = hold.quantityHeld - hold.quantitySold - hold.quantityReturned;
    if (input.quantity > remainingQuantity) throw new AppError('Sold quantity exceeds remaining held quantity', 400, 'INVALID_HOLD_QUANTITY');

    const movement = await moveProductQuantity(hold.productId, (product) => ({
      ...product,
      quantityOnHold: Math.max(0, product.quantityOnHold - input.quantity),
      updatedAt: now()
    }));

    const timestamp = now();
    const nextHold: Hold = {
      ...hold,
      finalCustomerId: input.finalCustomerId || hold.finalCustomerId,
      quantitySold: hold.quantitySold + input.quantity,
      status: calculateHoldStatus({
        ...hold,
        quantitySold: hold.quantitySold + input.quantity
      }),
      updatedAt: timestamp
    };
    if (nextHold.status === 'settled') nextHold.settledAt = timestamp;

    await requireDb().ref(`inventory/holds/${id}`).set(withoutId(nextHold));
    const saleMovement = await addMovement({
      productId: hold.productId,
      type: 'hold_sell',
      quantity: input.quantity,
      beforeQuantity: movement.product.quantityOnHold + input.quantity,
      afterQuantity: movement.product.quantityOnHold,
      referenceType: 'hold',
      referenceId: id,
      note: input.note
    });
    const product = await getProduct(hold.productId);
    await recordSaleAccounting({
      sourceType: 'hold',
      sourceId: saleMovement.id,
      sourceAction: 'sold',
      productId: hold.productId,
      partyId: nextHold.finalCustomerId || nextHold.contactId,
      quantity: input.quantity,
      total: money(input.quantity * hold.unitPrice, hold.currency ?? 'USD'),
      costPerUnit: product?.costPrice ?? 0,
      costCurrency: product?.currency ?? hold.currency ?? 'USD',
      memo: input.note || 'Hold sale settled',
      date: timestamp
    });

    return {
      success: true,
      data: enrichHold(nextHold)
    };
  });

  app.post('/holds/:id/payment', async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const input = paymentSchema.parse(request.body);
    const result = await applyHoldPayment(id, input);
    return {
      success: true,
      data: result
    };
  });

  app.post('/holds/:id/return', async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const input = holdQuantitySchema.parse(request.body);
    const hold = await getHold(id);
    if (!hold) throw new AppError('Hold not found', 404, 'HOLD_NOT_FOUND');

    const remainingQuantity = hold.quantityHeld - hold.quantitySold - hold.quantityReturned;
    if (input.quantity > remainingQuantity) throw new AppError('Returned quantity exceeds remaining held quantity', 400, 'INVALID_HOLD_QUANTITY');

    const movement = await moveProductQuantity(hold.productId, (product) => ({
      ...product,
      quantityOnHand: product.quantityOnHand + input.quantity,
      quantityOnHold: Math.max(0, product.quantityOnHold - input.quantity),
      updatedAt: now()
    }));

    const timestamp = now();
    const nextHold: Hold = {
      ...hold,
      quantityReturned: hold.quantityReturned + input.quantity,
      status: calculateHoldStatus({
        ...hold,
        quantityReturned: hold.quantityReturned + input.quantity
      }),
      updatedAt: timestamp
    };
    if (nextHold.status === 'settled') nextHold.settledAt = timestamp;

    await requireDb().ref(`inventory/holds/${id}`).set(withoutId(nextHold));
    await addMovement({
      productId: hold.productId,
      type: 'hold_return',
      quantity: input.quantity,
      beforeQuantity: movement.beforeQuantity,
      afterQuantity: movement.afterQuantity,
      referenceType: 'hold',
      referenceId: id,
      note: input.note
    });

    return {
      success: true,
      data: enrichHold(nextHold)
    };
  });
}
