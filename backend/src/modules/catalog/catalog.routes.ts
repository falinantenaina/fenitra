import { Router } from 'express';
import { asyncHandler } from '../../middleware/errorHandler';
import { parseBody, parseParams, parseQuery } from '../../middleware/validate';
import { requireAuth, managerOrAdmin } from '../../middleware/auth';
import { prisma } from '../../lib/prisma';
import { conflict, notFound } from '../../lib/errors';
import { money } from '../../lib/money';
import { boolFilter, ilike, offset, pageMeta } from '../../lib/pagination';
import {
  bulkVariantSchema,
  createProductSchema,
  createSizeSchema,
  createVariantSchema,
  idParamSchema,
  priceSchema,
  productListQuery,
  sizeListQuery,
  slugify,
  updateProductSchema,
  updateSizeSchema,
  updateVariantSchema,
  variantListQuery,
} from './catalog.schemas';

/* ════════════════════ PRODUITS ════════════════════ */

export const productsRouter = Router();

const productSort = (s: string): Record<string, 'asc' | 'desc'> =>
  s.startsWith('-') ? { [s.slice(1)]: 'desc' } : { [s]: 'asc' };

/** GET /api/products */
productsRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const q = parseQuery(req, productListQuery);
    const where = {
      ...(boolFilter(q.active) !== undefined ? { active: boolFilter(q.active) } : {}),
      ...(ilike(q.q) ? { name: ilike(q.q) } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.product.findMany({
        where,
        orderBy: productSort(q.sort),
        skip: offset(q),
        take: q.limit,
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          imageUrl: true,
          active: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { variants: { where: { active: true } } } },
        },
      }),
      prisma.product.count({ where }),
    ]);

    res.json({
      items: items.map((p) => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        description: p.description,
        imageUrl: p.imageUrl,
        active: p.active,
        variantsCount: p._count.variants,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      })),
      ...pageMeta(total, q.page, q.limit),
    });
  }),
);

/** POST /api/products */
productsRouter.post(
  '/',
  managerOrAdmin,
  asyncHandler(async (req, res) => {
    const body = parseBody(req, createProductSchema);

    const base = slugify(body.name);
    let slug = base;
    for (let i = 2; i <= 500; i++) {
      const taken = await prisma.product.findUnique({ where: { slug }, select: { id: true } });
      if (!taken) break;
      slug = `${base}-${i}`;
    }

    const product = await prisma.product.create({
      data: { name: body.name, slug, description: body.description ?? null, imageUrl: body.imageUrl ?? null },
    });
    res.status(201).json(product);
  }),
);

/**
 * POST /api/products/:id/variants — pointures **du modèle** (création en bloc).
 * Saisie rapide d'un arrivage : chaque modèle porte ses propres pointures ;
 * les valeurs absentes du dictionnaire sont créées à la volée, les
 * combinaisons déjà actives sont ignorées (`skipDuplicates`) et une pointure
 * **désactivée** sur ce modèle est réactivée au lieu d'être refusée.
 */
productsRouter.post(
  '/:id/variants',
  managerOrAdmin,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(req, idParamSchema);
    const body = parseBody(req, bulkVariantSchema);

    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) throw notFound('Produit introuvable');
    if (!product.active) throw conflict('Le produit est désactivé');

    const values = [...new Set(body.sizeValues)].sort((a, b) => a - b);

    const { created, reactivated, skipped } = await prisma.$transaction(async (tx) => {
      for (const value of values) {
        const size = await tx.size.findUnique({ where: { value } });
        if (!size) await tx.size.create({ data: { value, order: value, label: String(value) } });
      }
      const sizes = await tx.size.findMany({ where: { value: { in: values } } });
      const existing = await tx.productVariant.findMany({
        where: { productId: id, sizeId: { in: sizes.map((s) => s.id) } },
        include: { size: true },
      });
      const alreadyUsed = new Set(existing.map((v) => v.size.value));

      let reactivatedCount = 0;
      for (const variant of existing) {
        if (variant.active) continue;
        await tx.productVariant.update({ where: { id: variant.id }, data: { active: true } });
        reactivatedCount += 1;
      }

      const toCreate = sizes.filter((size) => !alreadyUsed.has(size.value));
      const result = await tx.productVariant.createMany({
        data: toCreate.map((size) => ({
          productId: id,
          sizeId: size.id,
          sellingPrice: body.sellingPrice,
        })),
        skipDuplicates: true,
      });

      return {
        created: result.count,
        reactivated: reactivatedCount,
        skipped: values.length - result.count - reactivatedCount,
      };
    });

    if (created === 0 && reactivated === 0) throw conflict('Ces pointures sont déjà pourvues sur ce produit');

    const variants = await prisma.productVariant.findMany({
      where: { productId: id },
      orderBy: { size: { value: 'asc' } },
      include: { size: true },
    });

    res.status(201).json({
      created,
      reactivated,
      skipped,
      variants: variants.map((v) => ({
        id: v.id,
        sku: v.sku,
        sellingPrice: money(v.sellingPrice),
        active: v.active,
        size: { id: v.size.id, value: v.size.value, label: v.size.label, order: v.size.order },
      })),
    });
  }),
);

