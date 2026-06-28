import type { FastifyInstance } from 'fastify';
import { enrichHold, enrichSale, getInventoryCollections, groupMoney, money } from '../inventory.service.js';

export async function dashboardRoutes(app: FastifyInstance) {
  app.get('/inventory/summary', async () => {
    const collections = await getInventoryCollections();
    const holds = collections.holds.map(enrichHold);
    const sales = collections.sales.map(enrichSale);
    const holdBalances = holds.map((hold) => money(hold.balanceDue, hold.currency));
    const saleBalances = sales.map((sale) => sale.balanceDue);

    return {
      success: true,
      data: {
        totalProducts: collections.products.length,
        totalContacts: collections.contacts.length,
        totalCategories: collections.categories.length,
        totalCableRolls: collections.cableRolls.length,
        lowCableRolls: collections.cableRolls.filter((roll) => roll.remainingMeters <= roll.lowMeterAlert).length,
        stockOnHand: collections.products.reduce((sum, product) => sum + product.quantityOnHand, 0),
        stockOnHold: collections.products.reduce((sum, product) => sum + product.quantityOnHold, 0),
        activeHolds: holds.filter((hold) => hold.status !== 'settled').length,
        unpaidBalance: groupMoney([...holdBalances, ...saleBalances])
      }
    };
  });
}
