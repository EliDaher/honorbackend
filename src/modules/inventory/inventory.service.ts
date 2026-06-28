import { db } from '../../config/firebase.js';
import { AppError } from '../../utils/app-error.js';
import { deleteJournalEntry, recordPaymentAccounting } from '../accounting/accounting.service.js';
import type { PaymentInput } from './inventory.schema.js';
import type {
  CableCut,
  CableRoll,
  Category,
  Contact,
  Currency,
  Hold,
  HoldReceipt,
  Money,
  MovementType,
  Payment,
  Product,
  Sale
} from './inventory.types.js';

export function requireDb() {
  if (!db) {
    throw new AppError('Firebase Realtime Database is not configured', 503, 'FIREBASE_NOT_CONFIGURED');
  }

  return db;
}

export function now() {
  return new Date().toISOString();
}

export function money(amount: number, currency: Currency): Money {
  return { amount: Number(amount.toFixed(2)), currency };
}

export function collectionToArray<T extends { id: string }>(value: Record<string, Omit<T, 'id'>> | null) {
  return Object.entries(value ?? {})
    .map(([id, item]) => ({ id, ...item }) as T)
    .sort((a, b) => {
      const aDate = 'createdAt' in a && typeof a.createdAt === 'string' ? a.createdAt : '';
      const bDate = 'createdAt' in b && typeof b.createdAt === 'string' ? b.createdAt : '';
      return bDate.localeCompare(aDate);
    });
}

export function groupMoney(items: Money[]) {
  return items.reduce<Record<Currency, number>>(
    (balances, item) => {
      balances[item.currency] += item.amount;
      return balances;
    },
    { USD: 0, SYP: 0 }
  );
}

export function normalizeProduct(id: string, value: Omit<Product, 'id'>): Product {
  return {
    ...value,
    categoryId: value.categoryId ?? '',
    currency: value.currency ?? 'USD',
    id
  };
}

export function normalizeHold(id: string, value: Omit<Hold, 'id'>): Hold {
  return {
    currency: 'USD',
    ...value,
    id
  };
}

export function calculateHoldStatus(hold: Pick<Hold, 'quantityHeld' | 'quantitySold' | 'quantityReturned' | 'unitPrice' | 'paidAmount'>) {
  const remainingQuantity = hold.quantityHeld - hold.quantitySold - hold.quantityReturned;
  const amountDue = hold.quantitySold * hold.unitPrice;
  const balanceDue = Math.max(0, amountDue - hold.paidAmount);

  if (remainingQuantity === 0 && balanceDue === 0) return 'settled' as const;
  if (hold.quantitySold > 0 && balanceDue > 0) return 'awaiting_payment' as const;
  return 'active' as const;
}

export function enrichHold(hold: Hold) {
  const currency = hold.currency ?? 'USD';
  const remainingQuantity = hold.quantityHeld - hold.quantitySold - hold.quantityReturned;
  const amountDue = hold.quantitySold * hold.unitPrice;
  const balanceDue = Math.max(0, amountDue - hold.paidAmount);

  return {
    ...hold,
    currency,
    remainingQuantity,
    amountDue,
    balanceDue,
    amountDueMoney: money(amountDue, currency),
    balanceDueMoney: money(balanceDue, currency)
  };
}

export function calculateSaleStatus(total: Money, paidAmount: Money) {
  const balance = Math.max(0, total.amount - paidAmount.amount);
  if (balance === 0) return 'paid' as const;
  if (paidAmount.amount > 0) return 'partial' as const;
  return 'unpaid' as const;
}

export function enrichSale(sale: Sale) {
  const balanceDue = Math.max(0, sale.total.amount - sale.paidAmount.amount);
  return {
    ...sale,
    balanceDue: money(balanceDue, sale.total.currency)
  };
}

export function withoutId<T extends { id: string }>(value: T) {
  const { id: _id, ...rest } = value;
  return rest;
}

export async function getCategory(categoryId: string) {
  const snapshot = await requireDb().ref(`inventory/categories/${categoryId}`).get();
  const value = snapshot.val() as Omit<Category, 'id'> | null;
  return value ? ({ id: categoryId, ...value } as Category) : null;
}

