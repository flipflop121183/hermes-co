import type { Request } from "express";
import { forbidden } from "../errors.js";
import { assertBoard, assertCompanyAccess } from "./authz.js";

export function canManageBusinessOps(req: Request, companyId: string): boolean {
  if (req.actor.type !== "board") return false;
  // API keys and delegated MCP sessions are not a human approval surface.
  if (!["session", "local_implicit"].includes(req.actor.source ?? "")) return false;
  if (req.actor.isInstanceAdmin || req.actor.source === "local_implicit") return true;
  return Boolean(req.actor.memberships?.some((m) =>
    m.companyId === companyId && m.status === "active" && m.membershipRole === "owner"));
}

export function assertBusinessOpsAccess(req: Request, companyId: string) {
  assertCompanyAccess(req, companyId);
  // Until explicit role/resource grants are implemented, no agent can read
  // customer data or documents, including a same-company free-model agent.
  assertBoard(req);
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method.toUpperCase()) && !canManageBusinessOps(req, companyId)) {
    throw forbidden("Business changes require an owner session");
  }
}
