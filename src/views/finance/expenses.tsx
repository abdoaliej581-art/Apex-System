"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader, EmptyState, ErrorState, ListSkeleton, Field } from "@/components/shared";
import { api, qs, formatCurrency, formatDate } from "@/lib/api-client";
import { useSession } from "next-auth/react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Receipt, Plus, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

type ExpenseRow = {
  id: string; category: string; description: string; amount: number; date: string;
  vendor?: string | null; projectId?: string | null;
  project?: { id: string; name: string; projectNumber: string } | null;
};

const CATEGORIES = ["HOSTING", "DOMAIN", "SOFTWARE", "MARKETING", "OPERATIONS", "OTHER"] as const;

const CATEGORY_STYLE: Record<string, string> = {
  HOSTING: "bg-cyan-500/10 text-cyan-300 border-cyan-500/30",
  DOMAIN: "bg-sky-500/10 text-sky-300 border-sky-500/30",
  SOFTWARE: "bg-violet-500/10 text-violet-300 border-violet-500/30",
  MARKETING: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  OPERATIONS: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  OTHER: "bg-slate-500/10 text-slate-300 border-slate-500/30",
};

export function ExpensesView({ navigate }: { navigate: (p: string) => void }) {
  const { data: session } = useSession();
  const { toast } = useToast();
  const perms = session?.user?.permissions || [];
  const can = (p: string) => perms.includes(p);

  const [rows, setRows] = useState<ExpenseRow[]>([]);
  const [summary, setSummary] = useState<{ total: number; byCategory: { category: string; amount: number }[] }>({ total: 0, byCategory: [] });
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("ALL");
  const [reloadKey, setReloadKey] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editRow, setEditRow] = useState<ExpenseRow | null>(null);
  const [deleteRow, setDeleteRow] = useState<ExpenseRow | null>(null);

  const pageSize = 15;

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const data = await api.get<{ items: ExpenseRow[]; total: number; summary: { total: number; byCategory: { category: string; amount: number }[] } }>(
        `/api/expenses${qs({ q, category: category === "ALL" ? undefined : category, page, pageSize })}`
      );
      setRows(data.items);
      setTotal(data.total);
      setSummary(data.summary);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [q, category, page, reloadKey]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [q, category]);

  const doDelete = async () => {
    if (!deleteRow) return;
    try {
      await api.delete(`/api/expenses/${deleteRow.id}`);
      toast({ title: "Expense deleted" });
      setDeleteRow(null);
      setReloadKey((k) => k + 1);
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Delete failed", variant: "destructive" });
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const topCategories = [...summary.byCategory].sort((a, b) => b.amount - a.amount).slice(0, 3);

  return (
    <div>
      <PageHeader
        title="Expenses"
        description="Hosting, domains, software, marketing and operating costs — the other side of the P&L."
        actions={can("expenses.create") ? (
          <Button onClick={() => { setEditRow(null); setDialogOpen(true); }} className="bg-primary text-primary-foreground hover:bg-primary/90">
            <Plus className="w-4 h-4 mr-2" /> New expense
          </Button>
        ) : undefined}
      />

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-5">
        <div className="apex-panel p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Total expenses</p>
          <p className="text-lg font-semibold text-rose-300 mt-1">{formatCurrency(summary.total)}</p>
        </div>
        {topCategories.map((c) => (
          <div key={c.category} className="apex-panel p-4">
            <span className={cn("inline-flex px-2 py-0.5 rounded-md border text-[10px] font-medium", CATEGORY_STYLE[c.category])}>
              {c.category}
            </span>
            <p className="text-lg font-semibold mt-1.5">{formatCurrency(c.amount)}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search description or vendor…" className="sm:max-w-xs bg-secondary/40" />
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="sm:w-44 bg-secondary/40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All categories</SelectItem>
            {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {loading ? <ListSkeleton rows={6} /> : error ? <ErrorState onRetry={load} /> : rows.length === 0 ? (
        <EmptyState
          icon={<Receipt className="w-5 h-5" />}
          title={q || category !== "ALL" ? "No expenses match your filters" : "No expenses recorded yet"}
          description={q || category !== "ALL" ? "Try adjusting the search or category filter." : "Track hosting bills, software subscriptions and other operating costs here."}
          action={can("expenses.create") && !q && category === "ALL" ? <Button onClick={() => setDialogOpen(true)}><Plus className="w-4 h-4 mr-2" /> Add first expense</Button> : undefined}
        />
      ) : (
        <>
          <div className="apex-panel overflow-x-auto apex-scroll">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 font-medium">Description</th>
                  <th className="px-4 py-3 font-medium hidden md:table-cell">Vendor</th>
                  <th className="px-4 py-3 font-medium hidden lg:table-cell">Project</th>
                  <th className="px-4 py-3 font-medium text-right">Amount</th>
                  {(can("expenses.edit") || can("expenses.delete")) && <th className="px-4 py-3 font-medium text-right">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((ex) => (
                  <tr key={ex.id} className="border-b border-border/60 hover:bg-accent/50 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">{formatDate(ex.date)}</td>
                    <td className="px-4 py-3">
                      <span className={cn("inline-flex px-2 py-0.5 rounded-md border text-[11px] font-medium", CATEGORY_STYLE[ex.category] ?? CATEGORY_STYLE.OTHER)}>
                        {ex.category}
                      </span>
                    </td>
                    <td className="px-4 py-3 max-w-[240px] truncate">{ex.description}</td>
                    <td className="px-4 py-3 hidden md:table-cell text-muted-foreground">{ex.vendor ?? "—"}</td>
                    <td className="px-4 py-3 hidden lg:table-cell text-muted-foreground max-w-[140px] truncate">{ex.project?.name ?? "—"}</td>
                    <td className="px-4 py-3 text-right font-semibold text-rose-300 whitespace-nowrap">{formatCurrency(ex.amount)}</td>
                    {(can("expenses.edit") || can("expenses.delete")) && (
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {can("expenses.edit") && (
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditRow(ex); setDialogOpen(true); }} aria-label="Edit expense">
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        {can("expenses.delete") && (
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-rose-300" onClick={() => setDeleteRow(ex)} aria-label="Delete expense">
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
            <span>{total} expense{total === 1 ? "" : "s"}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <span className="px-2 py-1.5">{page} / {totalPages}</span>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        </>
      )}

      <ExpenseDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        edit={editRow}
        onSaved={() => { setDialogOpen(false); setReloadKey((k) => k + 1); }}
      />

      <AlertDialog open={deleteRow !== null} onOpenChange={(o) => !o && setDeleteRow(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this expense?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteRow?.description} — {formatCurrency(deleteRow?.amount ?? 0)}. The action is audited but cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction className="bg-rose-500/90 hover:bg-rose-500 text-white" onClick={doDelete}>Delete expense</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ExpenseDialog({ open, onClose, edit, onSaved }: {
  open: boolean; onClose: () => void; edit: ExpenseRow | null; onSaved: () => void;
}) {
  const { toast } = useToast();
  const [category, setCategory] = useState("OTHER");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [vendor, setVendor] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setCategory(edit?.category ?? "OTHER");
      setDescription(edit?.description ?? "");
      setAmount(edit ? String(edit.amount) : "");
      setDate(edit ? edit.date.slice(0, 10) : new Date().toISOString().slice(0, 10));
      setVendor(edit?.vendor ?? "");
    }
  }, [open, edit]);

  const submit = async () => {
    const amt = Number(amount);
    if (description.trim().length < 2) { toast({ title: "Description is required", variant: "destructive" }); return; }
    if (!amt || amt <= 0) { toast({ title: "Enter a valid amount", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const payload = {
        category, description: description.trim(), amount: amt,
        date: new Date(`${date}T12:00:00.000Z`).toISOString(),
        vendor: vendor || undefined,
      };
      if (edit) {
        await api.patch(`/api/expenses/${edit.id}`, payload);
        toast({ title: "Expense updated" });
      } else {
        await api.post("/api/expenses", payload);
        toast({ title: "Expense recorded", description: formatCurrency(amt) });
      }
      onSaved();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Failed to save expense", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{edit ? "Edit expense" : "New expense"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3.5 py-1">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Category">
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="h-9 bg-secondary/40"><SelectValue /></SelectTrigger>
                <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Amount" required>
              <Input type="number" min={0.01} step={0.01} value={amount} onChange={(e) => setAmount(e.target.value)} className="h-9 bg-secondary/40" />
            </Field>
          </div>
          <Field label="Description" required>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} className="h-9 bg-secondary/40" placeholder="e.g. Vercel Pro monthly plan" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9 bg-secondary/40" /></Field>
            <Field label="Vendor"><Input value={vendor} onChange={(e) => setVendor(e.target.value)} className="h-9 bg-secondary/40" placeholder="e.g. Vercel" /></Field>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={submit} disabled={saving} className="bg-primary text-primary-foreground hover:bg-primary/90">
              {saving ? "Saving…" : edit ? "Save changes" : "Record expense"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
