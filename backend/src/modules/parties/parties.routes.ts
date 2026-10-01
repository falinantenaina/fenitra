import { Router } from 'express';
import { asyncHandler } from '../../middleware/errorHandler';
import { parseBody, parseParams, parseQuery } from '../../middleware/validate';
import { managerOrAdmin, requireAuth } from '../../middleware/auth';
import { prisma } from '../../lib/prisma';
import { notFound } from '../../lib/errors';
import { money } from '../../lib/money';
import { boolFilter, ilike, offset, pageMeta } from '../../lib/pagination';
import {
  createCustomerSchema,
  createOnlineSellerSchema,
  createSupplierSchema,
  idParamSchema,
  partyListQuery,
  updateCustomerSchema,
  updateOnlineSellerSchema,
  updateSupplierSchema,
} from './parties.schemas';

const partySort = (s: string): Record<string, 'asc' | 'desc'> =>
  s.startsWith('-') ? { [s.slice(1)]: 'desc' } : { [s]: 'asc' };

interface PartyBody {
  name: string;
  phone?: string | null;
  address?: string | null;
  notes?: string | null;
}

const toParty = (p: {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  notes: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  status?: string;
}) => ({
  id: p.id,
  name: p.name,
  phone: p.phone,
  address: p.address,
  notes: p.notes,
  active: p.active,
  ...(p.status !== undefined ? { status: p.status } : {}),
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
});

/* ════════════════════ FOURNISSEURS ════════════════════ */

export const suppliersRouter = Router();

/** GET /api/suppliers */
suppliersRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const q = parseQuery(req, partyListQuery);
    const where = {
      ...(boolFilter(q.active) !== undefined ? { active: boolFilter(q.active) } : {}),
      ...(ilike(q.q) ? { name: ilike(q.q) } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.supplier.findMany({ where, orderBy: partySort(q.sort), skip: offset(q), take: q.limit }),
      prisma.supplier.count({ where }),
    ]);

    res.json({ items: items.map(toParty), ...pageMeta(total, q.page, q.limit) });
  }),
);

/** POST /api/suppliers */
suppliersRouter.post(
  '/',
  managerOrAdmin,
  asyncHandler(async (req, res) => {
    const body = parseBody(req, createSupplierSchema);
    const supplier = await prisma.supplier.create({ data: body as PartyBody });
    res.status(201).json(toParty(supplier));
  }),
);

/** GET /api/suppliers/:id/summary — arrivages, paiements, dette */
suppliersRouter.get(
  '/:id/summary',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(req, idParamSchema);
    const supplier = await prisma.supplier.findUnique({ where: { id } });
    if (!supplier) throw notFound('Fournisseur introuvable');

    const [arrivals, debts, openCount, payments] = await Promise.all([
      prisma.arrival.aggregate({
        where: { supplierId: id, status: { not: 'CANCELLED' } },
        _count: true,
        _sum: { totalCost: true, totalQty: true, paidAmount: true, unpaidAmount: true },
      }),
      prisma.debt.aggregate({
        where: { supplierId: id, type: 'SUPPLIER', status: { not: 'CANCELLED' } },
        _count: true,
        _sum: { initialAmount: true, paidAmount: true, remainingAmount: true },
      }),
      prisma.debt.count({
        where: { supplierId: id, type: 'SUPPLIER', status: { in: ['OPEN', 'PARTIAL'] } },
      }),
      prisma.payment.aggregate({
        where: { partyType: 'SUPPLIER', partyId: id },
        _count: true,
        _sum: { amount: true },
      }),
    ]);

    res.json({
      supplier: toParty(supplier),
      arrivals: {
        count: arrivals._count,
        totalCost: money(arrivals._sum.totalCost ?? 0),
        totalQty: arrivals._sum.totalQty ?? 0,
        paidAmount: money(arrivals._sum.paidAmount ?? 0),
        unpaidAmount: money(arrivals._sum.unpaidAmount ?? 0),
      },
      debts: {
        count: debts._count,
        openCount,
        initialAmount: money(debts._sum.initialAmount ?? 0),
        paidAmount: money(debts._sum.paidAmount ?? 0),
        remainingAmount: money(debts._sum.remainingAmount ?? 0),
      },
      payments: { count: payments._count, total: money(payments._sum.amount ?? 0) },
    });
  }),
);

/** GET /api/suppliers/:id */
suppliersRouter.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(req, idParamSchema);
    const supplier = await prisma.supplier.findUnique({ where: { id } });
    if (!supplier) throw notFound('Fournisseur introuvable');
    res.json(toParty(supplier));
  }),
);

