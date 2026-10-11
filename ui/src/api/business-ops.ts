import { api } from "./client";

export type OfferingKind = "product" | "service";
export type OfferingStatus = "active" | "draft" | "archived";
export type OfferingBilling = "one_time" | "subscription";

export interface Offering {
  id: string;
  company_id: string;
  kind: OfferingKind;
  name: string;
  description: string;
  price_cents: number;
  currency: string;
  billing: OfferingBilling;
  status: OfferingStatus;
  created_at: string;
  updated_at: string;
}

export interface OrderItem {
  offeringId?: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
}

export type OrderStatus = "pending" | "paid" | "fulfilled" | "cancelled" | "refunded";

export interface Order {
  id: string;
  company_id: string;
  customer_name: string;
  customer_email: string | null;
  items: OrderItem[];
  total_cents: number;
  currency: string;
  status: OrderStatus;
  notes: string;
  created_at: string;
  updated_at: string;
}

export type DocumentCategory = "knowledge" | "policy" | "sop" | "product_doc" | "company_doc";

export interface BizDocument {
  id: string;
  company_id: string;
  category: DocumentCategory;
  title: string;
  content: string;
  tags: string[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface BusinessOpsSummary {
  activeOfferings: number;
  totalOrders: number;
  totalDocuments: number;
  revenueCents: number;
}

export const businessOpsApi = {
  summary: (companyId: string) =>
    api.get<BusinessOpsSummary>(`/companies/${companyId}/business-ops/summary`),

  listOfferings: (companyId: string, kind?: OfferingKind) =>
    api
      .get<{ offerings: Offering[] }>(
        `/companies/${companyId}/business-ops/offerings${kind ? `?kind=${kind}` : ""}`,
      )
      .then((r) => r.offerings),
  createOffering: (companyId: string, body: Partial<Offering> & { kind: OfferingKind; name: string }) =>
    api.post<{ offering: Offering }>(`/companies/${companyId}/business-ops/offerings`, body).then((r) => r.offering),
  updateOffering: (companyId: string, id: string, body: Partial<Offering>) =>
    api
      .patch<{ offering: Offering }>(`/companies/${companyId}/business-ops/offerings/${id}`, body)
      .then((r) => r.offering),
  deleteOffering: (companyId: string, id: string) =>
    api.delete<void>(`/companies/${companyId}/business-ops/offerings/${id}`),

  listOrders: (companyId: string) =>
    api.get<{ orders: Order[] }>(`/companies/${companyId}/business-ops/orders`).then((r) => r.orders),
  createOrder: (
    companyId: string,
    body: { customerName: string; customerEmail?: string; items: OrderItem[]; notes?: string },
  ) => api.post<{ order: Order }>(`/companies/${companyId}/business-ops/orders`, body).then((r) => r.order),
  updateOrder: (companyId: string, id: string, body: Partial<Order> & { status?: OrderStatus }) =>
    api.patch<{ order: Order }>(`/companies/${companyId}/business-ops/orders/${id}`, body).then((r) => r.order),

  listDocuments: (companyId: string, category?: DocumentCategory) =>
    api
      .get<{ documents: BizDocument[] }>(
        `/companies/${companyId}/business-ops/documents${category ? `?category=${category}` : ""}`,
      )
      .then((r) => r.documents),
  createDocument: (
    companyId: string,
    body: { category?: DocumentCategory; title: string; content?: string; tags?: string[] },
  ) =>
    api.post<{ document: BizDocument }>(`/companies/${companyId}/business-ops/documents`, body).then((r) => r.document),
  updateDocument: (companyId: string, id: string, body: Partial<BizDocument>) =>
    api
      .patch<{ document: BizDocument }>(`/companies/${companyId}/business-ops/documents/${id}`, body)
      .then((r) => r.document),
  deleteDocument: (companyId: string, id: string) =>
    api.delete<void>(`/companies/${companyId}/business-ops/documents/${id}`),
};
