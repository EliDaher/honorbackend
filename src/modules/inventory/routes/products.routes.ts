import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../../utils/app-error.js';
import { deleteJournalEntry, recordOpeningInventoryAccounting } from '../../accounting/accounting.service.js';
import { productCreateSchema, productUpdateSchema, stockSchema } from '../inventory.schema.js';
import type { Product } from '../inventory.types.js';
import { addMovement, collectionToArray, getCategory, getInventoryCollections, getProduct, money, moveProductQuantity, normalizeProduct, now, removeMovementsForReference, requireDb, withoutId } from '../inventory.service.js';

export async function productsRoutes(app: FastifyInstance) {
  app.get('/products', async () => {
    const snapshot = await requireDb().ref('inventory/products').get();
    return {
      success: true,
      data: collectionToArray<Product>(snapshot.val()).map((product) => normalizeProduct(product.id, withoutId(product) as Omit<Product, 'id'>))
    };
  });

  app.post('/products', async (request, reply) => {
    const input = productCreateSchema.parse(request.body);
    const ref = requireDb().ref('inventory/products').push();
    const timestamp = now();
    const product: Omit<Product, 'id'> = {
      ...input,
      quantityOnHold: 0,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    await ref.set(product);

    if (input.quantityOnHand > 0) {
      await addMovement({
        productId: ref.key!,
        type: 'create_product',
        quantity: input.quantityOnHand,
        beforeQuantity: 0,
        afterQuantity: input.quantityOnHand,
        referenceType: 'product',
        referenceId: ref.key!,
        note: 'Initial product quantity'
      });
      if (input.costPrice > 0) {
        await recordOpeningInventoryAccounting({
          sourceType: 'product',
          sourceId: ref.key!,
          amount: money(input.quantityOnHand * input.costPrice, input.currency),
          memo: 'Initial product inventory value',
          date: timestamp
        });
      }
    }

    return reply.status(201).send({
      success: true,
      data: { id: ref.key, ...product }
    });
  });

  app.patch('/products/:id', async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const input = productUpdateSchema.parse(request.body);
    const existing = await getProduct(id);
    if (!existing) throw new AppError('Product not found', 404, 'PRODUCT_NOT_FOUND');
    if (input.categoryId && !(await getCategory(input.categoryId))) throw new AppError('Category not found', 404, 'CATEGORY_NOT_FOUND');

    const { id: _id, quantityOnHold, createdAt, ...updatableExisting } = existing;
    const next = {
      ...updatableExisting,
      ...input,
      quantityOnHold,
      createdAt,
      updatedAt: now()
    };

    await requireDb().ref(`inventory/products/${id}`).set(next);

    return {
      success: true,
      data: { id, ...next }
    };
  });

  app.delete('/products/:id', async (request) => {
    console.log('DELETE /products/:id');
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    console.log({ id: id });
    const existing = await getProduct(id);
    if (!existing) throw new AppError('Product not found', 404, 'PRODUCT_NOT_FOUND');
    // if ((existing.quantityOnHand ?? 0) > 0 || (existing.quantityOnHold ?? 0) > 0) {
    //   throw new AppError('Product still has stock and cannot be deleted', 400, 'PRODUCT_HAS_STOCK');
    // }

    const collections = await getInventoryCollections();
    if (collections.holds.some((hold) => hold.productId === id)) throw new AppError('Product is used by holds and cannot be deleted', 400, 'PRODUCT_IN_USE');
    if (collections.sales.some((sale) => sale.productId === id)) throw new AppError('Product is used by sales and cannot be deleted', 400, 'PRODUCT_IN_USE');
    if (collections.cableRolls.some((roll) => roll.productId === id)) throw new AppError('Product is used by cable rolls and cannot be deleted', 400, 'PRODUCT_IN_USE');
    if (collections.cableCuts.some((cut) => cut.productId === id)) throw new AppError('Product is used by cable cuts and cannot be deleted', 400, 'PRODUCT_IN_USE');

    await requireDb().ref(`inventory/products/${id}`).remove();
    await removeMovementsForReference('product', id);
    await deleteJournalEntry('product', id, 'opening_inventory');
    return {
      success: true,
      data: { id }
    };
  });

  app.post('/products/:id/stock', async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const input = stockSchema.parse(request.body);
    const result = await moveProductQuantity(id, (product) => ({
      ...product,
      quantityOnHand: product.quantityOnHand + input.quantity,
      updatedAt: now()
    }));

    await addMovement({
      productId: id,
      type: 'stock_in',
      quantity: input.quantity,
      beforeQuantity: result.beforeQuantity,
      afterQuantity: result.afterQuantity,
      referenceType: 'product',
      referenceId: id,
      note: input.note
    });

    return {
      success: true,
      data: result.product
    };
  });
}
