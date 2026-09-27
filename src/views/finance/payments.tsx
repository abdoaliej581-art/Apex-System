"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader, EmptyState, ErrorState, ListSkeleton, Field } from "@/components/shared";
import { api, qs, formatCurrency, formatDate } from "@/lib/api-client";
import { useSession } from "next-auth/react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Banknote, Plus } from "lucide-react";
import { RecordPaymentDialog } from "@/views/finance/invoices";
import { cn } from "@/lib/utils";

type PaymentRow = {
  id: string; amount: number; date: string; method: string; reference?: string | null; notes?: string | null;
  invoice?: { id: string; invoiceNumber: string; currency: string; status: string } | null;
  client?: { id: string; companyName: string; clientNumber: string } | null;
  recordedBy?: { id: string; name: string } | null;
};

type OpenInvoice = { id: string; invoiceNumber: string; remaining: number; currency: string; clientName: string };

const METHODS = ["ALL", "BANK_TRANSFER", "CASH", "INSTAPAY", "VODAFONE_CASH", "PAYPAL", "OTHER"];

const METHOD_STYLE: Record<string, string> = {
  BANK_TRANSFER: "bg-cyan-500/10 text-cyan-300 border-cyan-500/30",
  CASH: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  INSTAPAY: "bg-violet-500/10 text-violet-300 border-violet-500/30",
  VODAFONE_CASH: "bg-rose-500/10 text-rose-300 border-rose-500/30",
  PAYPAL: "bg-sky-500/10 text-sky-300 border-sky-500/30",
  OTHER: "bg-slate-500/10 text-slate-300 border-slate-500/30",
};

