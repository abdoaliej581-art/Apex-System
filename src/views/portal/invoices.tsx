"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Receipt, CheckCircle2, Wallet, RefreshCw, FileText, CreditCard, Loader2, X, Printer,
} from "lucide-react";
import { PageHeader, EmptyState, ErrorState, StatusBadge, StatCard, ListSkeleton } from "@/components/shared";
import { printInvoice, type InvoicePrintOrg } from "@/lib/invoice-print";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api, qs } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { ViewProps } from "@/views/registry";

type PortalInvoice = {
  id: string; invoiceNumber: string; status: string; total: number; paidAmount: number;
  currency: string; issueDate: string; dueDate: string | null;
  project: { name: string; projectNumber: string } | null;
};

type InvoicesResponse = {
  items: PortalInvoice[];
  total: number; page: number; pageSize: number;
  org: InvoicePrintOrg;
  clientName: string;
  summary: { outstanding: number; paidTotal: number; byStatus: { status: string; count: number }[] };
};

type InvoiceDetail = {
  invoice: PortalInvoice & {
    subtotal: number; discountAmount: number; taxPercent: number;
    paymentTerms: string | null; notes: string | null;
    items: { id: string; description: string; quantity: number; unitPrice: number; total: number }[];
    payments: { id: string; amount: number; method: string; reference: string | null; date: string }[];
  };
  outstanding: number;
};

const STATUS_FILTERS = ["", "SENT", "PARTIALLY_PAID", "PAID", "OVERDUE", "CANCELLED"];
const money = (n: number) => n.toLocaleString("en-EG", { maximumFractionDigits: 2 });
const dateShort = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";

