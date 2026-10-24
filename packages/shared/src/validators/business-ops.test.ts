import { describe, expect, it } from "vitest";
import { BUSINESS_OPS_MAX_CENTS, offeringCreateSchema, offeringUpdateSchema, orderCreateSchema, orderUpdateSchema, documentUpdateSchema } from "./business-ops.js";

describe("Business Ops input boundaries", () => {
  it("bounds individual prices and total order value", () => {
    expect(offeringCreateSchema.safeParse({ kind: "product", name: "A", priceCents: BUSINESS_OPS_MAX_CENTS }).success).toBe(true);
    for (const priceCents of [-1, 0.5, BUSINESS_OPS_MAX_CENTS + 1, Infinity]) {
      expect(offeringCreateSchema.safeParse({ kind: "product", name: "A", priceCents }).success).toBe(false);
    }
    expect(orderCreateSchema.safeParse({ customerName: "A", items: [{ name: "A", quantity: 2, unitPriceCents: BUSINESS_OPS_MAX_CENTS }] }).success).toBe(false);
  });
  it("only accepts currencies with supported minor units", () => {
    expect(offeringCreateSchema.safeParse({ kind: "service", name: "A", currency: "jpy" }).success).toBe(false);
    expect(offeringCreateSchema.parse({ kind: "service", name: "A", currency: "eur" }).currency).toBe("eur");
  });
  it("requires versions and rejects post-recording amount changes", () => {
    expect(orderUpdateSchema.safeParse({ status: "paid" }).success).toBe(false);
    expect(orderUpdateSchema.safeParse({ expectedVersion: 1, total_cents: 1 }).success).toBe(false);
    expect(orderUpdateSchema.safeParse({ expectedVersion: 1, items: [] }).success).toBe(false);
    expect(documentUpdateSchema.safeParse({ title: "A" }).success).toBe(false);
  });
  it("does not apply creation defaults to patches", () => {
    expect(offeringUpdateSchema.parse({ status: "archived", expectedVersion: 1 })).toEqual({ status: "archived", expectedVersion: 1 });
    expect(documentUpdateSchema.parse({ title: "Renamed", expectedVersion: 2 })).toEqual({ title: "Renamed", expectedVersion: 2 });
    expect(orderUpdateSchema.parse({ evidenceReference: "receipt", expectedVersion: 3 })).toEqual({ evidenceReference: "receipt", expectedVersion: 3 });
  });
  it("defaults new offerings to draft and rejects unrecognized fields", () => {
    expect(offeringCreateSchema.parse({ kind: "product", name: "A" }).status).toBe("draft");
    expect(offeringCreateSchema.safeParse({ kind: "product", name: "A", price_cents: 123 }).success).toBe(false);
  });
});
