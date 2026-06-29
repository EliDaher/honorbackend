import { z } from 'zod';

export const currencySchema = z.enum(['USD', 'SYP']).default('USD');

export const categoryCreateSchema = z.object({
  name: z.string().trim().min(1),
  parentId: z.string().trim().optional().default(''),
  description: z.string().trim().optional().default('')
});

export const categoryUpdateSchema = categoryCreateSchema.partial().refine((value) => Object.keys(value).length > 0, {
  message: 'At least one field is required'
});

export const productCreateSchema = z.object({
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

export const productUpdateSchema = z
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

export const stockSchema = z.object({
  quantity: z.coerce.number().int().positive(),
  note: z.string().trim().optional().default('')
});

export const contactCreateSchema = z.object({
  type: z.enum(['dealer', 'customer', 'worker', 'supplier']),
  name: z.string().trim().min(1),
  phone: z.string().trim().optional().default(''),
  address: z.string().trim().optional().default(''),
  notes: z.string().trim().optional().default('')
});

export const contactUpdateSchema = contactCreateSchema.partial().refine((value) => Object.keys(value).length > 0, {
  message: 'At least one field is required'
});

export const holdCreateSchema = z.object({
  productId: z.string().trim().min(1),
  contactId: z.string().trim().min(1),
  finalCustomerId: z.string().trim().optional().default(''),
  quantity: z.coerce.number().int().positive(),
  unitPrice: z.coerce.number().min(0),
  currency: currencySchema,
  note: z.string().trim().optional().default('')
});

export const holdReceiptCreateSchema = z.object({
  contactId: z.string().trim().min(1),
  finalCustomerId: z.string().trim().optional().default(''),
  note: z.string().trim().optional().default(''),
  items: z
    .array(
      z.object({
        productId: z.string().trim().min(1),
        quantity: z.coerce.number().int().positive(),
        unitPrice: z.coerce.number().min(0),
        currency: currencySchema,
        note: z.string().trim().optional().default('')
      })
    )
    .min(1)
});

export const holdUpdateSchema = z
  .object({
    contactId: z.string().trim().min(1).optional(),
    finalCustomerId: z.string().trim().optional(),
    unitPrice: z.coerce.number().min(0).optional(),
    currency: currencySchema.optional(),
    note: z.string().trim().optional()
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required'
  });

export const holdQuantitySchema = z.object({
  quantity: z.coerce.number().int().positive(),
  finalCustomerId: z.string().trim().optional().default(''),
  note: z.string().trim().optional().default('')
});

export const holdSellSchema = holdQuantitySchema.extend({
  discountPerUnit: z.coerce.number().min(0).optional().default(0)
});

export const holdReceiptSellSchema = z.object({
  finalCustomerId: z.string().trim().optional().default(''),
  discountAmount: z.coerce.number().min(0).optional().default(0),
  note: z.string().trim().optional().default('')
});

export const paymentSchema = z.object({
  amount: z.coerce.number().positive(),
  currency: currencySchema,
  date: z.string().trim().optional(),
  note: z.string().trim().optional().default('')
});

export const customerDebtInvoiceCreateSchema = z.object({
  amount: z.coerce.number().positive(),
  currency: currencySchema,
  date: z.string().trim().optional(),
  note: z.string().trim().optional().default('')
});

export const paymentCreateSchema = paymentSchema.extend({
  targetType: z.enum(['sale', 'hold', 'customer', 'contact']),
  targetId: z.string().trim().min(1),
  customerId: z.string().trim().optional().default(''),
  contactId: z.string().trim().optional().default('')
});

export const paymentUpdateSchema = z
  .object({
    amount: z.coerce.number().positive().optional(),
    currency: currencySchema.optional(),
    note: z.string().trim().optional()
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required'
  });

export const saleCreateSchema = z.object({
  productId: z.string().trim().optional().default(''),
  responsibleContactId: z.string().trim().optional().default(''),
  finalCustomerId: z.string().trim().optional().default(''),
  quantity: z.coerce.number().positive(),
  unitPrice: z.coerce.number().min(0),
  currency: currencySchema,
  note: z.string().trim().optional().default('')
});

export const saleUpdateSchema = z
  .object({
    responsibleContactId: z.string().trim().optional(),
    finalCustomerId: z.string().trim().optional(),
    note: z.string().trim().optional()
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required'
  });

export const cableRollCreateSchema = z.object({
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

export const cableRollUpdateSchema = z
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

export const cableRollAdjustSchema = z.object({
  remainingMeters: z.coerce.number().nonnegative(),
  note: z.string().trim().optional().default('')
});

export const cableCutSchema = z.object({
  destinationType: z.enum(['sale', 'hold', 'use']),
  responsibleContactId: z.string().trim().optional().default(''),
  finalCustomerId: z.string().trim().optional().default(''),
  meters: z.coerce.number().positive(),
  pricePerMeter: z.coerce.number().min(0),
  currency: currencySchema,
  note: z.string().trim().optional().default('')
});

export type PaymentInput = z.infer<typeof paymentSchema>;
