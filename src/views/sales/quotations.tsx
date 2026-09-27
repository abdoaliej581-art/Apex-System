"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PageHeader, EmptyState, ErrorState, ListSkeleton, StatusBadge, Field } from "@/components/shared";
import { api, qs, formatCurrency, formatDate, relativeTime } from "@/lib/api-client";
import { useSession } from "next-auth/react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Separator } from "@/components/ui/separator";
import {
  ReceiptText, Plus, MoreHorizontal, Pencil, Trash2, Eye, Send, CheckCheck, XCircle,
  Clock, ArrowRight, RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ================= Types & helpers =================

type Party = { id: string; companyName: string } | null | undefined;

type QuotationListRow = {
  id: string; quotationNumber: string; title: string; status: string;
  currency: string; subtotal: number; discountAmount: number; taxPercent: number; total: number;
  validUntil?: string | null; createdAt: string;
  lead?: Party; client?: Party; _count?: { items: number };
};

type QuotationItemRow = { id: string; description: string; quantity: number; unitPrice: number; total: number; order: number };

type ActivityRow = { id: string; type: string; title: string; description?: string | null; actorName: string; actorColor: string; createdAt: string };

type QuotationDetail = QuotationListRow & {
  leadId?: string | null; clientId?: string | null;
  paymentTerms?: string | null; notes?: string | null;
  items: QuotationItemRow[];
  lead?: Party; client?: Party;
  activities: ActivityRow[];
};

type ItemDraft = { description: string; quantity: string; unitPrice: string };
type Option = { id: string; label: string };

const num = (v: string): number => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Mirrors the server formula: total = subtotal - discount + subtotal * tax% / 100 */
function previewTotals(items: ItemDraft[], discount: number, taxPercent: number) {
  const subtotal = round2(items.reduce((s, i) => s + num(i.quantity) * num(i.unitPrice), 0));
  const tax = round2((subtotal * taxPercent) / 100);
  return { subtotal, tax, total: round2(subtotal - discount + tax) };
}

function extractList(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    for (const key of ["items", "leads", "clients", "projects", "team"]) {
      if (Array.isArray(obj[key])) return obj[key] as Record<string, unknown>[];
    }
  }
  return [];
}

function toOptions(url: string, labelKey: string): Promise<Option[]> {
  return api.get<unknown>(url)
    .then((data) => extractList(data).map((x) => ({ id: String(x.id), label: String(x[labelKey] ?? x.name ?? x.companyName ?? "") })).filter((o) => o.label))
    .catch(() => []);
}

function toDateInput(d: string | Date): string {
  const x = new Date(d);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
}

const ACTIVE_STATUSES = ["DRAFT", "SENT"];

// ================= Items editor =================

