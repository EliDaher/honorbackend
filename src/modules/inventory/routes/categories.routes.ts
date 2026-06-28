import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../../utils/app-error.js';
import { categoryCreateSchema, categoryUpdateSchema } from '../inventory.schema.js';
import type { Category } from '../inventory.types.js';
import { getCategory, getInventoryCollections, now, requireDb, withoutId } from '../inventory.service.js';

export async function categoriesRoutes(app: FastifyInstance) {
  app.get('/categories', async () => {
    const collections = await getInventoryCollections();
    const productCounts = collections.products.reduce<Record<string, number>>((counts, product) => {
      if (product.categoryId) counts[product.categoryId] = (counts[product.categoryId] ?? 0) + 1;
      return counts;
    }, {});
    const cableRollCounts = collections.cableRolls.reduce<Record<string, number>>((counts, roll) => {
      if (roll.categoryId) counts[roll.categoryId] = (counts[roll.categoryId] ?? 0) + 1;
      return counts;
    }, {});

    return {
      success: true,
      data: collections.categories.map((category) => ({
        ...category,
        productCount: productCounts[category.id] ?? 0,
        cableRollCount: cableRollCounts[category.id] ?? 0
      }))
    };
  });

  app.post('/categories', async (request, reply) => {
    const input = categoryCreateSchema.parse(request.body);
    if (input.parentId && !(await getCategory(input.parentId))) {
      throw new AppError('Parent category not found', 404, 'CATEGORY_NOT_FOUND');
    }

    const ref = requireDb().ref('inventory/categories').push();
    const timestamp = now();
    const category: Omit<Category, 'id'> = {
      ...input,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    await ref.set(category);

    return reply.status(201).send({
      success: true,
      data: { id: ref.key, ...category }
    });
  });

  app.patch('/categories/:id', async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const input = categoryUpdateSchema.parse(request.body);
    const existing = await getCategory(id);
    if (!existing) throw new AppError('Category not found', 404, 'CATEGORY_NOT_FOUND');
    if (input.parentId && input.parentId === id) throw new AppError('Category cannot be its own parent', 400, 'INVALID_CATEGORY_PARENT');
    if (input.parentId && !(await getCategory(input.parentId))) throw new AppError('Parent category not found', 404, 'CATEGORY_NOT_FOUND');

    const next = {
      ...withoutId(existing),
      ...input,
      updatedAt: now()
    };
    await requireDb().ref(`inventory/categories/${id}`).set(next);

    return {
      success: true,
      data: { id, ...next }
    };
  });

  app.delete('/categories/:id', async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const existing = await getCategory(id);
    if (!existing) throw new AppError('Category not found', 404, 'CATEGORY_NOT_FOUND');

    const collections = await getInventoryCollections();
    if (collections.categories.some((category) => category.parentId === id)) {
      throw new AppError('Category has child categories and cannot be deleted', 400, 'CATEGORY_HAS_CHILDREN');
    }
    if (collections.products.some((product) => product.categoryId === id)) {
      throw new AppError('Category is used by products and cannot be deleted', 400, 'CATEGORY_IN_USE');
    }
    if (collections.cableRolls.some((roll) => roll.categoryId === id)) {
      throw new AppError('Category is used by cable rolls and cannot be deleted', 400, 'CATEGORY_IN_USE');
    }

    await requireDb().ref(`inventory/categories/${id}`).remove();
    return {
      success: true,
      data: { id }
    };
  });
}
