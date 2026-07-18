import type { FastifyInstance } from 'fastify';
import { inventoryMovementCreateSchema } from '../inventory.schema.js';
import { createManualInventoryMovement, getInventoryMovements } from '../inventory.service.js';

export async function inventoryMovementsRoutes(app: FastifyInstance) {
  app.get('/inventory-movements', async () => ({
    success: true,
    data: await getInventoryMovements()
  }));

  app.post('/inventory-movements', async (request, reply) => {
    const input = inventoryMovementCreateSchema.parse(request.body);
    const result = await createManualInventoryMovement({
      ...input,
      createdBy: request.user.username || request.user.id
    });

    return reply.status(201).send({ success: true, data: result });
  });
}