export async function getProduct(productId: string) {
  const snapshot = await requireDb().ref(`inventory/products/${productId}`).get();
  const value = snapshot.val() as Omit<Product, 'id'> | null;
  return value ? normalizeProduct(productId, value) : null;
}

export async function getContact(contactId: string) {
  const snapshot = await requireDb().ref(`inventory/contacts/${contactId}`).get();
  const value = snapshot.val() as Omit<Contact, 'id'> | null;
  return value ? ({ id: contactId, ...value } as Contact) : null;
}

export async function getHold(holdId: string) {
  const snapshot = await requireDb().ref(`inventory/holds/${holdId}`).get();
  const value = snapshot.val() as Omit<Hold, 'id'> | null;
  return value ? normalizeHold(holdId, value) : null;
}

export async function getHoldReceipt(receiptId: string) {
  const snapshot = await requireDb().ref(`inventory/holdReceipts/${receiptId}`).get();
  const value = snapshot.val() as Omit<HoldReceipt, 'id'> | null;
  return value ? ({ id: receiptId, ...value } as HoldReceipt) : null;
}

export async function getSale(saleId: string) {
  const snapshot = await requireDb().ref(`inventory/sales/${saleId}`).get();
  const value = snapshot.val() as Omit<Sale, 'id'> | null;
  return value ? ({ id: saleId, ...value } as Sale) : null;
}

export async function getPayment(paymentId: string) {
  const snapshot = await requireDb().ref(`inventory/payments/${paymentId}`).get();
  const value = snapshot.val() as Omit<Payment, 'id'> | null;
  return value ? ({ id: paymentId, ...value } as Payment) : null;
}

export async function getCableRoll(rollId: string) {
  const snapshot = await requireDb().ref(`inventory/cableRolls/${rollId}`).get();
  const value = snapshot.val() as Omit<CableRoll, 'id'> | null;
  return value ? ({ id: rollId, ...value } as CableRoll) : null;
}

export async function addMovement(input: {
  productId: string;
  type: MovementType;
  quantity: number;
  beforeQuantity: number;
  afterQuantity: number;
  referenceType: 'product' | 'hold' | 'payment' | 'sale' | 'cableRoll' | 'cableCut';
  referenceId: string;
  note: string;
}) {
  const ref = requireDb().ref('inventory/movements').push();
  const movement = {
    id: ref.key!,
    ...input,
    createdAt: now()
  };
  await ref.set(movement);
  return movement;
}

export async function removeMovementsForReference(referenceType: string, referenceId: string) {
  const movementsRef = requireDb().ref('inventory/movements');
  const snapshot = await movementsRef.get();
  const movements = (snapshot.val() ?? {}) as Record<string, { referenceType?: string; referenceId?: string }>;
  const updates: Record<string, null> = {};

  for (const [id, movement] of Object.entries(movements)) {
    if (movement.referenceType === referenceType && movement.referenceId === referenceId) {
      updates[id] = null;
    }
  }

  if (Object.keys(updates).length > 0) await movementsRef.update(updates);
}

export async function moveProductQuantity(
  productId: string,
  update: (product: Omit<Product, 'id'>) => Omit<Product, 'id'> | undefined
) {
  const existing = await getProduct(productId);
  if (!existing) throw new AppError('Product not found', 404, 'PRODUCT_NOT_FOUND');

  const { id: _id, ...current } = existing;
  const beforeQuantity = current.quantityOnHand;
  const next = update(current);
  if (!next) throw new AppError('Quantity update was rejected', 400, 'QUANTITY_UPDATE_REJECTED');

  await requireDb().ref(`inventory/products/${productId}`).set(next);
  return {
    product: normalizeProduct(productId, next),
    beforeQuantity,
    afterQuantity: next.quantityOnHand
  };
}

export async function createPaymentRecord(input: Omit<Payment, 'id' | 'createdAt'>) {
  const ref = requireDb().ref('inventory/payments').push();
  const payment: Omit<Payment, 'id'> = {
    ...input,
    createdAt: now()
  };
  await ref.set(payment);
  return { id: ref.key!, ...payment } as Payment;
}

