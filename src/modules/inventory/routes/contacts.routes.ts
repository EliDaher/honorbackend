import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../../utils/app-error.js';
import { contactCreateSchema, contactUpdateSchema } from '../inventory.schema.js';
import type { Contact } from '../inventory.types.js';
import { collectionToArray, getContact, getInventoryCollections, now, requireDb } from '../inventory.service.js';

export async function contactsRoutes(app: FastifyInstance) {
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
    if (input.type && input.type !== existing.type) {
      const collections = await getInventoryCollections();
      const hasInventoryReference =
        collections.holds.some((hold) => hold.contactId === id || hold.finalCustomerId === id) ||
      collections.sales.some((sale) => sale.responsibleContactId === id || sale.finalCustomerId === id) ||
      collections.payments.some((payment) => payment.contactId === id || payment.customerId === id || payment.targetId === id) ||
      collections.cableCuts.some((cut) => cut.responsibleContactId === id || cut.finalCustomerId === id) ||
      collections.holdRequests.some((holdRequest) => holdRequest.workerContactId === id);
      if (hasInventoryReference) throw new AppError('Contact type cannot be changed while it has related records', 400, 'CONTACT_TYPE_IN_USE');
    }

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

  app.delete('/contacts/:id', async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const existing = await getContact(id);
    if (!existing) throw new AppError('Contact not found', 404, 'CONTACT_NOT_FOUND');

    const collections = await getInventoryCollections();
    const [expensesSnapshot, purchasesSnapshot] = await Promise.all([
      requireDb().ref('accounting/expenses').get(),
      requireDb().ref('accounting/purchases').get()
    ]);
    const expenses = collectionToArray<{ id: string; vendorContactId: string }>(expensesSnapshot.val());
    const purchases = collectionToArray<{ id: string; supplierContactId: string }>(purchasesSnapshot.val());

    const inUse =
      collections.holds.some((hold) => hold.contactId === id || hold.finalCustomerId === id) ||
      collections.sales.some((sale) => sale.responsibleContactId === id || sale.finalCustomerId === id) ||
      collections.payments.some((payment) => payment.contactId === id || payment.customerId === id || payment.targetId === id) ||
      collections.cableCuts.some((cut) => cut.responsibleContactId === id || cut.finalCustomerId === id) ||
      collections.holdRequests.some((holdRequest) => holdRequest.workerContactId === id) ||
      expenses.some((expense) => expense.vendorContactId === id) ||
      purchases.some((purchase) => purchase.supplierContactId === id);

    if (inUse) throw new AppError('Contact has related records and cannot be deleted', 400, 'CONTACT_IN_USE');

    await requireDb().ref(`inventory/contacts/${id}`).remove();
    return {
      success: true,
      data: { id }
    };
  });
}
