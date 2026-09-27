"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader, EmptyState, ErrorState, ListSkeleton, StatusBadge, Field } from "@/components/shared";
import { api, qs, formatCurrency, formatDate } from "@/lib/api-client";
import { printInvoice, type InvoicePrintOrg } from "@/lib/invoice-print";
import { useSession } from "next-auth/react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { relativeTime } from "@/lib/api-client";
import {
  FileSpreadsheet, Plus, Trash2, Send, Ban, Wallet, AlertCircle,
  Banknote, CircleDashed, X, Printer, Mail, CheckCircle2, AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";

type InvoiceItem = { description: string; quantity: number; unitPrice: number };
type ClientOption = { id: string; companyName: string; clientNumber: string };
type ProjectOption = { id: string; name: string; projectNumber: string; clientId: string };

type InvoiceRow = {
  id: string; invoiceNumber: string; status: string; effectiveStatus: string; currency: string;
  subtotal: number; discountAmount: number; taxPercent: number; total: number; paidAmount: number; remaining: number;
  issueDate: string; dueDate: string | null; paymentTerms?: string | null; notes?: string | null;
  client: ClientOption | null; project: ProjectOption | null;
  items?: { id: string; description: string; quantity: number; unitPrice: number; total: number; order: number }[];
  payments?: { id: string; amount: number; date: string; method: string; reference?: string | null; notes?: string | null; recordedBy?: { name: string } | null }[];
  activities?: { id: string; type: string; title: string; actorName?: string | null; createdAt: string }[];
};

const STATUS_OPTIONS = [
  { value: "ALL", label: "All statuses" },
  { value: "UNPAID", label: "Unpaid (open)" },
  { value: "OVERDUE", label: "Overdue" },
  { value: "DRAFT", label: "Draft" },
  { value: "SENT", label: "Sent" },
  { value: "PARTIALLY_PAID", label: "Partially paid" },
  { value: "PAID", label: "Paid" },
  { value: "CANCELLED", label: "Cancelled" },
];

export function InvoicesView({ navigate, entityId }: { navigate: (p: string) => void; entityId?: string }) {
  const { data: session } = useSession();
  const { toast } = useToast();
  const perms = session?.user?.permissions || [];
  const can = (p: string) => perms.includes(p);

  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [summary, setSummary] = useState({ invoicedTotal: 0, paidTotal: 0 });
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("ALL");
  const [reloadKey, setReloadKey] = useState(0);

  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  // Auto-open entity from global search
  useEffect(() => {
    if (entityId) setDetailId(entityId);
  }, [entityId]);

  const pageSize = 15;

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const data = await api.get<{ items: InvoiceRow[]; total: number; summary: { invoicedTotal: number; paidTotal: number } }>(
        `/api/invoices${qs({ q, status: status === "ALL" ? undefined : status, page, pageSize })}`
      );
      setRows(data.items);
      setTotal(data.total);
      setSummary(data.summary);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [q, status, page, reloadKey]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [q, status]);

  const refresh = () => { setReloadKey((k) => k + 1); setDetailId(null); };

  const outstanding = summary.invoicedTotal - summary.paidTotal;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      <PageHeader
        title="Invoices"
        description="Billing lifecycle per client and project — send, track payments and never chase a number again."
        actions={can("invoices.create") ? (
          <Button onClick={() => setCreateOpen(true)} className="bg-primary text-primary-foreground hover:bg-primary/90">
            <Plus className="w-4 h-4 mr-2" /> New Invoice
          </Button>
        ) : undefined}
      />

      {/* Finance summary strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
        <div className="apex-panel p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-cyan-500/10 text-cyan-300 flex items-center justify-center"><FileSpreadsheet className="w-4 h-4" /></div>
          <div><p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Total invoiced</p><p className="text-lg font-semibold">{formatCurrency(summary.invoicedTotal)}</p></div>
        </div>
        <div className="apex-panel p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-emerald-500/10 text-emerald-300 flex items-center justify-center"><Banknote className="w-4 h-4" /></div>
          <div><p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Collected</p><p className="text-lg font-semibold text-emerald-300">{formatCurrency(summary.paidTotal)}</p></div>
        </div>
        <div className="apex-panel p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-amber-500/10 text-amber-300 flex items-center justify-center"><AlertCircle className="w-4 h-4" /></div>
          <div><p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Outstanding</p><p className="text-lg font-semibold text-amber-300">{formatCurrency(outstanding)}</p></div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search number, client or notes…" className="sm:max-w-xs bg-secondary/40" />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="sm:w-44 bg-secondary/40"><SelectValue /></SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {loading ? <ListSkeleton rows={6} /> : error ? <ErrorState onRetry={load} /> : rows.length === 0 ? (
        <EmptyState
          icon={<FileSpreadsheet className="w-5 h-5" />}
          title={q || status !== "ALL" ? "No invoices match your filters" : "No invoices yet"}
          description={q || status !== "ALL" ? "Try clearing the search or choosing a different status." : "Create your first invoice from a client or project and start tracking revenue."}
          action={can("invoices.create") && !q && status === "ALL" ? <Button onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4 mr-2" /> Create invoice</Button> : undefined}
        />
      ) : (
        <>
          <div className="apex-panel overflow-x-auto apex-scroll">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="px-4 py-3 font-medium">Invoice</th>
                  <th className="px-4 py-3 font-medium">Client</th>
                  <th className="px-4 py-3 font-medium hidden lg:table-cell">Project</th>
                  <th className="px-4 py-3 font-medium hidden md:table-cell">Issued</th>
                  <th className="px-4 py-3 font-medium">Due</th>
                  <th className="px-4 py-3 font-medium text-right">Total</th>
                  <th className="px-4 py-3 font-medium hidden xl:table-cell">Paid</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((inv) => {
                  const overdue = inv.effectiveStatus === "OVERDUE";
                  const paidPct = inv.total > 0 ? Math.min(100, (inv.paidAmount / inv.total) * 100) : 0;
                  return (
                    <tr key={inv.id} onClick={() => setDetailId(inv.id)} className="border-b border-border/60 hover:bg-accent/50 cursor-pointer transition-colors">
                      <td className="px-4 py-3 font-mono text-xs text-cyan-300 whitespace-nowrap">{inv.invoiceNumber}</td>
                      <td className="px-4 py-3 max-w-[180px] truncate">{inv.client?.companyName ?? "—"}</td>
                      <td className="px-4 py-3 hidden lg:table-cell max-w-[160px] truncate text-muted-foreground">{inv.project?.name ?? "—"}</td>
                      <td className="px-4 py-3 hidden md:table-cell text-muted-foreground whitespace-nowrap">{formatDate(inv.issueDate)}</td>
                      <td className={cn("px-4 py-3 whitespace-nowrap", overdue ? "text-rose-300 font-medium" : "text-muted-foreground")}>{formatDate(inv.dueDate)}</td>
                      <td className="px-4 py-3 text-right font-semibold whitespace-nowrap">{formatCurrency(inv.total, inv.currency)}</td>
                      <td className="px-4 py-3 hidden xl:table-cell min-w-[110px]">
                        <div className="flex items-center gap-2">
                          <Progress value={paidPct} className="h-1.5 flex-1" />
                          <span className="text-[10px] text-muted-foreground w-9 text-right">{Math.round(paidPct)}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3"><StatusBadge status={inv.effectiveStatus} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
            <span>{total} invoice{total === 1 ? "" : "s"}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <span className="px-2 py-1.5">{page} / {totalPages}</span>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        </>
      )}

      <NewInvoiceDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={(id) => { setCreateOpen(false); load(); setDetailId(id); }} navigate={navigate} />
      {detailId && <InvoiceDetailSheet invoiceId={detailId} onClose={refresh} can={can} />}
    </div>
  );
}

// ================= New Invoice Dialog =================
function NewInvoiceDialog({ open, onOpenChange, onCreated, navigate }: {
  open: boolean; onOpenChange: (o: boolean) => void; onCreated: (id: string) => void; navigate: (p: string) => void;
}) {
  const { toast } = useToast();
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [clientId, setClientId] = useState("none");
  const [projectId, setProjectId] = useState("none");
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState("");
  const [currency, setCurrency] = useState("EGP");
  const [discountAmount, setDiscountAmount] = useState("");
  const [taxPercent, setTaxPercent] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<InvoiceItem[]>([{ description: "", quantity: 1, unitPrice: 0 }]);
  const [saving, setSaving] = useState(false);
  const [loadErr, setLoadErr] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoadErr(false);
    api.get<{ items: ClientOption[] }>("/api/clients?pageSize=100")
      .then((d) => setClients(d.items.filter((c) => c && typeof c.id === "string")))
      .catch(() => setLoadErr(true));
    api.get<{ items: ProjectOption[] }>("/api/projects?pageSize=100")
      .then((d) => setProjects(d.items.filter((p) => p && typeof p.id === "string")))
      .catch(() => setProjects([]));
  }, [open]);

  const filteredProjects = projects.filter((p) => p.clientId === clientId);
  const subtotal = items.reduce((s, i) => s + (i.quantity || 0) * (i.unitPrice || 0), 0);
  const disc = Number(discountAmount) || 0;
  const tax = Number(taxPercent) || 0;
  const grand = Math.max(0, subtotal - disc) * (1 + tax / 100);

  const setItem = (idx: number, patch: Partial<InvoiceItem>) =>
    setItems((arr) => arr.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  const submit = async () => {
    const validItems = items.filter((i) => i.description.trim() && i.quantity > 0);
    if (clientId === "none") { toast({ title: "Client is required", variant: "destructive" }); return; }
    if (validItems.length === 0) { toast({ title: "Add at least one item with a description", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const created = await api.post<InvoiceRow>("/api/invoices", {
        clientId,
        projectId: projectId !== "none" ? projectId : undefined,
        issueDate: new Date(`${issueDate}T12:00:00.000Z`).toISOString(),
        dueDate: dueDate ? new Date(`${dueDate}T12:00:00.000Z`).toISOString() : undefined,
        currency,
        discountAmount: disc,
        taxPercent: tax,
        paymentTerms: paymentTerms || undefined,
        notes: notes || undefined,
        items: validItems.map((i) => ({ description: i.description.trim(), quantity: Number(i.quantity), unitPrice: Number(i.unitPrice) })),
      });
      toast({ title: "Invoice created", description: `${created.invoiceNumber} — ${formatCurrency(created.total, created.currency)}` });
      onCreated(created.id);
      setItems([{ description: "", quantity: 1, unitPrice: 0 }]);
      setClientId("none"); setProjectId("none"); setDiscountAmount(""); setTaxPercent(""); setNotes(""); setPaymentTerms("");
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Failed to create invoice", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[92vh] overflow-y-auto apex-scroll">
        <DialogHeader>
          <DialogTitle>New invoice</DialogTitle>
        </DialogHeader>
        {loadErr ? (
          <EmptyState title="Client list unavailable" description="You need clients.view permission, or create a client first in the CRM module." action={<Button variant="outline" onClick={() => { onOpenChange(false); navigate("crm/clients"); }}>Go to Clients</Button>} />
        ) : (
          <div className="space-y-4 py-1">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Client" required>
                <Select value={clientId} onValueChange={(v) => { setClientId(v); setProjectId("none"); }}>
                  <SelectTrigger className="h-9 bg-secondary/40"><SelectValue placeholder="Select client" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none" disabled>Select a client</SelectItem>
                    {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.companyName}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Project (optional)" hint={clientId !== "none" && filteredProjects.length === 0 ? "No projects for this client yet." : undefined}>
                <Select value={projectId} onValueChange={setProjectId} disabled={clientId === "none"}>
                  <SelectTrigger className="h-9 bg-secondary/40"><SelectValue placeholder="No project" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No project</SelectItem>
                    {filteredProjects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Field label="Issue date"><Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className="h-9 bg-secondary/40" /></Field>
              <Field label="Due date"><Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="h-9 bg-secondary/40" /></Field>
              <Field label="Currency">
                <Select value={currency} onValueChange={setCurrency}>
                  <SelectTrigger className="h-9 bg-secondary/40"><SelectValue /></SelectTrigger>
                  <SelectContent>{["EGP", "USD", "SAR", "EUR"].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Tax %"><Input type="number" min={0} max={100} step="0.5" value={taxPercent} onChange={(e) => setTaxPercent(e.target.value)} className="h-9 bg-secondary/40" placeholder="0" /></Field>
            </div>

            {/* Items editor */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground">ITEMS *</p>
                <Button type="button" variant="outline" size="sm" onClick={() => setItems((a) => [...a, { description: "", quantity: 1, unitPrice: 0 }])}>
                  <Plus className="w-3.5 h-3.5 mr-1" /> Add item
                </Button>
              </div>
              <div className="space-y-2">
                {items.map((it, idx) => (
                  <div key={idx} className="flex gap-2 items-center">
                    <Input value={it.description} onChange={(e) => setItem(idx, { description: e.target.value })} placeholder={`Item ${idx + 1} — e.g. Frontend development`} className="flex-1 h-9 bg-secondary/40" />
                    <Input type="number" min={0.5} step={0.5} value={it.quantity} onChange={(e) => setItem(idx, { quantity: Number(e.target.value) })} className="w-16 h-9 bg-secondary/40" aria-label="Quantity" />
                    <Input type="number" min={0} step={0.01} value={it.unitPrice} onChange={(e) => setItem(idx, { unitPrice: Number(e.target.value) })} className="w-24 h-9 bg-secondary/40" aria-label="Unit price" />
                    <span className="w-20 text-right text-xs text-muted-foreground hidden sm:block">{formatCurrency((it.quantity || 0) * (it.unitPrice || 0), "")}</span>
                    {items.length > 1 && (
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-rose-300" onClick={() => setItems((a) => a.filter((_, i) => i !== idx))} aria-label="Remove item">
                        <X className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex flex-col items-end gap-0.5 pt-1 text-sm border-t border-border pt-3">
                <p className="text-muted-foreground text-xs">Subtotal: {formatCurrency(subtotal, currency)}</p>
                {disc > 0 && <p className="text-muted-foreground text-xs">Discount: −{formatCurrency(disc, currency)}</p>}
                {tax > 0 && <p className="text-muted-foreground text-xs">Tax ({tax}%): {formatCurrency(Math.max(0, subtotal - disc) * (tax / 100), currency)}</p>}
                <p className="font-semibold text-cyan-300">Total: {formatCurrency(grand, currency)}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Discount amount"><Input type="number" min={0} step={0.01} value={discountAmount} onChange={(e) => setDiscountAmount(e.target.value)} className="h-9 bg-secondary/40" placeholder="0" /></Field>
              <Field label="Payment terms"><Input value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} className="h-9 bg-secondary/40" placeholder="e.g. 50% upfront, 50% on delivery" /></Field>
            </div>
            <Field label="Notes"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="bg-secondary/40" placeholder="Anything the client should know about this invoice…" /></Field>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={submit} disabled={saving} className="bg-primary text-primary-foreground hover:bg-primary/90">
                {saving ? "Creating…" : "Create invoice"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ================= Invoice Detail Sheet =================
function InvoiceDetailSheet({ invoiceId, onClose, can }: {
  invoiceId: string; onClose: () => void; can: (p: string) => boolean;
}) {
  const { toast } = useToast();
  const [inv, setInv] = useState<InvoiceRow & { payments?: InvoiceRow["payments"]; activities?: InvoiceRow["activities"] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [payOpen, setPayOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"SENT" | "CANCELLED" | "DELETE" | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const [org, setOrg] = useState<InvoicePrintOrg>({ name: "APEX" });

  useEffect(() => {
    api.get<InvoicePrintOrg>("/api/org").then(setOrg).catch(() => undefined);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setInv(await api.get<InvoiceRow>(`/api/invoices/${invoiceId}`));
    } catch {
      toast({ title: "Failed to load invoice", variant: "destructive" });
      onClose();
    } finally {
      setLoading(false);
    }
  }, [invoiceId]);

  useEffect(() => { load(); }, [load]);

  const doStatus = async (status: "SENT" | "CANCELLED") => {
    try {
      await api.patch(`/api/invoices/${invoiceId}`, { status });
      toast({ title: status === "SENT" ? "Invoice sent" : "Invoice cancelled" });
      setConfirmAction(null);
      load();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Action failed", variant: "destructive" });
    }
  };

  const doDelete = async () => {
    try {
      await api.delete(`/api/invoices/${invoiceId}`);
      toast({ title: "Draft invoice deleted" });
      setConfirmAction(null);
      onClose();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Delete failed", variant: "destructive" });
    }
  };

  const paidPct = inv && inv.total > 0 ? Math.min(100, (inv.paidAmount / inv.total) * 100) : 0;

  const printCurrent = () => {
    if (!inv) return;
    printInvoice({
      org,
      clientName: inv.client?.companyName || "Client",
      projectName: inv.project?.name ?? null,
      invoice: {
        invoiceNumber: inv.invoiceNumber, issueDate: inv.issueDate, dueDate: inv.dueDate,
        status: inv.effectiveStatus, currency: inv.currency, subtotal: inv.subtotal,
        discountAmount: inv.discountAmount, taxPercent: inv.taxPercent, total: inv.total,
        paidAmount: inv.paidAmount, paymentTerms: inv.paymentTerms ?? null, notes: inv.notes ?? null,
      },
      items: (inv.items ?? []).map((it) => ({ id: it.id, description: it.description, quantity: it.quantity, unitPrice: it.unitPrice, total: it.quantity * it.unitPrice })),
      payments: (inv.payments ?? []).map((p) => ({ id: p.id, amount: p.amount, method: p.method, reference: p.reference ?? null, date: p.date })),
    });
  };

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-[560px] p-0 overflow-y-auto apex-scroll">
        {loading || !inv ? (
          <div className="p-6 space-y-3"><ListSkeleton rows={5} /></div>
        ) : (
          <div className="p-6 space-y-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <SheetTitle className="font-mono text-cyan-300">{inv.invoiceNumber}</SheetTitle>
                <p className="text-sm text-muted-foreground mt-0.5">{inv.client?.companyName}{inv.project ? ` · ${inv.project.name}` : ""}</p>
              </div>
              <StatusBadge status={inv.effectiveStatus} />
            </div>

            {/* Money box */}
            <div className="apex-panel p-4 space-y-2.5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Total</span>
                <span className="font-semibold text-base">{formatCurrency(inv.total, inv.currency)}</span>
              </div>
              <Progress value={paidPct} className="h-2" />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Paid {formatCurrency(inv.paidAmount, inv.currency)} ({Math.round(paidPct)}%)</span>
                <span className={inv.remaining > 0 ? "text-amber-300 font-medium" : "text-emerald-300"}>
                  {inv.remaining > 0 ? `${formatCurrency(inv.remaining, inv.currency)} remaining` : "Fully paid"}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 pt-1 text-xs text-muted-foreground">
                <p>Issued: <span className="text-foreground">{formatDate(inv.issueDate)}</span></p>
                <p>Due: <span className={inv.effectiveStatus === "OVERDUE" ? "text-rose-300" : "text-foreground"}>{formatDate(inv.dueDate)}</span></p>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={printCurrent}>
                <Printer className="w-4 h-4 mr-1.5" /> Print / PDF
              </Button>
              {can("invoices.edit") && inv.status !== "DRAFT" && inv.status !== "CANCELLED" && (
                <Button size="sm" variant="outline" onClick={() => setEmailOpen(true)}>
                  <Mail className="w-4 h-4 mr-1.5" /> Email to client
                </Button>
              )}
              {can("payments.create") && !["PAID", "CANCELLED", "DRAFT"].includes(inv.status) && inv.remaining > 0 && (
                <Button size="sm" className="bg-emerald-500/90 hover:bg-emerald-500 text-emerald-950 font-semibold" onClick={() => setPayOpen(true)}>
                  <Wallet className="w-4 h-4 mr-1.5" /> Record payment
                </Button>
              )}
              {can("invoices.edit") && inv.status === "DRAFT" && (
                <Button size="sm" variant="outline" onClick={() => setConfirmAction("SENT")}>
                  <Send className="w-4 h-4 mr-1.5" /> Mark as sent
                </Button>
              )}
              {can("invoices.edit") && ["DRAFT", "SENT", "PARTIALLY_PAID"].includes(inv.status) && inv.paidAmount === 0 && (
                <Button size="sm" variant="outline" className="text-rose-300 border-rose-500/30" onClick={() => setConfirmAction("CANCELLED")}>
                  <Ban className="w-4 h-4 mr-1.5" /> Cancel invoice
                </Button>
              )}
              {can("invoices.delete") && inv.status === "DRAFT" && (
                <Button size="sm" variant="outline" className="text-rose-300 border-rose-500/30" onClick={() => setConfirmAction("DELETE")}>
                  <Trash2 className="w-4 h-4 mr-1.5" /> Delete draft
                </Button>
              )}
            </div>

            <Tabs defaultValue="items">
              <TabsList className="w-full justify-start">
                <TabsTrigger value="items">Items</TabsTrigger>
                <TabsTrigger value="payments">Payments ({inv.payments?.length ?? 0})</TabsTrigger>
                <TabsTrigger value="history">History</TabsTrigger>
              </TabsList>
              <TabsContent value="items" className="mt-3">
                <div className="rounded-lg border border-border overflow-hidden">
                  <table className="w-full text-sm">
                    <tbody>
                      {(inv.items ?? []).map((it) => (
                        <tr key={it.id} className="border-b border-border/60 last:border-0">
                          <td className="px-3 py-2.5">{it.description}</td>
                          <td className="px-3 py-2.5 text-right text-muted-foreground whitespace-nowrap">{it.quantity} × {it.unitPrice.toLocaleString()}</td>
                          <td className="px-3 py-2.5 text-right font-medium whitespace-nowrap">{formatCurrency(it.total, inv.currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="text-xs text-muted-foreground mt-2 space-y-0.5 text-right">
                  <p>Subtotal: {formatCurrency(inv.subtotal, inv.currency)}</p>
                  {inv.discountAmount > 0 && <p>Discount: −{formatCurrency(inv.discountAmount, inv.currency)}</p>}
                  {inv.taxPercent > 0 && <p>Tax ({inv.taxPercent}%): {formatCurrency((inv.subtotal - inv.discountAmount) * (inv.taxPercent / 100), inv.currency)}</p>}
                </div>
              </TabsContent>
              <TabsContent value="payments" className="mt-3">
                {(inv.payments ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">No payments recorded yet.</p>
                ) : (
                  <div className="space-y-2">
                    {(inv.payments ?? []).map((p) => (
                      <div key={p.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
                        <div>
                          <p className="text-sm font-medium text-emerald-300">{formatCurrency(p.amount, inv.currency)}</p>
                          <p className="text-xs text-muted-foreground">{formatDate(p.date)} · {p.method.replace(/_/g, " ")}{p.reference ? ` · ${p.reference}` : ""}</p>
                        </div>
                        <p className="text-[11px] text-muted-foreground">{p.recordedBy?.name ?? "—"}</p>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>
              <TabsContent value="history" className="mt-3">
                {(inv.activities ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">No history yet.</p>
                ) : (
                  <div className="space-y-3">
                    {(inv.activities ?? []).map((a) => (
                      <div key={a.id} className="flex gap-2.5">
                        <CircleDashed className="w-3.5 h-3.5 text-cyan-400 mt-1 shrink-0" />
                        <div><p className="text-sm">{a.title}</p><p className="text-[11px] text-muted-foreground">{a.actorName ?? "System"} · {relativeTime(a.createdAt)}</p></div>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>
            </Tabs>

            {/* Confirmations (§70) */}
            <AlertDialog open={confirmAction !== null} onOpenChange={(o) => !o && setConfirmAction(null)}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {confirmAction === "SENT" && "Mark invoice as sent?"}
                    {confirmAction === "CANCELLED" && "Cancel this invoice?"}
                    {confirmAction === "DELETE" && "Delete this draft invoice?"}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {confirmAction === "SENT" && "Items and amounts become locked. You will still be able to record payments and cancel."}
                    {confirmAction === "CANCELLED" && "This may affect related records. Cancelled invoices stay in history for auditability."}
                    {confirmAction === "DELETE" && "Only drafts can be deleted. Sent invoices must be cancelled instead to preserve financial history."}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Go back</AlertDialogCancel>
                  <AlertDialogAction
                    className={confirmAction === "SENT" ? "bg-primary text-primary-foreground" : "bg-rose-500/90 hover:bg-rose-500 text-white"}
                    onClick={() => confirmAction === "SENT" ? doStatus("SENT") : confirmAction === "CANCELLED" ? doStatus("CANCELLED") : doDelete()}
                  >
                    {confirmAction === "SENT" ? "Mark as sent" : confirmAction === "CANCELLED" ? "Cancel invoice" : "Delete draft"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            {payOpen && (
              <RecordPaymentDialog
                invoice={{ id: inv.id, invoiceNumber: inv.invoiceNumber, remaining: inv.remaining, currency: inv.currency, clientName: inv.client?.companyName ?? "" }}
                onClose={() => { setPayOpen(false); load(); }}
              />
            )}
            {emailOpen && inv && (
              <EmailInvoiceDialog
                invoice={{ id: inv.id, invoiceNumber: inv.invoiceNumber, clientName: inv.client?.companyName ?? "", clientEmail: null }}
                onClose={() => setEmailOpen(false)}
              />
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ================= Email Invoice Dialog =================
function EmailInvoiceDialog({ invoice, onClose }: {
  invoice: { id: string; invoiceNumber: string; clientName: string; clientEmail: string | null };
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [toEmail, setToEmail] = useState(invoice.clientEmail ?? "");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async () => {
    if (!toEmail.trim()) {
      toast({ title: "Enter a recipient email address", variant: "destructive" });
      return;
    }
    setSending(true);
    try {
      const res = await api.post<{ sent: boolean; skipped: boolean; sentTo: string }>(
        `/api/invoices/${invoice.id}/email`,
        { toEmail: toEmail.trim(), message: message.trim() || undefined }
      );
      if (res.skipped) {
        toast({
          title: "Email not sent — SMTP not configured",
          description: "Set SMTP_HOST, SMTP_USER, SMTP_PASS and MAIL_FROM in your environment.",
          variant: "destructive",
        });
      } else {
        setSent(true);
        toast({ title: `Invoice emailed to ${res.sentTo}` });
      }
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Failed to send email", variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Email invoice — {invoice.invoiceNumber}</DialogTitle>
        </DialogHeader>
        {sent ? (
          <div className="py-6 flex flex-col items-center gap-3 text-center">
            <CheckCircle2 className="w-10 h-10 text-emerald-400" />
            <p className="font-medium">Invoice sent successfully</p>
            <p className="text-sm text-muted-foreground">The client will receive the invoice with full details and payment terms.</p>
            <Button variant="outline" className="mt-2" onClick={onClose}>Close</Button>
          </div>
        ) : (
          <div className="space-y-3.5 py-1">
            <p className="text-xs text-muted-foreground">
              Sending <span className="text-foreground font-medium">{invoice.invoiceNumber}</span> to{" "}
              <span className="text-foreground font-medium">{invoice.clientName}</span>
            </p>
            <Field label="Recipient email" required>
              <Input
                type="email"
                value={toEmail}
                onChange={(e) => setToEmail(e.target.value)}
                placeholder="client@example.com"
                className="h-9 bg-secondary/40"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                We pre-filled the primary contact email if available. You can override it.
              </p>
            </Field>
            <Field label="Personal message (optional)" hint="Shown above the invoice details in the email.">
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
                className="bg-secondary/40"
                placeholder="e.g. Hi Ahmed, please find attached invoice for the Q4 project…"
              />
            </Field>
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/8 px-3 py-2.5 flex gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-200">
                The email will contain the full invoice with all line items, totals, and payment terms.
                Make sure the invoice is correct before sending.
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button
                onClick={submit}
                disabled={sending || !toEmail.trim()}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {sending ? (
                  <><span className="w-4 h-4 mr-2 border-2 border-current border-t-transparent rounded-full animate-spin inline-block" />Sending…</>
                ) : (
                  <><Mail className="w-4 h-4 mr-1.5" />Send invoice</>
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
export function RecordPaymentDialog({ invoice, onClose }: {
  invoice: { id: string; invoiceNumber: string; remaining: number; currency: string; clientName: string };
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [amount, setAmount] = useState(String(invoice.remaining));
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState("BANK_TRANSFER");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const amt = Number(amount);
    if (!amt || amt <= 0) { toast({ title: "Enter a valid amount", variant: "destructive" }); return; }
    setSaving(true);
    try {
      await api.post("/api/payments", {
        invoiceId: invoice.id,
        amount: amt,
        date: new Date(`${date}T12:00:00.000Z`).toISOString(),
        method,
        reference: reference || undefined,
        notes: notes || undefined,
      });
      toast({ title: "Payment recorded", description: `${formatCurrency(amt, invoice.currency)} for ${invoice.invoiceNumber}` });
      onClose();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Failed to record payment", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record payment — {invoice.invoiceNumber}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3.5 py-1">
          <p className="text-xs text-muted-foreground">{invoice.clientName} · remaining <span className="text-amber-300 font-medium">{formatCurrency(invoice.remaining, invoice.currency)}</span></p>
          <Field label="Amount" required>
            <Input type="number" min={0.01} step={0.01} value={amount} onChange={(e) => setAmount(e.target.value)} className="h-9 bg-secondary/40" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9 bg-secondary/40" /></Field>
            <Field label="Method">
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger className="h-9 bg-secondary/40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["BANK_TRANSFER", "CASH", "INSTAPAY", "VODAFONE_CASH", "PAYPAL", "OTHER"].map((m) => (
                    <SelectItem key={m} value={m}>{m.replace(/_/g, " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="Reference"><Input value={reference} onChange={(e) => setReference(e.target.value)} className="h-9 bg-secondary/40" placeholder="Transfer / receipt number" /></Field>
          <Field label="Notes"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="bg-secondary/40" /></Field>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={submit} disabled={saving} className="bg-emerald-500/90 hover:bg-emerald-500 text-emerald-950 font-semibold">
              {saving ? "Saving…" : "Record payment"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