function ItemsEditor({ items, onChange, currency }: { items: ItemDraft[]; onChange: (items: ItemDraft[]) => void; currency: string }) {
  const totals = previewTotals(items, 0, 0);
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="hidden md:grid grid-cols-[1fr_90px_120px_110px_36px] gap-2 px-3 py-2 bg-secondary/50 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
        <span>Description</span><span>Qty</span><span>Unit price</span><span className="text-right">Line total</span><span />
      </div>
      <div className="divide-y divide-border max-h-60 overflow-y-auto apex-scroll">
        {items.map((item, idx) => (
          <div key={idx} className="grid grid-cols-[1fr_72px_64px] md:grid-cols-[1fr_90px_120px_110px_36px] gap-2 px-3 py-2 items-center">
            <Input
              value={item.description}
              onChange={(e) => onChange(items.map((it, i) => (i === idx ? { ...it, description: e.target.value } : it)))}
              placeholder={`Item ${idx + 1} — e.g. Logo refresh`}
              className="col-span-3 md:col-span-1 h-8 text-sm"
            />
            <Input
              type="number" min={0} step={0.5} value={item.quantity}
              onChange={(e) => onChange(items.map((it, i) => (i === idx ? { ...it, quantity: e.target.value } : it)))}
              className="h-8 text-sm" aria-label="Quantity"
            />
            <Input
              type="number" min={0} step={0.01} value={item.unitPrice}
              onChange={(e) => onChange(items.map((it, i) => (i === idx ? { ...it, unitPrice: e.target.value } : it)))}
              className="h-8 text-sm" aria-label="Unit price"
            />
            <span className="hidden md:block text-sm font-medium text-right tabular-nums">
              {formatCurrency(round2(num(item.quantity) * num(item.unitPrice)), currency)}
            </span>
            <Button
              variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive justify-self-end"
              disabled={items.length <= 1}
              onClick={() => onChange(items.filter((_, i) => i !== idx))}
              title="Remove item"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between px-3 py-2 bg-secondary/30 border-t border-border">
        <Button variant="outline" size="sm" onClick={() => onChange([...items, { description: "", quantity: "1", unitPrice: "0" }])}>
          <Plus className="w-3.5 h-3.5 mr-1.5" /> Add item
        </Button>
        <p className="text-xs text-muted-foreground">Items subtotal: <span className="font-semibold text-foreground tabular-nums">{formatCurrency(totals.subtotal, currency)}</span></p>
      </div>
    </div>
  );
}

// ================= Detail sheet =================

function QuotationDetailSheet({ id, open, onOpenChange, onChanged, canEdit, canDelete, onDeleteRequest }: {
  id: string | null; open: boolean; onOpenChange: (o: boolean) => void; onChanged: () => void;
  canEdit: boolean; canDelete: boolean; onDeleteRequest: (row: QuotationListRow) => void;
}) {
  const { toast } = useToast();
  const [detail, setDetail] = useState<QuotationDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState(false);

  const loadDetail = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      setDetail(await api.get<QuotationDetail>(`/api/quotations/${id}`));
    } catch (e) {
      toast({ title: "Could not load quotation", description: e instanceof Error ? e.message : undefined });
    } finally {
      setLoading(false);
    }
  }, [id, toast]);

  useEffect(() => {
    if (open && id) loadDetail();
    if (!open) setDetail(null);
  }, [open, id, loadDetail]);

  const act = async (status: string, successTitle: string) => {
    if (!id) return;
    setActing(true);
    try {
      await api.patch(`/api/quotations/${id}`, { status });
      toast({ title: successTitle });
      await loadDetail();
      onChanged();
    } catch (e) {
      toast({ title: "Action failed", description: e instanceof Error ? e.message : undefined });
    } finally {
      setActing(false);
    }
  };

  const currency = detail?.currency ?? "EGP";
  const active = detail ? ACTIVE_STATUSES.includes(detail.status) : false;
  const expired = detail?.validUntil ? new Date(detail.validUntil) < new Date() && active : false;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg p-0 flex flex-col">
        {loading || !detail ? (
          <div className="p-6"><ListSkeleton rows={8} /></div>
        ) : (
          <>
            <SheetHeader className="p-5 pb-3 border-b border-border">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <SheetTitle className="flex items-center gap-2 text-base">
                    <ReceiptText className="w-4 h-4 text-primary shrink-0" /> {detail.quotationNumber}
                  </SheetTitle>
                  <SheetDescription className="mt-1 line-clamp-2">{detail.title}</SheetDescription>
                </div>
                <StatusBadge status={detail.status} />
              </div>
              <div className="flex items-center gap-1.5 mt-3 flex-wrap">
                {["DRAFT", "SENT"].map((step, i) => {
                  const idx = ["DRAFT", "SENT"].indexOf(detail.status);
                  const done = idx >= 0 && i <= idx;
                  return (
                    <span
                      key={step}
                      className={cn(
                        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-medium",
                        done ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground"
                      )}
                    >
                      <span className={cn("w-1.5 h-1.5 rounded-full", done ? "bg-primary" : "bg-muted-foreground/50")} />
                      {step.charAt(0) + step.slice(1).toLowerCase()}
                    </span>
                  );
                })}
                <ArrowRight className="w-3 h-3 text-muted-foreground/50" />
                <span className="inline-flex items-center px-2.5 py-1 rounded-full border border-dashed border-border text-[11px] text-muted-foreground">
                  {["ACCEPTED", "REJECTED", "EXPIRED"].includes(detail.status) ? detail.status.charAt(0) + detail.status.slice(1).toLowerCase() : "Pending decision"}
                </span>
              </div>
              {canEdit && ACTIVE_STATUSES.includes(detail.status) && (
                <div className="flex flex-wrap gap-2 mt-3">
                  {detail.status === "DRAFT" && (
                    <Button size="sm" onClick={() => act("SENT", "Quotation sent")} disabled={acting}>
                      <Send className="w-3.5 h-3.5 mr-1.5" /> Send quotation
                    </Button>
                  )}
                  <Button size="sm" className="bg-emerald-600 hover:bg-emerald-600/90 text-white" onClick={() => act("ACCEPTED", "Quotation accepted")} disabled={acting}>
                    <CheckCheck className="w-3.5 h-3.5 mr-1.5" /> Accept
                  </Button>
                  <Button size="sm" variant="outline" className="text-rose-300 hover:text-rose-200" onClick={() => act("REJECTED", "Quotation rejected")} disabled={acting}>
                    <XCircle className="w-3.5 h-3.5 mr-1.5" /> Reject
                  </Button>
                  <Button size="sm" variant="ghost" className="text-amber-300 hover:text-amber-200" onClick={() => act("EXPIRED", "Quotation marked expired")} disabled={acting}>
                    <Clock className="w-3.5 h-3.5 mr-1.5" /> Expire
                  </Button>
                </div>
              )}
            </SheetHeader>

            <div className="flex-1 overflow-y-auto apex-scroll p-5 space-y-5">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1">Lead / Client</p>
                  <p className="font-medium">{detail.lead?.companyName ?? detail.client?.companyName ?? "Unlinked"}</p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1">Valid until</p>
                  <p className={cn("font-medium", expired && "text-rose-400")}>{formatDate(detail.validUntil)}{expired && " · expired"}</p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1">Created</p>
                  <p className="font-medium">{formatDate(detail.createdAt)}</p>
                </div>
              </div>

              <div className="rounded-lg border border-border p-4 space-y-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Financials</p>
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">Subtotal</span><span className="tabular-nums">{formatCurrency(detail.subtotal, currency)}</span></div>
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">Discount</span><span className="tabular-nums">−{formatCurrency(detail.discountAmount, currency)}</span></div>
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">Tax ({detail.taxPercent}%)</span><span className="tabular-nums">{formatCurrency(round2((detail.subtotal * detail.taxPercent) / 100), currency)}</span></div>
                <Separator className="my-2" />
                <div className="flex justify-between font-semibold"><span>Total</span><span className="tabular-nums text-primary">{formatCurrency(detail.total, currency)}</span></div>
              </div>

              {detail.items.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Line items</p>
                  <div className="rounded-lg border border-border divide-y divide-border">
                    {detail.items.map((it) => (
                      <div key={it.id} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
                        <div className="min-w-0">
                          <p className="truncate">{it.description}</p>
                          <p className="text-[11px] text-muted-foreground">{it.quantity} × {formatCurrency(it.unitPrice, currency)}</p>
                        </div>
                        <span className="font-medium tabular-nums shrink-0">{formatCurrency(it.total, currency)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {detail.paymentTerms && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Payment terms</p>
                  <p className="text-sm whitespace-pre-wrap">{detail.paymentTerms}</p>
                </div>
              )}
              {detail.notes && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Internal notes</p>
                  <p className="text-sm whitespace-pre-wrap">{detail.notes}</p>
                </div>
              )}

              {canDelete && detail.status === "DRAFT" && (
                <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => onDeleteRequest(detail)}>
                  <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Delete draft
                </Button>
              )}

              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Activity</p>
                {detail.activities.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">No activity recorded yet.</p>
                ) : (
                  <div className="space-y-4">
                    {detail.activities.map((a) => (
                      <div key={a.id} className="flex gap-3">
                        <div
                          className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 border"
                          style={{ backgroundColor: `${a.actorColor}22`, color: a.actorColor, borderColor: `${a.actorColor}55` }}
                        >
                          {a.actorName.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm leading-snug">{a.title}</p>
                          <p className="text-[11px] text-muted-foreground mt-0.5">{a.actorName} · {relativeTime(a.createdAt)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ================= Main view =================

export function QuotationsView({ navigate }: { navigate: (p: string) => void }) {
  void navigate;
  const { toast } = useToast();
  const { data: session } = useSession();
  const perms = session?.user?.permissions || [];
  const canCreate = perms.includes("quotations.create");
  const canEdit = perms.includes("quotations.edit");
  const canDelete = perms.includes("quotations.delete");

  const [rows, setRows] = useState<QuotationListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [builderOpen, setBuilderOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title: "", leadId: "", clientId: "", validUntil: "", currency: "EGP",
    discountAmount: "0", taxPercent: "0", paymentTerms: "", notes: "",
  });
  const [items, setItems] = useState<ItemDraft[]>([{ description: "", quantity: "1", unitPrice: "0" }]);
  const [leadOpts, setLeadOpts] = useState<Option[]>([]);
  const [clientOpts, setClientOpts] = useState<Option[]>([]);

  const [detailId, setDetailId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [deleting, setDeleting] = useState<QuotationListRow | null>(null);

  const load = useCallback(async (opts?: { page?: number; status?: string; q?: string }) => {
    const p = opts?.page ?? page;
    const st = opts?.status ?? statusFilter;
    const q = opts?.q ?? query;
    setLoading(true);
    setError(false);
    try {
      const data = await api.get<{ items: QuotationListRow[]; total: number }>(
        `/api/quotations${qs({ page: p, pageSize, status: st === "ALL" ? undefined : st, q: q || undefined })}`
      );
      setRows(data.items);
      setTotal(data.total);
      setPage(p);
    } catch (e) {
      setError(true);
      toast({ title: "Could not load quotations", description: e instanceof Error ? e.message : undefined });
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, query, pageSize, toast]);

  useEffect(() => { load({ page: 1, status: statusFilter, q: query }); }, [statusFilter, query]);

  useEffect(() => {
    Promise.all([toOptions("/api/leads?pageSize=100", "companyName"), toOptions("/api/clients?pageSize=100", "companyName")])
      .then(([l, c]) => { setLeadOpts(l); setClientOpts(c); });
  }, []);

  const onSearchInput = (v: string) => {
    setSearch(v);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => setQuery(v), 300);
  };

  const openCreate = () => {
    setEditingId(null);
    setForm({ title: "", leadId: "", clientId: "", validUntil: "", currency: "EGP", discountAmount: "0", taxPercent: "0", paymentTerms: "", notes: "" });
    setItems([{ description: "", quantity: "1", unitPrice: "0" }]);
    setBuilderOpen(true);
  };

  const openEdit = async (row: QuotationListRow) => {
    try {
      const d = await api.get<QuotationDetail>(`/api/quotations/${row.id}`);
      setEditingId(row.id);
      setForm({
        title: d.title, leadId: d.leadId ?? "", clientId: d.clientId ?? "",
        validUntil: d.validUntil ? toDateInput(d.validUntil) : "",
        currency: d.currency, discountAmount: String(d.discountAmount), taxPercent: String(d.taxPercent),
        paymentTerms: d.paymentTerms ?? "", notes: d.notes ?? "",
      });
      setItems(
        d.items.length > 0
          ? d.items.map((i) => ({ description: i.description, quantity: String(i.quantity), unitPrice: String(i.unitPrice) }))
          : [{ description: "", quantity: "1", unitPrice: "0" }]
      );
      setBuilderOpen(true);
    } catch (e) {
      toast({ title: "Could not load quotation", description: e instanceof Error ? e.message : undefined });
    }
  };

  const submitBuilder = async () => {
    if (form.title.trim().length < 2) return toast({ title: "Title is required" });
    const cleaned = items.filter((i) => i.description.trim());
    if (cleaned.length === 0) return toast({ title: "Add at least one item with a description" });
    for (const i of cleaned) {
      if (num(i.quantity) <= 0) return toast({ title: `Quantity for "${i.description}" must be greater than 0` });
      if (num(i.unitPrice) < 0) return toast({ title: `Unit price for "${i.description}" cannot be negative` });
    }
    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        leadId: form.leadId || null,
        clientId: form.clientId || null,
        validUntil: form.validUntil || null,
        currency: form.currency,
        discountAmount: num(form.discountAmount),
        taxPercent: num(form.taxPercent),
        paymentTerms: form.paymentTerms || null,
        notes: form.notes || null,
        items: cleaned.map((i) => ({ description: i.description.trim(), quantity: num(i.quantity), unitPrice: num(i.unitPrice) })),
      };
      if (editingId) {
        await api.patch(`/api/quotations/${editingId}`, payload);
        toast({ title: "Quotation updated" });
      } else {
        await api.post("/api/quotations", payload);
        toast({ title: "Quotation created as draft" });
      }
      setBuilderOpen(false);
      load();
    } catch (e) {
      toast({ title: "Save failed", description: e instanceof Error ? e.message : undefined });
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await api.delete(`/api/quotations/${deleting.id}`);
      toast({ title: "Draft deleted" });
      setDeleting(null);
      if (detailId === deleting.id) setSheetOpen(false);
      load();
    } catch (e) {
      toast({ title: "Delete failed", description: e instanceof Error ? e.message : undefined });
    }
  };

  const totals = previewTotals(items, num(form.discountAmount), num(form.taxPercent));
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      <PageHeader
        title="Quotations"
        description="Quick priced quotes with validity dates — the lightweight sibling of proposals."
        actions={canCreate && <Button onClick={openCreate}><Plus className="w-4 h-4 mr-2" /> New Quotation</Button>}
      />

      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <Input placeholder="Search number or title…" value={search} onChange={(e) => onSearchInput(e.target.value)} className="sm:max-w-xs" />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="sm:w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            <SelectItem value="DRAFT">Draft</SelectItem>
            <SelectItem value="SENT">Sent</SelectItem>
            <SelectItem value="ACCEPTED">Accepted</SelectItem>
            <SelectItem value="REJECTED">Rejected</SelectItem>
            <SelectItem value="EXPIRED">Expired</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <ListSkeleton />
      ) : error ? (
        <ErrorState onRetry={() => load()} />
      ) : total === 0 ? (
        <EmptyState
          icon={<ReceiptText className="w-5 h-5" />}
          title={query || statusFilter !== "ALL" ? "No quotations match your filters" : "No quotations yet"}
          description={query || statusFilter !== "ALL" ? "Try adjusting the search or status filter." : "Send your first quick quote with priced items."}
          action={canCreate && !(query || statusFilter !== "ALL") ? <Button size="sm" onClick={openCreate}><Plus className="w-4 h-4 mr-2" /> New Quotation</Button> : undefined}
        />
      ) : (
        <div className="apex-panel overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-medium">Quotation #</th>
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="px-4 py-3 font-medium hidden lg:table-cell">Lead / Client</th>
                <th className="px-4 py-3 font-medium text-right">Total</th>
                <th className="px-4 py-3 font-medium hidden md:table-cell">Status</th>
                <th className="px-4 py-3 font-medium hidden xl:table-cell">Valid until</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => {
                const expired = r.validUntil ? new Date(r.validUntil) < new Date() && ACTIVE_STATUSES.includes(r.status) : false;
                return (
                  <tr key={r.id} className="hover:bg-accent/40 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">{r.quotationNumber}</td>
                    <td className="px-4 py-3">
                      <button className="text-left font-medium hover:text-primary transition-colors" onClick={() => { setDetailId(r.id); setSheetOpen(true); }}>
                        {r.title}
                      </button>
                      <p className="text-[11px] text-muted-foreground mt-0.5 lg:hidden">{r.lead?.companyName ?? r.client?.companyName ?? "Unlinked"}</p>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-muted-foreground">{r.lead?.companyName ?? r.client?.companyName ?? "Unlinked"}</td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums whitespace-nowrap">{formatCurrency(r.total, r.currency)}</td>
                    <td className="px-4 py-3 hidden md:table-cell"><StatusBadge status={r.status} /></td>
                    <td className={cn("px-4 py-3 hidden xl:table-cell whitespace-nowrap", expired ? "text-rose-400" : "text-muted-foreground")}>
                      {formatDate(r.validUntil)}{expired && " · expired"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" title="View" onClick={() => { setDetailId(r.id); setSheetOpen(true); }}>
                          <Eye className="w-3.5 h-3.5" />
                        </Button>
                        {canEdit && !["ACCEPTED", "REJECTED", "EXPIRED"].includes(r.status) && (
                          <Button variant="ghost" size="icon" className="h-8 w-8" title="Edit" onClick={() => openEdit(r)}>
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        {canDelete && r.status === "DRAFT" && (
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" title="Delete draft" onClick={() => setDeleting(r)}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        {!canEdit && !canDelete && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="w-4 h-4" /></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end"><DropdownMenuItem disabled>No actions available</DropdownMenuItem></DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm mt-4">
          <p className="text-muted-foreground">Page {page} of {totalPages} · {total} quotations</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => load({ page: page - 1 })}>Previous</Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => load({ page: page + 1 })}>Next</Button>
          </div>
        </div>
      )}

      {/* Builder dialog */}
      <Dialog open={builderOpen} onOpenChange={setBuilderOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit quotation" : "New quotation"}</DialogTitle>
            <DialogDescription>Totals are always recalculated on the server from the line items below.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[70vh] overflow-y-auto apex-scroll pr-1 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Title" required>
                <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Social media retainer" />
              </Field>
              <Field label="Currency">
                <Select value={form.currency} onValueChange={(v) => setForm({ ...form, currency: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="EGP">EGP</SelectItem>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="SAR">SAR</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Valid until">
                <Input type="date" value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.target.value })} />
              </Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {leadOpts.length > 0 ? (
                <Field label="Linked lead">
                  <Select value={form.leadId || "NONE"} onValueChange={(v) => setForm({ ...form, leadId: v === "NONE" ? "" : v, clientId: "" })}>
                    <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                    <SelectContent className="max-h-60">
                      <SelectItem value="NONE">None</SelectItem>
                      {leadOpts.map((o) => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
              ) : (
                <Field label="Linked lead" hint="Lead list unavailable — the quotation will be unlinked">
                  <Input value={form.leadId} disabled placeholder="Unavailable without leads.view" />
                </Field>
              )}
              {clientOpts.length > 0 ? (
                <Field label="Linked client">
                  <Select value={form.clientId || "NONE"} onValueChange={(v) => setForm({ ...form, clientId: v === "NONE" ? "" : v, leadId: "" })}>
                    <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                    <SelectContent className="max-h-60">
                      <SelectItem value="NONE">None</SelectItem>
                      {clientOpts.map((o) => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
              ) : (
                <Field label="Linked client" hint="Client list unavailable — the quotation will be unlinked">
                  <Input value={form.clientId} disabled placeholder="Unavailable without clients.view" />
                </Field>
              )}
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Line items</p>
              <ItemsEditor items={items} onChange={setItems} currency={form.currency} />
              <div className="mt-3 rounded-lg border border-border bg-secondary/30 p-4">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Discount amount">
                    <Input type="number" min={0} step={0.01} value={form.discountAmount} onChange={(e) => setForm({ ...form, discountAmount: e.target.value })} />
                  </Field>
                  <Field label="Tax percent">
                    <Input type="number" min={0} max={100} step={0.01} value={form.taxPercent} onChange={(e) => setForm({ ...form, taxPercent: e.target.value })} />
                  </Field>
                </div>
                <Separator className="my-3" />
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="tabular-nums">{formatCurrency(totals.subtotal, form.currency)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Tax ({num(form.taxPercent)}%)</span><span className="tabular-nums">{formatCurrency(totals.tax, form.currency)}</span></div>
                  <div className="flex justify-between font-semibold"><span>Total</span><span className="tabular-nums text-primary">{formatCurrency(totals.total, form.currency)}</span></div>
                </div>
              </div>
            </div>

            <Field label="Payment terms">
              <Textarea rows={2} value={form.paymentTerms} onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })} placeholder="e.g. Full payment on delivery" />
            </Field>
            <Field label="Internal notes">
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Notes the client will never see" />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBuilderOpen(false)}>Cancel</Button>
            <Button onClick={submitBuilder} disabled={saving}>
              {saving ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : null}
              {editingId ? "Save changes" : "Create quotation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail sheet */}
      <QuotationDetailSheet
        id={detailId}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onChanged={() => load()}
        canEdit={canEdit}
        canDelete={canDelete}
        onDeleteRequest={(row) => setDeleting(row)}
      />

      {/* Delete confirm */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this draft?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting ? `${deleting.quotationNumber} — ${deleting.title}` : ""} will be permanently removed. Only drafts can be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep draft</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={confirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