export async function applySalePayment(saleId: string, input: PaymentInput) {
  const sale = await getSale(saleId);
  if (!sale) throw new AppError('Sale not found', 404, 'SALE_NOT_FOUND');
  if (sale.total.currency !== input.currency) {
    throw new AppError('Payment currency must match sale currency', 400, 'CURRENCY_MISMATCH');
  }

  const balanceDue = Math.max(0, sale.total.amount - sale.paidAmount.amount);
  if (input.amount > balanceDue) {
    throw new AppError('Payment exceeds balance due', 400, 'PAYMENT_EXCEEDS_BALANCE');
  }

  const timestamp = now();
  const nextSale: Sale = {
    ...sale,
    paidAmount: money(sale.paidAmount.amount + input.amount, input.currency),
    updatedAt: timestamp
  };
  nextSale.status = calculateSaleStatus(nextSale.total, nextSale.paidAmount);
  if (nextSale.status === 'paid') nextSale.paidAt = timestamp;

  await requireDb().ref(`inventory/sales/${saleId}`).set(withoutId(nextSale));
  const payment = await createPaymentRecord({
    targetType: 'sale',
    targetId: saleId,
    customerId: sale.finalCustomerId,
    contactId: sale.responsibleContactId,
    amount: money(input.amount, input.currency),
    note: input.note
  });

  await addMovement({
    productId: sale.productId,
    type: 'sale_payment',
    quantity: input.amount,
    beforeQuantity: balanceDue,
    afterQuantity: balanceDue - input.amount,
    referenceType: 'payment',
    referenceId: payment.id,
    note: input.note
  });
  await recordPaymentAccounting({
    sourceId: payment.id,
    amount: payment.amount,
    partyId: payment.customerId || payment.contactId,
    memo: input.note || 'Sale payment',
    date: payment.createdAt
  });

  return { sale: enrichSale(nextSale), payment };
}

export async function applyHoldPayment(holdId: string, input: PaymentInput) {
  const hold = await getHold(holdId);
  if (!hold) throw new AppError('Hold not found', 404, 'HOLD_NOT_FOUND');
  const holdCurrency = hold.currency ?? 'USD';
  if (holdCurrency !== input.currency) throw new AppError('Payment currency must match hold currency', 400, 'CURRENCY_MISMATCH');

  const amountDue = hold.quantitySold * hold.unitPrice;
  const balanceDue = Math.max(0, amountDue - hold.paidAmount);
  if (input.amount > balanceDue) throw new AppError('Payment exceeds balance due', 400, 'PAYMENT_EXCEEDS_BALANCE');

  const timestamp = now();
  const nextHold: Hold = {
    ...hold,
    paidAmount: hold.paidAmount + input.amount,
    status: calculateHoldStatus({
      ...hold,
      paidAmount: hold.paidAmount + input.amount
    }),
    updatedAt: timestamp
  };
  if (nextHold.status === 'settled') nextHold.settledAt = timestamp;

  await requireDb().ref(`inventory/holds/${holdId}`).set(withoutId(nextHold));
  const payment = await createPaymentRecord({
    targetType: 'hold',
    targetId: holdId,
    customerId: hold.finalCustomerId ?? '',
    contactId: hold.contactId,
    amount: money(input.amount, input.currency),
    note: input.note
  });
  await addMovement({
    productId: hold.productId,
    type: 'hold_payment',
    quantity: input.amount,
    beforeQuantity: balanceDue,
    afterQuantity: balanceDue - input.amount,
    referenceType: 'payment',
    referenceId: payment.id,
    note: input.note
  });
  await recordPaymentAccounting({
    sourceId: payment.id,
    amount: payment.amount,
    partyId: payment.customerId || payment.contactId,
    memo: input.note || 'Hold payment',
    date: payment.createdAt
  });

  return { hold: enrichHold(nextHold), payment };
}

