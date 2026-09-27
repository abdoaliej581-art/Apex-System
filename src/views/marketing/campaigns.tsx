"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader, EmptyState, ErrorState, ListSkeleton, StatusBadge, Field, StatCard } from "@/components/shared";
import { api, qs, formatCurrency, formatDate, relativeTime } from "@/lib/api-client";
import { useSession } from "next-auth/react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import {
  BarChart3, Plus, Pencil, Trash2, Search, Target, Users, CalendarRange, FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";

const STATUSES = ["PLANNING", "ACTIVE", "PAUSED", "COMPLETED", "CANCELLED"] as const;

type CampaignRow = {
  id: string; name: string; objective: string | null; audience: string | null;
  platform: string | null; startDate: string | null; endDate: string | null;
  budget: number | null; notes: string | null; status: string;
  createdAt: string; updatedAt: string; contentCount: number;
};

type Summary = { byStatus: { status: string; count: number }[]; totalBudget: number };

type LinkedContent = {
  id: string; title: string; platform: string; contentType: string; status: string;
  publishDate: string | null;
  author: { id: string; name: string; avatarColor: string } | null;
};

const STATUS_ACCENT: Record<string, string> = {
  PLANNING: "bg-sky-500/10 text-sky-300 border-sky-500/30",
  ACTIVE: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  PAUSED: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  COMPLETED: "bg-slate-500/10 text-slate-300 border-slate-500/30",
  CANCELLED: "bg-rose-500/10 text-rose-300 border-rose-500/30",
};

const emptyForm = {
  name: "", objective: "", audience: "", platform: "", status: "PLANNING",
  startDate: "", endDate: "", budget: "", notes: "",
};