/** PUT /api/suppliers/:id */
suppliersRouter.put(
  '/:id',
  managerOrAdmin,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(req, idParamSchema);
    const body = parseBody(req, updateSupplierSchema);
    const existing = await prisma.supplier.findUnique({ where: { id } });
    if (!existing) throw notFound('Fournisseur introuvable');

    const supplier = await prisma.supplier.update({ where: { id }, data: body });
    res.json(toParty(supplier));
  }),
);

/** DELETE /api/suppliers/:id — désactivation (l'historique reste lisible) */
suppliersRouter.delete(
  '/:id',
  managerOrAdmin,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(req, idParamSchema);
    const existing = await prisma.supplier.findUnique({ where: { id } });
    if (!existing) throw notFound('Fournisseur introuvable');

    await prisma.supplier.update({ where: { id }, data: { active: false } });
    res.status(204).end();
  }),
);

/* ════════════════════ CLIENTS ════════════════════ */

export const customersRouter = Router();

/** GET /api/customers */
customersRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const q = parseQuery(req, partyListQuery);
    const where = {
      ...(boolFilter(q.active) !== undefined ? { active: boolFilter(q.active) } : {}),
      ...(ilike(q.q) ? { name: ilike(q.q) } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.customer.findMany({ where, orderBy: partySort(q.sort), skip: offset(q), take: q.limit }),
      prisma.customer.count({ where }),
    ]);

    res.json({ items: items.map(toParty), ...pageMeta(total, q.page, q.limit) });
  }),
);

/** POST /api/customers */
customersRouter.post(
  '/',
  managerOrAdmin,
  asyncHandler(async (req, res) => {
    const body = parseBody(req, createCustomerSchema);
    const customer = await prisma.customer.create({ data: body as PartyBody });
    res.status(201).json(toParty(customer));
  }),
);

/** GET /api/customers/:id/summary — ventes, règlements, dettes */
customersRouter.get(
  '/:id/summary',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(req, idParamSchema);
    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) throw notFound('Client introuvable');

    const [sales, cancelledSales, debts, openCount, payments] = await Promise.all([
      prisma.sale.aggregate({
        where: { customerId: id, status: { not: 'CANCELLED' } },
        _count: true,
        _sum: { totalAmount: true, paidAmount: true, remainingAmount: true, cogs: true, margin: true },
      }),
      prisma.sale.count({ where: { customerId: id, status: 'CANCELLED' } }),
      prisma.debt.aggregate({
        where: { customerId: id, type: 'CUSTOMER', status: { not: 'CANCELLED' } },
        _count: true,
        _sum: { initialAmount: true, paidAmount: true, remainingAmount: true },
      }),
      prisma.debt.count({ where: { customerId: id, type: 'CUSTOMER', status: { in: ['OPEN', 'PARTIAL'] } } }),
      prisma.payment.aggregate({
        where: { partyType: 'CUSTOMER', partyId: id },
        _count: true,
        _sum: { amount: true },
      }),
    ]);

    res.json({
      customer: toParty(customer),
      sales: {
        count: sales._count,
        cancelledCount: cancelledSales,
        totalAmount: money(sales._sum.totalAmount ?? 0),
        paidAmount: money(sales._sum.paidAmount ?? 0),
        remainingAmount: money(sales._sum.remainingAmount ?? 0),
        cogs: money(sales._sum.cogs ?? 0),
        margin: money(sales._sum.margin ?? 0),
      },
      debts: {
        count: debts._count,
        openCount,
        initialAmount: money(debts._sum.initialAmount ?? 0),
        paidAmount: money(debts._sum.paidAmount ?? 0),
        remainingAmount: money(debts._sum.remainingAmount ?? 0),
      },
      payments: { count: payments._count, total: money(payments._sum.amount ?? 0) },
    });
  }),
);

/** GET /api/customers/:id */
customersRouter.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(req, idParamSchema);
    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) throw notFound('Client introuvable');
    res.json(toParty(customer));
  }),
);

/** PUT /api/customers/:id */
customersRouter.put(
  '/:id',
  managerOrAdmin,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(req, idParamSchema);
    const body = parseBody(req, updateCustomerSchema);
    const existing = await prisma.customer.findUnique({ where: { id } });
    if (!existing) throw notFound('Client introuvable');

    const customer = await prisma.customer.update({ where: { id }, data: body });
    res.json(toParty(customer));
  }),
);

