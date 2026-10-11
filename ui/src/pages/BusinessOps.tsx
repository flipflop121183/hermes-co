import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, ShoppingBag, FileText, Receipt } from "lucide-react";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { PageTabBar } from "../components/PageTabBar";
import { EmptyState } from "../components/EmptyState";
import {
  businessOpsApi,
  type Offering,
  type OfferingKind,
  type Order,
  type BizDocument,
  type DocumentCategory,
} from "../api/business-ops";

function centsToDisplay(cents: number, currency: string) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: currency.toUpperCase() }).format(
    (cents ?? 0) / 100,
  );
}

type Tab = "catalog" | "orders" | "knowledge";

export function BusinessOps() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("catalog");

  useEffect(() => {
    setBreadcrumbs([{ label: "Business" }]);
  }, [setBreadcrumbs]);

  const summaryQuery = useQuery({
    queryKey: ["business-ops", "summary", selectedCompanyId],
    queryFn: () => businessOpsApi.summary(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  return (
    <div className="flex flex-col gap-6 p-6 max-w-5xl mx-auto w-full">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Business</h1>
          <p className="text-sm text-muted-foreground">
            What the company sells, who bought it, and the knowledge it runs on.
          </p>
        </div>
      </div>

      {summaryQuery.data ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <SummaryTile label="Active offerings" value={String(summaryQuery.data.activeOfferings)} />
          <SummaryTile label="Orders" value={String(summaryQuery.data.totalOrders)} />
          <SummaryTile
            label="Revenue"
            value={centsToDisplay(summaryQuery.data.revenueCents, "usd")}
          />
          <SummaryTile label="Knowledge docs" value={String(summaryQuery.data.totalDocuments)} />
        </div>
      ) : null}

      <PageTabBar
        items={[
          { value: "catalog", label: "Products & Services" },
          { value: "orders", label: "Orders" },
          { value: "knowledge", label: "Knowledge Base" },
        ]}
        value={tab}
        onValueChange={(v) => setTab(v as Tab)}
      />

      {!selectedCompanyId ? (
        <EmptyState icon={ShoppingBag} title="Select a company" message="Choose a company to manage its business." />
      ) : tab === "catalog" ? (
        <CatalogTab companyId={selectedCompanyId} queryClient={queryClient} />
      ) : tab === "orders" ? (
        <OrdersTab companyId={selectedCompanyId} queryClient={queryClient} />
      ) : (
        <KnowledgeTab companyId={selectedCompanyId} queryClient={queryClient} />
      )}
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold text-foreground">{value}</div>
    </div>
  );
}

function CatalogTab({ companyId, queryClient }: { companyId: string; queryClient: ReturnType<typeof useQueryClient> }) {
  const [kind, setKind] = useState<OfferingKind>("product");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [priceDollars, setPriceDollars] = useState("");

  const offeringsQuery = useQuery({
    queryKey: ["business-ops", "offerings", companyId],
    queryFn: () => businessOpsApi.listOfferings(companyId),
    enabled: !!companyId,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      businessOpsApi.createOffering(companyId, {
        kind,
        name,
        description,
        priceCents: Math.round((Number(priceDollars) || 0) * 100),
      } as never),
    onSuccess: () => {
      setName("");
      setDescription("");
      setPriceDollars("");
      queryClient.invalidateQueries({ queryKey: ["business-ops", "offerings", companyId] });
      queryClient.invalidateQueries({ queryKey: ["business-ops", "summary", companyId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => businessOpsApi.deleteOffering(companyId, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["business-ops", "offerings", companyId] });
      queryClient.invalidateQueries({ queryKey: ["business-ops", "summary", companyId] });
    },
  });

  const offerings = offeringsQuery.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-col gap-2 rounded-lg border border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) createMutation.mutate();
        }}
      >
        <div className="flex gap-2 flex-wrap">
          <select
            className="rounded-md border border-border bg-background px-2 py-1 text-sm"
            value={kind}
            onChange={(e) => setKind(e.target.value as OfferingKind)}
          >
            <option value="product">Product</option>
            <option value="service">Service</option>
          </select>
          <input
            className="flex-1 min-w-[160px] rounded-md border border-border bg-background px-2 py-1 text-sm"
            placeholder="Name (e.g. Paperclip Pro License)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="w-32 rounded-md border border-border bg-background px-2 py-1 text-sm"
            placeholder="Price (USD)"
            inputMode="decimal"
            value={priceDollars}
            onChange={(e) => setPriceDollars(e.target.value)}
          />
          <button
            type="submit"
            className="inline-flex items-center gap-1 rounded-md bg-foreground text-background px-3 py-1 text-sm font-medium disabled:opacity-50"
            disabled={createMutation.isPending || !name.trim()}
          >
            <Plus className="h-3.5 w-3.5" /> Add
          </button>
        </div>
        <textarea
          className="rounded-md border border-border bg-background px-2 py-1 text-sm"
          placeholder="Description"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </form>

      {offerings.length === 0 ? (
        <EmptyState icon={ShoppingBag} title="No offerings yet" message="Add the first product or service this business sells." />
      ) : (
        <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {offerings.map((o: Offering) => (
            <div key={o.id} className="flex items-start justify-between gap-3 p-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">{o.kind}</span>
                  <span className="font-medium text-foreground">{o.name}</span>
                  <span className="text-xs rounded px-1.5 py-0.5 bg-accent/50 text-foreground/80">{o.status}</span>
                </div>
                {o.description ? <p className="text-sm text-muted-foreground mt-1">{o.description}</p> : null}
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="font-medium text-foreground">{centsToDisplay(o.price_cents, o.currency)}</span>
                <button
                  aria-label={`Delete ${o.name}`}
                  onClick={() => deleteMutation.mutate(o.id)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OrdersTab({ companyId, queryClient }: { companyId: string; queryClient: ReturnType<typeof useQueryClient> }) {
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [itemName, setItemName] = useState("");
  const [itemPriceDollars, setItemPriceDollars] = useState("");

  const offeringsQuery = useQuery({
    queryKey: ["business-ops", "offerings", companyId],
    queryFn: () => businessOpsApi.listOfferings(companyId),
    enabled: !!companyId,
  });
  const ordersQuery = useQuery({
    queryKey: ["business-ops", "orders", companyId],
    queryFn: () => businessOpsApi.listOrders(companyId),
    enabled: !!companyId,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      businessOpsApi.createOrder(companyId, {
        customerName,
        customerEmail: customerEmail || undefined,
        items: [
          {
            name: itemName,
            quantity: 1,
            unitPriceCents: Math.round((Number(itemPriceDollars) || 0) * 100),
          },
        ],
      }),
    onSuccess: () => {
      setCustomerName("");
      setCustomerEmail("");
      setItemName("");
      setItemPriceDollars("");
      queryClient.invalidateQueries({ queryKey: ["business-ops", "orders", companyId] });
      queryClient.invalidateQueries({ queryKey: ["business-ops", "summary", companyId] });
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: Order["status"] }) =>
      businessOpsApi.updateOrder(companyId, id, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["business-ops", "orders", companyId] });
      queryClient.invalidateQueries({ queryKey: ["business-ops", "summary", companyId] });
    },
  });

  const orders = ordersQuery.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-wrap gap-2 rounded-lg border border-border p-3 items-center"
        onSubmit={(e) => {
          e.preventDefault();
          if (customerName.trim() && itemName.trim()) createMutation.mutate();
        }}
      >
        <input
          className="flex-1 min-w-[140px] rounded-md border border-border bg-background px-2 py-1 text-sm"
          placeholder="Customer name"
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
        />
        <input
          className="flex-1 min-w-[140px] rounded-md border border-border bg-background px-2 py-1 text-sm"
          placeholder="Customer email (optional)"
          value={customerEmail}
          onChange={(e) => setCustomerEmail(e.target.value)}
        />
        <select
          className="rounded-md border border-border bg-background px-2 py-1 text-sm min-w-[140px]"
          value={itemName}
          onChange={(e) => setItemName(e.target.value)}
        >
          <option value="">Item sold…</option>
          {(offeringsQuery.data ?? []).map((o: Offering) => (
            <option key={o.id} value={o.name}>
              {o.name}
            </option>
          ))}
        </select>
        <input
          className="w-28 rounded-md border border-border bg-background px-2 py-1 text-sm"
          placeholder="Price (USD)"
          inputMode="decimal"
          value={itemPriceDollars}
          onChange={(e) => setItemPriceDollars(e.target.value)}
        />
        <button
          type="submit"
          className="inline-flex items-center gap-1 rounded-md bg-foreground text-background px-3 py-1 text-sm font-medium disabled:opacity-50"
          disabled={createMutation.isPending || !customerName.trim() || !itemName.trim()}
        >
          <Plus className="h-3.5 w-3.5" /> Record sale
        </button>
      </form>

      {orders.length === 0 ? (
        <EmptyState icon={Receipt} title="No orders yet" message="Record a sale once this business lands its first customer." />
      ) : (
        <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {orders.map((order: Order) => (
            <div key={order.id} className="flex items-center justify-between gap-3 p-3">
              <div>
                <div className="font-medium text-foreground">{order.customer_name}</div>
                <div className="text-xs text-muted-foreground">
                  {order.items.map((i) => i.name).join(", ")} ·{" "}
                  {new Date(order.created_at).toLocaleDateString()}
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="font-medium text-foreground">{centsToDisplay(order.total_cents, order.currency)}</span>
                <select
                  className="rounded-md border border-border bg-background px-2 py-1 text-xs"
                  value={order.status}
                  onChange={(e) => statusMutation.mutate({ id: order.id, status: e.target.value as Order["status"] })}
                >
                  {["pending", "paid", "fulfilled", "cancelled", "refunded"].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function KnowledgeTab({ companyId, queryClient }: { companyId: string; queryClient: ReturnType<typeof useQueryClient> }) {
  const [category, setCategory] = useState<DocumentCategory>("knowledge");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");

  const docsQuery = useQuery({
    queryKey: ["business-ops", "documents", companyId],
    queryFn: () => businessOpsApi.listDocuments(companyId),
    enabled: !!companyId,
  });

  const createMutation = useMutation({
    mutationFn: () => businessOpsApi.createDocument(companyId, { category, title, content }),
    onSuccess: () => {
      setTitle("");
      setContent("");
      queryClient.invalidateQueries({ queryKey: ["business-ops", "documents", companyId] });
      queryClient.invalidateQueries({ queryKey: ["business-ops", "summary", companyId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => businessOpsApi.deleteDocument(companyId, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["business-ops", "documents", companyId] });
      queryClient.invalidateQueries({ queryKey: ["business-ops", "summary", companyId] });
    },
  });

  const docs = docsQuery.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-col gap-2 rounded-lg border border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) createMutation.mutate();
        }}
      >
        <div className="flex gap-2 flex-wrap">
          <select
            className="rounded-md border border-border bg-background px-2 py-1 text-sm"
            value={category}
            onChange={(e) => setCategory(e.target.value as DocumentCategory)}
          >
            <option value="knowledge">Knowledge</option>
            <option value="policy">Policy</option>
            <option value="sop">SOP</option>
            <option value="product_doc">Product doc</option>
            <option value="company_doc">Company doc</option>
          </select>
          <input
            className="flex-1 min-w-[160px] rounded-md border border-border bg-background px-2 py-1 text-sm"
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <button
            type="submit"
            className="inline-flex items-center gap-1 rounded-md bg-foreground text-background px-3 py-1 text-sm font-medium disabled:opacity-50"
            disabled={createMutation.isPending || !title.trim()}
          >
            <Plus className="h-3.5 w-3.5" /> Add doc
          </button>
        </div>
        <textarea
          className="rounded-md border border-border bg-background px-2 py-1 text-sm font-mono"
          placeholder="Markdown content — mission, SOPs, pricing rules, anything the agents and humans should know"
          rows={5}
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
      </form>

      {docs.length === 0 ? (
        <EmptyState icon={FileText} title="No knowledge yet" message="This is where company knowledge, policies, and SOPs live." />
      ) : (
        <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {docs.map((d: BizDocument) => (
            <div key={d.id} className="flex items-start justify-between gap-3 p-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">{d.category}</span>
                  <span className="font-medium text-foreground">{d.title}</span>
                </div>
                {d.content ? (
                  <p className="text-sm text-muted-foreground mt-1 line-clamp-2 whitespace-pre-wrap">{d.content}</p>
                ) : null}
              </div>
              <button
                aria-label={`Delete ${d.title}`}
                onClick={() => deleteMutation.mutate(d.id)}
                className="text-muted-foreground hover:text-destructive shrink-0"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
