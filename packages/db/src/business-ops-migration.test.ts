import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createDb, ensurePostgresDatabase, type Db } from "./client.js";
import { startEmbeddedPostgresTestDatabase, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS, type EmbeddedPostgresTestDatabase } from "./test-embedded-postgres.js";
let database: EmbeddedPostgresTestDatabase;
let db: Db;
const migration = await readFile(new URL("./migrations/0333_business_ops.sql", import.meta.url), "utf8");
async function apply(target: Db) {
  for (const statement of migration.split("--> statement-breakpoint")) {
    if (statement.trim()) await target.execute(sql.raw(statement));
  }
}

describe("Business Ops migration", () => {
  beforeAll(async () => {
    // A fresh database must pass the entire real migration chain.
    database = await startEmbeddedPostgresTestDatabase("business-ops-migration-");
    db = createDb(database.connectionString);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterAll(async () => { await database?.cleanup(); });

  it("replays safely on the fresh schema", async () => {
    await apply(db);
    await apply(db);
    const result = await db.execute(sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'business_ops_orders' AND column_name = 'external_reference'`);
    expect(result).toHaveLength(1);
  });
  it("adopts populated prototype tables and preserves orphan records for reconciliation", async () => {
    const legacyUrl = new URL(database.connectionString);
    const adminUrl = new URL(database.connectionString);
    adminUrl.pathname = "/postgres";
    await ensurePostgresDatabase(adminUrl.toString(), "business_legacy_fixture");
    legacyUrl.pathname = "/business_legacy_fixture";
    const legacy = createDb(legacyUrl.toString());
    await legacy.execute(sql`CREATE TABLE companies (id uuid PRIMARY KEY)`);
    const fixture = await readFile(new URL("./__fixtures__/business-ops-prototype.sql", import.meta.url), "utf8");
    for (const statement of fixture.split(";")) if (statement.trim()) await legacy.execute(sql.raw(statement));
    const company = randomUUID();
    const orphan = randomUUID();
    const document = randomUUID();
    const offering = randomUUID();
    await legacy.execute(sql`INSERT INTO companies VALUES (${company})`);
    await legacy.execute(sql`INSERT INTO business_ops_documents (id, company_id, title, content) VALUES (${document}, ${company}, 'Original title', 'Original content')`);
    await legacy.execute(sql`INSERT INTO business_ops_offerings (id, company_id, kind, name, price_cents) VALUES (${offering}, ${orphan}, 'product', 'Legacy orphan', -1)`);
    await legacy.execute(sql`INSERT INTO business_ops_orders (id, company_id, customer_name, total_cents, status) VALUES (${randomUUID()}, ${company}, 'Original customer', 123, 'paid')`);
    await apply(legacy);
    await apply(legacy);
    const [doc] = await legacy.execute(sql`SELECT * FROM business_ops_documents WHERE id = ${document}`);
    expect(doc).toMatchObject({ title: "Original title", content: "Original content", version: 1, archived_at: null });
    const [product] = await legacy.execute(sql`SELECT * FROM business_ops_offerings WHERE id = ${offering}`);
    expect(product).toMatchObject({ company_id: orphan, price_cents: -1, status: "active", version: 1 });
    const [order] = await legacy.execute(sql`SELECT * FROM business_ops_orders`);
    expect(order).toMatchObject({ customer_name: "Original customer", total_cents: 123, status: "paid", evidence_reference: null, version: 1 });
    // NOT VALID exempts old rows only; new invalid writes must still fail.
    await expect(legacy.execute(sql`INSERT INTO business_ops_documents (id, company_id, title) VALUES (${randomUUID()}, ${orphan}, 'Denied')`)).rejects.toThrow();
    await expect(legacy.execute(sql`INSERT INTO business_ops_offerings (id, company_id, kind, name, price_cents) VALUES (${randomUUID()}, ${company}, 'product', 'Denied', -1)`)).rejects.toThrow();
  });
});
