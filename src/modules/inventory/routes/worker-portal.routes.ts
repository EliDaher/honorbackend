import type { FastifyInstance } from 'fastify';
import { AppError } from '../../../utils/app-error.js';
import { requireRole } from '../../auth/auth.middleware.js';
import { buildPartyLedger, collectionToArray, getContact, getInventoryCollections, normalizeProduct, requireDb, withoutId } from '../inventory.service.js';
import type { Product } from '../inventory.types.js';

function requireWorkerContactId(contactId?: string) {
  if (!contactId) throw new AppError('Worker account is not linked to a worker contact', 400, 'WORKER_ACCOUNT_NOT_LINKED');
  return contactId;
}

export async function workerPortalRoutes(app: FastifyInstance) {
  app.get('/worker/me', { preHandler: requireRole(['worker']) }, async (request) => {
    const contactId = requireWorkerContactId(request.user.contactId);
    const worker = await getContact(contactId);
    if (!worker || worker.type !== 'worker') throw new AppError('Worker not found', 404, 'WORKER_NOT_FOUND');
    const collections = await getInventoryCollections();

    return {
      success: true,
      data: {
        ...worker,
        detail: buildPartyLedger(contactId, collections)
      }
    };
  });

  app.get('/worker/products', { preHandler: requireRole(['worker']) }, async () => {
    const snapshot = await requireDb().ref('inventory/products').get();
    const products = collectionToArray<Product>(snapshot.val()).map((product) => normalizeProduct(product.id, withoutId(product) as Omit<Product, 'id'>));

    return {
      success: true,
      data: products
        .map((product) => ({
          id: product.id,
          name: product.name,
          sku: product.sku,
          category: product.category,
          categoryId: product.categoryId,
          quantityOnHand: product.quantityOnHand,
          salePrice: product.salePrice,
          currency: product.currency,
          notes: product.notes,
          createdAt: product.createdAt,
          updatedAt: product.updatedAt
        }))
    };
  });
}
