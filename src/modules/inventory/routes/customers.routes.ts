import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../../utils/app-error.js';
import { recordCustomerDebtInvoiceAccounting } from '../../accounting/accounting.service.js';
import { customerDebtInvoiceCreateSchema } from '../inventory.schema.js';
import type { CustomerDebtInvoice } from '../inventory.types.js';
import { buildPartyLedger, getContact, getInventoryCollections, money, now, requireDb } from '../inventory.service.js';

export async function customersRoutes(app: FastifyInstance) {
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

    const timestamp = now();
    const ref = requireDb().ref('inventory/customerDebtInvoices').push();
    const invoice: Omit<CustomerDebtInvoice, 'id'> = {
      customerId: id,
      amount: money(input.amount, input.currency),
      note: input.note,
      date: input.date || timestamp,
      createdAt: timestamp
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
}
