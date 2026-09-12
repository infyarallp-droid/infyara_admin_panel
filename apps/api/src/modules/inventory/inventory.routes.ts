import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler, HttpError } from '../../lib/http.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { createInvoice } from '../billing/billing.service.js';

export const inventoryRouter = Router();
inventoryRouter.use(requireAuth);

const manage = requireRole('SUPER_ADMIN', 'ADMIN', 'MANAGER');
const sell = requireRole('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'FRONT_DESK', 'ACCOUNTANT');
const rupees = (paise: bigint) => Number(paise) / 100;

// ───────────── Products & variants ─────────────

inventoryRouter.get(
  '/products',
  asyncHandler(async (_req, res) => {
    const products = await prisma.product.findMany({
      include: { variants: { orderBy: { variantLabel: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ ok: true, products });
  }),
);

inventoryRouter.get(
  '/low-stock',
  asyncHandler(async (_req, res) => {
    // stockQty <= reorderLevel — Prisma can't compare two columns directly, so filter in JS.
    const variants = await prisma.productVariant.findMany({ include: { product: true } });
    const low = variants.filter((v) => v.stockQty <= v.reorderLevel);
    res.json({ ok: true, variants: low });
  }),
);

inventoryRouter.post(
  '/products',
  manage,
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        name: z.string().min(1),
        type: z.enum(['MAT', 'TSHIRT', 'NUTRITION_DRINK', 'OTHER']),
        description: z.string().optional(),
      })
      .parse(req.body);
    const product = await prisma.product.create({ data: input });
    res.status(201).json({ ok: true, product });
  }),
);

const variantSchema = z.object({
  variantLabel: z.string().min(1),
  attributes: z.record(z.unknown()).optional(),
  sku: z.string().min(1),
  priceRupees: z.number().nonnegative(),
  stockQty: z.number().int().nonnegative().default(0),
  reorderLevel: z.number().int().nonnegative().default(0),
});

inventoryRouter.post(
  '/products/:productId/variants',
  manage,
  asyncHandler(async (req, res) => {
    const input = variantSchema.parse(req.body);
    const variant = await prisma.productVariant.create({
      data: {
        productId: req.params.productId,
        variantLabel: input.variantLabel,
        attributes: input.attributes as Prisma.InputJsonValue | undefined,
        sku: input.sku,
        pricePaise: BigInt(Math.round(input.priceRupees * 100)),
        stockQty: input.stockQty,
        reorderLevel: input.reorderLevel,
      },
    });
    res.status(201).json({ ok: true, variant });
  }),
);

inventoryRouter.put(
  '/variants/:id',
  manage,
  asyncHandler(async (req, res) => {
    const input = variantSchema.partial().parse(req.body);
    const variant = await prisma.productVariant.update({
      where: { id: req.params.id },
      data: {
        variantLabel: input.variantLabel,
        attributes: input.attributes as Prisma.InputJsonValue | undefined,
        sku: input.sku,
        reorderLevel: input.reorderLevel,
        ...(input.priceRupees != null ? { pricePaise: BigInt(Math.round(input.priceRupees * 100)) } : {}),
      },
    });
    res.json({ ok: true, variant });
  }),
);

// Restock (adds stock + a PURCHASE ledger entry)
inventoryRouter.post(
  '/variants/:id/restock',
  manage,
  asyncHandler(async (req, res) => {
    const { qty, note } = z.object({ qty: z.number().int().positive(), note: z.string().optional() }).parse(req.body);
    const variant = await prisma.$transaction(async (tx) => {
      const v = await tx.productVariant.update({
        where: { id: req.params.id },
        data: { stockQty: { increment: qty } },
      });
      await tx.inventoryTransaction.create({
        data: { variantId: v.id, changeQty: qty, reason: 'PURCHASE', note, createdById: req.user!.sub },
      });
      return v;
    });
    res.json({ ok: true, variant });
  }),
);

inventoryRouter.get(
  '/variants/:id/transactions',
  asyncHandler(async (req, res) => {
    const transactions = await prisma.inventoryTransaction.findMany({
      where: { variantId: req.params.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({ ok: true, transactions });
  }),
);

// ───────────── Sell products → invoice + stock ledger ─────────────

inventoryRouter.post(
  '/sell',
  sell,
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        studentId: z.string().uuid().optional(),
        discountRupees: z.number().nonnegative().default(0),
        items: z.array(z.object({ variantId: z.string().uuid(), qty: z.number().int().positive() })).min(1),
      })
      .parse(req.body);

    const result = await prisma.$transaction(async (tx) => {
      const lines = [] as { itemType: 'PRODUCT_VARIANT'; refId: string; description: string; qty: number; unitPriceRupees: number }[];

      for (const item of input.items) {
        const v = await tx.productVariant.findUnique({ where: { id: item.variantId }, include: { product: true } });
        if (!v) throw new HttpError(404, `Variant ${item.variantId} not found`);
        if (v.stockQty < item.qty) throw new HttpError(409, `Insufficient stock for ${v.product.name} (${v.variantLabel})`);
        lines.push({
          itemType: 'PRODUCT_VARIANT',
          refId: v.id,
          description: `${v.product.name} — ${v.variantLabel}`,
          qty: item.qty,
          unitPriceRupees: rupees(v.pricePaise),
        });
      }

      const invoice = await createInvoice(tx, {
        studentId: input.studentId ?? null,
        type: 'PRODUCT',
        items: lines,
        discountRupees: input.discountRupees,
        createdById: req.user!.sub,
      });

      for (const item of input.items) {
        await tx.productVariant.update({ where: { id: item.variantId }, data: { stockQty: { decrement: item.qty } } });
        await tx.inventoryTransaction.create({
          data: { variantId: item.variantId, changeQty: -item.qty, reason: 'SALE', refInvoiceId: invoice.id, createdById: req.user!.sub },
        });
      }
      return invoice;
    });

    res.status(201).json({ ok: true, invoice: result });
  }),
);