/** DELETE /api/customers/:id */
customersRouter.delete(
  '/:id',
  managerOrAdmin,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(req, idParamSchema);
    const existing = await prisma.customer.findUnique({ where: { id } });
    if (!existing) throw notFound('Client introuvable');

    await prisma.customer.update({ where: { id }, data: { active: false } });
    res.status(204).end();
  }),
);

/* ════════════════════ VENDEURS EN LIGNE ════════════════════ */

export const onlineSellersRouter = Router();

/** GET /api/online-sellers */
onlineSellersRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const q = parseQuery(req, partyListQuery);
    const where = {
      ...(boolFilter(q.active) !== undefined ? { active: boolFilter(q.active) } : {}),
      ...(ilike(q.q) ? { name: ilike(q.q) } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.onlineSeller.findMany({ where, orderBy: partySort(q.sort), skip: offset(q), take: q.limit }),
      prisma.onlineSeller.count({ where }),
    ]);

    res.json({ items: items.map(toParty), ...pageMeta(total, q.page, q.limit) });
  }),
);

/** POST /api/online-sellers */
onlineSellersRouter.post(
  '/',
  managerOrAdmin,
  asyncHandler(async (req, res) => {
    const body = parseBody(req, createOnlineSellerSchema);
    const seller = await prisma.onlineSeller.create({ data: body });
    res.status(201).json(toParty(seller));
  }),
);

/** GET /api/online-sellers/:id/summary — ventes, règlements, dettes */
onlineSellersRouter.get(
  '/:id/summary',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(req, idParamSchema);
    const seller = await prisma.onlineSeller.findUnique({ where: { id } });
    if (!seller) throw notFound('Vendeur en ligne introuvable');

    const [sales, cancelledSales, debts, openCount, payments] = await Promise.all([
      prisma.sale.aggregate({
        where: { onlineSellerId: id, status: { not: 'CANCELLED' } },
        _count: true,
        _sum: { totalAmount: true, paidAmount: true, remainingAmount: true, cogs: true, margin: true },
      }),
      prisma.sale.count({ where: { onlineSellerId: id, status: 'CANCELLED' } }),
      prisma.debt.aggregate({
        where: { onlineSellerId: id, type: 'ONLINE_SELLER', status: { not: 'CANCELLED' } },
        _count: true,
        _sum: { initialAmount: true, paidAmount: true, remainingAmount: true },
      }),
      prisma.debt.count({
        where: { onlineSellerId: id, type: 'ONLINE_SELLER', status: { in: ['OPEN', 'PARTIAL'] } },
      }),
      prisma.payment.aggregate({
        where: { partyType: 'ONLINE_SELLER', partyId: id },
        _count: true,
        _sum: { amount: true },
      }),
    ]);

    res.json({
      onlineSeller: toParty(seller),
      sales: {
        count: sales._count,
        cancelledCount: cancelledSales,
        totalAmount: money(sales._sum.totalAmount ?? 0),
        paidAmount: money(sales._sum.paidAmount ?? 0),
        remainingAmount: money(sales._sum.remainingAmount ?? 0),
        cogs: money(sales._sum.cogs ?? 0),
        margin: money(sales._sum.margin ?? 0),
      },
      debts: {
        count: debts._count,
        openCount,
        initialAmount: money(debts._sum.initialAmount ?? 0),
        paidAmount: money(debts._sum.paidAmount ?? 0),
        remainingAmount: money(debts._sum.remainingAmount ?? 0),
      },
      payments: { count: payments._count, total: money(payments._sum.amount ?? 0) },
    });
  }),
);

/** GET /api/online-sellers/:id */
onlineSellersRouter.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(req, idParamSchema);
    const seller = await prisma.onlineSeller.findUnique({ where: { id } });
    if (!seller) throw notFound('Vendeur en ligne introuvable');
    res.json(toParty(seller));
  }),
);

/** PUT /api/online-sellers/:id */
onlineSellersRouter.put(
  '/:id',
  managerOrAdmin,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(req, idParamSchema);
    const body = parseBody(req, updateOnlineSellerSchema);
    const existing = await prisma.onlineSeller.findUnique({ where: { id } });
    if (!existing) throw notFound('Vendeur en ligne introuvable');

    const seller = await prisma.onlineSeller.update({ where: { id }, data: body });
    res.json(toParty(seller));
  }),
);

/** DELETE /api/online-sellers/:id */
onlineSellersRouter.delete(
  '/:id',
  managerOrAdmin,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(req, idParamSchema);
    const existing = await prisma.onlineSeller.findUnique({ where: { id } });
    if (!existing) throw notFound('Vendeur en ligne introuvable');

    await prisma.onlineSeller.update({ where: { id }, data: { active: false } });
    res.status(204).end();
  }),
);
