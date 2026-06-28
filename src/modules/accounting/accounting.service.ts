import { db } from '../../config/firebase.js';
import { AppError } from '../../utils/app-error.js';

export type Currency = 'USD' | 'SYP';

export type Money = {
  amount: number;
  currency: Currency;
};

type AccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense';

type Account = {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  description: string;
  system: boolean;
  createdAt: string;
  updatedAt: string;
};

type JournalLineInput = {
  accountId: string;
  debit?: number;
  credit?: number;
  currency: Currency;
  partyId?: string;
  description?: string;
};

type JournalLine = Required<Pick<JournalLineInput, 'accountId' | 'currency'>> & {
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
  partyId: string;
  description: string;
};

type JournalEntry = {
  id: string;
  date: string;
  sourceType: string;
  sourceId: string;
  sourceAction: string;
  memo: string;
  partyId: string;
  balanced: boolean;
  lines: JournalLine[];
  createdAt: string;
};

type Product = {
  id: string;
  name: string;
  quantityOnHand: number;
  quantityOnHold: number;
  costPrice: number;
  currency: Currency;
  createdAt: string;
  updatedAt: string;
};

type Sale = {
  id: string;
  productId: string;
  cableRollId: string;
  responsibleContactId: string;
  finalCustomerId: string;
  quantity: number;
  total: Money;
  paidAmount: Money;
  note: string;
  createdAt: string;
};

type Hold = {
  id: string;
  productId: string;
  contactId: string;
  finalCustomerId?: string;
  quantitySold: number;
  unitPrice: number;
  currency?: Currency;
  paidAmount: number;
  note: string;
  createdAt: string;
};

type Payment = {
  id: string;
  targetType: 'sale' | 'hold' | 'customer' | 'contact';
  targetId: string;
  customerId: string;
  contactId: string;
  amount: Money;
  note: string;
  createdAt: string;
};

type CableRoll = {
  id: string;
  productId: string;
  remainingMeters: number;
  costPerMeter: Money;
  createdAt: string;
};

type Expense = {
  id: string;
  category: string;
  vendorContactId: string;
  amount: Money;
  paidStatus: 'paid' | 'unpaid';
  note: string;
  createdAt: string;
};

type Purchase = {
  id: string;
  productId: string;
  supplierContactId: string;
  quantity: number;
  unitCost: Money;
  total: Money;
  paidStatus: 'paid' | 'unpaid';
  note: string;
  createdAt: string;
};

const accountIds = {
  cash: 'cash',
  receivable: 'accounts_receivable',
  inventory: 'inventory',
  payable: 'accounts_payable',
  openingEquity: 'opening_balance_equity',
  revenue: 'sales_revenue',
  cogs: 'cost_of_goods_sold',
  expenses: 'operating_expenses'
} as const;

const defaultAccounts: Account[] = [
  { id: accountIds.cash, code: '1000', name: 'Cash', type: 'asset', description: 'Cash collected from customers and used for paid expenses.', system: true, createdAt: '', updatedAt: '' },
  { id: accountIds.receivable, code: '1100', name: 'Accounts Receivable', type: 'asset', description: 'Customer and contact balances still due.', system: true, createdAt: '', updatedAt: '' },
  { id: accountIds.inventory, code: '1200', name: 'Inventory', type: 'asset', description: 'Stock and remaining cable value at cost.', system: true, createdAt: '', updatedAt: '' },
  { id: accountIds.payable, code: '2000', name: 'Accounts Payable', type: 'liability', description: 'Unpaid purchases and expenses.', system: true, createdAt: '', updatedAt: '' },
  { id: accountIds.openingEquity, code: '3000', name: 'Opening Balance Equity', type: 'equity', description: 'Historical inventory value introduced during backfill.', system: true, createdAt: '', updatedAt: '' },
  { id: accountIds.revenue, code: '4000', name: 'Sales Revenue', type: 'income', description: 'Revenue from product, hold, and cable sales.', system: true, createdAt: '', updatedAt: '' },
  { id: accountIds.cogs, code: '5000', name: 'Cost of Goods Sold', type: 'expense', description: 'Inventory cost consumed by sales.', system: true, createdAt: '', updatedAt: '' },
  { id: accountIds.expenses, code: '6000', name: 'Operating Expenses', type: 'expense', description: 'Manual operating expenses.', system: true, createdAt: '', updatedAt: '' }
];

