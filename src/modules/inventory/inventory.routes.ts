import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../config/firebase.js';
import { AppError } from '../../utils/app-error.js';
import { requireAuth } from '../auth/auth.middleware.js';
import { recordCustomerDebtInvoiceAccounting, recordOpeningInventoryAccounting, recordPaymentAccounting, recordSaleAccounting } from '../accounting/accounting.service.js';

type Currency = 'USD' | 'SYP';

type Money = {
  amount: number;
  currency: Currency;
};

type Category = {
  id: string;
  name: string;
  parentId: string;
  description: string;
  createdAt: string;
  updatedAt: string;
};

type Product = {
  id: string;
  name: string;
  sku: string;
  category: string;
  categoryId: string;
  quantityOnHand: number;
  quantityOnHold: number;
  costPrice: number;
  salePrice: number;
  currency: Currency;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

type Contact = {
  id: string;
  type: 'dealer' | 'customer' | 'worker' | 'supplier';
  name: string;
  phone: string;
  address: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

type Hold = {
  id: string;
  productId: string;
  contactId: string;
  finalCustomerId?: string;
  quantityHeld: number;
  quantitySold: number;
  quantityReturned: number;
  unitPrice: number;
  currency?: Currency;
  paidAmount: number;
  status: 'active' | 'awaiting_payment' | 'settled';
  note: string;
  createdAt: string;
  updatedAt: string;
  settledAt?: string;
};

type Sale = {
  id: string;
  productId: string;
  cableRollId: string;
  cableCutId: string;
  responsibleContactId: string;
  finalCustomerId: string;
  quantity: number;
  unitPrice: Money;
  total: Money;
  paidAmount: Money;
  status: 'unpaid' | 'partial' | 'paid';
  note: string;
  createdAt: string;
  updatedAt: string;
  paidAt?: string;
};

type Payment = {
  id: string;
  targetType: 'sale' | 'hold' | 'customer' | 'contact';
  targetId: string;
  customerId: string;
  contactId: string;
  amount: Money;
  note: string;
  date?: string;
  createdAt: string;
};

type CustomerDebtInvoice = {
  id: string;
  customerId: string;
  amount: Money;
  note: string;
  date: string;
  createdAt: string;
};

type PartyStatementEntry = {
  id: string;
  sourceType: 'debt_invoice' | 'sale' | 'hold' | 'payment';
  sourceId: string;
  date: string;
  description: string;
  currency: Currency;
  debit?: Money;
  credit?: Money;
  runningBalanceByCurrency: Record<Currency, number>;
};

type CableRoll = {
  id: string;
  productId: string;
  rollCode: string;
  cableType: string;
  categoryId: string;
  color: string;
  originalMeters: number;
  remainingMeters: number;
  costPerMeter: Money;
  salePricePerMeter: Money;
  location: string;
  lowMeterAlert: number;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

type CableCut = {
  id: string;
  cableRollId: string;
  productId: string;
  destinationType: 'sale' | 'hold' | 'use';
  responsibleContactId: string;
  finalCustomerId: string;
  meters: number;
  pricePerMeter: Money;
  total: Money;
  saleId: string;
  note: string;
  createdAt: string;
};

type MovementType =
  | 'create_product'
  | 'stock_in'
  | 'hold_out'
  | 'hold_sell'
  | 'hold_return'
  | 'hold_payment'
  | 'direct_sale'
  | 'sale_payment'
  | 'cable_roll_create'
  | 'cable_roll_adjust'
  | 'cable_cut';

const currencySchema = z.enum(['USD', 'SYP']).default('USD');
const dateSchema = z.string().trim().min(1).refine((value) => !Number.isNaN(Date.parse(value)), {
  message: 'Invalid date'
});

const categoryCreateSchema = z.object({
  name: z.string().trim().min(1),
  parentId: z.string().trim().optional().default(''),
  description: z.string().trim().optional().default('')
});

const categoryUpdateSchema = categoryCreateSchema.partial().refine((value) => Object.keys(value).length > 0, {
  message: 'At least one field is required'
});

const productCreateSchema = z.object({
  name: z.string().trim().min(1),
  sku: z.string().trim().optional().default(''),
  category: z.string().trim().optional().default(''),
  categoryId: z.string().trim().optional().default(''),
  quantityOnHand: z.coerce.number().int().min(0).default(0),
  costPrice: z.coerce.number().min(0).default(0),
  salePrice: z.coerce.number().min(0).default(0),
  currency: currencySchema,
  notes: z.string().trim().optional().default('')
});

const productUpdateSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    sku: z.string().trim().optional(),
    category: z.string().trim().optional(),
    categoryId: z.string().trim().optional(),
    costPrice: z.coerce.number().min(0).optional(),
    salePrice: z.coerce.number().min(0).optional(),
    currency: currencySchema.optional(),
    notes: z.string().trim().optional()
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required'
  });

const stockSchema = z.object({
  quantity: z.coerce.number().int().positive(),
  note: z.string().trim().optional().default('')
});

const contactCreateSchema = z.object({
  type: z.enum(['dealer', 'customer', 'worker', 'supplier']),
  name: z.string().trim().min(1),
  phone: z.string().trim().optional().default(''),
  address: z.string().trim().optional().default(''),
  notes: z.string().trim().optional().default('')
});

const contactUpdateSchema = contactCreateSchema.partial().refine((value) => Object.keys(value).length > 0, {
  message: 'At least one field is required'
});

const holdCreateSchema = z.object({
  productId: z.string().trim().min(1),
  contactId: z.string().trim().min(1),
  finalCustomerId: z.string().trim().optional().default(''),
  quantity: z.coerce.number().int().positive(),
  unitPrice: z.coerce.number().min(0),
  currency: currencySchema,
  note: z.string().trim().optional().default('')
});

const holdQuantitySchema = z.object({
  quantity: z.coerce.number().int().positive(),
  finalCustomerId: z.string().trim().optional().default(''),
  note: z.string().trim().optional().default('')
});

const paymentSchema = z.object({
  amount: z.coerce.number().positive(),
  currency: currencySchema,
  note: z.string().trim().optional().default(''),
  date: dateSchema.optional()
});

const paymentCreateSchema = paymentSchema.extend({
  targetType: z.enum(['sale', 'hold', 'customer', 'contact']),
  targetId: z.string().trim().min(1),
  customerId: z.string().trim().optional().default(''),
  contactId: z.string().trim().optional().default('')
});

const customerDebtInvoiceCreateSchema = z.object({
  amount: z.coerce.number().positive(),
  currency: currencySchema,
  date: dateSchema,
  note: z.string().trim().optional().default('')
});

const saleCreateSchema = z.object({
  productId: z.string().trim().optional().default(''),
  responsibleContactId: z.string().trim().optional().default(''),
  finalCustomerId: z.string().trim().optional().default(''),
  quantity: z.coerce.number().positive(),
  unitPrice: z.coerce.number().min(0),
  currency: currencySchema,
  note: z.string().trim().optional().default('')
});

const cableRollCreateSchema = z.object({
  productId: z.string().trim().min(1),
  rollCode: z.string().trim().min(1),
  cableType: z.string().trim().min(1),
  categoryId: z.string().trim().optional().default(''),
  color: z.string().trim().optional().default(''),
  originalMeters: z.coerce.number().positive(),
  remainingMeters: z.coerce.number().nonnegative().optional(),
  costPerMeter: z.coerce.number().min(0).default(0),
  salePricePerMeter: z.coerce.number().min(0).default(0),
  currency: currencySchema,
  location: z.string().trim().optional().default(''),
  lowMeterAlert: z.coerce.number().min(0).default(15),
  notes: z.string().trim().optional().default('')
});

const cableRollUpdateSchema = z
  .object({
    rollCode: z.string().trim().min(1).optional(),
    cableType: z.string().trim().min(1).optional(),
    categoryId: z.string().trim().optional(),
    color: z.string().trim().optional(),
    costPerMeter: z.coerce.number().min(0).optional(),
    salePricePerMeter: z.coerce.number().min(0).optional(),
    currency: currencySchema.optional(),
    location: z.string().trim().optional(),
    lowMeterAlert: z.coerce.number().min(0).optional(),
    notes: z.string().trim().optional()
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required'
  });

const cableRollAdjustSchema = z.object({
  remainingMeters: z.coerce.number().nonnegative(),
  note: z.string().trim().optional().default('')
});

const cableCutSchema = z.object({
  destinationType: z.enum(['sale', 'hold', 'use']),
  responsibleContactId: z.string().trim().optional().default(''),
  finalCustomerId: z.string().trim().optional().default(''),
  meters: z.coerce.number().positive(),
  pricePerMeter: z.coerce.number().min(0),
  currency: currencySchema,
  note: z.string().trim().optional().default('')
});

function requireDb() {
  if (!db) {
    throw new AppError('Firebase Realtime Database is not configured', 503, 'FIREBASE_NOT_CONFIGURED');
  }

  return db;
}

function now() {
  return new Date().toISOString();
}

function money(amount: number, currency: Currency): Money {
  return { amount: Number(amount.toFixed(2)), currency };
}

function collectionToArray<T extends { id: string }>(value: Record<string, Omit<T, 'id'>> | null) {
  return Object.entries(value ?? {})
    .map(([id, item]) => ({ id, ...item }) as T)
    .sort((a, b) => {
      const aDate = 'createdAt' in a && typeof a.createdAt === 'string' ? a.createdAt : '';
      const bDate = 'createdAt' in b && typeof b.createdAt === 'string' ? b.createdAt : '';
      return bDate.localeCompare(aDate);
    });
}

function groupMoney(items: Money[]) {
  return items.reduce<Record<Currency, number>>(
    (balances, item) => {
      balances[item.currency] += item.amount;
      return balances;
    },
    { USD: 0, SYP: 0 }
  );
}

function normalizeProduct(id: string, value: Omit<Product, 'id'>): Product {
  return {
    ...value,
    categoryId: value.categoryId ?? '',
    currency: value.currency ?? 'USD',
    id
  };
}

function normalizeHold(id: string, value: Omit<Hold, 'id'>): Hold {
  return {
    currency: 'USD',
    ...value,
    id
  };
}

function calculateHoldStatus(hold: Pick<Hold, 'quantityHeld' | 'quantitySold' | 'quantityReturned' | 'unitPrice' | 'paidAmount'>) {
  const remainingQuantity = hold.quantityHeld - hold.quantitySold - hold.quantityReturned;
  const amountDue = hold.quantitySold * hold.unitPrice;
  const balanceDue = Math.max(0, amountDue - hold.paidAmount);

  if (remainingQuantity === 0 && balanceDue === 0) return 'settled' as const;
  if (hold.quantitySold > 0 && balanceDue > 0) return 'awaiting_payment' as const;
  return 'active' as const;
}

function enrichHold(hold: Hold) {
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

function calculateSaleStatus(total: Money, paidAmount: Money) {
  const balance = Math.max(0, total.amount - paidAmount.amount);
  if (balance === 0) return 'paid' as const;
  if (paidAmount.amount > 0) return 'partial' as const;
  return 'unpaid' as const;
}

function enrichSale(sale: Sale) {
  const balanceDue = Math.max(0, sale.total.amount - sale.paidAmount.amount);
  return {
    ...sale,
    balanceDue: money(balanceDue, sale.total.currency)
  };
}

function withoutId<T extends { id: string }>(value: T) {
  const { id: _id, ...rest } = value;
  return rest;
}

async function getCategory(categoryId: string) {
  const snapshot = await requireDb().ref(`inventory/categories/${categoryId}`).get();
  const value = snapshot.val() as Omit<Category, 'id'> | null;
  return value ? ({ id: categoryId, ...value } as Category) : null;
}

async function getProduct(productId: string) {
  const snapshot = await requireDb().ref(`inventory/products/${productId}`).get();
  const value = snapshot.val() as Omit<Product, 'id'> | null;
  return value ? normalizeProduct(productId, value) : null;
}

async function getContact(contactId: string) {
  const snapshot = await requireDb().ref(`inventory/contacts/${contactId}`).get();
  const value = snapshot.val() as Omit<Contact, 'id'> | null;
  return value ? ({ id: contactId, ...value } as Contact) : null;
}

async function getHold(holdId: string) {
  const snapshot = await requireDb().ref(`inventory/holds/${holdId}`).get();
  const value = snapshot.val() as Omit<Hold, 'id'> | null;
  return value ? normalizeHold(holdId, value) : null;
}

async function getSale(saleId: string) {
  const snapshot = await requireDb().ref(`inventory/sales/${saleId}`).get();
  const value = snapshot.val() as Omit<Sale, 'id'> | null;
  return value ? ({ id: saleId, ...value } as Sale) : null;
}

async function getCableRoll(rollId: string) {
  const snapshot = await requireDb().ref(`inventory/cableRolls/${rollId}`).get();
  const value = snapshot.val() as Omit<CableRoll, 'id'> | null;
  return value ? ({ id: rollId, ...value } as CableRoll) : null;
}

async function addMovement(input: {
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

async function moveProductQuantity(
  productId: string,
  update: (product: Omit<Product, 'id'>) => Omit<Product, 'id'> | undefined
)
{
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

async function createPaymentRecord(input: Omit<Payment, 'id' | 'createdAt'>) {
  const ref = requireDb().ref('inventory/payments').push();
  const timestamp = now();
  const payment: Omit<Payment, 'id'> = {
    ...input,
    date: input.date ?? timestamp,
    createdAt: timestamp
  };
  await ref.set(payment);
  return { id: ref.key!, ...payment } as Payment;
}

async function applySalePayment(saleId: string, input: z.infer<typeof paymentSchema>) {
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
    note: input.note,
    date: input.date
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
    date: payment.date || payment.createdAt
  });

  return { sale: enrichSale(nextSale), payment };
}

async function applyHoldPayment(holdId: string, input: z.infer<typeof paymentSchema>) {
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
    note: input.note,
    date: input.date
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
    date: payment.date || payment.createdAt
  });

  return { hold: enrichHold(nextHold), payment };
}
async function getInventoryCollections() {
  const [productsSnapshot, holdsSnapshot, contactsSnapshot, salesSnapshot, paymentsSnapshot, debtInvoicesSnapshot, categoriesSnapshot, rollsSnapshot, cutsSnapshot] =
    await Promise.all([
      requireDb().ref('inventory/products').get(),
      requireDb().ref('inventory/holds').get(),
      requireDb().ref('inventory/contacts').get(),
      requireDb().ref('inventory/sales').get(),
      requireDb().ref('inventory/payments').get(),
      requireDb().ref('inventory/customerDebtInvoices').get(),
      requireDb().ref('inventory/categories').get(),
      requireDb().ref('inventory/cableRolls').get(),
      requireDb().ref('inventory/cableCuts').get()
    ]);

  return {
    products: collectionToArray<Product>(productsSnapshot.val()).map((product) => normalizeProduct(product.id, withoutId(product) as Omit<Product, 'id'>)),
    holds: collectionToArray<Hold>(holdsSnapshot.val()).map((hold) => normalizeHold(hold.id, withoutId(hold) as Omit<Hold, 'id'>)),
    contacts: collectionToArray<Contact>(contactsSnapshot.val()),
    sales: collectionToArray<Sale>(salesSnapshot.val()),
    payments: collectionToArray<Payment>(paymentsSnapshot.val()),
    customerDebtInvoices: collectionToArray<CustomerDebtInvoice>(debtInvoicesSnapshot.val()),
    categories: collectionToArray<Category>(categoriesSnapshot.val()),
    cableRolls: collectionToArray<CableRoll>(rollsSnapshot.val()),
    cableCuts: collectionToArray<CableCut>(cutsSnapshot.val())
  };
}

function uniqueById<T extends { id: string }>(items: T[]) {
  return Array.from(new Map(items.map((item) => [item.id, item])).values());
}

function roundMoneyAmount(amount: number) {
  return Number(amount.toFixed(2));
}

function buildPartyLedger(contactId: string, collections: Awaited<ReturnType<typeof getInventoryCollections>>) {
  const holds = collections.holds.filter((hold) => hold.contactId === contactId || hold.finalCustomerId === contactId).map(enrichHold);
  const salesAsResponsible = collections.sales.filter((sale) => sale.responsibleContactId === contactId).map(enrichSale);
  const salesAsCustomer = collections.sales.filter((sale) => sale.finalCustomerId === contactId).map(enrichSale);
  const sales = uniqueById([...salesAsResponsible, ...salesAsCustomer]);
  const payments = collections.payments.filter((payment) => payment.contactId === contactId || payment.customerId === contactId || payment.targetId === contactId);
  const debtInvoices = collections.customerDebtInvoices.filter((invoice) => invoice.customerId === contactId);
  const statementRows: Array<Omit<PartyStatementEntry, 'runningBalanceByCurrency'>> = [
    ...debtInvoices.map((invoice) => ({
      id: `debt-invoice-${invoice.id}`,
      sourceType: 'debt_invoice' as const,
      sourceId: invoice.id,
      date: invoice.date || invoice.createdAt,
      description: invoice.note || 'Customer debt invoice',
      currency: invoice.amount.currency,
      debit: invoice.amount
    })),
    ...sales.map((sale) => ({
      id: `sale-${sale.id}`,
      sourceType: 'sale' as const,
      sourceId: sale.id,
      date: sale.createdAt,
      description: sale.note || 'Sale',
      currency: sale.total.currency,
      debit: sale.total
    })),
    ...holds
      .filter((hold) => hold.quantitySold > 0)
      .map((hold) => ({
        id: `hold-${hold.id}`,
        sourceType: 'hold' as const,
        sourceId: hold.id,
        date: hold.settledAt || hold.updatedAt || hold.createdAt,
        description: hold.note || 'Hold sale',
        currency: hold.currency,
        debit: hold.amountDueMoney
      })),
    ...payments.map((payment) => ({
      id: `payment-${payment.id}`,
      sourceType: 'payment' as const,
      sourceId: payment.id,
      date: payment.date || payment.createdAt,
      description: payment.note || 'Payment',
      currency: payment.amount.currency,
      credit: payment.amount
    }))
  ].sort((a, b) => {
    const dateCompare = a.date.localeCompare(b.date);
    return dateCompare === 0 ? a.id.localeCompare(b.id) : dateCompare;
  });

  const runningBalanceByCurrency: Record<Currency, number> = { USD: 0, SYP: 0 };
  const statement = statementRows.map((row): PartyStatementEntry => {
    if (row.debit) runningBalanceByCurrency[row.debit.currency] = roundMoneyAmount(runningBalanceByCurrency[row.debit.currency] + row.debit.amount);
    if (row.credit) runningBalanceByCurrency[row.credit.currency] = roundMoneyAmount(runningBalanceByCurrency[row.credit.currency] - row.credit.amount);
    return {
      ...row,
      runningBalanceByCurrency: { ...runningBalanceByCurrency }
    };
  });

  return {
    activeHolds: holds.filter((hold) => hold.status !== 'settled'),
    holds,
    salesAsResponsible,
    salesAsCustomer,
    payments,
    debtInvoices,
    statement,
    balancesByCurrency: { ...runningBalanceByCurrency },
    itemsInCustody: holds.reduce((sum, hold) => sum + hold.remainingQuantity, 0),
    soldQuantity: holds.reduce((sum, hold) => sum + hold.quantitySold, 0) + salesAsResponsible.reduce((sum, sale) => sum + sale.quantity, 0),
    collectedByCurrency: groupMoney(payments.map((payment) => payment.amount))
  };
}

export async function inventoryRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/categories', async () => {
    const collections = await getInventoryCollections();
    const productCounts = collections.products.reduce<Record<string, number>>((counts, product) => {
      if (product.categoryId) counts[product.categoryId] = (counts[product.categoryId] ?? 0) + 1;
      return counts;
    }, {});
    const cableRollCounts = collections.cableRolls.reduce<Record<string, number>>((counts, roll) => {
      if (roll.categoryId) counts[roll.categoryId] = (counts[roll.categoryId] ?? 0) + 1;
      return counts;
    }, {});

    return {
      success: true,
      data: collections.categories.map((category) => ({
        ...category,
        productCount: productCounts[category.id] ?? 0,
        cableRollCount: cableRollCounts[category.id] ?? 0
      }))
    };
  });

  app.post('/categories', async (request, reply) => {
    const input = categoryCreateSchema.parse(request.body);
    if (input.parentId && !(await getCategory(input.parentId))) {
      throw new AppError('Parent category not found', 404, 'CATEGORY_NOT_FOUND');
    }

    const ref = requireDb().ref('inventory/categories').push();
    const timestamp = now();
    const category: Omit<Category, 'id'> = {
      ...input,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    await ref.set(category);

    return reply.status(201).send({
      success: true,
      data: { id: ref.key, ...category }
    });
  });

  app.patch('/categories/:id', async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const input = categoryUpdateSchema.parse(request.body);
    const existing = await getCategory(id);
    if (!existing) throw new AppError('Category not found', 404, 'CATEGORY_NOT_FOUND');
    if (input.parentId && input.parentId === id) throw new AppError('Category cannot be its own parent', 400, 'INVALID_CATEGORY_PARENT');
    if (input.parentId && !(await getCategory(input.parentId))) throw new AppError('Parent category not found', 404, 'CATEGORY_NOT_FOUND');

    const next = {
      ...withoutId(existing),
      ...input,
      updatedAt: now()
    };
    await requireDb().ref(`inventory/categories/${id}`).set(next);

    return {
      success: true,
      data: { id, ...next }
    };
  });

  app.get('/products', async () => {
    const snapshot = await requireDb().ref('inventory/products').get();
    return {
      success: true,
      data: collectionToArray<Product>(snapshot.val()).map((product) => normalizeProduct(product.id, withoutId(product) as Omit<Product, 'id'>))
    };
  });

  app.post('/products', async (request, reply) => {
    const input = productCreateSchema.parse(request.body);
    const ref = requireDb().ref('inventory/products').push();
    const timestamp = now();
    const product: Omit<Product, 'id'> = {
      ...input,
      quantityOnHold: 0,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    await ref.set(product);

    if (input.quantityOnHand > 0) {
      await addMovement({
        productId: ref.key!,
        type: 'create_product',
        quantity: input.quantityOnHand,
        beforeQuantity: 0,
        afterQuantity: input.quantityOnHand,
        referenceType: 'product',
        referenceId: ref.key!,
        note: 'Initial product quantity'
      });
      if (input.costPrice > 0) {
        await recordOpeningInventoryAccounting({
          sourceType: 'product',
          sourceId: ref.key!,
          amount: money(input.quantityOnHand * input.costPrice, input.currency),
          memo: 'Initial product inventory value',
          date: timestamp
        });
      }
    }

    return reply.status(201).send({
      success: true,
      data: { id: ref.key, ...product }
    });
  });

  app.patch('/products/:id', async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const input = productUpdateSchema.parse(request.body);
    const existing = await getProduct(id);
    if (!existing) throw new AppError('Product not found', 404, 'PRODUCT_NOT_FOUND');

    const { id: _id, quantityOnHold, createdAt, ...updatableExisting } = existing;
    const next = {
      ...updatableExisting,
      ...input,
      quantityOnHold,
      createdAt,
      updatedAt: now()
    };

    await requireDb().ref(`inventory/products/${id}`).set(next);

    return {
      success: true,
      data: { id, ...next }
    };
  });

  app.post('/products/:id/stock', async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const input = stockSchema.parse(request.body);
    const result = await moveProductQuantity(id, (product) => ({
      ...product,
      quantityOnHand: product.quantityOnHand + input.quantity,
      updatedAt: now()
    }));

    await addMovement({
      productId: id,
      type: 'stock_in',
      quantity: input.quantity,
      beforeQuantity: result.beforeQuantity,
      afterQuantity: result.afterQuantity,
      referenceType: 'product',
      referenceId: id,
      note: input.note
    });

    return {
      success: true,
      data: result.product
    };
  });

  app.get('/contacts', async () => {
    const snapshot = await requireDb().ref('inventory/contacts').get();
    return {
      success: true,
      data: collectionToArray<Contact>(snapshot.val())
    };
  });

  app.post('/contacts', async (request, reply) => {
    const input = contactCreateSchema.parse(request.body);
    const ref = requireDb().ref('inventory/contacts').push();
    const timestamp = now();
    const contact: Omit<Contact, 'id'> = {
      ...input,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    await ref.set(contact);

    return reply.status(201).send({
      success: true,
      data: { id: ref.key, ...contact }
    });
  });

  app.patch('/contacts/:id', async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const input = contactUpdateSchema.parse(request.body);
    const existing = await getContact(id);
    if (!existing) throw new AppError('Contact not found', 404, 'CONTACT_NOT_FOUND');

    const { id: _id, createdAt, ...updatableExisting } = existing;
    const next = {
      ...updatableExisting,
      ...input,
      createdAt,
      updatedAt: now()
    };

    await requireDb().ref(`inventory/contacts/${id}`).set(next);

    return {
      success: true,
      data: { id, ...next }
    };
  });

  app.get('/workers', async () => {
    const collections = await getInventoryCollections();
    return {
      success: true,
      data: collections.contacts
        .filter((contact) => contact.type === 'worker')
        .map((worker) => ({
          ...worker,
          detail: buildPartyLedger(worker.id, collections)
        }))
    };
  });

  app.get('/workers/:id', async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const worker = await getContact(id);
    if (!worker || worker.type !== 'worker') throw new AppError('Worker not found', 404, 'WORKER_NOT_FOUND');
    const collections = await getInventoryCollections();
    return {
      success: true,
      data: {
        ...worker,
        detail: buildPartyLedger(id, collections)
      }
    };
  });

  app.get('/customers', async () => {
    const collections = await getInventoryCollections();
    return {
      success: true,
      data: collections.contacts
        .filter((contact) => contact.type === 'customer')
        .map((customer) => ({
          ...customer,
          ledger: buildPartyLedger(customer.id, collections)
        }))
    };
  });

  app.get('/customers/:id/ledger', async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const customer = await getContact(id);
    if (!customer || customer.type !== 'customer') throw new AppError('Customer not found', 404, 'CUSTOMER_NOT_FOUND');
    const collections = await getInventoryCollections();
    return {
      success: true,
      data: {
        customer,
        ledger: buildPartyLedger(id, collections)
      }
    };
  });

  app.post('/customers/:id/debt-invoices', async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const input = customerDebtInvoiceCreateSchema.parse(request.body);
    const customer = await getContact(id);
    if (!customer || customer.type !== 'customer') throw new AppError('Customer not found', 404, 'CUSTOMER_NOT_FOUND');

    const ref = requireDb().ref('inventory/customerDebtInvoices').push();
    const invoice: Omit<CustomerDebtInvoice, 'id'> = {
      customerId: id,
      amount: money(input.amount, input.currency),
      note: input.note,
      date: input.date,
      createdAt: now()
    };

    await ref.set(invoice);
    await recordCustomerDebtInvoiceAccounting({
      sourceId: ref.key!,
      amount: invoice.amount,
      partyId: id,
      memo: input.note || 'Customer debt invoice',
      date: invoice.date
    });

    return reply.status(201).send({
      success: true,
      data: { id: ref.key!, ...invoice }
    });
  });

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

  app.post('/sales/:id/payment', async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const input = paymentSchema.parse(request.body);
    const result = await applySalePayment(id, input);
    return {
      success: true,
      data: result
    };
  });

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

    let targetId = input.targetId;
    let customerId = input.customerId;
    let contactId = input.contactId;

    if (input.targetType === 'customer') {
      customerId = customerId || targetId;
      targetId = customerId;
      const customer = await getContact(customerId);
      if (!customer || customer.type !== 'customer') throw new AppError('Customer not found', 404, 'CUSTOMER_NOT_FOUND');
      const collections = await getInventoryCollections();
      const ledger = buildPartyLedger(customerId, collections);
      if (input.amount > (ledger.balancesByCurrency[input.currency] ?? 0) + 0.009) {
        throw new AppError('Payment exceeds customer balance', 400, 'PAYMENT_EXCEEDS_BALANCE');
      }
    }

    if (input.targetType === 'contact') {
      contactId = contactId || targetId;
      targetId = contactId;
      if (!(await getContact(contactId))) throw new AppError('Contact not found', 404, 'CONTACT_NOT_FOUND');
    }

    const payment = await createPaymentRecord({
      targetType: input.targetType,
      targetId,
      customerId,
      contactId,
      amount: money(input.amount, input.currency),
      note: input.note,
      date: input.date
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

  app.get('/cables/rolls', async () => {
    const snapshot = await requireDb().ref('inventory/cableRolls').get();
    return {
      success: true,
      data: collectionToArray<CableRoll>(snapshot.val())
    };
  });

  app.post('/cables/rolls', async (request, reply) => {
    const input = cableRollCreateSchema.parse(request.body);
    const product = await getProduct(input.productId);
    if (!product) throw new AppError('Product not found', 404, 'PRODUCT_NOT_FOUND');
    const remainingMeters = input.remainingMeters ?? input.originalMeters;
    if (remainingMeters > input.originalMeters) throw new AppError('Remaining meters cannot exceed original meters', 400, 'INVALID_CABLE_METERS');

    const ref = requireDb().ref('inventory/cableRolls').push();
    const timestamp = now();
    const roll: Omit<CableRoll, 'id'> = {
      productId: input.productId,
      rollCode: input.rollCode,
      cableType: input.cableType,
      categoryId: input.categoryId,
      color: input.color,
      originalMeters: input.originalMeters,
      remainingMeters,
      costPerMeter: money(input.costPerMeter, input.currency),
      salePricePerMeter: money(input.salePricePerMeter, input.currency),
      location: input.location,
      lowMeterAlert: input.lowMeterAlert,
      notes: input.notes,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    await ref.set(roll);
    await addMovement({
      productId: input.productId,
      type: 'cable_roll_create',
      quantity: remainingMeters,
      beforeQuantity: 0,
      afterQuantity: remainingMeters,
      referenceType: 'cableRoll',
      referenceId: ref.key!,
      note: 'Cable roll created'
    });

    return reply.status(201).send({
      success: true,
      data: { id: ref.key!, ...roll }
    });
  });

  app.patch('/cables/rolls/:id', async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const input = cableRollUpdateSchema.parse(request.body);
    const roll = await getCableRoll(id);
    if (!roll) throw new AppError('Cable roll not found', 404, 'CABLE_ROLL_NOT_FOUND');
    const next = {
      ...withoutId(roll),
      ...input,
      costPerMeter:
        input.costPerMeter !== undefined || input.currency
          ? money(input.costPerMeter ?? roll.costPerMeter.amount, input.currency ?? roll.costPerMeter.currency)
          : roll.costPerMeter,
      salePricePerMeter:
        input.salePricePerMeter !== undefined || input.currency
          ? money(input.salePricePerMeter ?? roll.salePricePerMeter.amount, input.currency ?? roll.salePricePerMeter.currency)
          : roll.salePricePerMeter,
      updatedAt: now()
    };
    await requireDb().ref(`inventory/cableRolls/${id}`).set(next);
    return { success: true, data: { id, ...next } };
  });

  app.post('/cables/rolls/:id/adjust', async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const input = cableRollAdjustSchema.parse(request.body);
    const roll = await getCableRoll(id);
    if (!roll) throw new AppError('Cable roll not found', 404, 'CABLE_ROLL_NOT_FOUND');
    if (input.remainingMeters > roll.originalMeters) throw new AppError('Remaining meters cannot exceed original meters', 400, 'INVALID_CABLE_METERS');

    const next = {
      ...withoutId(roll),
      remainingMeters: input.remainingMeters,
      updatedAt: now()
    };
    await requireDb().ref(`inventory/cableRolls/${id}`).set(next);
    await addMovement({
      productId: roll.productId,
      type: 'cable_roll_adjust',
      quantity: input.remainingMeters - roll.remainingMeters,
      beforeQuantity: roll.remainingMeters,
      afterQuantity: input.remainingMeters,
      referenceType: 'cableRoll',
      referenceId: id,
      note: input.note
    });

    return {
      success: true,
      data: { id, ...next }
    };
  });

  app.post('/cables/rolls/:id/cut', async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const input = cableCutSchema.parse(request.body);
    const roll = await getCableRoll(id);
    if (!roll) throw new AppError('Cable roll not found', 404, 'CABLE_ROLL_NOT_FOUND');
    if (input.meters > roll.remainingMeters) throw new AppError('Cut meters exceed remaining roll meters', 400, 'INSUFFICIENT_CABLE_METERS');
    if (input.responsibleContactId && !(await getContact(input.responsibleContactId))) throw new AppError('Responsible contact not found', 404, 'CONTACT_NOT_FOUND');
    if (input.finalCustomerId && !(await getContact(input.finalCustomerId))) throw new AppError('Final customer not found', 404, 'CUSTOMER_NOT_FOUND');

    const timestamp = now();
    const nextRoll = {
      ...withoutId(roll),
      remainingMeters: roll.remainingMeters - input.meters,
      updatedAt: timestamp
    };
    await requireDb().ref(`inventory/cableRolls/${id}`).set(nextRoll);

    let saleId = '';
    const total = money(input.meters * input.pricePerMeter, input.currency);
    if (input.destinationType === 'sale') {
      const saleRef = requireDb().ref('inventory/sales').push();
      const sale: Omit<Sale, 'id'> = {
        productId: roll.productId,
        cableRollId: id,
        cableCutId: '',
        responsibleContactId: input.responsibleContactId,
        finalCustomerId: input.finalCustomerId,
        quantity: input.meters,
        unitPrice: money(input.pricePerMeter, input.currency),
        total,
        paidAmount: money(0, input.currency),
        status: 'unpaid',
        note: input.note,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      await saleRef.set(sale);
      saleId = saleRef.key!;
    }

    const cutRef = requireDb().ref('inventory/cableCuts').push();
    const cut: Omit<CableCut, 'id'> = {
      cableRollId: id,
      productId: roll.productId,
      destinationType: input.destinationType,
      responsibleContactId: input.responsibleContactId,
      finalCustomerId: input.finalCustomerId,
      meters: input.meters,
      pricePerMeter: money(input.pricePerMeter, input.currency),
      total,
      saleId,
      note: input.note,
      createdAt: timestamp
    };
    await cutRef.set(cut);

    if (saleId) {
      await requireDb().ref(`inventory/sales/${saleId}/cableCutId`).set(cutRef.key!);
    }

    await addMovement({
      productId: roll.productId,
      type: 'cable_cut',
      quantity: input.meters,
      beforeQuantity: roll.remainingMeters,
      afterQuantity: nextRoll.remainingMeters,
      referenceType: 'cableCut',
      referenceId: cutRef.key!,
      note: input.note
    });
    if (saleId) {
      await recordSaleAccounting({
        sourceType: 'cable_sale',
        sourceId: saleId,
        productId: roll.productId,
        partyId: input.finalCustomerId || input.responsibleContactId,
        quantity: input.meters,
        total,
        costPerUnit: roll.costPerMeter.amount,
        costCurrency: roll.costPerMeter.currency,
        memo: input.note || 'Cable sale',
        date: timestamp
      });
    }

    return reply.status(201).send({
      success: true,
      data: {
        roll: { id, ...nextRoll },
        cut: { id: cutRef.key!, ...cut },
        saleId
      }
    });
  });

  app.get('/cables/cuts', async () => {
    const snapshot = await requireDb().ref('inventory/cableCuts').get();
    return {
      success: true,
      data: collectionToArray<CableCut>(snapshot.val())
    };
  });

  app.get('/inventory/summary', async () => {
    const collections = await getInventoryCollections();
    const holds = collections.holds.map(enrichHold);
    const sales = collections.sales.map(enrichSale);
    const holdBalances = holds.map((hold) => money(hold.balanceDue, hold.currency));
    const saleBalances = sales.map((sale) => sale.balanceDue);
    const invoiceBalances = collections.customerDebtInvoices.map((invoice) => invoice.amount);
    const directPaymentCredits = collections.payments
      .filter((payment) => payment.targetType === 'customer' || payment.targetType === 'contact')
      .map((payment) => money(-payment.amount.amount, payment.amount.currency));

    return {
      success: true,
      data: {
        totalProducts: collections.products.length,
        totalContacts: collections.contacts.length,
        totalCategories: collections.categories.length,
        totalCableRolls: collections.cableRolls.length,
        lowCableRolls: collections.cableRolls.filter((roll) => roll.remainingMeters <= roll.lowMeterAlert).length,
        stockOnHand: collections.products.reduce((sum, product) => sum + product.quantityOnHand, 0),
        stockOnHold: collections.products.reduce((sum, product) => sum + product.quantityOnHold, 0),
        activeHolds: holds.filter((hold) => hold.status !== 'settled').length,
        unpaidBalance: groupMoney([...holdBalances, ...saleBalances, ...invoiceBalances, ...directPaymentCredits])
      }
    };
  });
}