export function PortalInvoicesView(_props: ViewProps) {
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 12;

  const [data, setData] = useState<InvoicesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedQ(q.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<InvoicesResponse>(`/api/portal/invoices${qs({ q: debouncedQ, status, page, pageSize })}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load your invoices.");
    } finally {
      setLoading(false);
    }
  }, [debouncedQ, status, page]);

  useEffect(() => { load(); }, [load, reloadKey]);

  useEffect(() => {
    if (!detailId) { setDetail(null); setDetailError(null); return; }
    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);
    api.get<InvoiceDetail>(`/api/portal/invoices/${detailId}`)
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch((err) => { if (!cancelled) setDetailError(err instanceof Error ? err.message : "Failed to load invoice."); })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [detailId]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;
  const hasFilters = debouncedQ !== "" || status !== "";
  const currency = data?.items[0]?.currency ?? "EGP";

  const printDetail = () => {
    if (!detail || !data) return;
    printInvoice({
      org: data.org,
      clientName: data.clientName,
      projectName: detail.invoice.project?.name ?? null,
      invoice: {
        invoiceNumber: detail.invoice.invoiceNumber, issueDate: detail.invoice.issueDate,
        dueDate: detail.invoice.dueDate, status: detail.invoice.status, currency: detail.invoice.currency,
        subtotal: detail.invoice.subtotal, discountAmount: detail.invoice.discountAmount,
        taxPercent: detail.invoice.taxPercent, total: detail.invoice.total, paidAmount: detail.invoice.paidAmount,
        paymentTerms: detail.invoice.paymentTerms ?? null, notes: detail.invoice.notes ?? null,
      },
      items: detail.invoice.items.map((it) => ({ id: it.id, description: it.description, quantity: it.quantity, unitPrice: it.unitPrice, total: it.total })),
      payments: detail.invoice.payments.map((p) => ({ id: p.id, amount: p.amount, method: p.method, reference: p.reference ?? null, date: p.date })),
    });
  };

  return (
    <div>
      <PageHeader
        title="Invoices"
        description="Every issued invoice with its live payment status."
        actions={<Button variant="ghost" size="icon" onClick={() => setReloadKey((k) => k + 1)} aria-label="Refresh invoices"><RefreshCw className="w-4 h-4" /></Button>}
      />

      {/* Summary */}
      {data && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
          <StatCard label="Outstanding" value={`${money(data.summary.outstanding)} ${currency}`} accent={data.summary.outstanding > 0 ? "amber" : "emerald"} icon={<Wallet className="w-4 h-4" />} sub={data.summary.outstanding > 0 ? "Across unpaid invoices" : "You are all settled"} />
          <StatCard label="Collected to date" value={`${money(data.summary.paidTotal)} ${currency}`} accent="emerald" icon={<CheckCircle2 className="w-4 h-4" />} sub="All payments received" />
          <StatCard label="Invoices" value={data.total} accent="cyan" icon={<Receipt className="w-4 h-4" />} sub={`${data.summary.byStatus.find((s) => s.status === "OVERDUE")?.count ?? 0} overdue`} />
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by invoice number…" className="sm:max-w-xs bg-secondary/40" aria-label="Search invoices" />
        <div className="flex gap-1.5 overflow-x-auto apex-scroll pb-1" role="group" aria-label="Filter by status">
          {STATUS_FILTERS.map((s) => (
            <button key={s || "all"} onClick={() => { setStatus(s); setPage(1); }}
              className={cn("px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border transition-colors",
                status === s ? "bg-primary/15 text-primary border-primary/40" : "text-muted-foreground border-border hover:border-primary/30 hover:text-foreground")}>
              {s ? s.replace(/_/g, " ") : "All"}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <ListSkeleton rows={5} />
      ) : error ? (
        <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
      ) : !data || data.items.length === 0 ? (
        <EmptyState icon={<Receipt className="w-5 h-5" />}
          title={hasFilters ? "No invoices match your filters" : "No invoices yet"}
          description={hasFilters ? "Try adjusting the search or status filter." : "Issued invoices will appear here once billing starts."} />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block apex-panel overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Invoice</th>
                  <th className="px-4 py-3 font-medium">Issued</th>
                  <th className="px-4 py-3 font-medium">Due</th>
                  <th className="px-4 py-3 font-medium text-right">Total</th>
                  <th className="px-4 py-3 font-medium text-right">Remaining</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((inv) => {
                  const remaining = Math.max(0, inv.total - inv.paidAmount);
                  return (
                    <tr key={inv.id} onClick={() => setDetailId(inv.id)}
                      className="border-b border-border/50 last:border-0 hover:bg-accent/40 cursor-pointer transition-colors">
                      <td className="px-4 py-3 font-mono text-[13px]">{inv.invoiceNumber}
                        {inv.project && <span className="block text-[11px] text-muted-foreground font-sans mt-0.5">{inv.project.name}</span>}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{dateShort(inv.issueDate)}</td>
                      <td className="px-4 py-3 text-muted-foreground">{dateShort(inv.dueDate)}</td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">{money(inv.total)} {inv.currency}</td>
                      <td className={cn("px-4 py-3 text-right tabular-nums", remaining > 0 && inv.status !== "CANCELLED" ? "text-amber-300" : "text-muted-foreground")}>
                        {inv.status === "PAID" ? "—" : `${money(remaining)} ${inv.currency}`}
                      </td>
                      <td className="px-4 py-3"><StatusBadge status={inv.status} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {data.items.map((inv) => {
              const remaining = Math.max(0, inv.total - inv.paidAmount);
              return (
                <button key={inv.id} onClick={() => setDetailId(inv.id)} className="w-full text-left apex-panel p-4 hover:border-primary/40 transition-colors">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-mono text-sm font-medium">{inv.invoiceNumber}</p>
                      {inv.project && <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{inv.project.name}</p>}
                    </div>
                    <StatusBadge status={inv.status} />
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold tabular-nums">{money(inv.total)} {inv.currency}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">Issued {dateShort(inv.issueDate)} · Due {dateShort(inv.dueDate)}</p>
                    </div>
                    {remaining > 0 && inv.status !== "CANCELLED" && (
                      <span className="text-xs text-amber-300 font-medium">{money(remaining)} remaining</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 mt-6">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <span className="text-xs text-muted-foreground">Page {page} of {totalPages}</span>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          )}
        </>
      )}

      {/* Detail sheet */}
      <Sheet open={!!detailId} onOpenChange={(o) => { if (!o) setDetailId(null); }}>
        <SheetContent side="right" className="w-full sm:max-w-xl p-0 flex flex-col">
          <SheetHeader className="px-5 py-4 border-b border-border">
            {detailLoading || !detail ? (
              <>
                <SheetTitle className="flex items-center gap-2">
                  {detailLoading && <Loader2 className="w-4 h-4 animate-spin text-primary" />}
                  {detailLoading ? "Loading invoice…" : "Invoice"}
                </SheetTitle>
                <SheetDescription className="sr-only">Invoice details</SheetDescription>
              </>
            ) : detailError ? (
              <>
                <SheetTitle>Invoice unavailable</SheetTitle>
                <SheetDescription>{detailError}</SheetDescription>
              </>
            ) : (
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <SheetTitle className="font-mono">{detail.invoice.invoiceNumber}</SheetTitle>
                  <SheetDescription className="flex flex-wrap items-center gap-2 mt-1">
                    <StatusBadge status={detail.invoice.status} />
                    <span className="text-xs text-muted-foreground">Issued {dateShort(detail.invoice.issueDate)} · Due {dateShort(detail.invoice.dueDate)}</span>
                  </SheetDescription>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button size="sm" variant="outline" className="h-8" onClick={printDetail}>
                    <Printer className="w-3.5 h-3.5 mr-1.5" /> PDF
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setDetailId(null)} aria-label="Close details">
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}
          </SheetHeader>

          <ScrollArea className="flex-1 min-h-0">
            {detailLoading && (
              <div className="p-5 space-y-3">
                {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-12 rounded-lg bg-secondary/30 animate-pulse" />)}
              </div>
            )}
            {detailError && !detailLoading && (
              <div className="p-5"><ErrorState message={detailError} onRetry={() => setDetailId((id) => id)} /></div>
            )}
            {detail && !detailLoading && (
              <div className="px-5 py-4 space-y-5">
                {detail.invoice.project && (
                  <p className="text-xs text-muted-foreground">
                    Project: <span className="text-foreground font-medium">{detail.invoice.project.name}</span>{" "}
                    <span className="font-mono">({detail.invoice.project.projectNumber})</span>
                  </p>
                )}

                {/* Line items */}
                <div>
                  <h3 className="text-sm font-semibold flex items-center gap-2 mb-2.5"><FileText className="w-4 h-4 text-primary" /> Line items</h3>
                  <div className="rounded-lg border border-border overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-secondary/40 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                          <th className="px-3 py-2 font-medium">Description</th>
                          <th className="px-3 py-2 font-medium text-right">Qty</th>
                          <th className="px-3 py-2 font-medium text-right">Unit</th>
                          <th className="px-3 py-2 font-medium text-right">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.invoice.items.map((it) => (
                          <tr key={it.id} className="border-t border-border/60">
                            <td className="px-3 py-2.5">{it.description}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{it.quantity}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{money(it.unitPrice)}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums font-medium">{money(it.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Totals */}
                <div className="rounded-lg border border-border bg-card/40 p-4 space-y-1.5 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="tabular-nums">{money(detail.invoice.subtotal)} {detail.invoice.currency}</span></div>
                  {detail.invoice.discountAmount > 0 && (
                    <div className="flex justify-between text-emerald-300"><span>Discount</span><span className="tabular-nums">−{money(detail.invoice.discountAmount)}</span></div>
                  )}
                  {detail.invoice.taxPercent > 0 && (
                    <div className="flex justify-between"><span className="text-muted-foreground">Tax ({detail.invoice.taxPercent}%)</span><span className="tabular-nums">{money(Math.max(0, detail.invoice.total - detail.invoice.subtotal + detail.invoice.discountAmount))}</span></div>
                  )}
                  <Separator className="my-2" />
                  <div className="flex justify-between font-semibold"><span>Total</span><span className="tabular-nums">{money(detail.invoice.total)} {detail.invoice.currency}</span></div>
                  <div className="flex justify-between text-emerald-300"><span>Paid</span><span className="tabular-nums">{money(detail.invoice.paidAmount)}</span></div>
                  <div className={cn("flex justify-between font-semibold", detail.outstanding > 0 ? "text-amber-300" : "text-emerald-300")}>
                    <span>{detail.outstanding > 0 ? "Outstanding" : "Fully paid"}</span>
                    <span className="tabular-nums">{detail.outstanding > 0 ? `${money(detail.outstanding)} ${detail.invoice.currency}` : "✓"}</span>
                  </div>
                </div>

                {/* Payment history */}
                <div>
                  <h3 className="text-sm font-semibold flex items-center gap-2 mb-2.5"><CreditCard className="w-4 h-4 text-primary" /> Payment history</h3>
                  {detail.invoice.payments.length === 0 ? (
                    <p className="text-sm text-muted-foreground border border-dashed border-border rounded-lg p-4 text-center">No payments recorded yet.</p>
                  ) : (
                    <ul className="space-y-2">
                      {detail.invoice.payments.map((p) => (
                        <li key={p.id} className="rounded-lg border border-border bg-card/40 px-3 py-2.5 flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium">{money(p.amount)} {detail.invoice.currency}</p>
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                              {p.method}{p.reference ? ` · ${p.reference}` : ""} · {dateShort(p.date)}
                            </p>
                          </div>
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {(detail.invoice.paymentTerms || detail.invoice.notes) && (
                  <div className="rounded-lg border border-border/70 bg-secondary/20 p-3">
                    {detail.invoice.paymentTerms && <p className="text-xs text-muted-foreground">Terms: {detail.invoice.paymentTerms}</p>}
                    {detail.invoice.notes && <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">{detail.invoice.notes}</p>}
                  </div>
                )}
              </div>
            )}
          </ScrollArea>
        </SheetContent>
      </Sheet>
    </div>
  );
}
