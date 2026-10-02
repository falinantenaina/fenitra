import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/errorHandler';
import { parseBody, parseParams, parseQuery } from '../../middleware/validate';
import { managerOrAdmin, requireAuth } from '../../middleware/auth';
import { prisma } from '../../lib/prisma';
import { notFound } from '../../lib/errors';
import { money } from '../../lib/money';
import { ilike, listQuerySchema, offset, pageMeta } from '../../lib/pagination';
import { allocateFIFO } from '../../services/fifo';
import { n } from '../../services/metrics/queries';
import { idParamSchema } from '../../lib/zod';
import { utc } from '../../lib/sql';

export const stockRouter = Router();

const summaryQuery = z.object({
  variantId: z.string().min(1).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

const lotListQuery = listQuerySchema.extend({
  variantId: z.string().min(1).optional(),
  supplierId: z.string().min(1).optional(),
  status: z.enum(['OPEN', 'CLOSED', 'CANCELLED']).optional(),
  q: z.string().trim().min(1).max(200).optional(),
});

const movementListQuery = listQuerySchema.extend({
  variantId: z.string().min(1).optional(),
  lotId: z.string().min(1).optional(),
  type: z.enum(['IN', 'OUT', 'ADJUSTMENT', 'RETURN', 'REVERSAL']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

/**
 * §14-§17 — un ajustement enregistre une PERTE (casse / vol / perte).
 * `qty` est la **quantité perdue** ; elle est consommée en FIFO, valorisée
 * au coût du lot, et comptabilisée en dépense non monétaire pour préserver
 * l'identité comptable (FORMULES §3).
 */
const adjustmentSchema = z.object({
  variantId: z.string().min(1, 'Variante requise'),
  qty: z.number().int().min(1, 'Quantité invalide').max(10000),
  reason: z.string().trim().min(3, 'Motif requis').max(500),
  date: z.coerce.date().optional(),
});

/**
 * GET /api/stock/summary — quantité + valeur à une date (§17).
 * `from` est accepté pour compatibilité mais l'état de stock est toujours
 * calculé **à une date** : `to` (ou maintenant).
 */
stockRouter.get(
  '/summary',
  requireAuth,
  asyncHandler(async (req, res) => {
    const query = parseQuery(req, summaryQuery);
    const at = query.to ?? new Date();
    const variantFilter = query.variantId ? Prisma.sql`AND l."variantId" = ${query.variantId}` : Prisma.empty;

    const rows = await prisma.$queryRaw<{ value: number | bigint; quantity: number | bigint; lots: number }[]>`
      SELECT
        COALESCE(SUM(GREATEST(qty, 0) * l."unitCost"), 0)::bigint AS value,
        COALESCE(SUM(GREATEST(qty, 0)), 0)::bigint                AS quantity,
        COUNT(*)::int                                             AS lots
      FROM (
        SELECT l.id, l."unitCost",
          l."initialQty" + COALESCE((
            SELECT SUM(m.delta)
            FROM "StockMovement" m
            WHERE m."lotId" = l.id AND m."date" < ${utc(at)}::timestamp AND m.type <> 'IN'
          ), 0) AS qty
        FROM "StockLot" l
        WHERE l.status <> 'CANCELLED' ${variantFilter}
      ) l`;

    res.json({
      at,
      variantId: query.variantId ?? null,
      quantity: n(rows[0]?.quantity),
      value: money(n(rows[0]?.value)),
      lots: rows[0]?.lots ?? 0,
    });
  }),
);

/** GET /api/stock/lots — liste des lots (FIFO) */
stockRouter.get(
  '/lots',
  requireAuth,
  asyncHandler(async (req, res) => {
    const query = parseQuery(req, lotListQuery);
    const where = {
      ...(query.variantId ? { variantId: query.variantId } : {}),
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(ilike(query.q)
        ? { variant: { product: { name: ilike(query.q) } } }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.stockLot.findMany({
        where,
        orderBy: [{ entryDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        skip: offset(query),
        take: query.limit,
        include: {
          supplier: { select: { id: true, name: true } },
          arrival: { select: { id: true, reference: true, date: true } },
          variant: {
            select: {
              id: true,
              product: { select: { id: true, name: true } },
              size: { select: { id: true, value: true, label: true } },
            },
          },
        },
      }),
      prisma.stockLot.count({ where }),
    ]);

    res.json({
      items: items.map((l) => ({
        id: l.id,
        code: l.code,
        entryDate: l.entryDate,
        status: l.status,
        initialQty: l.initialQty,
        remainingQty: l.remainingQty,
        unitCost: money(l.unitCost),
        totalCost: money(l.totalCost),
        value: money(l.remainingQty * l.unitCost),
        supplier: l.supplier,
        arrival: l.arrival,
        variant: l.variant,
      })),
      ...pageMeta(total, query.page, query.limit),
    });
  }),
);

/** GET /api/stock/lots/:id/movements — piste d'audit d'un lot */
stockRouter.get(
  '/lots/:id/movements',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(req, idParamSchema);
    const lot = await prisma.stockLot.findUnique({ where: { id } });
    if (!lot) throw notFound('Lot introuvable');

    const movements = await prisma.stockMovement.findMany({
      where: { lotId: id },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      include: { user: { select: { id: true, name: true } } },
    });

    res.json({
      lot: {
        id: lot.id,
        code: lot.code,
        initialQty: lot.initialQty,
        remainingQty: lot.remainingQty,
        unitCost: money(lot.unitCost),
        status: lot.status,
      },
      items: movements.map((m) => ({
        id: m.id,
        type: m.type,
        delta: m.delta,
        unitCost: m.unitCost === null ? null : money(m.unitCost),
        date: m.date,
        notes: m.notes,
        refType: m.refType,
        refId: m.refId,
        user: m.user,
      })),
      total: movements.length,
    });
  }),
);

/** GET /api/stock/movements — journal des mouvements */
stockRouter.get(
  '/movements',
  requireAuth,
  asyncHandler(async (req, res) => {
    const query = parseQuery(req, movementListQuery);
    const where = {
      ...(query.variantId ? { variantId: query.variantId } : {}),
      ...(query.lotId ? { lotId: query.lotId } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.from || query.to
        ? { date: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.stockMovement.findMany({
        where,
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        skip: offset(query),
        take: query.limit,
        include: {
          user: { select: { id: true, name: true } },
          lot: { select: { id: true, code: true } },
          variant: {
            select: {
              id: true,
              product: { select: { id: true, name: true } },
              size: { select: { id: true, value: true } },
            },
          },
        },
      }),
      prisma.stockMovement.count({ where }),
    ]);

    res.json({
      items: items.map((m) => ({
        id: m.id,
        type: m.type,
        delta: m.delta,
        unitCost: m.unitCost === null ? null : money(m.unitCost),
        date: m.date,
        notes: m.notes,
        refType: m.refType,
        refId: m.refId,
        lot: m.lot,
        variant: m.variant,
        user: m.user,
      })),
      ...pageMeta(total, query.page, query.limit),
    });
  }),
);

/** POST /api/stock/adjustments — casse / perte (FIFO + dépense) */
stockRouter.post(
  '/adjustments',
  managerOrAdmin,
  asyncHandler(async (req, res) => {
    const body = parseBody(req, adjustmentSchema);

    const variant = await prisma.productVariant.findUnique({
      where: { id: body.variantId },
      select: { id: true, product: { select: { name: true } }, size: { select: { value: true } } },
    });
    if (!variant) throw notFound('Variante introuvable');

    const date = body.date ?? new Date();
    const userId = req.user!.id;

    const result = await prisma.$transaction(async (tx) => {
      const { allocations, totalCost } = await allocateFIFO(tx, body.variantId, body.qty, {
        type: 'ADJUSTMENT',
        refType: 'ADJUSTMENT',
        date,
        userId,
        notes: body.reason,
      });

      const category = await tx.expenseCategory.upsert({
        where: { name: 'Ajustement de stock' },
        create: { name: 'Ajustement de stock', icon: 'warning', order: 99 },
        update: {},
      });

      const expense = await tx.expense.create({
        data: {
          categoryId: category.id,
          amount: totalCost,
          date,
          description: `Ajustement de stock — ${variant.product.name} (${variant.size.value})`,
          method: 'Ajustement',
          notes: body.reason,
          userId,
        },
      });

      // Un stock perdu diminue l'actif : sans écriture, l'identité (§3) serait fausse.
      if (totalCost > 0) {
        await tx.ledgerEntry.create({
          data: {
            date,
            kind: 'EXPENSE',
            amount: totalCost,
            cashDelta: 0,
            description: `Ajustement de stock — ${variant.product.name} (${variant.size.value})`,
            reference: expense.id,
            refType: 'EXPENSE',
            refId: expense.id,
            expenseId: expense.id,
            userId,
          },
        });
      }

      return { allocations, totalCost, expenseId: expense.id };
    });

    res.status(201).json({
      variantId: body.variantId,
      quantity: body.qty,
      reason: body.reason,
      lostValue: money(result.totalCost),
      expenseId: result.expenseId,
      allocations: result.allocations.map((a) => ({
        lotId: a.lotId,
        quantity: a.quantity,
        unitCost: money(a.unitCost),
        cost: money(a.quantity * a.unitCost),
      })),
    });
  }),
);