export function CampaignsView({ navigate: _navigate }: { navigate: (p: string) => void }) {
  const { data: session } = useSession();
  const { toast } = useToast();
  const perms = session?.user?.permissions || [];
  const can = (p: string) => perms.includes(p);

  const [rows, setRows] = useState<CampaignRow[]>([]);
  const [summary, setSummary] = useState<Summary>({ byStatus: [], totalBudget: 0 });
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("ALL");
  const [reloadKey, setReloadKey] = useState(0);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editRow, setEditRow] = useState<CampaignRow | null>(null);
  const [deleteRow, setDeleteRow] = useState<CampaignRow | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  // detail
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ campaign: CampaignRow; contents: LinkedContent[]; activities: { id: string; title: string; description: string | null; createdAt: string; actorName: string | null; actorColor: string | null }[] } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const pageSize = 12;

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const data = await api.get<{ items: CampaignRow[]; total: number; summary: Summary }>(
        `/api/campaigns${qs({
          q, status: status === "ALL" ? undefined : status, page, pageSize,
        })}`
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

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const d = await api.get<{ campaign: CampaignRow; contents: LinkedContent[]; activities: { id: string; title: string; description: string | null; createdAt: string; actorName: string | null; actorColor: string | null }[] }>(`/api/campaigns/${id}`);
      setDetail(d);
    } catch {
      toast({ title: "Could not load campaign details", variant: "destructive" });
      setDetailId(null);
    } finally {
      setDetailLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (detailId) loadDetail(detailId);
    else setDetail(null);
  }, [detailId, loadDetail]);

  const openCreate = () => { setEditRow(null); setForm(emptyForm); setDialogOpen(true); };
  const openEdit = (row: CampaignRow) => {
    setEditRow(row);
    setForm({
      name: row.name, objective: row.objective || "", audience: row.audience || "",
      platform: row.platform || "", status: row.status,
      startDate: row.startDate ? new Date(row.startDate).toISOString().slice(0, 10) : "",
      endDate: row.endDate ? new Date(row.endDate).toISOString().slice(0, 10) : "",
      budget: row.budget != null ? String(row.budget) : "",
      notes: row.notes || "",
    });
    setDialogOpen(true);
  };

  const doSave = async () => {
    if (form.name.trim().length < 2) {
      toast({ title: "Campaign name is required", variant: "destructive" });
      return;
    }
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      objective: form.objective || null,
      audience: form.audience || null,
      platform: form.platform || null,
      status: form.status,
      startDate: form.startDate ? new Date(`${form.startDate}T00:00:00`).toISOString() : null,
      endDate: form.endDate ? new Date(`${form.endDate}T23:59:59`).toISOString() : null,
      budget: form.budget === "" ? null : Number(form.budget),
      notes: form.notes || null,
    };
    try {
      if (editRow) {
        await api.patch(`/api/campaigns/${editRow.id}`, payload);
        toast({ title: "Campaign updated" });
      } else {
        await api.post("/api/campaigns", payload);
        toast({ title: "Campaign created" });
      }
      setDialogOpen(false);
      setReloadKey((k) => k + 1);
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Save failed", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const quickStatus = async (row: CampaignRow, next: string) => {
    try {
      await api.patch(`/api/campaigns/${row.id}`, { status: next });
      toast({ title: `Campaign marked ${next.toLowerCase()}` });
      if (detailId === row.id) loadDetail(row.id);
      setReloadKey((k) => k + 1);
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Status change failed", variant: "destructive" });
    }
  };

  const doDelete = async () => {
    if (!deleteRow) return;
    try {
      await api.delete(`/api/campaigns/${deleteRow.id}`);
      toast({ title: "Campaign deleted", description: deleteRow.contentCount > 0 ? `${deleteRow.contentCount} linked content items were kept (unlinked).` : undefined });
      if (detailId === deleteRow.id) setDetailId(null);
      setDeleteRow(null);
      setReloadKey((k) => k + 1);
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Delete failed", variant: "destructive" });
    }
  };

  const countBy = (s: string) => summary.byStatus.find((x) => x.status === s)?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasFilters = q !== "" || status !== "ALL";

  // Campaign lifetime progress (start → end) for the card progress bar
  const lifetime = (row: CampaignRow): number | null => {
    if (!row.startDate || !row.endDate) return null;
    const start = new Date(row.startDate).getTime();
    const end = new Date(row.endDate).getTime();
    const now = Date.now();
    if (end <= start) return null;
    return Math.min(100, Math.max(0, Math.round(((now - start) / (end - start)) * 100)));
  };

  return (
    <div>
      <PageHeader
        title="Campaigns"
        description="Marketing campaigns linked to content — plan budgets, track status and connect output to the pipeline."
        actions={can("campaigns.create") ? (
          <Button onClick={openCreate} className="bg-primary text-primary-foreground hover:bg-primary/90">
            <Plus className="w-4 h-4 mr-2" /> New campaign
          </Button>
        ) : undefined}
      />

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-5">
        <StatCard label="Active campaigns" value={countBy("ACTIVE")} sub={`${countBy("PLANNING")} planning · ${countBy("PAUSED")} paused`} icon={<Target className="w-4 h-4" />} accent="emerald" />
        <StatCard label="Total budget" value={formatCurrency(summary.totalBudget)} sub="across all campaigns" icon={<BarChart3 className="w-4 h-4" />} accent="cyan" />
        <StatCard label="Completed" value={countBy("COMPLETED")} sub={`${countBy("CANCELLED")} cancelled`} icon={<CalendarRange className="w-4 h-4" />} accent="violet" />
        <StatCard label="All campaigns" value={total} sub="in the system" icon={<FileText className="w-4 h-4" />} accent="amber" />
      </div>

      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <div className="relative sm:max-w-xs w-full">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search campaigns…" className="pl-8 bg-secondary/40" />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="sm:w-44 bg-secondary/40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {loading ? <ListSkeleton rows={6} /> : error ? <ErrorState onRetry={load} /> : rows.length === 0 ? (
        <EmptyState
          icon={<Target className="w-5 h-5" />}
          title={hasFilters ? "No campaigns match your filters" : "No campaigns yet"}
          description={hasFilters ? "Try adjusting the search or status filter." : "Group your content pushes under campaigns to see what actually moves the business."}
          action={can("campaigns.create") && !hasFilters ? <Button onClick={openCreate}><Plus className="w-4 h-4 mr-2" /> Create first campaign</Button> : undefined}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {rows.map((row) => {
              const pct = lifetime(row);
              return (
                <button key={row.id} onClick={() => setDetailId(row.id)} className="apex-panel p-5 text-left hover:border-primary/40 transition-colors flex flex-col">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="font-medium truncate">{row.name}</h3>
                      {row.platform && <p className="text-xs text-muted-foreground mt-0.5">{row.platform}</p>}
                    </div>
                    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-md border text-[11px] font-medium shrink-0", STATUS_ACCENT[row.status])}>
                      {row.status}
                    </span>
                  </div>

                  {row.objective && <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{row.objective}</p>}

                  <div className="grid grid-cols-2 gap-3 mt-3 text-xs">
                    <div>
                      <p className="text-muted-foreground">Budget</p>
                      <p className="font-medium mt-0.5">{row.budget != null ? formatCurrency(row.budget) : "—"}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Content</p>
                      <p className="font-medium mt-0.5">{row.contentCount} item{row.contentCount === 1 ? "" : "s"}</p>
                    </div>
                    <div className="col-span-2">
                      <p className="text-muted-foreground">Period</p>
                      <p className="font-medium mt-0.5">{row.startDate ? formatDate(row.startDate) : "—"} → {row.endDate ? formatDate(row.endDate) : "—"}</p>
                    </div>
                  </div>

                  {pct != null && (
                    <div className="mt-3">
                      <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                        <span>Lifetime</span><span>{pct}%</span>
                      </div>
                      <Progress value={pct} className="h-1.5" />
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between mt-4 text-xs text-muted-foreground">
            <span>{total} campaign{total === 1 ? "" : "s"}</span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
              <span>{page} / {totalPages}</span>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          </div>
        </>
      )}

      {/* ---------- Create / edit dialog ---------- */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editRow ? "Edit campaign" : "New campaign"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <Field label="Campaign name" required>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Ramadan web-dev offers" className="bg-secondary/40" />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Objective">
                <Input value={form.objective} onChange={(e) => setForm({ ...form, objective: e.target.value })} placeholder="e.g. Generate 20 qualified leads" className="bg-secondary/40" />
              </Field>
            </div>
            <Field label="Audience">
              <Input value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })} placeholder="e.g. Egyptian SMB owners" className="bg-secondary/40" />
            </Field>
            <Field label="Platform">
              <Input value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })} placeholder="e.g. Facebook + Instagram" className="bg-secondary/40" />
            </Field>
            <Field label="Status" required>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger className="bg-secondary/40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Budget (EGP)">
              <Input type="number" min="0" step="0.01" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} placeholder="0.00" className="bg-secondary/40" />
            </Field>
            <Field label="Start date">
              <Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} className="bg-secondary/40" />
            </Field>
            <Field label="End date">
              <Input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} className="bg-secondary/40" />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Notes">
                <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Strategy notes, links, learnings…" className="bg-secondary/40" />
              </Field>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={doSave} disabled={saving} className="bg-primary text-primary-foreground hover:bg-primary/90">
              {saving ? "Saving…" : editRow ? "Save changes" : "Create campaign"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ---------- Detail sheet ---------- */}
      <Sheet open={!!detailId} onOpenChange={(open) => { if (!open) setDetailId(null); }}>
        <SheetContent className="w-full sm:max-w-lg p-0 flex flex-col">
          {/* Header always rendered — Radix requires SheetTitle for a11y */}
          <div className="p-5 border-b border-border">
            <SheetTitle className="text-base font-semibold">{detail?.campaign.name || "…"}</SheetTitle>
            {detail && (
              <div className="flex items-center gap-2 mt-2">
                <span className={cn("inline-flex items-center px-2 py-0.5 rounded-md border text-[11px] font-medium", STATUS_ACCENT[detail.campaign.status])}>
                  {detail.campaign.status}
                </span>
                {detail.campaign.platform && <span className="text-[11px] text-muted-foreground">{detail.campaign.platform}</span>}
              </div>
            )}
          </div>
          {detailLoading || !detail ? (
            <div className="p-6 space-y-3"><ListSkeleton rows={5} /></div>
          ) : (
            <ScrollArea className="flex-1 apex-scroll">
                <div className="p-5 space-y-5">
                  {/* Quick status */}
                  {can("campaigns.edit") && (
                    <div className="flex flex-wrap gap-1.5">
                      {STATUSES.filter((s) => s !== detail.campaign.status).map((s) => (
                        <Button key={s} size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => quickStatus(detail.campaign, s)}>
                          → {s}
                        </Button>
                      ))}
                      {can("campaigns.edit") && (
                        <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => openEdit(detail.campaign)}>
                          <Pencil className="w-3 h-3 mr-1" /> Edit
                        </Button>
                      )}
                      {can("campaigns.delete") && (
                        <Button size="sm" variant="outline" className="h-7 text-[11px] text-destructive hover:text-destructive" onClick={() => setDeleteRow(detail.campaign)}>
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      )}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div><p className="text-xs text-muted-foreground">Objective</p><p className="mt-0.5">{detail.campaign.objective || "—"}</p></div>
                    <div><p className="text-xs text-muted-foreground">Audience</p><p className="mt-0.5 inline-flex items-center gap-1"><Users className="w-3 h-3 text-muted-foreground" />{detail.campaign.audience || "—"}</p></div>
                    <div><p className="text-xs text-muted-foreground">Budget</p><p className="mt-0.5">{detail.campaign.budget != null ? formatCurrency(detail.campaign.budget) : "—"}</p></div>
                    <div><p className="text-xs text-muted-foreground">Period</p><p className="mt-0.5">{detail.campaign.startDate ? formatDate(detail.campaign.startDate) : "—"} → {detail.campaign.endDate ? formatDate(detail.campaign.endDate) : "—"}</p></div>
                  </div>

                  {detail.campaign.notes && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Notes</p>
                      <div className="rounded-lg border border-border bg-secondary/30 p-3 text-sm whitespace-pre-wrap">{detail.campaign.notes}</div>
                    </div>
                  )}

                  {/* Linked content */}
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Linked content ({detail.contents.length})</p>
                    {detail.contents.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No content linked yet — assign content to this campaign from the Content page.</p>
                    ) : (
                      <div className="space-y-1.5">
                        {detail.contents.map((c) => (
                          <div key={c.id} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-secondary/20 px-3 py-2">
                            <div className="min-w-0">
                              <p className="text-xs font-medium truncate">{c.title}</p>
                              <p className="text-[10px] text-muted-foreground">
                                {c.platform.replace(/_/g, " ")} · {c.contentType.replace(/_/g, " ")} · {c.publishDate ? formatDate(c.publishDate) : "no date"}
                                {c.author ? ` · ${c.author.name}` : ""}
                              </p>
                            </div>
                            <StatusBadge status={c.status} />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Timeline */}
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">History</p>
                    {detail.activities.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No activity recorded yet.</p>
                    ) : (
                      <div className="space-y-3">
                        {detail.activities.map((a) => (
                          <div key={a.id} className="flex items-start gap-2.5">
                            <span className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0 mt-0.5" style={{ background: a.actorColor || "#22d3ee", color: "#0A1120" }}>
                              {(a.actorName || "S").split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
                            </span>
                            <div className="min-w-0">
                              <p className="text-xs leading-relaxed">{a.title}</p>
                              <p className="text-[10px] text-muted-foreground">{a.actorName || "System"} · {relativeTime(a.createdAt)}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </ScrollArea>
          )}
        </SheetContent>
      </Sheet>

      {/* ---------- Delete confirm ---------- */}
      <AlertDialog open={!!deleteRow} onOpenChange={(open) => { if (!open) setDeleteRow(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this campaign?</AlertDialogTitle>
            <AlertDialogDescription>
              “{deleteRow?.name}” will be permanently removed{deleteRow && deleteRow.contentCount > 0 ? ` — ${deleteRow.contentCount} linked content item${deleteRow.contentCount === 1 ? "" : "s"} will be kept but unlinked` : ""}. This action is recorded in the audit log.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={doDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