/** GET /api/products/:id — produit + variantes (tailles) */
productsRouter.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(req, idParamSchema);
    const product = await prisma.product.findUnique({
      where: { id },
      include: {
        variants: {
          orderBy: [{ size: { value: 'asc' } }],
          include: { size: true },
        },
      },
    });
    if (!product) throw notFound('Produit introuvable');

    res.json({
      id: product.id,
      name: product.name,
      slug: product.slug,
      description: product.description,
      imageUrl: product.imageUrl,
      active: product.active,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
      variants: product.variants.map((v) => ({
        id: v.id,
        sku: v.sku,
        sellingPrice: money(v.sellingPrice),
        active: v.active,
        size: { id: v.size.id, value: v.size.value, label: v.size.label, order: v.size.order },
      })),
    });
  }),
);

/** PUT /api/products/:id */
productsRouter.put(
  '/:id',
  managerOrAdmin,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(req, idParamSchema);
    const body = parseBody(req, updateProductSchema);

    const existing = await prisma.product.findUnique({ where: { id } });
    if (!existing) throw notFound('Produit introuvable');

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.description !== undefined) data.description = body.description;
    if (body.imageUrl !== undefined) data.imageUrl = body.imageUrl;
    if (body.active !== undefined) data.active = body.active;

    const product = await prisma.product.update({ where: { id }, data });
    res.json(product);
  }),
);

/** DELETE /api/products/:id — suppression douce (le catalogue historique reste lisible) */
productsRouter.delete(
  '/:id',
  managerOrAdmin,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(req, idParamSchema);
    const existing = await prisma.product.findUnique({ where: { id } });
    if (!existing) throw notFound('Produit introuvable');

    await prisma.product.update({ where: { id }, data: { active: false } });
    res.status(204).end();
  }),
);

/* ════════════════════ POINTURES ════════════════════ */

export const sizesRouter = Router();

/** GET /api/sizes */
sizesRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const q = parseQuery(req, sizeListQuery);
    const numeric = Number(q.q);
    const where = q.q
      ? {
          OR: [
            { label: { contains: q.q, mode: 'insensitive' as const } },
            ...(Number.isFinite(numeric) && q.q !== '' ? [{ value: numeric }] : []),
          ],
        }
      : {};

    const [items, total] = await Promise.all([
      prisma.size.findMany({ where, orderBy: { value: 'asc' }, skip: offset(q), take: q.limit }),
      prisma.size.count({ where }),
    ]);

    res.json({
      items: items.map((s) => ({ id: s.id, value: s.value, label: s.label, order: s.order })),
      ...pageMeta(total, q.page, q.limit),
    });
  }),
);

/** POST /api/sizes */
sizesRouter.post(
  '/',
  managerOrAdmin,
  asyncHandler(async (req, res) => {
    const body = parseBody(req, createSizeSchema);
    const exists = await prisma.size.findUnique({ where: { value: body.value } });
    if (exists) throw conflict(`La pointure ${body.value} existe déjà`);

    const size = await prisma.size.create({
      data: { value: body.value, label: body.label ?? null, order: body.order ?? body.value },
    });
    res.status(201).json({ id: size.id, value: size.value, label: size.label, order: size.order });
  }),
);

