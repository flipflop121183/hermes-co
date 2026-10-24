import type { Request } from "express";
import { describe, expect, it, vi } from "vitest";
vi.mock("../services/authorization.js", () => ({ responsibleUserAuthzShadowMode: () => false }));
import { assertBusinessOpsAccess, canManageBusinessOps } from "./business-ops-access.js";
const companyId = "11111111-1111-4111-8111-111111111111";
const owner = { type: "board", source: "session", userId: "owner", companyIds: [companyId], memberships: [{ companyId, membershipRole: "owner", status: "active" }] };
const request = (actor: unknown, method = "POST") => ({ actor, method }) as Request;

describe("Business Ops actor boundary", () => {
  it.each(["chief", "finance", "builder", "growth", "support", "logkeeper"])("denies %s until explicit grants exist", (role) => {
    for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
      expect(() => assertBusinessOpsAccess(request({ type: "agent", companyId, agentId: role }, method), companyId)).toThrow();
    }
  });
  it("accepts a company owner session", () => {
    expect(canManageBusinessOps(request(owner), companyId)).toBe(true);
    expect(() => assertBusinessOpsAccess(request(owner), companyId)).not.toThrow();
  });
  it.each(["board_key", "mcp_oauth"])("denies owner writes via %s", (source) => {
    expect(() => assertBusinessOpsAccess(request({ ...owner, source }), companyId)).toThrow();
  });
  it.each(["member", "viewer"])("permits %s reads but denies writes", (membershipRole) => {
    const actor = { ...owner, memberships: [{ companyId, membershipRole, status: "active" }] };
    expect(() => assertBusinessOpsAccess(request(actor, "GET"), companyId)).not.toThrow();
    expect(() => assertBusinessOpsAccess(request(actor), companyId)).toThrow();
  });
  it("denies cross-company, inactive, anonymous, and unverified owner access", () => {
    for (const actor of [{ ...owner, companyIds: [] }, { type: "none" }, { ...owner, memberships: [] }, { ...owner, memberships: [{ companyId, membershipRole: "owner", status: "suspended" }] }]) {
      expect(() => assertBusinessOpsAccess(request(actor), companyId)).toThrow();
    }
  });
});
