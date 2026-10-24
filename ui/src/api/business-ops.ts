import { api } from "./client";
import type { Offering, Order, BizDocument, BusinessOpsSummary, OfferingKind, DocumentCategory,
  OfferingCreateInput, OfferingUpdateInput, OrderCreateInput, OrderUpdateInput, DocumentCreateInput, DocumentUpdateInput,
} from "@paperclipai/shared";
export type { Offering, Order, BizDocument, BusinessOpsSummary, OfferingKind, DocumentCategory } from "@paperclipai/shared";
const base = (companyId: string) => `/companies/${companyId}/business-ops`;
export const businessOpsApi = {
  access: (companyId: string) => api.get<{ canWrite: boolean }>(`${base(companyId)}/access`),
  summary: (companyId: string) => api.get<BusinessOpsSummary>(`${base(companyId)}/summary`),
  listOfferings: (companyId: string, kind?: OfferingKind) => api.get<{ offerings: Offering[] }>(`${base(companyId)}/offerings${kind ? `?kind=${kind}` : ""}`).then((r) => r.offerings),
  createOffering: (companyId: string, body: OfferingCreateInput) => api.post<{ offering: Offering }>(`${base(companyId)}/offerings`, body).then((r) => r.offering),
  updateOffering: (companyId: string, id: string, body: OfferingUpdateInput) => api.patch<{ offering: Offering }>(`${base(companyId)}/offerings/${id}`, body).then((r) => r.offering),
  listOrders: (companyId: string) => api.get<{ orders: Order[] }>(`${base(companyId)}/orders`).then((r) => r.orders),
  createOrder: (companyId: string, body: OrderCreateInput) => api.post<{ order: Order }>(`${base(companyId)}/orders`, body).then((r) => r.order),
  updateOrder: (companyId: string, id: string, body: OrderUpdateInput) => api.patch<{ order: Order }>(`${base(companyId)}/orders/${id}`, body).then((r) => r.order),
  listDocuments: (companyId: string, category?: DocumentCategory) => api.get<{ documents: BizDocument[] }>(`${base(companyId)}/documents${category ? `?category=${category}` : ""}`).then((r) => r.documents),
  createDocument: (companyId: string, body: DocumentCreateInput) => api.post<{ document: BizDocument }>(`${base(companyId)}/documents`, body).then((r) => r.document),
  updateDocument: (companyId: string, id: string, body: DocumentUpdateInput) => api.patch<{ document: BizDocument }>(`${base(companyId)}/documents/${id}`, body).then((r) => r.document),
  archiveDocument: (companyId: string, id: string, expectedVersion: number) => api.post<{ document: BizDocument }>(`${base(companyId)}/documents/${id}/archive`, { expectedVersion }).then((r) => r.document),
};
