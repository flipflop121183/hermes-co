import { randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import {
  offeringCreateSchema, offeringUpdateSchema, orderCreateSchema, orderUpdateSchema,
  documentCreateSchema, documentUpdateSchema, archiveBusinessRecordSchema, type OrderStatus,
} from "@paperclipai/shared";
import { logger } from "../middleware/logger.js";
import { badRequest, conflict, notFound } from "../errors.js";
import { getActorInfo } from "./authz.js";
import { assertBusinessOpsAccess, canManageBusinessOps } from "./business-ops-access.js";
import { logActivity, publishActivity, type ActivityPublication } from "../services/activity-log.js";

type Row = Record<string, unknown>;
type Table = "business_ops_offerings" | "business_ops_orders" | "business_ops_documents";
const uuid = z.string().uuid();
const company = (req: Request) => uuid.parse(req.params.companyId);
const recordId = (req: Request) => uuid.parse(req.params.id);
const transitions: Record<OrderStatus, OrderStatus[]> = {
  pending: ["paid", "cancelled"], paid: ["fulfilled", "refunded"],
  fulfilled: ["refunded"], cancelled: [], refunded: [],
};

function checkVersion(row: Row, expected: number) {
  if (row.version !== expected) throw conflict("Record changed. Refresh before editing.");
}
async function lockRecord(db: Db, table: Table, companyId: string, id: string): Promise<Row> {
  const [row] = await db.execute(sql`SELECT * FROM ${sql.identifier(table)} WHERE id = ${id} AND company_id = ${companyId} FOR UPDATE`);
  if (!row) throw notFound("Business record not found");
  return row;
}
function requireEvidence(status: OrderStatus, evidence?: string | null) {
  if (["paid", "fulfilled", "refunded"].includes(status) && !evidence?.trim()) {
    throw badRequest("An evidence reference is required for this recorded status; no payment is executed.");
  }
}
async function preserveDocument(db: Db, row: Row, actorId: string) {
  await db.execute(sql`INSERT INTO business_ops_document_revisions (id, company_id, document_id, version, snapshot, actor_id)
    VALUES (${randomUUID()}, ${row.company_id}, ${row.id}, ${row.version}, ${JSON.stringify(row)}::jsonb, ${actorId})
    ON CONFLICT (document_id, version) DO NOTHING`);
}

export function businessOpsRoutes(db: Db) {
  const router = Router();
  // Scope auth to this module. Schema changes belong exclusively to migrations.
  router.use("/companies/:companyId/business-ops", (req, _res, next) => {
    try { assertBusinessOpsAccess(req, company(req)); next(); } catch (err) { next(err); }
  });
  async function mutate(req: Request, action: string, entityType: string, work: (tx: Db) => Promise<Row>) {
    const publications: ActivityPublication[] = [];
    const actor = getActorInfo(req);
    const row = await db.transaction(async (transaction) => {
      const tx = transaction as unknown as Db;
      const result = await work(tx);
      await logActivity(tx, {
        companyId: company(req), actorType: actor.actorType, actorId: actor.actorId,
        action, entityType, entityId: String(result.id),
        // The shared activity feed must never contain customer details or document bodies.
        details: { version: result.version, authorizationSource: actor.actorSource },
      }, publications);
      return result;
    });
    for (const publication of publications) {
      try { publishActivity(publication); }
      catch (err) { logger.warn({ err }, "Business Ops activity notification failed after commit"); }
    }
    return row;
  }
  router.get("/companies/:companyId/business-ops/access", (req, res) => res.json({ canWrite: canManageBusinessOps(req, company(req)) }));

  router.get("/companies/:companyId/business-ops/offerings", async (req, res) => {
    const kind = z.enum(["product", "service"]).optional().parse(req.query.kind);
    const offerings = await db.execute(sql`SELECT * FROM business_ops_offerings WHERE company_id = ${company(req)} AND status <> 'archived'
      ${kind ? sql`AND kind = ${kind}` : sql``} ORDER BY created_at DESC`);
    res.json({ offerings });
  });
  router.post("/companies/:companyId/business-ops/offerings", async (req, res) => {
    const b = offeringCreateSchema.parse(req.body);
    const offering = await mutate(req, "business_offering.created", "business_offering", async (tx) => {
      const [row] = await tx.execute(sql`INSERT INTO business_ops_offerings (id, company_id, kind, name, description, price_cents, currency, billing, status)
        VALUES (${randomUUID()}, ${company(req)}, ${b.kind}, ${b.name}, ${b.description}, ${b.priceCents}, ${b.currency}, ${b.billing}, ${b.status}) RETURNING *`);
      return row!;
    });
    res.status(201).json({ offering });
  });
  router.patch("/companies/:companyId/business-ops/offerings/:id", async (req, res) => {
    const b = offeringUpdateSchema.parse(req.body);
    const offering = await mutate(req, "business_offering.updated", "business_offering", async (tx) => {
      const c = await lockRecord(tx, "business_ops_offerings", company(req), recordId(req));
      checkVersion(c, b.expectedVersion);
      const [row] = await tx.execute(sql`UPDATE business_ops_offerings SET kind = ${b.kind ?? c.kind}, name = ${b.name ?? c.name},
        description = ${b.description ?? c.description}, price_cents = ${b.priceCents ?? c.price_cents}, currency = ${b.currency ?? c.currency},
        billing = ${b.billing ?? c.billing}, status = ${b.status ?? c.status}, version = version + 1, updated_at = now()
        WHERE id = ${c.id} AND company_id = ${company(req)} RETURNING *`);
      return row!;
    });
    res.json({ offering });
  });
  // Old DELETE clients cannot destroy records. Archiving uses PATCH + expectedVersion.
  router.delete("/companies/:companyId/business-ops/offerings/:id", (_req, res) => res.status(405).json({ error: "Archive with PATCH status and expectedVersion" }));

  router.get("/companies/:companyId/business-ops/orders", async (req, res) => {
    res.json({ orders: await db.execute(sql`SELECT * FROM business_ops_orders WHERE company_id = ${company(req)} ORDER BY created_at DESC`) });
  });
  router.post("/companies/:companyId/business-ops/orders", async (req, res) => {
    const b = orderCreateSchema.parse(req.body);
    requireEvidence(b.status, b.evidenceReference);
    const order = await mutate(req, "business_order.recorded", "business_order", async (tx) => {
      for (const item of b.items) {
        if (!item.offeringId) continue;
        const [offering] = await tx.execute(sql`SELECT * FROM business_ops_offerings WHERE id = ${item.offeringId} AND company_id = ${company(req)} AND status = 'active' FOR SHARE`);
        if (!offering || offering.currency !== b.currency || offering.price_cents !== item.unitPriceCents) {
          throw badRequest("Catalog item must be active, belong to this company, and match the recorded currency and price");
        }
      }
      const total = b.items.reduce((sum, item) => sum + item.quantity * item.unitPriceCents, 0);
      const [row] = await tx.execute(sql`INSERT INTO business_ops_orders (id, company_id, customer_name, customer_email, items, total_cents, currency, status, notes, evidence_reference, external_reference, status_history)
        VALUES (${randomUUID()}, ${company(req)}, ${b.customerName}, ${b.customerEmail || null}, ${JSON.stringify(b.items)}::jsonb, ${total}, ${b.currency}, ${b.status}, ${b.notes}, ${b.evidenceReference ?? null}, ${b.externalReference ?? null}, ${JSON.stringify([{ status: b.status, evidenceReference: b.evidenceReference ?? null, actorId: getActorInfo(req).actorId, recordedAt: new Date().toISOString(), version: 1 }])}::jsonb)
        ON CONFLICT (company_id, external_reference) DO NOTHING RETURNING *`);
      if (!row) throw conflict("External reference already recorded. Read the existing order before retrying.");
      return row;
    });
    res.status(201).json({ order });
  });
  router.patch("/companies/:companyId/business-ops/orders/:id", async (req, res) => {
    const b = orderUpdateSchema.parse(req.body);
    const order = await mutate(req, "business_order.status_recorded", "business_order", async (tx) => {
      const c = await lockRecord(tx, "business_ops_orders", company(req), recordId(req));
      checkVersion(c, b.expectedVersion);
      const status = b.status ?? (c.status as OrderStatus);
      if (status !== c.status && !transitions[c.status as OrderStatus].includes(status)) throw badRequest("Invalid order status transition");
      // Every settlement/fulfilment/refund transition needs its own evidence.
      requireEvidence(status, status !== c.status ? b.evidenceReference : b.evidenceReference ?? (c.evidence_reference as string | null));
      const [row] = await tx.execute(sql`UPDATE business_ops_orders SET status = ${status}, evidence_reference = ${b.evidenceReference ?? c.evidence_reference},
        status_history = ${JSON.stringify([
          // Preserve the pre-hardening status and reference on the first edit.
          ...((c.status_history as unknown[]).length ? c.status_history as unknown[] : [{ status: c.status, evidenceReference: c.evidence_reference, version: c.version, legacy: true }]),
          { status, evidenceReference: b.evidenceReference ?? c.evidence_reference, actorId: getActorInfo(req).actorId, recordedAt: new Date().toISOString(), version: Number(c.version) + 1 },
        ])}::jsonb,
        version = version + 1, updated_at = now() WHERE id = ${c.id} AND company_id = ${company(req)} RETURNING *`);
      return row!;
    });
    res.json({ order });
  });

  router.get("/companies/:companyId/business-ops/documents", async (req, res) => {
    const category = documentCreateSchema.shape.category.removeDefault().optional().parse(req.query.category);
    const documents = await db.execute(sql`SELECT * FROM business_ops_documents WHERE company_id = ${company(req)} AND archived_at IS NULL
      ${category ? sql`AND category = ${category}` : sql``} ORDER BY updated_at DESC`);
    res.json({ documents });
  });
  router.post("/companies/:companyId/business-ops/documents", async (req, res) => {
    const b = documentCreateSchema.parse(req.body);
    const document = await mutate(req, "business_document.created", "business_document", async (tx) => {
      const [row] = await tx.execute(sql`INSERT INTO business_ops_documents (id, company_id, category, title, content, tags, created_by)
        VALUES (${randomUUID()}, ${company(req)}, ${b.category}, ${b.title}, ${b.content}, ${JSON.stringify(b.tags)}::jsonb, ${getActorInfo(req).actorId}) RETURNING *`);
      await preserveDocument(tx, row!, getActorInfo(req).actorId);
      return row!;
    });
    res.status(201).json({ document });
  });
  router.patch("/companies/:companyId/business-ops/documents/:id", async (req, res) => {
    const b = documentUpdateSchema.parse(req.body);
    const document = await mutate(req, "business_document.updated", "business_document", async (tx) => {
      const c = await lockRecord(tx, "business_ops_documents", company(req), recordId(req));
      checkVersion(c, b.expectedVersion);
      if (c.archived_at) throw conflict("Archived documents cannot be edited");
      await preserveDocument(tx, c, getActorInfo(req).actorId);
      const [row] = await tx.execute(sql`UPDATE business_ops_documents SET category = ${b.category ?? c.category}, title = ${b.title ?? c.title},
        content = ${b.content ?? c.content}, tags = ${JSON.stringify(b.tags ?? c.tags)}::jsonb, version = version + 1, updated_at = now()
        WHERE id = ${c.id} AND company_id = ${company(req)} RETURNING *`);
      await preserveDocument(tx, row!, getActorInfo(req).actorId);
      return row!;
    });
    res.json({ document });
  });
  router.post("/companies/:companyId/business-ops/documents/:id/archive", async (req, res) => {
    const b = archiveBusinessRecordSchema.parse(req.body);
    const document = await mutate(req, "business_document.archived", "business_document", async (tx) => {
      const c = await lockRecord(tx, "business_ops_documents", company(req), recordId(req));
      checkVersion(c, b.expectedVersion);
      await preserveDocument(tx, c, getActorInfo(req).actorId);
      const [row] = await tx.execute(sql`UPDATE business_ops_documents SET archived_at = now(), version = version + 1, updated_at = now()
        WHERE id = ${c.id} AND company_id = ${company(req)} RETURNING *`);
      await preserveDocument(tx, row!, getActorInfo(req).actorId);
      return row!;
    });
    res.json({ document });
  });
  router.delete("/companies/:companyId/business-ops/documents/:id", (_req, res) => res.status(405).json({ error: "Documents must be archived with their current version" }));
  router.get("/companies/:companyId/business-ops/documents/:id/revisions", async (req, res) => {
    res.json({ revisions: await db.execute(sql`SELECT * FROM business_ops_document_revisions WHERE company_id = ${company(req)} AND document_id = ${recordId(req)} ORDER BY version DESC`) });
  });
  router.get("/companies/:companyId/business-ops/summary", async (req, res) => {
    const id = company(req);
    const [counts] = await db.execute(sql`SELECT
      (SELECT count(*)::int FROM business_ops_offerings WHERE company_id = ${id} AND status = 'active') AS "activeOfferings",
      (SELECT count(*)::int FROM business_ops_orders WHERE company_id = ${id}) AS "totalOrders",
      (SELECT count(*)::int FROM business_ops_documents WHERE company_id = ${id} AND archived_at IS NULL) AS "totalDocuments"`);
    const recordedValueByCurrency = await db.execute(sql`SELECT currency, sum(total_cents)::text AS "totalCents" FROM business_ops_orders
      WHERE company_id = ${id} AND status IN ('paid', 'fulfilled') GROUP BY currency ORDER BY currency`);
    res.json({ ...counts, recordedValueByCurrency });
  });
  return router;
}
