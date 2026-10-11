import { randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { badRequest, notFound } from "../errors.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";

/**
 * Business Ops module: a self-contained, first-party addition on top of the
 * stock Paperclip platform. It gives a company running on Paperclip the
 * pieces an actual business needs on top of "manage my agents":
 *
 *   - offerings: the catalog of software products and services the company
 *     sells (price, billing model, status)
 *   - orders: sales/orders placed by customers against that catalog
 *   - documents: the company's knowledge base — policies, SOPs, product
 *     docs, and general company knowledge, housed directly in the app
 *
 * It intentionally avoids touching the core drizzle migration pipeline
 * (packages/db migrations + check-migration-safety/.test.ts): these tables
 * are owned and bootstrapped by this module alone via idempotent
 * `CREATE TABLE IF NOT EXISTS`, so it can't destabilize the platform's own
 * schema history. Swap this for a real drizzle migration later if this
 * module graduates to a first-class schema citizen.
 */

let schemaReadyPromise: Promise<void> | null = null;

async function ensureBusinessOpsSchema(db: Db): Promise<void> {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS business_ops_offerings (
          id UUID PRIMARY KEY,
          company_id UUID NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('product', 'service')),
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          price_cents INTEGER NOT NULL DEFAULT 0,
          currency TEXT NOT NULL DEFAULT 'usd',
          billing TEXT NOT NULL DEFAULT 'one_time' CHECK (billing IN ('one_time', 'subscription')),
          status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'draft', 'archived')),
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS business_ops_offerings_company_idx
          ON business_ops_offerings (company_id)
      `);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS business_ops_orders (
          id UUID PRIMARY KEY,
          company_id UUID NOT NULL,
          customer_name TEXT NOT NULL,
          customer_email TEXT,
          items JSONB NOT NULL DEFAULT '[]',
          total_cents INTEGER NOT NULL DEFAULT 0,
          currency TEXT NOT NULL DEFAULT 'usd',
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'fulfilled', 'cancelled', 'refunded')),
          notes TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS business_ops_orders_company_idx
          ON business_ops_orders (company_id)
      `);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS business_ops_documents (
          id UUID PRIMARY KEY,
          company_id UUID NOT NULL,
          category TEXT NOT NULL DEFAULT 'knowledge'
            CHECK (category IN ('knowledge', 'policy', 'sop', 'product_doc', 'company_doc')),
          title TEXT NOT NULL,
          content TEXT NOT NULL DEFAULT '',
          tags JSONB NOT NULL DEFAULT '[]',
          created_by TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS business_ops_documents_company_idx
          ON business_ops_documents (company_id)
      `);
    })();
  }
  await schemaReadyPromise;
}

const offeringCreateSchema = z.object({
  kind: z.enum(["product", "service"]),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(10_000).optional().default(""),
  priceCents: z.number().int().min(0).optional().default(0),
  currency: z.string().trim().min(1).max(10).optional().default("usd"),
  billing: z.enum(["one_time", "subscription"]).optional().default("one_time"),
  status: z.enum(["active", "draft", "archived"]).optional().default("active"),
});
const offeringUpdateSchema = offeringCreateSchema.partial();

const orderItemSchema = z.object({
  offeringId: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(200),
  quantity: z.number().int().min(1).optional().default(1),
  unitPriceCents: z.number().int().min(0).optional().default(0),
});
const orderCreateSchema = z.object({
  customerName: z.string().trim().min(1).max(200),
  customerEmail: z.string().trim().email().optional().or(z.literal("")).optional(),
  items: z.array(orderItemSchema).min(1),
  currency: z.string().trim().min(1).max(10).optional().default("usd"),
  status: z.enum(["pending", "paid", "fulfilled", "cancelled", "refunded"]).optional().default("pending"),
  notes: z.string().trim().max(10_000).optional().default(""),
});
const orderUpdateSchema = z.object({
  customerName: z.string().trim().min(1).max(200).optional(),
  customerEmail: z.string().trim().email().optional().or(z.literal("")).optional(),
  items: z.array(orderItemSchema).min(1).optional(),
  status: z.enum(["pending", "paid", "fulfilled", "cancelled", "refunded"]).optional(),
  notes: z.string().trim().max(10_000).optional(),
});

const documentCreateSchema = z.object({
  category: z.enum(["knowledge", "policy", "sop", "product_doc", "company_doc"]).optional().default("knowledge"),
  title: z.string().trim().min(1).max(300),
  content: z.string().trim().max(200_000).optional().default(""),
  tags: z.array(z.string().trim().min(1).max(50)).optional().default([]),
});
const documentUpdateSchema = documentCreateSchema.partial();

function totalCentsOf(items: z.infer<typeof orderItemSchema>[]): number {
  return items.reduce((sum, item) => sum + item.quantity * item.unitPriceCents, 0);
}

function requireCompanyId(req: Request): string {
  const companyId = req.params.companyId;
  if (!companyId) throw badRequest("companyId is required");
  return companyId;
}

export function businessOpsRoutes(db: Db) {
  const router = Router();

  router.use(async (req, _res, next) => {
    try {
      await ensureBusinessOpsSchema(db);
      next();
    } catch (err) {
      next(err);
    }
  });

  // ---- Offerings (products & services catalog) ----

  router.get("/companies/:companyId/business-ops/offerings", async (req, res) => {
    const companyId = requireCompanyId(req);
    assertCompanyAccess(req, companyId);
    const kind = typeof req.query.kind === "string" ? req.query.kind : undefined;
    const offerings = kind
      ? await db.execute(sql`
          SELECT * FROM business_ops_offerings
          WHERE company_id = ${companyId} AND kind = ${kind}
          ORDER BY created_at DESC
        `)
      : await db.execute(sql`
          SELECT * FROM business_ops_offerings
          WHERE company_id = ${companyId}
          ORDER BY created_at DESC
        `);
    res.json({ offerings });
  });

  router.post("/companies/:companyId/business-ops/offerings", async (req, res) => {
    const companyId = requireCompanyId(req);
    assertCompanyAccess(req, companyId);
    const body = offeringCreateSchema.parse(req.body);
    const id = randomUUID();
    const [offering] = await db.execute(sql`
      INSERT INTO business_ops_offerings
        (id, company_id, kind, name, description, price_cents, currency, billing, status)
      VALUES
        (${id}, ${companyId}, ${body.kind}, ${body.name}, ${body.description},
         ${body.priceCents}, ${body.currency}, ${body.billing}, ${body.status})
      RETURNING *
    `);
    res.status(201).json({ offering });
  });

  router.patch("/companies/:companyId/business-ops/offerings/:id", async (req, res) => {
    const companyId = requireCompanyId(req);
    assertCompanyAccess(req, companyId);
    const body = offeringUpdateSchema.parse(req.body);
    const [current] = (await db.execute(sql`
      SELECT * FROM business_ops_offerings WHERE id = ${req.params.id} AND company_id = ${companyId}
    `)) as Record<string, unknown>[];
    if (!current) throw notFound("Offering not found");
    const merged = {
      kind: body.kind ?? (current.kind as string),
      name: body.name ?? (current.name as string),
      description: body.description ?? (current.description as string),
      priceCents: body.priceCents ?? (current.price_cents as number),
      currency: body.currency ?? (current.currency as string),
      billing: body.billing ?? (current.billing as string),
      status: body.status ?? (current.status as string),
    };
    const [offering] = await db.execute(sql`
      UPDATE business_ops_offerings
      SET kind = ${merged.kind}, name = ${merged.name}, description = ${merged.description},
          price_cents = ${merged.priceCents}, currency = ${merged.currency},
          billing = ${merged.billing}, status = ${merged.status}, updated_at = now()
      WHERE id = ${req.params.id} AND company_id = ${companyId}
      RETURNING *
    `);
    res.json({ offering });
  });

  router.delete("/companies/:companyId/business-ops/offerings/:id", async (req, res) => {
    const companyId = requireCompanyId(req);
    assertCompanyAccess(req, companyId);
    await db.execute(sql`
      DELETE FROM business_ops_offerings WHERE id = ${req.params.id} AND company_id = ${companyId}
    `);
    res.status(204).end();
  });

  // ---- Orders (sales) ----

  router.get("/companies/:companyId/business-ops/orders", async (req, res) => {
    const companyId = requireCompanyId(req);
    assertCompanyAccess(req, companyId);
    const orders = await db.execute(sql`
      SELECT * FROM business_ops_orders WHERE company_id = ${companyId} ORDER BY created_at DESC
    `);
    res.json({ orders });
  });

  router.post("/companies/:companyId/business-ops/orders", async (req, res) => {
    const companyId = requireCompanyId(req);
    assertCompanyAccess(req, companyId);
    const body = orderCreateSchema.parse(req.body);
    const id = randomUUID();
    const totalCents = totalCentsOf(body.items);
    const [order] = await db.execute(sql`
      INSERT INTO business_ops_orders
        (id, company_id, customer_name, customer_email, items, total_cents, currency, status, notes)
      VALUES
        (${id}, ${companyId}, ${body.customerName}, ${body.customerEmail || null},
         ${JSON.stringify(body.items)}::jsonb, ${totalCents}, ${body.currency}, ${body.status}, ${body.notes})
      RETURNING *
    `);
    res.status(201).json({ order });
  });

  router.patch("/companies/:companyId/business-ops/orders/:id", async (req, res) => {
    const companyId = requireCompanyId(req);
    assertCompanyAccess(req, companyId);
    const body = orderUpdateSchema.parse(req.body);
    const [current] = (await db.execute(sql`
      SELECT * FROM business_ops_orders WHERE id = ${req.params.id} AND company_id = ${companyId}
    `)) as Record<string, unknown>[];
    if (!current) throw notFound("Order not found");
    const items = body.items ?? (current.items as unknown as z.infer<typeof orderItemSchema>[]);
    const merged = {
      customerName: body.customerName ?? (current.customer_name as string),
      customerEmail: body.customerEmail ?? (current.customer_email as string | null),
      items,
      totalCents: totalCentsOf(items),
      status: body.status ?? (current.status as string),
      notes: body.notes ?? (current.notes as string),
    };
    const [order] = await db.execute(sql`
      UPDATE business_ops_orders
      SET customer_name = ${merged.customerName}, customer_email = ${merged.customerEmail || null},
          items = ${JSON.stringify(merged.items)}::jsonb, total_cents = ${merged.totalCents},
          status = ${merged.status}, notes = ${merged.notes}, updated_at = now()
      WHERE id = ${req.params.id} AND company_id = ${companyId}
      RETURNING *
    `);
    res.json({ order });
  });

  // ---- Documents (company knowledge base) ----

  router.get("/companies/:companyId/business-ops/documents", async (req, res) => {
    const companyId = requireCompanyId(req);
    assertCompanyAccess(req, companyId);
    const category = typeof req.query.category === "string" ? req.query.category : undefined;
    const documents = category
      ? await db.execute(sql`
          SELECT * FROM business_ops_documents
          WHERE company_id = ${companyId} AND category = ${category}
          ORDER BY updated_at DESC
        `)
      : await db.execute(sql`
          SELECT * FROM business_ops_documents
          WHERE company_id = ${companyId}
          ORDER BY updated_at DESC
        `);
    res.json({ documents });
  });

  router.post("/companies/:companyId/business-ops/documents", async (req, res) => {
    const companyId = requireCompanyId(req);
    assertCompanyAccess(req, companyId);
    const body = documentCreateSchema.parse(req.body);
    const actor = getActorInfo(req);
    const id = randomUUID();
    const [document] = await db.execute(sql`
      INSERT INTO business_ops_documents (id, company_id, category, title, content, tags, created_by)
      VALUES (${id}, ${companyId}, ${body.category}, ${body.title}, ${body.content},
              ${JSON.stringify(body.tags)}::jsonb, ${actor.actorId})
      RETURNING *
    `);
    res.status(201).json({ document });
  });

  router.patch("/companies/:companyId/business-ops/documents/:id", async (req, res) => {
    const companyId = requireCompanyId(req);
    assertCompanyAccess(req, companyId);
    const body = documentUpdateSchema.parse(req.body);
    const [current] = (await db.execute(sql`
      SELECT * FROM business_ops_documents WHERE id = ${req.params.id} AND company_id = ${companyId}
    `)) as Record<string, unknown>[];
    if (!current) throw notFound("Document not found");
    const merged = {
      category: body.category ?? (current.category as string),
      title: body.title ?? (current.title as string),
      content: body.content ?? (current.content as string),
      tags: body.tags ?? (current.tags as string[]),
    };
    const [document] = await db.execute(sql`
      UPDATE business_ops_documents
      SET category = ${merged.category}, title = ${merged.title}, content = ${merged.content},
          tags = ${JSON.stringify(merged.tags)}::jsonb, updated_at = now()
      WHERE id = ${req.params.id} AND company_id = ${companyId}
      RETURNING *
    `);
    res.json({ document });
  });

  router.delete("/companies/:companyId/business-ops/documents/:id", async (req, res) => {
    const companyId = requireCompanyId(req);
    assertCompanyAccess(req, companyId);
    await db.execute(sql`
      DELETE FROM business_ops_documents WHERE id = ${req.params.id} AND company_id = ${companyId}
    `);
    res.status(204).end();
  });

  // ---- Summary (dashboard tie-in: revenue, catalog size, doc count) ----

  router.get("/companies/:companyId/business-ops/summary", async (req, res) => {
    const companyId = requireCompanyId(req);
    assertCompanyAccess(req, companyId);
    const [[offerings], [orders], [documents], [revenue]] = await Promise.all([
      db.execute(sql`SELECT count(*)::int AS n FROM business_ops_offerings WHERE company_id = ${companyId} AND status = 'active'`),
      db.execute(sql`SELECT count(*)::int AS n FROM business_ops_orders WHERE company_id = ${companyId}`),
      db.execute(sql`SELECT count(*)::int AS n FROM business_ops_documents WHERE company_id = ${companyId}`),
      db.execute(sql`
        SELECT coalesce(sum(total_cents), 0)::bigint AS cents
        FROM business_ops_orders
        WHERE company_id = ${companyId} AND status IN ('paid', 'fulfilled')
      `),
    ]);
    res.json({
      activeOfferings: (offerings as { n: number }).n,
      totalOrders: (orders as { n: number }).n,
      totalDocuments: (documents as { n: number }).n,
      revenueCents: Number((revenue as { cents: string | number }).cents),
    });
  });

  return router;
}
