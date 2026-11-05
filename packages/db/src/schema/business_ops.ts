import { sql } from "drizzle-orm";
import { pgTable, uuid, text, integer, timestamp, jsonb, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

const identity = () => ({
  id: uuid("id").primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const businessOpsOfferings = pgTable("business_ops_offerings", {
  ...identity(),
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  priceCents: integer("price_cents").notNull().default(0),
  currency: text("currency").notNull().default("usd"),
  billing: text("billing").notNull().default("one_time"),
  status: text("status").notNull().default("draft"),
}, (t) => [
  index("business_ops_offerings_company_idx").on(t.companyId),
  check("business_ops_offerings_kind_check", sql`${t.kind} IN ('product', 'service')`),
  check("business_ops_offerings_billing_check", sql`${t.billing} IN ('one_time', 'subscription')`),
  check("business_ops_offerings_status_check", sql`${t.status} IN ('active', 'draft', 'archived')`),
  check("business_ops_offerings_price_check", sql`${t.priceCents} >= 0`),
]);

export const businessOpsOrders = pgTable("business_ops_orders", {
  ...identity(),
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email"),
  items: jsonb("items").notNull().default([]),
  totalCents: integer("total_cents").notNull().default(0),
  currency: text("currency").notNull().default("usd"),
  status: text("status").notNull().default("pending"),
  notes: text("notes").notNull().default(""),
  evidenceReference: text("evidence_reference"),
  externalReference: text("external_reference"),
  statusHistory: jsonb("status_history").notNull().default([]),
}, (t) => [
  index("business_ops_orders_company_idx").on(t.companyId),
  uniqueIndex("business_ops_orders_company_external_idx").on(t.companyId, t.externalReference),
  check("business_ops_orders_status_check", sql`${t.status} IN ('pending', 'paid', 'fulfilled', 'cancelled', 'refunded')`),
  check("business_ops_orders_total_check", sql`${t.totalCents} >= 0`),
]);

export const businessOpsDocuments = pgTable("business_ops_documents", {
  ...identity(),
  category: text("category").notNull().default("knowledge"),
  title: text("title").notNull(),
  content: text("content").notNull().default(""),
  tags: jsonb("tags").notNull().default([]),
  createdBy: text("created_by"),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (t) => [
  index("business_ops_documents_company_idx").on(t.companyId),
  check("business_ops_documents_category_check", sql`${t.category} IN ('knowledge', 'policy', 'sop', 'product_doc', 'company_doc')`),
]);

export const businessOpsDocumentRevisions = pgTable("business_ops_document_revisions", {
  id: uuid("id").primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  documentId: uuid("document_id").notNull().references(() => businessOpsDocuments.id),
  version: integer("version").notNull(),
  snapshot: jsonb("snapshot").notNull(),
  actorId: text("actor_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("business_ops_document_revisions_version_idx").on(t.documentId, t.version)]);
