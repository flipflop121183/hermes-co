import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import { sql } from "drizzle-orm";
import { createDb, type Db } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS, type EmbeddedPostgresTestDatabase } from "@paperclipai/db/test-embedded-postgres";
import { ZodError } from "zod";
import { HttpError } from "../errors.js";
vi.mock("../services/authorization.js", () => ({ responsibleUserAuthzShadowMode: () => false }));
import { businessOpsRoutes } from "./business-ops.js";

let database: EmbeddedPostgresTestDatabase;
let db: Db;
const companyId = randomUUID();
const otherCompany = randomUUID();
const owner: Request["actor"] = { type: "board", source: "session", userId: "test-owner", companyIds: [companyId, otherCompany], memberships: [companyId, otherCompany].map((id) => ({ companyId: id, membershipRole: "owner", status: "active" })) };
const path = (suffix: string, id = companyId) => `/companies/${id}/business-ops/${suffix}`;
function app(actor = owner, database = db) {
  const server = express();
  server.use(express.json());
  server.use((req, _res, next) => { req.actor = actor; next(); });
  server.use(businessOpsRoutes(database));
  server.get("/unrelated", (_req, res) => res.json({ ok: true }));
  server.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(err instanceof HttpError ? err.status : err instanceof ZodError ? 400 : 500).json({ error: err.message });
  });
  return server;
}

describe("Business Ops HTTP and PostgreSQL contracts", () => {
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("business-ops-http-");
    db = createDb(database.connectionString);
    await db.execute(sql`INSERT INTO companies (id, name, issue_prefix) VALUES (${companyId}, 'Test A', 'BOA'), (${otherCompany}, 'Test B', 'BOB')`);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterAll(async () => { await database?.cleanup(); });

  it("rejects agents before database access and leaves unrelated routes alone", async () => {
    const unusableDb = { execute: vi.fn(() => { throw new Error("DB must not be touched"); }) } as unknown as Db;
    const agentApp = app({ type: "agent", companyId, agentId: randomUUID() }, unusableDb);
    await request(agentApp).get(path("orders")).expect(403);
    await request(agentApp).get("/unrelated").expect(200);
    expect(unusableDb.execute).not.toHaveBeenCalled();
  });
  it("enforces company references, evidence, transitions, versions, and import uniqueness", async () => {
    const server = app();
    const offering = (await request(server).post(path("offerings")).send({ kind: "product", name: "A", status: "active", priceCents: 123 }).expect(201)).body.offering;
    const input = { customerName: "Customer", externalReference: "receipt-1", items: [{ offeringId: offering.id, name: "A", quantity: 1, unitPriceCents: 123 }] };
    await request(server).post(path("orders", otherCompany)).send(input).expect(400);
    await request(server).post(path("orders")).send({ ...input, currency: "eur" }).expect(400);
    await request(server).post(path("orders")).send({ ...input, status: "paid" }).expect(400);
    const order = (await request(server).post(path("orders")).send(input).expect(201)).body.order;
    await request(server).post(path("orders")).send(input).expect(409);
    await request(server).patch(path(`orders/${order.id}`)).send({ status: "fulfilled", expectedVersion: 1, evidenceReference: "delivery" }).expect(400);
    await request(server).patch(path(`orders/${order.id}`)).send({ status: "paid", expectedVersion: 1 }).expect(400);
    await request(server).patch(path(`orders/${order.id}`)).send({ status: "paid", expectedVersion: 1, evidenceReference: "payment" }).expect(200);
    await request(server).patch(path(`orders/${order.id}`)).send({ status: "refunded", expectedVersion: 1, evidenceReference: "refund" }).expect(409);
    await request(server).patch(path(`orders/${order.id}`, otherCompany)).send({ status: "refunded", expectedVersion: 2, evidenceReference: "refund" }).expect(404);
    const archived = (await request(server).patch(path(`offerings/${offering.id}`)).send({ status: "archived", expectedVersion: 1 }).expect(200)).body.offering;
    expect(archived.status).toBe("archived");
    expect(archived.price_cents).toBe(123);
    const [history] = await db.execute(sql`SELECT status_history FROM business_ops_orders WHERE id = ${order.id}`);
    expect(history!.status_history).toMatchObject([{ status: "pending", version: 1 }, { status: "paid", version: 2, evidenceReference: "payment" }]);
    await request(server).delete(path(`offerings/${offering.id}`)).expect(405);
    const [stored] = await db.execute(sql`SELECT * FROM business_ops_offerings WHERE id = ${offering.id}`);
    expect(stored).toBeTruthy();
  });
  it("keeps totals separate by currency and does not overflow aggregate cents", async () => {
    const id = otherCompany;
    for (const currency of ["usd", "usd", "eur"]) {
      await request(app()).post(path("orders", id)).send({ customerName: "Test", currency, status: "paid", evidenceReference: "fixture", items: [{ name: "Test", unitPriceCents: 2_000_000_000 }] }).expect(201);
    }
    const result = await request(app()).get(path("summary", id)).expect(200);
    expect(result.body.recordedValueByCurrency).toEqual([{ currency: "eur", totalCents: "2000000000" }, { currency: "usd", totalCents: "4000000000" }]);
    expect(result.body).not.toHaveProperty("revenueCents");
  });
  it("preserves document versions and archive snapshots, with metadata-only audit", async () => {
    const server = app();
    const document = (await request(server).post(path("documents")).send({ title: "Private title", content: "Private body" }).expect(201)).body.document;
    await request(server).patch(path(`documents/${document.id}`)).send({ content: "Revised private body", expectedVersion: 1 }).expect(200);
    await request(server).patch(path(`documents/${document.id}`)).send({ content: "Stale edit", expectedVersion: 1 }).expect(409);
    await request(server).post(path(`documents/${document.id}/archive`)).send({ expectedVersion: 2 }).expect(200);
    await request(server).delete(path(`documents/${document.id}`)).expect(405);
    const revisions = (await request(server).get(path(`documents/${document.id}/revisions`)).expect(200)).body.revisions;
    expect(revisions.map((r: { version: number }) => r.version)).toEqual([3, 2, 1]);
    expect(revisions[2].snapshot.content).toBe("Private body");
    expect(revisions[0].snapshot.archived_at).toBeTruthy();
    const logs = await db.execute(sql`SELECT details FROM activity_log WHERE entity_id = ${document.id}`);
    expect(logs).toHaveLength(3);
    expect(JSON.stringify(logs)).not.toContain("Private");
  });
  it("rolls back business writes when audit storage fails", async () => {
    // This trigger is restricted to this disposable fixture database.
    await db.execute(sql`CREATE FUNCTION reject_business_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit unavailable'; END $$`);
    await db.execute(sql`CREATE TRIGGER reject_business_audit BEFORE INSERT ON activity_log FOR EACH ROW EXECUTE FUNCTION reject_business_audit()`);
    try {
      await request(app()).post(path("documents")).send({ title: "Must roll back" }).expect(500);
      const rows = await db.execute(sql`SELECT id FROM business_ops_documents WHERE title = 'Must roll back'`);
      expect(rows).toHaveLength(0);
    } finally {
      await db.execute(sql`DROP TRIGGER reject_business_audit ON activity_log`);
      await db.execute(sql`DROP FUNCTION reject_business_audit()`);
    }
  });
});