/** PUT /api/sizes/:id */
sizesRouter.put(
  '/:id',
  managerOrAdmin,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(req, idParamSchema);
    const body = parseBody(req, updateSizeSchema);

    const existing = await prisma.size.findUnique({ where: { id } });
    if (!existing) throw notFound('Pointure introuvable');

    const data: { label?: string | null; order?: number } = {};
    if (body.label !== undefined) data.label = body.label;
    if (body.order !== undefined) data.order = body.order;

    const size = await prisma.size.update({ where: { id }, data });
    res.json({ id: size.id, value: size.value, label: size.label, order: size.order });
  }),
);

/** DELETE /api/sizes/:id — refusé si des variantes l'utilisent */
sizesRouter.delete(
  '/:id',
  managerOrAdmin,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(req, idParamSchema);
    const existing = await prisma.size.findUnique({ where: { id }, include: { _count: { select: { variants: true } } } });
    if (!existing) throw notFound('Pointure introuvable');
    if (existing._count.variants > 0) {
      throw conflict(`Pointure utilisée par ${existing._count.variants} variante(s) — désactivez plutôt le produit`);
    }

    await prisma.size.delete({ where: { id } });
    res.status(204).end();
  }),
);

/* ════════════════════ VARIANTES ════════════════════ */

export const variantsRouter = Router();

const variantSort = (s: string): Record<string, 'asc' | 'desc'> =>
  s.startsWith('-') ? { [s.slice(1)]: 'desc' } : { [s]: 'asc' };

/** GET /api/variants — `inStock=true` limite aux pointures vendables (§vente). */
variantsRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const q = parseQuery(req, variantListQuery);
    const inStock = boolFilter(q.inStock);
    const hasStock = { status: { not: 'CANCELLED' }, remainingQty: { gt: 0 } };
    const where = {
      ...(q.productId ? { productId: q.productId } : {}),
      ...(q.sizeId ? { sizeId: q.sizeId } : {}),
      ...(boolFilter(q.active) !== undefined ? { active: boolFilter(q.active) } : {}),
      ...(ilike(q.q) ? { OR: [{ sku: ilike(q.q) }, { product: { name: ilike(q.q) } }] } : {}),
      ...(inStock === true ? { lots: { some: hasStock } } : {}),
      ...(inStock === false ? { lots: { none: hasStock } } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.productVariant.findMany({
        where,
        orderBy: variantSort(q.sort),
        skip: offset(q),
        take: q.limit,
        include: {
          product: true,
          size: true,
          lots: { where: { status: { not: 'CANCELLED' } }, select: { remainingQty: true } },
        },
      }),
      prisma.productVariant.count({ where }),
    ]);

    res.json({
      items: items.map((v) => ({
        id: v.id,
        sku: v.sku,
        sellingPrice: money(v.sellingPrice),
        active: v.active,
        stock: Math.max(
          0,
          v.lots.reduce((sum, lot) => sum + lot.remainingQty, 0),
        ),
        product: { id: v.product.id, name: v.product.name, active: v.product.active },
        size: { id: v.size.id, value: v.size.value, label: v.size.label, order: v.size.order },
        createdAt: v.createdAt,
        updatedAt: v.updatedAt,
      })),
      ...pageMeta(total, q.page, q.limit),
    });
  }),
);

/** POST /api/variants — crée une variante produit × pointure */
variantsRouter.post(
  '/',
  managerOrAdmin,
  asyncHandler(async (req, res) => {
    const body = parseBody(req, createVariantSchema);

    const [product, size] = await Promise.all([
      prisma.product.findUnique({ where: { id: body.productId } }),
      prisma.size.findUnique({ where: { id: body.sizeId } }),
    ]);
    if (!product) throw notFound('Produit introuvable');
    if (!size) throw notFound('Pointure introuvable');
    if (!product.active) throw conflict('Le produit est désactivé');

    const duplicate = await prisma.productVariant.findUnique({
      where: { productId_sizeId: { productId: body.productId, sizeId: body.sizeId } },
    });
    if (duplicate) throw conflict(`Le produit ${product.name} existe déjà en pointure ${size.value}`);

    const variant = await prisma.productVariant.create({
      data: {
        productId: body.productId,
        sizeId: body.sizeId,
        sku: body.sku ?? null,
        sellingPrice: body.sellingPrice,
      },
      include: { product: true, size: true },
    });

    res.status(201).json({
      id: variant.id,
      sku: variant.sku,
      sellingPrice: money(variant.sellingPrice),
      active: variant.active,
      product: { id: variant.product.id, name: variant.product.name },
      size: { id: variant.size.id, value: variant.size.value, label: variant.size.label },
    });
  }),
);

