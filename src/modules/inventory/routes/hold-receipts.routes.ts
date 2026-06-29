import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../../utils/app-error.js';
import { recordSaleAccounting } from '../../accounting/accounting.service.js';
import { holdReceiptCreateSchema, holdReceiptSellSchema } from '../inventory.schema.js';
import type { Hold, HoldReceipt, Product } from '../inventory.types.js';
import {
  addMovement,
  calculateHoldStatus,
  collectionToArray,
  enrichHold,
  getContact,
  getHoldReceipt,
  getProduct,
  groupMoney,
  money,
  moveProductQuantity,
  normalizeHold,
  now,
  removeMovementsForReference,
  requireDb,
  roundAmount,
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
        discountAmount: 0,
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

  app.post('/hold-receipts/:id/sell', async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const input = holdReceiptSellSchema.parse(request.body);
    const receipt = await getHoldReceipt(id);
    if (!receipt) throw new AppError('Hold receipt not found', 404, 'HOLD_RECEIPT_NOT_FOUND');
    if (input.finalCustomerId && !(await getContact(input.finalCustomerId))) throw new AppError('Final customer not found', 404, 'CUSTOMER_NOT_FOUND');

    const holdsSnapshot = await requireDb().ref('inventory/holds').get();
    const receiptHolds = collectionToArray<Hold>(holdsSnapshot.val())
      .map((hold) => normalizeHold(hold.id, withoutId(hold) as Omit<Hold, 'id'>))
      .filter((hold) => hold.receiptId === id || (receipt.itemIds ?? []).includes(hold.id));
    const receiptHoldById = new Map(receiptHolds.map((hold) => [hold.id, hold]));
    const orderedHolds = (receipt.itemIds ?? [])
      .map((itemId) => receiptHoldById.get(itemId))
      .filter(Boolean) as Hold[];
    const holdsToSell = (orderedHolds.length > 0 ? orderedHolds : receiptHolds).filter((hold) => {
      const remainingQuantity = hold.quantityHeld - hold.quantitySold - hold.quantityReturned;
      return remainingQuantity > 0;
    });

    if (holdsToSell.length === 0) throw new AppError('Hold receipt has no remaining quantity to sell', 400, 'HOLD_RECEIPT_NO_REMAINING_QUANTITY');

    const currencies = new Set(holdsToSell.map((hold) => hold.currency ?? 'USD'));
    if (input.discountAmount > 0 && currencies.size > 1) {
      throw new AppError('Receipt discount requires a single currency receipt', 400, 'MIXED_CURRENCY_RECEIPT_DISCOUNT');
    }

    const timestamp = now();
    const grossTotal = roundAmount(
      holdsToSell.reduce((sum, hold) => {
        const remainingQuantity = hold.quantityHeld - hold.quantitySold - hold.quantityReturned;
        return sum + remainingQuantity * hold.unitPrice;
      }, 0)
    );
    const receiptDiscountAmount = roundAmount(input.discountAmount);
    if (receiptDiscountAmount > grossTotal) throw new AppError('Discount exceeds sale total', 400, 'DISCOUNT_EXCEEDS_TOTAL');

    let unallocatedDiscount = receiptDiscountAmount;
    const updatedHolds: Hold[] = [];

    for (let index = 0; index < holdsToSell.length; index += 1) {
      const hold = holdsToSell[index]!;
      const remainingQuantity = hold.quantityHeld - hold.quantitySold - hold.quantityReturned;
      const saleGrossAmount = roundAmount(remainingQuantity * hold.unitPrice);
      const saleDiscountAmount =
        receiptDiscountAmount === 0
          ? 0
          : index === holdsToSell.length - 1
            ? unallocatedDiscount
            : roundAmount((receiptDiscountAmount * saleGrossAmount) / grossTotal);
      unallocatedDiscount = roundAmount(unallocatedDiscount - saleDiscountAmount);
      const saleNetAmount = roundAmount(saleGrossAmount - saleDiscountAmount);

      const movement = await moveProductQuantity(hold.productId, (product) => ({
        ...product,
        quantityOnHold: Math.max(0, product.quantityOnHold - remainingQuantity),
        updatedAt: now()
      }));

      const nextHold: Hold = {
        ...hold,
        finalCustomerId: input.finalCustomerId || receipt.finalCustomerId || hold.finalCustomerId,
        quantitySold: hold.quantitySold + remainingQuantity,
        discountAmount: roundAmount((hold.discountAmount ?? 0) + saleDiscountAmount),
        status: calculateHoldStatus({
          ...hold,
          quantitySold: hold.quantitySold + remainingQuantity,
          discountAmount: roundAmount((hold.discountAmount ?? 0) + saleDiscountAmount)
        }),
        updatedAt: timestamp
      };
      if (nextHold.status === 'settled') nextHold.settledAt = timestamp;

      await requireDb().ref(`inventory/holds/${hold.id}`).set(withoutId(nextHold));
      const saleMovement = await addMovement({
        productId: hold.productId,
        type: 'hold_sell',
        quantity: remainingQuantity,
        beforeQuantity: movement.product.quantityOnHold + remainingQuantity,
        afterQuantity: movement.product.quantityOnHold,
        referenceType: 'hold',
        referenceId: hold.id,
        note: input.note || receipt.note
      });

      const product = await getProduct(hold.productId);
      await recordSaleAccounting({
        sourceType: 'hold',
        sourceId: saleMovement.id,
        sourceAction: 'sold',
        productId: hold.productId,
        partyId: nextHold.finalCustomerId || nextHold.contactId,
        quantity: remainingQuantity,
        total: money(saleNetAmount, hold.currency ?? 'USD'),
        discount: money(saleDiscountAmount, hold.currency ?? 'USD'),
        costPerUnit: product?.costPrice ?? 0,
        costCurrency: product?.currency ?? hold.currency ?? 'USD',
        memo: input.note || 'Hold receipt sale settled',
        date: timestamp
      });

      updatedHolds.push(nextHold);
    }

    const nextReceipt: HoldReceipt = {
      ...receipt,
      finalCustomerId: input.finalCustomerId || receipt.finalCustomerId,
      updatedAt: timestamp
    };
    await requireDb().ref(`inventory/holdReceipts/${id}`).set(withoutId(nextReceipt));

    const updatedById = new Map(updatedHolds.map((hold) => [hold.id, hold]));
    const nextReceiptHolds = receiptHolds.map((hold) => updatedById.get(hold.id) ?? hold);

    return {
      success: true,
      data: enrichReceipt(nextReceipt, nextReceiptHolds)
    };
  });
}
