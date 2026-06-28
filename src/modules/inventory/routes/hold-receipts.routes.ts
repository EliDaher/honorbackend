import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../../utils/app-error.js';
import { holdReceiptCreateSchema } from '../inventory.schema.js';
import type { Hold, HoldReceipt, Product } from '../inventory.types.js';
import {
  addMovement,
  collectionToArray,
  enrichHold,
  getContact,
  getHoldReceipt,
  getProduct,
  groupMoney,
  moveProductQuantity,
  normalizeHold,
  now,
  removeMovementsForReference,
  requireDb,
  withoutId
} from '../inventory.service.js';

type EnrichedHold = ReturnType<typeof enrichHold>;

function receiptNumber() {
  return `HR-${Date.now().toString(36).toUpperCase()}`;
}

function hasHoldActivity(hold: Hold) {
  return hold.quantitySold > 0 || hold.quantityReturned > 0 || hold.paidAmount > 0;
}

function receiptStatus(items: EnrichedHold[]) {
  if (items.length > 0 && items.every((item) => item.status === 'settled')) return 'settled' as const;
  if (items.some((item) => item.status === 'awaiting_payment')) return 'awaiting_payment' as const;
  return 'active' as const;
}

function enrichReceipt(receipt: HoldReceipt, holds: Hold[]) {
  const holdById = new Map(holds.map((hold) => [hold.id, hold]));
  const itemIds = receipt.itemIds ?? [];
  const orderedItems = itemIds.length > 0 ? itemIds.map((itemId) => holdById.get(itemId)).filter(Boolean) : holds.filter((hold) => hold.receiptId === receipt.id);
  const items = (orderedItems as Hold[]).map(enrichHold);

  return {
    ...receipt,
    itemIds,
    items,
    itemCount: items.length,
    remainingQuantity: items.reduce((sum, item) => sum + item.remainingQuantity, 0),
    balancesDue: groupMoney(items.map((item) => ({ amount: item.balanceDue, currency: item.currency }))),
    status: receiptStatus(items)
  };
}

export async function holdReceiptsRoutes(app: FastifyInstance) {
  app.get('/hold-receipts', async () => {
    const [receiptsSnapshot, holdsSnapshot] = await Promise.all([
      requireDb().ref('inventory/holdReceipts').get(),
      requireDb().ref('inventory/holds').get()
    ]);
    const holds = collectionToArray<Hold>(holdsSnapshot.val()).map((hold) => normalizeHold(hold.id, withoutId(hold) as Omit<Hold, 'id'>));
    const receipts = collectionToArray<HoldReceipt>(receiptsSnapshot.val()).map((receipt) => ({
      ...receipt,
      itemIds: receipt.itemIds ?? []
    }));

    return {
      success: true,
      data: receipts.map((receipt) => enrichReceipt(receipt, holds))
    };
  });

  app.post('/hold-receipts', async (request, reply) => {
    const input = holdReceiptCreateSchema.parse(request.body);
    const contact = await getContact(input.contactId);
    if (!contact) throw new AppError('Contact not found', 404, 'CONTACT_NOT_FOUND');
    if (input.finalCustomerId && !(await getContact(input.finalCustomerId))) throw new AppError('Final customer not found', 404, 'CUSTOMER_NOT_FOUND');

    const products = new Map<string, Product>();
    const requestedByProduct = new Map<string, number>();

    for (const item of input.items) {
      const product = products.get(item.productId) ?? (await getProduct(item.productId));
      if (!product) throw new AppError('Product not found', 404, 'PRODUCT_NOT_FOUND');
      products.set(item.productId, product);
      requestedByProduct.set(item.productId, (requestedByProduct.get(item.productId) ?? 0) + item.quantity);
    }

    for (const [productId, quantity] of requestedByProduct.entries()) {
      const product = products.get(productId);
      if (!product || product.quantityOnHand < quantity) throw new AppError('Not enough quantity on hand', 400, 'INSUFFICIENT_STOCK');
    }

    const db = requireDb();
    const receiptRef = db.ref('inventory/holdReceipts').push();
    const receiptId = receiptRef.key!;
    const timestamp = now();
    const itemIds: string[] = [];
    const holds: Hold[] = [];

    for (const item of input.items) {
      const holdRef = db.ref('inventory/holds').push();
      const movement = await moveProductQuantity(item.productId, (current) => {
        if (current.quantityOnHand < item.quantity) return;
        return {
          ...current,
          quantityOnHand: current.quantityOnHand - item.quantity,
          quantityOnHold: current.quantityOnHold + item.quantity,
          updatedAt: now()
        };
      });
      const hold: Omit<Hold, 'id'> = {
        receiptId,
        productId: item.productId,
        contactId: input.contactId,
        finalCustomerId: input.finalCustomerId || undefined,
        quantityHeld: item.quantity,
        quantitySold: 0,
        quantityReturned: 0,
        unitPrice: item.unitPrice,
        currency: item.currency,
        paidAmount: 0,
        status: 'active',
        note: item.note,
        createdAt: timestamp,
        updatedAt: timestamp
      };

      await holdRef.set(hold);
      await addMovement({
        productId: item.productId,
        type: 'hold_out',
        quantity: item.quantity,
        beforeQuantity: movement.beforeQuantity,
        afterQuantity: movement.afterQuantity,
        referenceType: 'hold',
        referenceId: holdRef.key!,
        note: item.note || input.note
      });
      itemIds.push(holdRef.key!);
      holds.push({ id: holdRef.key!, ...hold });
    }

    const receipt: Omit<HoldReceipt, 'id'> = {
      receiptNumber: receiptNumber(),
      contactId: input.contactId,
      finalCustomerId: input.finalCustomerId || undefined,
      itemIds,
      note: input.note,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    await receiptRef.set(receipt);

    return reply.status(201).send({
      success: true,
      data: enrichReceipt({ id: receiptId, ...receipt }, holds)
    });
  });

  app.delete('/hold-receipts/:id', async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const receipt = await getHoldReceipt(id);
    if (!receipt) throw new AppError('Hold receipt not found', 404, 'HOLD_RECEIPT_NOT_FOUND');

    const holdsSnapshot = await requireDb().ref('inventory/holds').get();
    const holds = collectionToArray<Hold>(holdsSnapshot.val())
      .map((hold) => normalizeHold(hold.id, withoutId(hold) as Omit<Hold, 'id'>))
      .filter((hold) => hold.receiptId === id || receipt.itemIds.includes(hold.id));

    if (holds.some(hasHoldActivity)) {
      throw new AppError('Hold receipt has item activity and cannot be deleted', 400, 'HOLD_RECEIPT_HAS_ACTIVITY');
    }

    for (const hold of holds) {
      await moveProductQuantity(hold.productId, (product) => ({
        ...product,
        quantityOnHand: product.quantityOnHand + hold.quantityHeld,
        quantityOnHold: Math.max(0, product.quantityOnHold - hold.quantityHeld),
        updatedAt: now()
      }));
      await requireDb().ref(`inventory/holds/${hold.id}`).remove();
      await removeMovementsForReference('hold', hold.id);
    }
    await requireDb().ref(`inventory/holdReceipts/${id}`).remove();

    return {
      success: true,
      data: { id, itemIds: holds.map((hold) => hold.id) }
    };
  });
}