/** GET /api/variants/:id */
variantsRouter.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(req, idParamSchema);
    const variant = await prisma.productVariant.findUnique({
      where: { id },
      include: { product: true, size: true },
    });
    if (!variant) throw notFound('Variante introuvable');

    res.json({
      id: variant.id,
      sku: variant.sku,
      sellingPrice: money(variant.sellingPrice),
      active: variant.active,
      product: { id: variant.product.id, name: variant.product.name, active: variant.product.active },
      size: { id: variant.size.id, value: variant.size.value, label: variant.size.label },
      createdAt: variant.createdAt,
      updatedAt: variant.updatedAt,
    });
  }),
);

/** PUT /api/variants/:id */
variantsRouter.put(
  '/:id',
  managerOrAdmin,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(req, idParamSchema);
    const body = parseBody(req, updateVariantSchema);

    const existing = await prisma.productVariant.findUnique({ where: { id } });
    if (!existing) throw notFound('Variante introuvable');

    if (body.sku !== undefined && body.sku !== null) {
      const taken = await prisma.productVariant.findFirst({
        where: { sku: body.sku, NOT: { id } },
      });
      if (taken) throw conflict(`Le SKU ${body.sku} est déjà attribué`);
    }

    const data: { sku?: string | null; sellingPrice?: number; active?: boolean } = {};
    if (body.sku !== undefined) data.sku = body.sku;
    if (body.sellingPrice !== undefined) data.sellingPrice = body.sellingPrice;
    if (body.active !== undefined) data.active = body.active;

    const variant = await prisma.productVariant.update({ where: { id }, data, include: { product: true, size: true } });

    res.json({
      id: variant.id,
      sku: variant.sku,
      sellingPrice: money(variant.sellingPrice),
      active: variant.active,
      product: { id: variant.product.id, name: variant.product.name },
      size: { id: variant.size.id, value: variant.size.value, label: variant.size.label },
      updatedAt: variant.updatedAt,
    });
  }),
);

/** PUT /api/variants/:id/price — change le prix de VENTE courant (§19) */
variantsRouter.put(
  '/:id/price',
  managerOrAdmin,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(req, idParamSchema);
    const body = parseBody(req, priceSchema);

    const existing = await prisma.productVariant.findUnique({ where: { id } });
    if (!existing) throw notFound('Variante introuvable');

    const variant = await prisma.productVariant.update({
      where: { id },
      data: { sellingPrice: body.sellingPrice },
    });

    res.json({ id: variant.id, sellingPrice: money(variant.sellingPrice), updatedAt: variant.updatedAt });
  }),
);

/**
 * GET /api/variants/:id/price-history — historique des PRIX D'ACHAT (§18).
 * Chaque ligne correspond à une ligne de carton d'arrivage ; `unitCost`
 * est figée à vie sur le lot.
 */
variantsRouter.get(
  '/:id/price-history',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(req, idParamSchema);
    const existing = await prisma.productVariant.findUnique({ where: { id } });
    if (!existing) throw notFound('Variante introuvable');

    const items = await prisma.arrivalItem.findMany({
      where: { variantId: id },
      orderBy: { createdAt: 'desc' },
      include: { carton: { include: { arrival: { select: { id: true, reference: true, date: true } } } } },
    });

    res.json({
      items: items.map((i) => ({
        arrivalId: i.carton.arrival.id,
        reference: i.carton.arrival.reference,
        date: i.carton.arrival.date,
        cartonReference: i.carton.reference,
        quantity: i.quantity,
        unitCost: money(i.unitCost),
        lineTotal: money(i.lineTotal),
      })),
      total: items.length,
    });
  }),
);
