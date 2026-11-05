import { z } from "zod";

// Keep every amount representable by the existing PostgreSQL INTEGER columns.
export const BUSINESS_OPS_MAX_CENTS = 2_147_483_647;
const cents = z.number().int().min(0).max(BUSINESS_OPS_MAX_CENTS);
// Only currencies with two decimal minor units are supported by this UI.
export const businessCurrencySchema = z.enum(["usd", "eur", "gbp", "cad", "aud"]);
export const offeringCreateSchema = z.object({
  kind: z.enum(["product", "service"]),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(10_000).default(""),
  priceCents: cents.default(0),
  currency: businessCurrencySchema.default("usd"),
  billing: z.enum(["one_time", "subscription"]).default("one_time"),
  status: z.enum(["active", "draft", "archived"]).default("draft"),
}).strict();
// Zod applies defaults even inside partial objects. Strip them on PATCH so
// archiving does not silently reset a price, currency, description, or billing.
export const offeringUpdateSchema = offeringCreateSchema.partial().extend({
  description: offeringCreateSchema.shape.description.removeDefault().optional(),
  priceCents: offeringCreateSchema.shape.priceCents.removeDefault().optional(),
  currency: offeringCreateSchema.shape.currency.removeDefault().optional(),
  billing: offeringCreateSchema.shape.billing.removeDefault().optional(),
  status: offeringCreateSchema.shape.status.removeDefault().optional(),
  expectedVersion: z.number().int().positive(),
});
export const archiveBusinessRecordSchema = z.object({ expectedVersion: z.number().int().positive() }).strict();
export const orderItemSchema = z.object({
  offeringId: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(200),
  quantity: z.number().int().min(1).max(1_000_000).default(1),
  unitPriceCents: cents.default(0),
}).strict();
const items = z.array(orderItemSchema).min(1).max(100).refine(
  (rows) => rows.reduce((sum, row) => sum + row.quantity * row.unitPriceCents, 0) <= BUSINESS_OPS_MAX_CENTS,
  "Order total exceeds the supported amount",
);
const orderFields = z.object({
  customerName: z.string().trim().min(1).max(200),
  customerEmail: z.union([z.email(), z.literal("")]).optional(),
  items,
  currency: businessCurrencySchema.default("usd"),
  status: z.enum(["pending", "paid", "fulfilled", "cancelled", "refunded"]).default("pending"),
  notes: z.string().trim().max(10_000).default(""),
  evidenceReference: z.string().trim().min(1).max(300).optional(),
  externalReference: z.string().trim().min(1).max(200).optional(),
}).strict();
export const orderCreateSchema = orderFields;
// Amounts/customer details are immutable after recording; corrections use a new record.
export const orderUpdateSchema = orderFields.pick({ status: true, evidenceReference: true }).partial().extend({
  status: orderFields.shape.status.removeDefault().optional(),
  expectedVersion: z.number().int().positive(),
});
export const documentCreateSchema = z.object({
  category: z.enum(["knowledge", "policy", "sop", "product_doc", "company_doc"]).default("knowledge"),
  title: z.string().trim().min(1).max(300),
  content: z.string().trim().max(200_000).default(""),
  tags: z.array(z.string().trim().min(1).max(50)).max(50).default([]),
}).strict();
export const documentUpdateSchema = documentCreateSchema.partial().extend({
  category: documentCreateSchema.shape.category.removeDefault().optional(),
  content: documentCreateSchema.shape.content.removeDefault().optional(),
  tags: documentCreateSchema.shape.tags.removeDefault().optional(),
  expectedVersion: z.number().int().positive(),
});

export type OfferingCreateInput = z.input<typeof offeringCreateSchema>;
export type OfferingUpdateInput = z.input<typeof offeringUpdateSchema>;
export type OrderCreateInput = z.input<typeof orderCreateSchema>;
export type OrderUpdateInput = z.input<typeof orderUpdateSchema>;
export type DocumentCreateInput = z.input<typeof documentCreateSchema>;
export type DocumentUpdateInput = z.input<typeof documentUpdateSchema>;