export function PaymentsView({ navigate }: { navigate: (p: string) => void }) {
  const { data: session } = useSession();
  const { toast } = useToast();
  const perms = session?.user?.permissions || [];
  const can = (p: string) => perms.includes(p);

  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState({ totalCollected: 0 });
  const [thisMonthTotal, setThisMonthTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [q, setQ] = useState("");
  const [method, setMethod] = useState("ALL");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [recordOpen, setRecordOpen] = useState(false);

  const pageSize = 15;

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const now = new Date();
      const monthFrom = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
      const [data, monthData] = await Promise.all([
        api.get<{ items: PaymentRow[]; total: number; summary: { totalCollected: number } }>(
          `/api/payments${qs({ q, method: method === "ALL" ? undefined : method, from, to, page, pageSize })}`
        ),
        api.get<{ items: PaymentRow[]; total: number; summary: { totalCollected: number } }>(
          `/api/payments${qs({ from: monthFrom, pageSize: 1 })}`
        ),
      ]);
      setRows(data.items);
      setTotal(data.total);
      setSummary(data.summary);
      setThisMonthTotal(monthData.summary.totalCollected);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [q, method, from, to, page, reloadKey]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [q, method, from, to]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      <PageHeader
        title="Payments"
        description="Every amount collected — traceable to its invoice, method and recorder."
        actions={can("payments.create") ? (
          <Button onClick={() => setRecordOpen(true)} className="bg-emerald-500/90 hover:bg-emerald-500 text-emerald-950 font-semibold">
            <Plus className="w-4 h-4 mr-2" /> Record payment
          </Button>
        ) : undefined}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
        <div className="apex-panel p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-emerald-500/10 text-emerald-300 flex items-center justify-center"><Banknote className="w-4 h-4" /></div>
          <div><p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Total collected (all time)</p><p className="text-lg font-semibold text-emerald-300">{formatCurrency(summary.totalCollected)}</p></div>
        </div>
        <div className="apex-panel p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-cyan-500/10 text-cyan-300 flex items-center justify-center"><Banknote className="w-4 h-4" /></div>
          <div><p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Collected this month</p><p className="text-lg font-semibold">{formatCurrency(thisMonthTotal)}</p></div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-4">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search invoice, client, reference…" className="bg-secondary/40 col-span-2 lg:col-span-1" />
        <Select value={method} onValueChange={setMethod}>
          <SelectTrigger className="bg-secondary/40"><SelectValue placeholder="All methods" /></SelectTrigger>
          <SelectContent>
            {METHODS.map((m) => <SelectItem key={m} value={m}>{m === "ALL" ? "All methods" : m.replace(/_/g, " ")}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="bg-secondary/40" aria-label="From date" />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="bg-secondary/40" aria-label="To date" />
      </div>

      {loading ? <ListSkeleton rows={6} /> : error ? <ErrorState onRetry={load} /> : rows.length === 0 ? (
        <EmptyState
          icon={<Banknote className="w-5 h-5" />}
          title={q || method !== "ALL" || from || to ? "No payments match your filters" : "No payments recorded yet"}
          description={q || method !== "ALL" || from || to ? "Try adjusting the search, method or date range." : "Record a payment against a sent invoice to start tracking collected revenue."}
          action={can("payments.create") && !q && method === "ALL" ? <Button onClick={() => setRecordOpen(true)}><Plus className="w-4 h-4 mr-2" /> Record first payment</Button> : undefined}
        />
      ) : (
        <>
          <div className="apex-panel overflow-x-auto apex-scroll">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Invoice</th>
                  <th className="px-4 py-3 font-medium hidden md:table-cell">Client</th>
                  <th className="px-4 py-3 font-medium text-right">Amount</th>
                  <th className="px-4 py-3 font-medium">Method</th>
                  <th className="px-4 py-3 font-medium hidden lg:table-cell">Reference</th>
                  <th className="px-4 py-3 font-medium hidden xl:table-cell">Recorded by</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className="border-b border-border/60 hover:bg-accent/50 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">{formatDate(p.date)}</td>
                    <td className="px-4 py-3 font-mono text-xs text-cyan-300 whitespace-nowrap">{p.invoice?.invoiceNumber ?? "—"}</td>
                    <td className="px-4 py-3 hidden md:table-cell max-w-[180px] truncate">{p.client?.companyName ?? "—"}</td>
                    <td className="px-4 py-3 text-right font-semibold text-emerald-300 whitespace-nowrap">{formatCurrency(p.amount, p.invoice?.currency ?? "EGP")}</td>
                    <td className="px-4 py-3">
                      <span className={cn("inline-flex px-2 py-0.5 rounded-md border text-[11px] font-medium", METHOD_STYLE[p.method] ?? METHOD_STYLE.OTHER)}>
                        {p.method.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-muted-foreground text-xs">{p.reference ?? "—"}</td>
                    <td className="px-4 py-3 hidden xl:table-cell text-muted-foreground text-xs">{p.recordedBy?.name ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
            <span>{total} payment{total === 1 ? "" : "s"}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <span className="px-2 py-1.5">{page} / {totalPages}</span>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        </>
      )}

      {recordOpen && <RecordPaymentPicker onClose={() => { setRecordOpen(false); setReloadKey((k) => k + 1); }} />}
    </div>
  );
}

/** Picks an open invoice (SENT / PARTIALLY_PAID / OVERDUE with remaining > 0), then opens the shared payment dialog. */
function RecordPaymentPicker({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const [invoices, setInvoices] = useState<OpenInvoice[]>([]);
  const [selected, setSelected] = useState<OpenInvoice | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<{ items: (OpenInvoice & { effectiveStatus: string; status: string; client?: { companyName: string } | null })[] }>("/api/invoices?pageSize=100")
      .then((d) => {
        const open = d.items
          .filter((i) => i.remaining > 0 && !["DRAFT", "CANCELLED", "PAID"].includes(i.effectiveStatus))
          .map((i) => ({ id: i.id, invoiceNumber: i.invoiceNumber, remaining: i.remaining, currency: i.currency, clientName: i.client?.companyName ?? "" }));
        setInvoices(open);
      })
      .catch(() => toast({ title: "Failed to load open invoices", variant: "destructive" }))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="fixed inset-0 z-50 bg-background/70 flex items-center justify-center"><ListSkeleton rows={3} /></div>
  );

  if (selected) return <RecordPaymentDialog invoice={selected} onClose={onClose} />;

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="apex-panel w-full max-w-md max-h-[70vh] overflow-y-auto apex-scroll p-5" onClick={(e) => e.stopPropagation()}>
        <p className="font-semibold mb-1">Select an invoice</p>
        <p className="text-xs text-muted-foreground mb-4">Only sent invoices with a remaining amount are listed.</p>
        {invoices.length === 0 ? (
          <EmptyState title="No open invoices" description="All sent invoices are fully paid. Send an invoice from the Invoices view first." />
        ) : (
          <div className="space-y-2">
            {invoices.map((inv) => (
              <button key={inv.id} onClick={() => setSelected(inv)} className="w-full text-left rounded-lg border border-border px-3 py-2.5 hover:border-primary/40 hover:bg-accent/50 transition-colors">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-mono text-cyan-300">{inv.invoiceNumber}</p>
                    <p className="text-xs text-muted-foreground truncate">{inv.clientName}</p>
                  </div>
                  <span className="text-sm font-semibold text-amber-300 whitespace-nowrap">{formatCurrency(inv.remaining, inv.currency)}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
