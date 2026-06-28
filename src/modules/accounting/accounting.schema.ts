import { z } from 'zod';

export const currencySchema = z.enum(['USD', 'SYP']).default('USD');
export const paidStatusSchema = z.enum(['paid', 'unpaid']).default('paid');

export const expenseCreateSchema = z.object({
  category: z.string().trim().min(1).default('Operating expense'),
  vendorContactId: z.string().trim().optional().default(''),
  amount: z.coerce.number().positive(),
  currency: currencySchema,
  paidStatus: paidStatusSchema,
  note: z.string().trim().optional().default('')
});

export const expenseUpdateSchema = expenseCreateSchema.partial().refine((value) => Object.keys(value).length > 0, {
  message: 'At least one field is required'
});

export const purchaseCreateSchema = z.object({
  productId: z.string().trim().min(1),
  supplierContactId: z.string().trim().optional().default(''),
  quantity: z.coerce.number().positive(),
  unitCost: z.coerce.number().min(0),
  currency: currencySchema,
  paidStatus: paidStatusSchema,
  note: z.string().trim().optional().default('')
});

export const purchaseUpdateSchema = purchaseCreateSchema
  .omit({ productId: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required'
  });

export type ExpenseCreateInput = z.infer<typeof expenseCreateSchema>;
export type ExpenseUpdateInput = z.infer<typeof expenseUpdateSchema>;
export type PurchaseCreateInput = z.infer<typeof purchaseCreateSchema>;
export type PurchaseUpdateInput = z.infer<typeof purchaseUpdateSchema>;
