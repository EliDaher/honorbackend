import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../../utils/app-error.js';
import { buildPartyLedger, getContact, getInventoryCollections } from '../inventory.service.js';

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
}
