import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../utils/app-error.js';
import { requireAuth, requireRole } from '../auth/auth.middleware.js';
import { createUser, getUser, getUsers, updateUser } from '../auth/auth.service.js';
import { getContact } from '../inventory/inventory.service.js';

const userCreateSchema = z.object({
  username: z.string().trim().min(3),
  password: z.string().min(4),
  role: z.enum(['admin', 'worker']),
  contactId: z.string().trim().optional().default(''),
  isActive: z.boolean().optional().default(true)
});

const userUpdateSchema = z
  .object({
    username: z.string().trim().min(3).optional(),
    password: z.string().min(4).optional(),
    role: z.enum(['admin', 'worker']).optional(),
    contactId: z.string().trim().optional(),
    isActive: z.boolean().optional()
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required'
  });

async function assertWorkerContact(role: 'admin' | 'worker', contactId?: string) {
  if (role !== 'worker') return;
  if (!contactId) {
    throw new AppError('Worker account requires a worker contact', 400, 'WORKER_CONTACT_REQUIRED');
  }

  const contact = await getContact(contactId);
  if (!contact || contact.type !== 'worker') {
    throw new AppError('Worker contact not found', 404, 'WORKER_NOT_FOUND');
  }
}

export async function usersRoutes(app: FastifyInstance) {
  app.get('/users/me', { preHandler: requireAuth }, async (request) => {
    return {
      success: true,
      data: request.user
    };
  });

  app.get('/users', { preHandler: requireRole(['admin']) }, async () => {
    return {
      success: true,
      data: await getUsers()
    };
  });

  app.post('/users', { preHandler: requireRole(['admin']) }, async (request, reply) => {
    const input = userCreateSchema.parse(request.body);
    await assertWorkerContact(input.role, input.contactId);
    const user = await createUser({
      username: input.username,
      password: input.password,
      role: input.role,
      contactId: input.contactId || undefined,
      isActive: input.isActive
    });

    return reply.status(201).send({
      success: true,
      data: user
    });
  });

  app.patch('/users/:id', { preHandler: requireRole(['admin']) }, async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const input = userUpdateSchema.parse(request.body);
    const existing = await getUser(id);
    if (!existing) throw new AppError('User not found', 404, 'USER_NOT_FOUND');
    const nextRole = input.role ?? existing.role;
    const nextContactId = input.contactId ?? existing.contactId;
    await assertWorkerContact(nextRole, nextContactId);

    return {
      success: true,
      data: await updateUser(id, input)
    };
  });

  app.get('/users/admin-only', { preHandler: requireRole(['admin']) }, async () => {
    return {
      success: true,
      message: 'Only admin can access this endpoint'
    };
  });
}
