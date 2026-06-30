export type Currency = 'USD' | 'SYP';

export type Money = {
  amount: number;
  currency: Currency;
};

export type Category = {
  id: string;
  name: string;
  parentId: string;
  description: string;
  createdAt: string;
  updatedAt: string;
};

export type Product = {
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

export type Contact = {
  id: string;
  type: 'dealer' | 'customer' | 'worker' | 'supplier';
  name: string;
  phone: string;
  address: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type Hold = {
  id: string;
  receiptId?: string;
  productId: string;
  contactId: string;
  finalCustomerId?: string;
  quantityHeld: number;
  quantitySold: number;
  quantityReturned: number;
  unitPrice: number;
  currency?: Currency;
  discountAmount: number;
  paidAmount: number;
  status: 'active' | 'awaiting_payment' | 'settled';
  note: string;
  createdAt: string;
  updatedAt: string;
  settledAt?: string;
};

export type HoldReceipt = {
  id: string;
  receiptNumber: string;
  contactId: string;
  finalCustomerId?: string;
  itemIds: string[];
  note: string;
  createdAt: string;
  updatedAt: string;
};

export type HoldRequestItem = {
  productId: string;
  quantity: number;
  unitPrice: number;
  currency: Currency;
  note: string;
};

export type HoldRequest = {
  id: string;
  workerContactId: string;
  requestedByUserId: string;
  requestedByUsername: string;
  items: HoldRequestItem[];
  status: 'pending' | 'approved' | 'rejected' | 'canceled';
  note: string;
  adminNote: string;
  holdReceiptId?: string;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  approvedBy?: string;
  rejectedAt?: string;
  rejectedBy?: string;
  canceledAt?: string;
};

export type Sale = {
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

export type Payment = {
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

export type CustomerDebtInvoice = {
  id: string;
  customerId: string;
  amount: Money;
  note: string;
  date: string;
  createdAt: string;
};

export type CableRoll = {
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

export type CableCut = {
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

export type MovementType =
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
