import { businessCurrencySchema } from "@paperclipai/shared";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Archive, ShoppingBag, FileText, Receipt } from "lucide-react";
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
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
  } catch {
    return `${currency} ${cents} minor units (legacy currency)`;
  }
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

  const accessQuery = useQuery({
    queryKey: ["business-ops", "access", selectedCompanyId],
    queryFn: () => businessOpsApi.access(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const canWrite = accessQuery.data?.canWrite === true;

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

      <ErrorMessage error={accessQuery.error || summaryQuery.error} />
      {selectedCompanyId && !canWrite && <p className="text-sm text-muted-foreground">Changes require a company owner session. Agent access is disabled.</p>}
      <p className="text-sm text-muted-foreground">Orders are manual records. They do not charge or refund customers. Company records here do not replace the approved policy and task systems.</p>
      {summaryQuery.data ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <SummaryTile label="Active offerings" value={String(summaryQuery.data.activeOfferings)} />
          <SummaryTile label="Orders" value={String(summaryQuery.data.totalOrders)} />
          {summaryQuery.data.recordedValueByCurrency.map((entry) => (
            <SummaryTile key={entry.currency} label="Recorded paid order value" value={displayRecordedValue(entry.totalCents, entry.currency)} />
          ))}
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
        <CatalogTab key={selectedCompanyId} canWrite={canWrite} companyId={selectedCompanyId} queryClient={queryClient} />
      ) : tab === "orders" ? (
        <OrdersTab key={selectedCompanyId} canWrite={canWrite} companyId={selectedCompanyId} queryClient={queryClient} />
      ) : (
        <KnowledgeTab key={selectedCompanyId} canWrite={canWrite} companyId={selectedCompanyId} queryClient={queryClient} />
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

function CatalogTab({ companyId, queryClient, canWrite }: { companyId: string; canWrite: boolean; queryClient: ReturnType<typeof useQueryClient> }) {
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
        priceCents: Math.round(Number(priceDollars) * 100),
        status: "active",
      }),
    onSuccess: () => {
      setName("");
      setDescription("");
      setPriceDollars("");
      queryClient.invalidateQueries({ queryKey: ["business-ops", "offerings", companyId] });
      queryClient.invalidateQueries({ queryKey: ["business-ops", "summary", companyId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (offering: Offering) => businessOpsApi.updateOffering(companyId, offering.id, { status: "archived", expectedVersion: offering.version }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["business-ops", "offerings", companyId] });
      queryClient.invalidateQueries({ queryKey: ["business-ops", "summary", companyId] });
    },
  });

  const offerings = offeringsQuery.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <fieldset disabled={!canWrite}>
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
            className="flex-1 min-w-40 rounded-md border border-border bg-background px-2 py-1 text-sm"
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
      </fieldset>

      <ErrorMessage error={offeringsQuery.error || createMutation.error || deleteMutation.error} />
      {offeringsQuery.isPending ? <p>Loading offerings…</p> : offeringsQuery.isError ? null : offerings.length === 0 ? (
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
                  disabled={!canWrite || deleteMutation.isPending}
                  aria-label={`Archive ${o.name}`}
                  onClick={() => deleteMutation.mutate(o)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Archive className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OrdersTab({ companyId, queryClient, canWrite }: { companyId: string; canWrite: boolean; queryClient: ReturnType<typeof useQueryClient> }) {
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [offeringId, setOfferingId] = useState("");
  const [externalReference, setExternalReference] = useState(() => crypto.randomUUID());

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
    mutationFn: () => {
      const offering = offeringsQuery.data?.find((item) => item.id === offeringId);
      if (!offering) throw new Error("Select an active offering");
      return businessOpsApi.createOrder(companyId, {
        currency: businessCurrencySchema.parse(offering.currency),
        externalReference,
        customerName,
        customerEmail: customerEmail || undefined,
        items: [
          {
            offeringId: offering.id,
            name: offering.name,
            quantity: 1,
            unitPriceCents: offering.price_cents,
          },
        ],
      });
    },
    onSuccess: () => {
      setCustomerName("");
      setCustomerEmail("");
      setOfferingId("");
      setExternalReference(crypto.randomUUID());
      queryClient.invalidateQueries({ queryKey: ["business-ops", "orders", companyId] });
      queryClient.invalidateQueries({ queryKey: ["business-ops", "summary", companyId] });
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ order, status, evidenceReference }: { order: Order; status: Order["status"]; evidenceReference?: string }) =>
      businessOpsApi.updateOrder(companyId, order.id, { status, evidenceReference, expectedVersion: order.version }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["business-ops", "orders", companyId] });
      queryClient.invalidateQueries({ queryKey: ["business-ops", "summary", companyId] });
    },
  });

  const orders = ordersQuery.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <fieldset disabled={!canWrite}>
      <form
        className="flex flex-wrap gap-2 rounded-lg border border-border p-3 items-center"
        onSubmit={(e) => {
          e.preventDefault();
          if (customerName.trim() && offeringId) createMutation.mutate();
        }}
      >
        <input
          className="flex-1 min-w-36 rounded-md border border-border bg-background px-2 py-1 text-sm"
          placeholder="Customer name"
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
        />
        <input
          className="flex-1 min-w-36 rounded-md border border-border bg-background px-2 py-1 text-sm"
          placeholder="Customer email (optional)"
          value={customerEmail}
          onChange={(e) => setCustomerEmail(e.target.value)}
        />
        <select
          className="rounded-md border border-border bg-background px-2 py-1 text-sm min-w-36"
          value={offeringId}
          onChange={(e) => setOfferingId(e.target.value)}
        >
          <option value="">Item sold…</option>
          {(offeringsQuery.data ?? []).filter((o) => o.status === "active").map((o: Offering) => (
            <option key={o.id} value={o.id}>
              {o.name} · {centsToDisplay(o.price_cents, o.currency)}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="inline-flex items-center gap-1 rounded-md bg-foreground text-background px-3 py-1 text-sm font-medium disabled:opacity-50"
          disabled={createMutation.isPending || !customerName.trim() || !offeringId}
        >
          <Plus className="h-3.5 w-3.5" /> Record order
        </button>
      </form>
      </fieldset>

      <ErrorMessage error={ordersQuery.error || offeringsQuery.error || createMutation.error || statusMutation.error} />
      {ordersQuery.isPending ? <p>Loading orders…</p> : ordersQuery.isError ? null : orders.length === 0 ? (
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
                <OrderStatusEditor key={`${order.id}-${order.version}`} order={order} disabled={!canWrite || statusMutation.isPending}
                  save={(status, evidenceReference) => statusMutation.mutate({ order, status, evidenceReference })} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function KnowledgeTab({ companyId, queryClient, canWrite }: { companyId: string; canWrite: boolean; queryClient: ReturnType<typeof useQueryClient> }) {
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
    mutationFn: (document: BizDocument) => businessOpsApi.archiveDocument(companyId, document.id, document.version),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["business-ops", "documents", companyId] });
      queryClient.invalidateQueries({ queryKey: ["business-ops", "summary", companyId] });
    },
  });

  const docs = docsQuery.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <fieldset disabled={!canWrite}>
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
            className="flex-1 min-w-40 rounded-md border border-border bg-background px-2 py-1 text-sm"
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
          placeholder="Working reference content. Approved company policies remain in their existing system."
          rows={5}
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
      </form>
      </fieldset>

      <ErrorMessage error={docsQuery.error || createMutation.error || deleteMutation.error} />
      {docsQuery.isPending ? <p>Loading documents…</p> : docsQuery.isError ? null : docs.length === 0 ? (
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
                disabled={!canWrite || deleteMutation.isPending}
                aria-label={`Archive ${d.title}`}
                onClick={() => deleteMutation.mutate(d)}
                className="text-muted-foreground hover:text-destructive shrink-0"
              >
                <Archive className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ErrorMessage({ error }: { error: Error | null }) {
  return error ? <p role="alert" className="text-sm text-destructive">{error.message} Refresh to retrieve the latest record before retrying.</p> : null;
}
function displayRecordedValue(cents: string, currency: string) {
  const amount = BigInt(cents);
  return `${currency.toUpperCase()} ${amount / 100n}.${(amount % 100n).toString().padStart(2, "0")}`;
}
function OrderStatusEditor({ order, disabled, save }: { order: Order; disabled: boolean; save: (status: Order["status"], evidence?: string) => void }) {
  const [status, setStatus] = useState(order.status);
  const [evidence, setEvidence] = useState("");
  const choices: Record<Order["status"], Order["status"][]> = {
    pending: ["paid", "cancelled"], paid: ["fulfilled", "refunded"], fulfilled: ["refunded"], cancelled: [], refunded: [],
  };
  const needsEvidence = ["paid", "fulfilled", "refunded"].includes(status);
  return <fieldset disabled={disabled} className="flex flex-wrap gap-2">
    <select aria-label="Recorded order status" className="rounded-md border border-border bg-background px-2 py-1 text-xs"
      value={status} onChange={(e) => setStatus(e.target.value as Order["status"])}>
      {[order.status, ...choices[order.status]].map((s) => <option key={s} value={s}>{s}</option>)}
    </select>
    {status !== order.status && <>
      {needsEvidence && <input aria-label="Evidence reference" placeholder="Evidence reference" value={evidence} onChange={(e) => setEvidence(e.target.value)} className="rounded-md border border-border bg-background px-2 py-1 text-xs" />}
      <button disabled={needsEvidence && !evidence.trim()} onClick={() => save(status, evidence.trim() || undefined)} className="text-sm text-foreground disabled:opacity-50">Record status</button>
    </>}
  </fieldset>;
}
