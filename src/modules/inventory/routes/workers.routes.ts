import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../../utils/app-error.js';
import { buildPartyLedger, getContact, getInventoryCollections } from '../inventory.service.js';

export async function workersRoutes(app: FastifyInstance) {
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
}
