export type OfferingKind = "product" | "service";
export type OfferingStatus = "active" | "draft" | "archived";
export type OfferingBilling = "one_time" | "subscription";

export interface Offering {
  id: string;
  company_id: string;
  version: number;
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
  version: number;
  customer_name: string;
  customer_email: string | null;
  items: OrderItem[];
  total_cents: number;
  currency: string;
  status: OrderStatus;
  notes: string;
  evidence_reference: string | null;
  external_reference: string | null;
  status_history: Array<{
    status: OrderStatus;
    evidenceReference: string | null;
    version: number;
    actorId?: string;
    recordedAt?: string;
    legacy?: boolean;
  }>;
  created_at: string;
  updated_at: string;
}

export type DocumentCategory = "knowledge" | "policy" | "sop" | "product_doc" | "company_doc";

export interface BizDocument {
  id: string;
  company_id: string;
  version: number;
  category: DocumentCategory;
  title: string;
  content: string;
  tags: string[];
  created_by: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BusinessOpsSummary {
  activeOfferings: number;
  totalOrders: number;
  totalDocuments: number;
  recordedValueByCurrency: Array<{ currency: string; totalCents: string }>;
}
