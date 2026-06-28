import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../../utils/app-error.js';
import { deleteJournalEntry, recordSaleAccounting } from '../../accounting/accounting.service.js';
import { cableCutSchema, cableRollAdjustSchema, cableRollCreateSchema, cableRollUpdateSchema } from '../inventory.schema.js';
import type { CableCut, CableRoll, Sale } from '../inventory.types.js';
import { addMovement, collectionToArray, getCableRoll, getCategory, getContact, getInventoryCollections, getProduct, money, now, removeMovementsForReference, requireDb, withoutId } from '../inventory.service.js';

export async function cablesRoutes(app: FastifyInstance) {
  app.get('/cables/rolls', async () => {
    const snapshot = await requireDb().ref('inventory/cableRolls').get();
    return {
      success: true,
      data: collectionToArray<CableRoll>(snapshot.val())
    };
  });

  app.post('/cables/rolls', async (request, reply) => {
    const input = cableRollCreateSchema.parse(request.body);
    const product = await getProduct(input.productId);
    if (!product) throw new AppError('Product not found', 404, 'PRODUCT_NOT_FOUND');
    const remainingMeters = input.remainingMeters ?? input.originalMeters;
    if (remainingMeters > input.originalMeters) throw new AppError('Remaining meters cannot exceed original meters', 400, 'INVALID_CABLE_METERS');

    const ref = requireDb().ref('inventory/cableRolls').push();
    const timestamp = now();
    const roll: Omit<CableRoll, 'id'> = {
      productId: input.productId,
      rollCode: input.rollCode,
      cableType: input.cableType,
      categoryId: input.categoryId,
      color: input.color,
      originalMeters: input.originalMeters,
      remainingMeters,
      costPerMeter: money(input.costPerMeter, input.currency),
      salePricePerMeter: money(input.salePricePerMeter, input.currency),
      location: input.location,
      lowMeterAlert: input.lowMeterAlert,
      notes: input.notes,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    await ref.set(roll);
    await addMovement({
      productId: input.productId,
      type: 'cable_roll_create',
      quantity: remainingMeters,
      beforeQuantity: 0,
      afterQuantity: remainingMeters,
      referenceType: 'cableRoll',
      referenceId: ref.key!,
      note: 'Cable roll created'
    });

    return reply.status(201).send({
      success: true,
      data: { id: ref.key!, ...roll }
    });
  });

  app.patch('/cables/rolls/:id', async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const input = cableRollUpdateSchema.parse(request.body);
    const roll = await getCableRoll(id);
    if (!roll) throw new AppError('Cable roll not found', 404, 'CABLE_ROLL_NOT_FOUND');
    if (input.categoryId && !(await getCategory(input.categoryId))) throw new AppError('Category not found', 404, 'CATEGORY_NOT_FOUND');
    const next = {
      ...withoutId(roll),
      ...input,
      costPerMeter:
        input.costPerMeter !== undefined || input.currency
          ? money(input.costPerMeter ?? roll.costPerMeter.amount, input.currency ?? roll.costPerMeter.currency)
          : roll.costPerMeter,
      salePricePerMeter:
        input.salePricePerMeter !== undefined || input.currency
          ? money(input.salePricePerMeter ?? roll.salePricePerMeter.amount, input.currency ?? roll.salePricePerMeter.currency)
          : roll.salePricePerMeter,
      updatedAt: now()
    };
    await requireDb().ref(`inventory/cableRolls/${id}`).set(next);
    return { success: true, data: { id, ...next } };
  });

  app.delete('/cables/rolls/:id', async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const roll = await getCableRoll(id);
    if (!roll) throw new AppError('Cable roll not found', 404, 'CABLE_ROLL_NOT_FOUND');

    const collections = await getInventoryCollections();
    if (collections.cableCuts.some((cut) => cut.cableRollId === id)) {
      throw new AppError('Cable roll has cuts and cannot be deleted', 400, 'CABLE_ROLL_HAS_CUTS');
    }
    if (roll.remainingMeters !== roll.originalMeters) {
      throw new AppError('Cable roll meters were adjusted and cannot be deleted', 400, 'CABLE_ROLL_HAS_ACTIVITY');
    }

    await requireDb().ref(`inventory/cableRolls/${id}`).remove();
    await removeMovementsForReference('cableRoll', id);
    await deleteJournalEntry('cable_roll', id, 'opening_inventory');

    return {
      success: true,
      data: { id }
    };
  });

  app.post('/cables/rolls/:id/adjust', async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const input = cableRollAdjustSchema.parse(request.body);
    const roll = await getCableRoll(id);
    if (!roll) throw new AppError('Cable roll not found', 404, 'CABLE_ROLL_NOT_FOUND');
    if (input.remainingMeters > roll.originalMeters) throw new AppError('Remaining meters cannot exceed original meters', 400, 'INVALID_CABLE_METERS');

    const next = {
      ...withoutId(roll),
      remainingMeters: input.remainingMeters,
      updatedAt: now()
    };
    await requireDb().ref(`inventory/cableRolls/${id}`).set(next);
    await addMovement({
      productId: roll.productId,
      type: 'cable_roll_adjust',
      quantity: input.remainingMeters - roll.remainingMeters,
      beforeQuantity: roll.remainingMeters,
      afterQuantity: input.remainingMeters,
      referenceType: 'cableRoll',
      referenceId: id,
      note: input.note
    });

    return {
      success: true,
      data: { id, ...next }
    };
  });

  app.post('/cables/rolls/:id/cut', async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const input = cableCutSchema.parse(request.body);
    const roll = await getCableRoll(id);
    if (!roll) throw new AppError('Cable roll not found', 404, 'CABLE_ROLL_NOT_FOUND');
    if (input.meters > roll.remainingMeters) throw new AppError('Cut meters exceed remaining roll meters', 400, 'INSUFFICIENT_CABLE_METERS');
    if (input.responsibleContactId && !(await getContact(input.responsibleContactId))) throw new AppError('Responsible contact not found', 404, 'CONTACT_NOT_FOUND');
    if (input.finalCustomerId && !(await getContact(input.finalCustomerId))) throw new AppError('Final customer not found', 404, 'CUSTOMER_NOT_FOUND');

    const timestamp = now();
    const nextRoll = {
      ...withoutId(roll),
      remainingMeters: roll.remainingMeters - input.meters,
      updatedAt: timestamp
    };
    await requireDb().ref(`inventory/cableRolls/${id}`).set(nextRoll);

    let saleId = '';
    const total = money(input.meters * input.pricePerMeter, input.currency);
    if (input.destinationType === 'sale') {
      const saleRef = requireDb().ref('inventory/sales').push();
      const sale: Omit<Sale, 'id'> = {
        productId: roll.productId,
        cableRollId: id,
        cableCutId: '',
        responsibleContactId: input.responsibleContactId,
        finalCustomerId: input.finalCustomerId,
        quantity: input.meters,
        unitPrice: money(input.pricePerMeter, input.currency),
        total,
        paidAmount: money(0, input.currency),
        status: 'unpaid',
        note: input.note,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      await saleRef.set(sale);
      saleId = saleRef.key!;
    }

    const cutRef = requireDb().ref('inventory/cableCuts').push();
    const cut: Omit<CableCut, 'id'> = {
      cableRollId: id,
      productId: roll.productId,
      destinationType: input.destinationType,
      responsibleContactId: input.responsibleContactId,
      finalCustomerId: input.finalCustomerId,
      meters: input.meters,
      pricePerMeter: money(input.pricePerMeter, input.currency),
      total,
      saleId,
      note: input.note,
      createdAt: timestamp
    };
    await cutRef.set(cut);

    if (saleId) {
      await requireDb().ref(`inventory/sales/${saleId}/cableCutId`).set(cutRef.key!);
    }

    await addMovement({
      productId: roll.productId,
      type: 'cable_cut',
      quantity: input.meters,
      beforeQuantity: roll.remainingMeters,
      afterQuantity: nextRoll.remainingMeters,
      referenceType: 'cableCut',
      referenceId: cutRef.key!,
      note: input.note
    });
    if (saleId) {
      await recordSaleAccounting({
        sourceType: 'cable_sale',
        sourceId: saleId,
        productId: roll.productId,
        partyId: input.finalCustomerId || input.responsibleContactId,
        quantity: input.meters,
        total,
        costPerUnit: roll.costPerMeter.amount,
        costCurrency: roll.costPerMeter.currency,
        memo: input.note || 'Cable sale',
        date: timestamp
      });
    }

    return reply.status(201).send({
      success: true,
      data: {
        roll: { id, ...nextRoll },
        cut: { id: cutRef.key!, ...cut },
        saleId
      }
    });
  });

  app.get('/cables/cuts', async () => {
    const snapshot = await requireDb().ref('inventory/cableCuts').get();
    return {
      success: true,
      data: collectionToArray<CableCut>(snapshot.val())
    };
  });
}