async function adjustSalePaidAmount(saleId: string, delta: number, currency: Currency) {
  const sale = await getSale(saleId);
  if (!sale) throw new AppError('Sale not found', 404, 'SALE_NOT_FOUND');
  if (sale.total.currency !== currency) throw new AppError('Payment currency must match sale currency', 400, 'CURRENCY_MISMATCH');

  const currentBalance = Math.max(0, sale.total.amount - sale.paidAmount.amount);
  if (delta > currentBalance) throw new AppError('Payment exceeds balance due', 400, 'PAYMENT_EXCEEDS_BALANCE');
  if (sale.paidAmount.amount + delta < 0) throw new AppError('Payment cannot be lower than already reversed amount', 400, 'INVALID_PAYMENT_AMOUNT');

  const timestamp = now();
  const nextSale: Sale = {
    ...sale,
    paidAmount: money(sale.paidAmount.amount + delta, currency),
    updatedAt: timestamp
  };
  nextSale.status = calculateSaleStatus(nextSale.total, nextSale.paidAmount);
  if (nextSale.status === 'paid') nextSale.paidAt = timestamp;
  else delete nextSale.paidAt;

  await requireDb().ref(`inventory/sales/${saleId}`).set(withoutId(nextSale));
  return enrichSale(nextSale);
}

async function adjustHoldPaidAmount(holdId: string, delta: number, currency: Currency) {
  const hold = await getHold(holdId);
  if (!hold) throw new AppError('Hold not found', 404, 'HOLD_NOT_FOUND');
  const holdCurrency = hold.currency ?? 'USD';
  if (holdCurrency !== currency) throw new AppError('Payment currency must match hold currency', 400, 'CURRENCY_MISMATCH');

  const amountDue = hold.quantitySold * hold.unitPrice;
  const currentBalance = Math.max(0, amountDue - hold.paidAmount);
  if (delta > currentBalance) throw new AppError('Payment exceeds balance due', 400, 'PAYMENT_EXCEEDS_BALANCE');
  if (hold.paidAmount + delta < 0) throw new AppError('Payment cannot be lower than already reversed amount', 400, 'INVALID_PAYMENT_AMOUNT');

  const timestamp = now();
  const nextHold: Hold = {
    ...hold,
    paidAmount: money(hold.paidAmount + delta, currency).amount,
    status: calculateHoldStatus({
      ...hold,
      paidAmount: hold.paidAmount + delta
    }),
    updatedAt: timestamp
  };
  if (nextHold.status === 'settled') nextHold.settledAt = timestamp;
  else delete nextHold.settledAt;

  await requireDb().ref(`inventory/holds/${holdId}`).set(withoutId(nextHold));
  return enrichHold(nextHold);
}

async function repostPaymentAccounting(payment: Payment) {
  await deleteJournalEntry('payment', payment.id, 'received');
  await recordPaymentAccounting({
    sourceId: payment.id,
    amount: payment.amount,
    partyId: payment.customerId || payment.contactId || payment.targetId,
    memo: payment.note || 'Payment received',
    date: payment.createdAt
  });
}

export async function updatePayment(paymentId: string, input: Partial<Pick<PaymentInput, 'amount' | 'currency' | 'note'>>) {
  const existing = await getPayment(paymentId);
  if (!existing) throw new AppError('Payment not found', 404, 'PAYMENT_NOT_FOUND');

  const nextAmount = input.amount ?? existing.amount.amount;
  const nextCurrency = input.currency ?? existing.amount.currency;
  const delta = money(nextAmount - existing.amount.amount, nextCurrency).amount;
  let productId = '';
  let balanceDueAfter = 0;

  if (existing.targetType === 'sale') {
    const sale = await adjustSalePaidAmount(existing.targetId, delta, nextCurrency);
    productId = sale.productId;
    balanceDueAfter = sale.balanceDue.amount;
  }

  if (existing.targetType === 'hold') {
    const hold = await adjustHoldPaidAmount(existing.targetId, delta, nextCurrency);
    productId = hold.productId;
    balanceDueAfter = hold.balanceDue;
  }

  const nextPayment: Payment = {
    ...existing,
    amount: money(nextAmount, nextCurrency),
    note: input.note ?? existing.note
  };
  await requireDb().ref(`inventory/payments/${paymentId}`).set(withoutId(nextPayment));
  await repostPaymentAccounting(nextPayment);

  if (existing.targetType === 'sale' || existing.targetType === 'hold') {
    await removeMovementsForReference('payment', paymentId);
    await addMovement({
      productId,
      type: existing.targetType === 'sale' ? 'sale_payment' : 'hold_payment',
      quantity: nextPayment.amount.amount,
      beforeQuantity: balanceDueAfter + nextPayment.amount.amount,
      afterQuantity: balanceDueAfter,
      referenceType: 'payment',
      referenceId: paymentId,
      note: nextPayment.note
    });
  }

  return nextPayment;
}