function requireDb() {
  if (!db) throw new AppError('Firebase Realtime Database is not configured', 503, 'FIREBASE_NOT_CONFIGURED');
  return db;
}

function now() {
  return new Date().toISOString();
}

function round(amount: number) {
  return Number(amount.toFixed(2));
}

function money(amount: number, currency: Currency): Money {
  return { amount: round(amount), currency };
}

function emptyCurrencyMap() {
  return { USD: 0, SYP: 0 } as Record<Currency, number>;
}

function collectionToArray<T extends { id: string }>(value: Record<string, Omit<T, 'id'>> | Record<string, T> | null | undefined) {
  return Object.entries(value ?? {})
    .map(([id, item]) => ({ id, ...item }) as T)
    .sort((a, b) => {
      const aDate = 'createdAt' in a && typeof a.createdAt === 'string' ? a.createdAt : '';
      const bDate = 'createdAt' in b && typeof b.createdAt === 'string' ? b.createdAt : '';
      return bDate.localeCompare(aDate);
    });
}

function sourceEntryId(sourceType: string, sourceId: string, sourceAction: string) {
  return `${sourceType}_${sourceAction}_${sourceId}`.replace(/[.#$\[\]\/]/g, '_');
}

export async function deleteJournalEntry(sourceType: string, sourceId: string, sourceAction = 'created') {
  await requireDb().ref(`accounting/journalEntries/${sourceEntryId(sourceType, sourceId, sourceAction)}`).remove();
}

export async function updateJournalEntryMetadata(input: {
  sourceType: string;
  sourceId: string;
  sourceAction?: string;
  memo?: string;
  partyId?: string;
}) {
  const entryRef = requireDb().ref(`accounting/journalEntries/${sourceEntryId(input.sourceType, input.sourceId, input.sourceAction ?? 'created')}`);
  const snapshot = await entryRef.get();
  const entry = snapshot.val() as JournalEntry | null;
  if (!entry) return null;

  const next: JournalEntry = {
    ...entry,
    memo: input.memo ?? entry.memo,
    partyId: input.partyId ?? entry.partyId,
    lines:
      input.partyId === undefined
        ? entry.lines
        : entry.lines.map((line) => ({
            ...line,
            partyId: input.partyId!
          }))
  };

  await entryRef.set(next);
  return next;
}

function balanceSign(type: AccountType) {
  return type === 'asset' || type === 'expense' ? 1 : -1;
}

function addAmount(target: Record<Currency, number>, currency: Currency, amount: number) {
  target[currency] = round((target[currency] ?? 0) + amount);
}

export async function ensureDefaultAccounts() {
  const timestamp = now();
  const accountsRef = requireDb().ref('accounting/accounts');
  const snapshot = await accountsRef.get();
  const existing = (snapshot.val() ?? {}) as Record<string, Account>;
  const updates: Record<string, Account> = {};

  for (const account of defaultAccounts) {
    if (!existing[account.id]) {
      updates[account.id] = { ...account, createdAt: timestamp, updatedAt: timestamp };
    }
  }

  if (Object.keys(updates).length > 0) await accountsRef.update(updates);
  const nextSnapshot = await accountsRef.get();
  return collectionToArray<Account>(nextSnapshot.val()).sort((a, b) => a.code.localeCompare(b.code));
}

export async function getAccounts() {
  return ensureDefaultAccounts();
}

async function getAccountsMap() {
  const accounts = await ensureDefaultAccounts();
  return accounts.reduce<Record<string, Account>>((map, account) => {
    map[account.id] = account;
    return map;
  }, {});
}

async function postJournalEntry(input: {
  sourceType: string;
  sourceId: string;
  sourceAction: string;
  memo: string;
  partyId?: string;
  date?: string;
  lines: JournalLineInput[];
}) {
  const id = sourceEntryId(input.sourceType, input.sourceId, input.sourceAction);
  const entryRef = requireDb().ref(`accounting/journalEntries/${id}`);
  const existingSnapshot = await entryRef.get();
  const existing = existingSnapshot.val() as JournalEntry | null;
  if (existing) return { entry: existing, created: false };

  const accounts = await getAccountsMap();
  const totals = new Map<Currency, { debit: number; credit: number }>();
  const lines: JournalLine[] = input.lines.map((line) => {
    const account = accounts[line.accountId];
    if (!account) throw new AppError(`Accounting account not found: ${line.accountId}`, 404, 'ACCOUNT_NOT_FOUND');

    const debit = round(line.debit ?? 0);
    const credit = round(line.credit ?? 0);
    if (debit < 0 || credit < 0 || (debit === 0 && credit === 0) || (debit > 0 && credit > 0)) {
      throw new AppError('Each journal line must contain either a debit or a credit amount', 400, 'INVALID_JOURNAL_LINE');
    }

    const currencyTotals = totals.get(line.currency) ?? { debit: 0, credit: 0 };
    currencyTotals.debit = round(currencyTotals.debit + debit);
    currencyTotals.credit = round(currencyTotals.credit + credit);
    totals.set(line.currency, currencyTotals);

    return {
      accountId: account.id,
      accountCode: account.code,
      accountName: account.name,
      debit,
      credit,
      currency: line.currency,
      partyId: line.partyId ?? '',
      description: line.description ?? ''
    };
  });

  for (const [currency, total] of totals.entries()) {
    if (Math.abs(total.debit - total.credit) > 0.009) {
      throw new AppError(`Journal entry is not balanced for ${currency}`, 400, 'UNBALANCED_JOURNAL_ENTRY');
    }
  }

  const entry: JournalEntry = {
    id,
    date: input.date ?? now(),
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    sourceAction: input.sourceAction,
    memo: input.memo,
    partyId: input.partyId ?? '',
    balanced: true,
    lines,
    createdAt: now()
  };

  await entryRef.set(entry);
  return { entry, created: true };
}

export async function recordSaleAccounting(input: {
  sourceType: 'sale' | 'hold' | 'cable_sale';
  sourceId: string;
  sourceAction?: string;
  productId: string;
  partyId?: string;
  quantity: number;
  total: Money;
  costPerUnit?: number;
  costCurrency?: Currency;
  memo?: string;
  date?: string;
}) {
  if (input.total.amount <= 0) return null;
  const lines: JournalLineInput[] = [
    { accountId: accountIds.receivable, debit: input.total.amount, currency: input.total.currency, partyId: input.partyId, description: 'Amount due from sale' },
    { accountId: accountIds.revenue, credit: input.total.amount, currency: input.total.currency, partyId: input.partyId, description: 'Sales revenue' }
  ];

  const costAmount = round((input.costPerUnit ?? 0) * input.quantity);
  const costCurrency = input.costCurrency ?? input.total.currency;
  if (costAmount > 0) {
    lines.push(
      { accountId: accountIds.cogs, debit: costAmount, currency: costCurrency, description: 'Cost of goods sold' },
      { accountId: accountIds.inventory, credit: costAmount, currency: costCurrency, description: 'Inventory relieved at cost' }
    );
  }

  return postJournalEntry({
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    sourceAction: input.sourceAction ?? 'created',
    memo: input.memo || 'Sale recorded',
    partyId: input.partyId,
    date: input.date,
    lines
  });
}

export async function recordPaymentAccounting(input: {
  sourceType?: string;
  sourceId: string;
  sourceAction?: string;
  amount: Money;
  partyId?: string;
  memo?: string;
  date?: string;
}) {
  if (input.amount.amount <= 0) return null;
  return postJournalEntry({
    sourceType: input.sourceType ?? 'payment',
    sourceId: input.sourceId,
    sourceAction: input.sourceAction ?? 'received',
    memo: input.memo || 'Payment received',
    partyId: input.partyId,
    date: input.date,
    lines: [
      { accountId: accountIds.cash, debit: input.amount.amount, currency: input.amount.currency, partyId: input.partyId, description: 'Cash received' },
      { accountId: accountIds.receivable, credit: input.amount.amount, currency: input.amount.currency, partyId: input.partyId, description: 'Receivable collected' }
    ]
  });
}

export async function recordOpeningInventoryAccounting(input: {
  sourceType: string;
  sourceId: string;
  amount: Money;
  memo: string;
  date?: string;
}) {
  if (input.amount.amount <= 0) return null;
  return postJournalEntry({
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    sourceAction: 'opening_inventory',
    memo: input.memo,
    date: input.date,
    lines: [
      { accountId: accountIds.inventory, debit: input.amount.amount, currency: input.amount.currency, description: 'Opening inventory value' },
      { accountId: accountIds.openingEquity, credit: input.amount.amount, currency: input.amount.currency, description: 'Opening balance equity' }
    ]
  });
}

export async function createExpense(input: {
  category: string;
  vendorContactId?: string;
  amount: number;
  currency: Currency;
  paidStatus: 'paid' | 'unpaid';
  note?: string;
}) {
  const timestamp = now();
  const ref = requireDb().ref('accounting/expenses').push();
  const expense: Expense = {
    id: ref.key!,
    category: input.category,
    vendorContactId: input.vendorContactId ?? '',
    amount: money(input.amount, input.currency),
    paidStatus: input.paidStatus,
    note: input.note ?? '',
    createdAt: timestamp
  };
  await ref.set(expense);
  await postExpenseJournal(expense);

  return expense;
}

async function getExpense(expenseId: string) {
  const snapshot = await requireDb().ref(`accounting/expenses/${expenseId}`).get();
  return snapshot.val() as Expense | null;
}

async function postExpenseJournal(expense: Expense) {
  return postJournalEntry({
    sourceType: 'expense',
    sourceId: expense.id,
    sourceAction: expense.paidStatus,
    memo: expense.note || expense.category,
    partyId: expense.vendorContactId,
    date: expense.createdAt,
    lines: [
      { accountId: accountIds.expenses, debit: expense.amount.amount, currency: expense.amount.currency, partyId: expense.vendorContactId, description: expense.category },
      { accountId: expense.paidStatus === 'paid' ? accountIds.cash : accountIds.payable, credit: expense.amount.amount, currency: expense.amount.currency, partyId: expense.vendorContactId, description: expense.paidStatus === 'paid' ? 'Expense paid' : 'Expense payable' }
    ]
  });
}

export async function updateExpense(expenseId: string, input: {
  category?: string;
  vendorContactId?: string;
  amount?: number;
  currency?: Currency;
  paidStatus?: 'paid' | 'unpaid';
  note?: string;
}) {
  const existing = await getExpense(expenseId);
  if (!existing) throw new AppError('Expense not found', 404, 'EXPENSE_NOT_FOUND');

  const next: Expense = {
    ...existing,
    ...input,
    amount: money(input.amount ?? existing.amount.amount, input.currency ?? existing.amount.currency),
    paidStatus: input.paidStatus ?? existing.paidStatus
  };

  await requireDb().ref(`accounting/expenses/${expenseId}`).set(next);
  await deleteJournalEntry('expense', expenseId, existing.paidStatus);
  await postExpenseJournal(next);
  return next;
}

export async function deleteExpense(expenseId: string) {
  const existing = await getExpense(expenseId);
  if (!existing) throw new AppError('Expense not found', 404, 'EXPENSE_NOT_FOUND');

  await requireDb().ref(`accounting/expenses/${expenseId}`).remove();
  await deleteJournalEntry('expense', expenseId, existing.paidStatus);
  return { id: expenseId };
}

async function getProduct(productId: string) {
  const snapshot = await requireDb().ref(`inventory/products/${productId}`).get();
  const product = snapshot.val() as Omit<Product, 'id'> | null;
  return product ? ({ id: productId, ...product } as Product) : null;
}

export async function createPurchase(input: {
  productId: string;
  supplierContactId?: string;
  quantity: number;
  unitCost: number;
  currency: Currency;
  paidStatus: 'paid' | 'unpaid';
  note?: string;
}) {
  const product = await getProduct(input.productId);
  if (!product) throw new AppError('Product not found', 404, 'PRODUCT_NOT_FOUND');
  if ((product.currency ?? 'USD') !== input.currency) throw new AppError('Purchase currency must match product currency', 400, 'CURRENCY_MISMATCH');

  const timestamp = now();
  const total = money(input.quantity * input.unitCost, input.currency);
  const ref = requireDb().ref('accounting/purchases').push();
  const purchase: Purchase = {
    id: ref.key!,
    productId: input.productId,
    supplierContactId: input.supplierContactId ?? '',
    quantity: input.quantity,
    unitCost: money(input.unitCost, input.currency),
    total,
    paidStatus: input.paidStatus,
    note: input.note ?? '',
    createdAt: timestamp
  };

  await ref.set(purchase);
  await requireDb().ref(`inventory/products/${input.productId}`).update({
    quantityOnHand: (product.quantityOnHand ?? 0) + input.quantity,
    costPrice: input.unitCost,
    updatedAt: timestamp
  });

  await postPurchaseJournal(purchase);

  return purchase;
}

async function getPurchase(purchaseId: string) {
  const snapshot = await requireDb().ref(`accounting/purchases/${purchaseId}`).get();
  return snapshot.val() as Purchase | null;
}

async function postPurchaseJournal(purchase: Purchase) {
  return postJournalEntry({
    sourceType: 'purchase',
    sourceId: purchase.id,
    sourceAction: purchase.paidStatus,
    memo: purchase.note || 'Stock purchase',
    partyId: purchase.supplierContactId,
    date: purchase.createdAt,
    lines: [
      { accountId: accountIds.inventory, debit: purchase.total.amount, currency: purchase.total.currency, partyId: purchase.supplierContactId, description: 'Inventory purchased' },
      { accountId: purchase.paidStatus === 'paid' ? accountIds.cash : accountIds.payable, credit: purchase.total.amount, currency: purchase.total.currency, partyId: purchase.supplierContactId, description: purchase.paidStatus === 'paid' ? 'Purchase paid' : 'Purchase payable' }
    ]
  });
}

export async function updatePurchase(purchaseId: string, input: {
  supplierContactId?: string;
  quantity?: number;
  unitCost?: number;
  currency?: Currency;
  paidStatus?: 'paid' | 'unpaid';
  note?: string;
}) {
  const existing = await getPurchase(purchaseId);
  if (!existing) throw new AppError('Purchase not found', 404, 'PURCHASE_NOT_FOUND');

  const product = await getProduct(existing.productId);
  if (!product) throw new AppError('Product not found', 404, 'PRODUCT_NOT_FOUND');

  const nextCurrency = input.currency ?? existing.total.currency;
  if ((product.currency ?? 'USD') !== nextCurrency) throw new AppError('Purchase currency must match product currency', 400, 'CURRENCY_MISMATCH');

  const nextQuantity = input.quantity ?? existing.quantity;
  const nextUnitCost = input.unitCost ?? existing.unitCost.amount;
  const quantityDelta = nextQuantity - existing.quantity;
  if (quantityDelta < 0 && (product.quantityOnHand ?? 0) < Math.abs(quantityDelta)) {
    throw new AppError('Cannot reduce purchase quantity because stock was already used', 400, 'PURCHASE_STOCK_ALREADY_USED');
  }

  const next: Purchase = {
    ...existing,
    supplierContactId: input.supplierContactId ?? existing.supplierContactId,
    quantity: nextQuantity,
    unitCost: money(nextUnitCost, nextCurrency),
    total: money(nextQuantity * nextUnitCost, nextCurrency),
    paidStatus: input.paidStatus ?? existing.paidStatus,
    note: input.note ?? existing.note
  };

  await requireDb().ref(`accounting/purchases/${purchaseId}`).set(next);
  await requireDb().ref(`inventory/products/${existing.productId}`).update({
    quantityOnHand: (product.quantityOnHand ?? 0) + quantityDelta,
    costPrice: nextUnitCost,
    updatedAt: now()
  });
  await deleteJournalEntry('purchase', purchaseId, existing.paidStatus);
  await postPurchaseJournal(next);
  return next;
}

export async function deletePurchase(purchaseId: string) {
  const existing = await getPurchase(purchaseId);
  if (!existing) throw new AppError('Purchase not found', 404, 'PURCHASE_NOT_FOUND');

  const product = await getProduct(existing.productId);
  if (!product) throw new AppError('Product not found', 404, 'PRODUCT_NOT_FOUND');
  if ((product.quantityOnHand ?? 0) < existing.quantity) {
    throw new AppError('Cannot delete purchase because its stock was already used', 400, 'PURCHASE_STOCK_ALREADY_USED');
  }

  await requireDb().ref(`accounting/purchases/${purchaseId}`).remove();
  await requireDb().ref(`inventory/products/${existing.productId}`).update({
    quantityOnHand: (product.quantityOnHand ?? 0) - existing.quantity,
    updatedAt: now()
  });
  await deleteJournalEntry('purchase', purchaseId, existing.paidStatus);
  return { id: purchaseId };
}

export async function getJournalEntries() {
  const snapshot = await requireDb().ref('accounting/journalEntries').get();
  return collectionToArray<JournalEntry>(snapshot.val()).sort((a, b) => b.date.localeCompare(a.date));
}

export async function getExpenses() {
  const snapshot = await requireDb().ref('accounting/expenses').get();
  return collectionToArray<Expense>(snapshot.val());
}

export async function getPurchases() {
  const snapshot = await requireDb().ref('accounting/purchases').get();
  return collectionToArray<Purchase>(snapshot.val());
}

async function getAccountingCollections() {
  const [accounts, journalEntries, expenses, purchases] = await Promise.all([getAccounts(), getJournalEntries(), getExpenses(), getPurchases()]);
  return { accounts, journalEntries, expenses, purchases };
}

function calculateAccountBalances(accounts: Account[], entries: JournalEntry[]) {
  return accounts.map((account) => {
    const raw = emptyCurrencyMap();
    for (const entry of entries) {
      for (const line of entry.lines) {
        if (line.accountId !== account.id) continue;
        addAmount(raw, line.currency, line.debit - line.credit);
      }
    }

    return {
      account,
      raw,
      balance: {
        USD: round(raw.USD * balanceSign(account.type)),
        SYP: round(raw.SYP * balanceSign(account.type))
      }
    };
  });
}

function sumBalances(rows: Array<{ balance: Record<Currency, number> }>) {
  return rows.reduce(
    (total, row) => ({ USD: round(total.USD + row.balance.USD), SYP: round(total.SYP + row.balance.SYP) }),
    emptyCurrencyMap()
  );
}

export async function getFinancialStatements() {
  const { accounts, journalEntries } = await getAccountingCollections();
  const accountBalances = calculateAccountBalances(accounts, journalEntries);
  const byId = accountBalances.reduce<Record<string, (typeof accountBalances)[number]>>((map, item) => {
    map[item.account.id] = item;
    return map;
  }, {});

  const revenue = byId[accountIds.revenue]?.balance ?? emptyCurrencyMap();
  const cogs = byId[accountIds.cogs]?.balance ?? emptyCurrencyMap();
  const operatingExpenses = byId[accountIds.expenses]?.balance ?? emptyCurrencyMap();
  const grossProfit = { USD: round(revenue.USD - cogs.USD), SYP: round(revenue.SYP - cogs.SYP) };
  const netProfit = { USD: round(grossProfit.USD - operatingExpenses.USD), SYP: round(grossProfit.SYP - operatingExpenses.SYP) };

  const assetRows = accountBalances.filter((item) => item.account.type === 'asset');
  const liabilityRows = accountBalances.filter((item) => item.account.type === 'liability');
  const equityRows = accountBalances.filter((item) => item.account.type === 'equity');
  const assetsTotal = sumBalances(assetRows);
  const liabilitiesTotal = sumBalances(liabilityRows);
  const equityBaseTotal = sumBalances(equityRows);
  const equityTotal = { USD: round(equityBaseTotal.USD + netProfit.USD), SYP: round(equityBaseTotal.SYP + netProfit.SYP) };

  return {
    generatedAt: now(),
    profitAndLoss: {
      revenue,
      cogs,
      grossProfit,
      operatingExpenses,
      netProfit
    },
    balanceSheet: {
      assets: assetRows,
      liabilities: liabilityRows,
      equity: equityRows,
      currentEarnings: netProfit,
      totals: {
        assets: assetsTotal,
        liabilities: liabilitiesTotal,
        equity: equityTotal,
        liabilitiesAndEquity: { USD: round(liabilitiesTotal.USD + equityTotal.USD), SYP: round(liabilitiesTotal.SYP + equityTotal.SYP) }
      }
    },
    accountBalances
  };
}

export async function getAccountingDashboard() {
  const [{ journalEntries, expenses, purchases }, statements] = await Promise.all([getAccountingCollections(), getFinancialStatements()]);
  const balances = statements.accountBalances.reduce<Record<string, Record<Currency, number>>>((map, row) => {
    map[row.account.id] = row.balance;
    return map;
  }, {});

  return {
    generatedAt: now(),
    metrics: {
      cash: balances[accountIds.cash] ?? emptyCurrencyMap(),
      receivables: balances[accountIds.receivable] ?? emptyCurrencyMap(),
      inventory: balances[accountIds.inventory] ?? emptyCurrencyMap(),
      payables: balances[accountIds.payable] ?? emptyCurrencyMap(),
      revenue: statements.profitAndLoss.revenue,
      cogs: statements.profitAndLoss.cogs,
      grossProfit: statements.profitAndLoss.grossProfit,
      expenses: statements.profitAndLoss.operatingExpenses,
      netProfit: statements.profitAndLoss.netProfit
    },
    counts: {
      journalEntries: journalEntries.length,
      unbalancedEntries: journalEntries.filter((entry) => !entry.balanced).length,
      expenses: expenses.length,
      purchases: purchases.length
    },
    recentEntries: journalEntries.slice(0, 8)
  };
}

async function getInventoryCollections() {
  const [productsSnapshot, holdsSnapshot, salesSnapshot, paymentsSnapshot, rollsSnapshot] = await Promise.all([
    requireDb().ref('inventory/products').get(),
    requireDb().ref('inventory/holds').get(),
    requireDb().ref('inventory/sales').get(),
    requireDb().ref('inventory/payments').get(),
    requireDb().ref('inventory/cableRolls').get()
  ]);

  return {
    products: collectionToArray<Product>(productsSnapshot.val()),
    holds: collectionToArray<Hold>(holdsSnapshot.val()),
    sales: collectionToArray<Sale>(salesSnapshot.val()),
    payments: collectionToArray<Payment>(paymentsSnapshot.val()),
    cableRolls: collectionToArray<CableRoll>(rollsSnapshot.val())
  };
}

export async function runAccountingBackfill() {
  const timestamp = now();
  const collections = await getInventoryCollections();
  let createdEntries = 0;
  let skippedEntries = 0;

  async function count(result: Awaited<ReturnType<typeof postJournalEntry>> | Awaited<ReturnType<typeof recordSaleAccounting>> | Awaited<ReturnType<typeof recordPaymentAccounting>> | null) {
    if (!result) return;
    if (result.created) createdEntries += 1;
    else skippedEntries += 1;
  }

  for (const product of collections.products) {
    const quantity = (product.quantityOnHand ?? 0) + (product.quantityOnHold ?? 0);
    await count(await recordOpeningInventoryAccounting({
      sourceType: 'product',
      sourceId: product.id,
      amount: money(quantity * (product.costPrice ?? 0), product.currency ?? 'USD'),
      memo: `Opening stock value for ${product.name}`,
      date: product.createdAt ?? timestamp
    }));
  }

  for (const roll of collections.cableRolls) {
    await count(await recordOpeningInventoryAccounting({
      sourceType: 'cable_roll',
      sourceId: roll.id,
      amount: money((roll.remainingMeters ?? 0) * (roll.costPerMeter?.amount ?? 0), roll.costPerMeter?.currency ?? 'USD'),
      memo: 'Opening cable roll value',
      date: roll.createdAt ?? timestamp
    }));
  }

  for (const sale of collections.sales) {
    const product = collections.products.find((item) => item.id === sale.productId);
    const roll = sale.cableRollId ? collections.cableRolls.find((item) => item.id === sale.cableRollId) : undefined;
    const costPerUnit = roll?.costPerMeter?.amount ?? product?.costPrice ?? 0;
    const costCurrency = roll?.costPerMeter?.currency ?? product?.currency ?? sale.total.currency;
    await count(await recordSaleAccounting({
      sourceType: sale.cableRollId ? 'cable_sale' : 'sale',
      sourceId: sale.id,
      sourceAction: 'backfill',
      productId: sale.productId,
      partyId: sale.finalCustomerId || sale.responsibleContactId,
      quantity: sale.quantity,
      total: sale.total,
      costPerUnit,
      costCurrency,
      memo: sale.note || 'Backfilled sale',
      date: sale.createdAt
    }));
  }

  for (const hold of collections.holds) {
    if ((hold.quantitySold ?? 0) <= 0) continue;
    const product = collections.products.find((item) => item.id === hold.productId);
    const currency = hold.currency ?? 'USD';
    await count(await recordSaleAccounting({
      sourceType: 'hold',
      sourceId: hold.id,
      sourceAction: 'backfill_sold',
      productId: hold.productId,
      partyId: hold.finalCustomerId || hold.contactId,
      quantity: hold.quantitySold,
      total: money(hold.quantitySold * hold.unitPrice, currency),
      costPerUnit: product?.costPrice ?? 0,
      costCurrency: product?.currency ?? currency,
      memo: hold.note || 'Backfilled hold settlement',
      date: hold.createdAt
    }));
  }

  for (const payment of collections.payments) {
    await count(await recordPaymentAccounting({
      sourceId: payment.id,
      amount: payment.amount,
      partyId: payment.customerId || payment.contactId || payment.targetId,
      memo: payment.note || `Backfilled ${payment.targetType} payment`,
      date: payment.createdAt
    }));
  }

  const backfillRef = requireDb().ref('accounting/accountingBackfills/historical-v1');
  const previous = (await backfillRef.get()).val() as { runCount?: number; firstRunAt?: string } | null;
  const result = {
    id: 'historical-v1',
    firstRunAt: previous?.firstRunAt ?? timestamp,
    lastRunAt: timestamp,
    runCount: (previous?.runCount ?? 0) + 1,
    createdEntries,
    skippedEntries,
    sourceCounts: {
      products: collections.products.length,
      cableRolls: collections.cableRolls.length,
      sales: collections.sales.length,
      holds: collections.holds.length,
      payments: collections.payments.length
    }
  };
  await backfillRef.set(result);
  return result;
}
