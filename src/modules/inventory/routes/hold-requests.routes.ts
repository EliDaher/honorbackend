import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../../utils/app-error.js';
import { requireRole } from '../../auth/auth.middleware.js';
import { holdRequestApprovalSchema, holdRequestCreateSchema, holdRequestRejectionSchema } from '../inventory.schema.js';
import type { HoldRequest, HoldRequestItem } from '../inventory.types.js';
import { collectionToArray, createHoldReceipt, getContact, getProduct, now, requireDb, withoutId } from '../inventory.service.js';

async function getHoldRequest(id: string) {
  const snapshot = await requireDb().ref(`inventory/holdRequests/${id}`).get();
  const value = snapshot.val() as Omit<HoldRequest, 'id'> | null;
  return value ? ({ id, ...value } as HoldRequest) : null;
}

async function assertWorkerContact(contactId: string) {
  const contact = await getContact(contactId);
  if (!contact || contact.type !== 'worker') throw new AppError('Worker not found', 404, 'WORKER_NOT_FOUND');
  return contact;
}

function requireWorkerContactId(request: FastifyRequest) {
  const contactId = request.user.contactId;
  if (!contactId) throw new AppError('Worker account is not linked to a worker contact', 400, 'WORKER_ACCOUNT_NOT_LINKED');
  return contactId;
}

async function buildRequestItems(items: Array<{ productId: string; quantity: number; note: string }>) {
  const requestedByProduct = new Map<string, number>();
  const products = new Map<string, Awaited<ReturnType<typeof getProduct>>>();

  for (const item of items) {
    const product = products.get(item.productId) ?? (await getProduct(item.productId));
    if (!product) throw new AppError('Product not found', 404, 'PRODUCT_NOT_FOUND');
    products.set(item.productId, product);
    requestedByProduct.set(item.productId, (requestedByProduct.get(item.productId) ?? 0) + item.quantity);
  }

  for (const [productId, quantity] of requestedByProduct.entries()) {
    const product = products.get(productId);
    if (!product || product.quantityOnHand < quantity) throw new AppError('Not enough quantity on hand', 400, 'INSUFFICIENT_STOCK');
  }

  return items.map<HoldRequestItem>((item) => {
    const product = products.get(item.productId);
    if (!product) throw new AppError('Product not found', 404, 'PRODUCT_NOT_FOUND');
    return {
      productId: item.productId,
      quantity: item.quantity,
      unitPrice: product.salePrice,
      currency: product.currency,
      note: item.note
    };
  });
}

function assertPending(request: HoldRequest) {
  if (request.status !== 'pending') throw new AppError('Hold request is not pending', 400, 'HOLD_REQUEST_NOT_PENDING');
}

function assertRequestAccess(request: FastifyRequest, holdRequest: HoldRequest) {
  if (request.user.role === 'admin') return;
  if (request.user.role === 'worker' && request.user.contactId === holdRequest.workerContactId) return;
  throw new AppError('Forbidden', 403, 'FORBIDDEN');
}

export async function holdRequestsRoutes(app: FastifyInstance) {
  app.get('/hold-requests', { preHandler: requireRole(['admin', 'worker']) }, async (request) => {
    const snapshot = await requireDb().ref('inventory/holdRequests').get();
    const requests = collectionToArray<HoldRequest>(snapshot.val());
    const visibleRequests =
      request.user.role === 'worker'
        ? requests.filter((holdRequest) => holdRequest.workerContactId === requireWorkerContactId(request))
        : requests;

    return {
      success: true,
      data: visibleRequests
    };
  });

  app.post('/hold-requests', { preHandler: requireRole(['admin', 'worker']) }, async (request, reply) => {
    const input = holdRequestCreateSchema.parse(request.body);
    const workerContactId = request.user.role === 'worker' ? requireWorkerContactId(request) : input.workerContactId;
    if (!workerContactId) throw new AppError('Worker contact is required', 400, 'WORKER_CONTACT_REQUIRED');
    await assertWorkerContact(workerContactId);

    const items = await buildRequestItems(input.items);
    const ref = requireDb().ref('inventory/holdRequests').push();
    const timestamp = now();
    const holdRequest: Omit<HoldRequest, 'id'> = {
      workerContactId,
      requestedByUserId: request.user.id,
      requestedByUsername: request.user.username,
      items,
      status: 'pending',
      note: input.note,
      adminNote: '',
      createdAt: timestamp,
      updatedAt: timestamp
    };

    await ref.set(holdRequest);

    return reply.status(201).send({
      success: true,
      data: { id: ref.key!, ...holdRequest }
    });
  });

  app.post('/hold-requests/:id/approve', { preHandler: requireRole(['admin']) }, async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const input = holdRequestApprovalSchema.parse(request.body);
    const holdRequest = await getHoldRequest(id);
    if (!holdRequest) throw new AppError('Hold request not found', 404, 'HOLD_REQUEST_NOT_FOUND');
    assertPending(holdRequest);

    await assertWorkerContact(holdRequest.workerContactId);
    const receipt = await createHoldReceipt({
      contactId: holdRequest.workerContactId,
      note: input.adminNote || holdRequest.note,
      items: input.items ?? holdRequest.items
    });

    const timestamp = now();
    const nextRequest: HoldRequest = {
      ...holdRequest,
      items: input.items ?? holdRequest.items,
      status: 'approved',
      adminNote: input.adminNote,
      holdReceiptId: receipt.id,
      approvedAt: timestamp,
      approvedBy: request.user.id,
      updatedAt: timestamp
    };

    await requireDb().ref(`inventory/holdRequests/${id}`).set(withoutId(nextRequest));

    return {
      success: true,
      data: {
        request: nextRequest,
        receipt
      }
    };
  });

  app.post('/hold-requests/:id/reject', { preHandler: requireRole(['admin']) }, async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const input = holdRequestRejectionSchema.parse(request.body);
    const holdRequest = await getHoldRequest(id);
    if (!holdRequest) throw new AppError('Hold request not found', 404, 'HOLD_REQUEST_NOT_FOUND');
    assertPending(holdRequest);

    const timestamp = now();
    const nextRequest: HoldRequest = {
      ...holdRequest,
      status: 'rejected',
      adminNote: input.adminNote,
      rejectedAt: timestamp,
      rejectedBy: request.user.id,
      updatedAt: timestamp
    };

    await requireDb().ref(`inventory/holdRequests/${id}`).set(withoutId(nextRequest));

    return {
      success: true,
      data: nextRequest
    };
  });

  app.post('/hold-requests/:id/cancel', { preHandler: requireRole(['admin', 'worker']) }, async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const holdRequest = await getHoldRequest(id);
    if (!holdRequest) throw new AppError('Hold request not found', 404, 'HOLD_REQUEST_NOT_FOUND');
    assertRequestAccess(request, holdRequest);
    assertPending(holdRequest);

    const timestamp = now();
    const nextRequest: HoldRequest = {
      ...holdRequest,
      status: 'canceled',
      canceledAt: timestamp,
      updatedAt: timestamp
    };

    await requireDb().ref(`inventory/holdRequests/${id}`).set(withoutId(nextRequest));

    return {
      success: true,
      data: nextRequest
    };
  });
}