export async function deletePayment(paymentId: string) {
  const existing = await getPayment(paymentId);
  if (!existing) throw new AppError('Payment not found', 404, 'PAYMENT_NOT_FOUND');

  if (existing.targetType === 'sale') {
    await adjustSalePaidAmount(existing.targetId, -existing.amount.amount, existing.amount.currency);
  }

  if (existing.targetType === 'hold') {
    await adjustHoldPaidAmount(existing.targetId, -existing.amount.amount, existing.amount.currency);
  }

  await requireDb().ref(`inventory/payments/${paymentId}`).remove();
  await removeMovementsForReference('payment', paymentId);
  await deleteJournalEntry('payment', paymentId, 'received');
  return { id: paymentId };
}

export async function getInventoryCollections() {
  const [productsSnapshot, holdsSnapshot, holdReceiptsSnapshot, contactsSnapshot, salesSnapshot, paymentsSnapshot, categoriesSnapshot, rollsSnapshot, cutsSnapshot] =
    await Promise.all([
      requireDb().ref('inventory/products').get(),
      requireDb().ref('inventory/holds').get(),
      requireDb().ref('inventory/holdReceipts').get(),
      requireDb().ref('inventory/contacts').get(),
      requireDb().ref('inventory/sales').get(),
      requireDb().ref('inventory/payments').get(),
      requireDb().ref('inventory/categories').get(),
      requireDb().ref('inventory/cableRolls').get(),
      requireDb().ref('inventory/cableCuts').get()
    ]);

  return {
    products: collectionToArray<Product>(productsSnapshot.val()).map((product) => normalizeProduct(product.id, withoutId(product) as Omit<Product, 'id'>)),
    holds: collectionToArray<Hold>(holdsSnapshot.val()).map((hold) => normalizeHold(hold.id, withoutId(hold) as Omit<Hold, 'id'>)),
    holdReceipts: collectionToArray<HoldReceipt>(holdReceiptsSnapshot.val()),
    contacts: collectionToArray<Contact>(contactsSnapshot.val()),
    sales: collectionToArray<Sale>(salesSnapshot.val()),
    payments: collectionToArray<Payment>(paymentsSnapshot.val()),
    categories: collectionToArray<Category>(categoriesSnapshot.val()),
    cableRolls: collectionToArray<CableRoll>(rollsSnapshot.val()),
    cableCuts: collectionToArray<CableCut>(cutsSnapshot.val())
  };
}

export function buildPartyLedger(contactId: string, collections: Awaited<ReturnType<typeof getInventoryCollections>>) {
  const holds = collections.holds.filter((hold) => hold.contactId === contactId).map(enrichHold);
  const salesAsResponsible = collections.sales.filter((sale) => sale.responsibleContactId === contactId).map(enrichSale);
  const salesAsCustomer = collections.sales.filter((sale) => sale.finalCustomerId === contactId).map(enrichSale);
  const payments = collections.payments.filter((payment) => payment.contactId === contactId || payment.customerId === contactId || payment.targetId === contactId);
  const holdBalances = holds.map((hold) => money(hold.balanceDue, hold.currency));
  const saleBalances = [...salesAsResponsible, ...salesAsCustomer].map((sale) => sale.balanceDue);
  const directCredits = payments
    .filter((payment) => payment.targetType === 'customer' || payment.targetType === 'contact')
    .map((payment) => money(-payment.amount.amount, payment.amount.currency));

  return {
    activeHolds: holds.filter((hold) => hold.status !== 'settled'),
    holds,
    salesAsResponsible,
    salesAsCustomer,
    payments,
    balancesByCurrency: groupMoney([...holdBalances, ...saleBalances, ...directCredits]),
    itemsInCustody: holds.reduce((sum, hold) => sum + hold.remainingQuantity, 0),
    soldQuantity: holds.reduce((sum, hold) => sum + hold.quantitySold, 0) + salesAsResponsible.reduce((sum, sale) => sum + sale.quantity, 0),
    collectedByCurrency: groupMoney(payments.map((payment) => payment.amount))
  };
}
