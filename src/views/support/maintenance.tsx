"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader, EmptyState, ErrorState, ListSkeleton, StatusBadge, Field, StatCard } from "@/components/shared";
import { api, qs, formatDate, relativeTime } from "@/lib/api-client";
import { useSession } from "next-auth/react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Wrench, Plus, Pencil, Archive, Search, Clock, CalendarClock,
  Building2, FolderKanban, Timer, TriangleAlert, Infinity as InfinityIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const PLANS = ["BASIC", "STANDARD", "PREMIUM", "CUSTOM"] as const;
const STATUSES = ["ACTIVE", "EXPIRED", "CANCELLED"] as const;

// Mirrors server transitions
const TRANSITIONS: Record<string, string[]> = {
  ACTIVE: ["EXPIRED", "CANCELLED"],
  EXPIRED: ["ACTIVE"],
  CANCELLED: ["ACTIVE"],
};

const PLAN_STYLES: Record<string, string> = {
  BASIC: "bg-slate-500/10 text-slate-300 border-slate-500/30",
  STANDARD: "bg-sky-500/10 text-sky-300 border-sky-500/30",
  PREMIUM: "bg-violet-500/10 text-violet-300 border-violet-500/30",
  CUSTOM: "bg-cyan-500/10 text-cyan-300 border-cyan-500/30",
};

type ClientRef = { id: string; companyName: string };
type ProjectRef = { id: string; name: string; projectNumber: string; clientId: string };

type PlanRow = {
  id: string; plan: string; startDate: string; endDate: string | null;
  includedHours: number | null; usedHours: number; status: string; notes: string | null;
  createdAt: string; updatedAt: string; logsCount: number;
  client: ClientRef | null; project: ProjectRef | null;
};

type LogRow = {
  id: string; hours: number; note: string | null; spentOn: string;
  createdAt: string; loggedById: string | null; loggedByName: string | null;
};

type PlanDetail = {
  plan: PlanRow;
  logs: LogRow[];
  activities: { id: string; title: string; description: string | null; createdAt: string; actorName: string | null; actorColor: string | null }[];
};

type Summary = {
  byStatus: { status: string; count: number }[];
  activeCount: number;
  expiringSoon: number;
  includedHours: number;
  usedHours: number;
};

const emptyForm = {
  clientId: "", projectId: "", plan: "STANDARD", startDate: "",
  endDate: "", includedHours: "", notes: "",
};

export function MaintenanceView({ navigate: _navigate }: { navigate: (p: string) => void }) {
  const { data: session } = useSession();
  const { toast } = useToast();
  const perms = session?.user?.permissions || [];
  const can = (p: string) => perms.includes(p);

  const [rows, setRows] = useState<PlanRow[]>([]);
  const [summary, setSummary] = useState<Summary>({ byStatus: [], activeCount: 0, expiringSoon: 0, includedHours: 0, usedHours: 0 });
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("ALL");
  const [reloadKey, setReloadKey] = useState(0);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editRow, setEditRow] = useState<PlanRow | null>(null);
  const [archiveRow, setArchiveRow] = useState<PlanRow | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const [clients, setClients] = useState<ClientRef[]>([]);
  const [projects, setProjects] = useState<ProjectRef[]>([]);

  // detail
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PlanDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // hours form
  const [hoursForm, setHoursForm] = useState({ hours: "", note: "", spentOn: "" });
  const [loggingHours, setLoggingHours] = useState(false);

  const pageSize = 12;

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const data = await api.get<{ items: PlanRow[]; total: number; summary: Summary }>(
        `/api/maintenance${qs({
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

  const loadRefs = useCallback(async () => {
    const results = await Promise.allSettled([
      api.get<{ items?: ClientRef[] }>("/api/clients?pageSize=100&status=ACTIVE"),
      api.get<{ items?: ProjectRef[] }>("/api/projects?pageSize=100"),
    ]);
    if (results[0].status === "fulfilled") setClients(results[0].value.items || []);
    if (results[1].status === "fulfilled") setProjects(results[1].value.items || []);
  }, []);

  useEffect(() => { loadRefs(); }, [loadRefs]);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const d = await api.get<PlanDetail>(`/api/maintenance/${id}`);
      setDetail(d);
    } catch {
      toast({ title: "Could not load plan details", variant: "destructive" });
      setDetailId(null);
    } finally {
      setDetailLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (detailId) loadDetail(detailId);
    else setDetail(null);
  }, [detailId, loadDetail]);

  const openCreate = () => {
    setEditRow(null);
    setForm({ ...emptyForm, startDate: new Date().toISOString().slice(0, 10) });
    setDialogOpen(true);
  };

  const openEdit = (row: PlanRow) => {
    setEditRow(row);
    setForm({
      clientId: row.client?.id || "",
      projectId: row.project?.id || "",
      plan: row.plan,
      startDate: row.startDate ? new Date(row.startDate).toISOString().slice(0, 10) : "",
      endDate: row.endDate ? new Date(row.endDate).toISOString().slice(0, 10) : "",
      includedHours: row.includedHours != null ? String(row.includedHours) : "",
      notes: row.notes || "",
    });
    setDialogOpen(true);
  };

  const doSave = async () => {
    if (!form.clientId) {
      toast({ title: "Please choose a client", variant: "destructive" });
      return;
    }
    if (!form.startDate) {
      toast({ title: "Start date is required", variant: "destructive" });
      return;
    }
    if (form.includedHours !== "" && (isNaN(Number(form.includedHours)) || Number(form.includedHours) <= 0)) {
      toast({ title: "Included hours must be a positive number (or empty for unlimited)", variant: "destructive" });
      return;
    }
    setSaving(true);
    const payload = {
      clientId: form.clientId,
      projectId: form.projectId || null,
      plan: form.plan,
      startDate: new Date(`${form.startDate}T00:00:00`).toISOString(),
      endDate: form.endDate ? new Date(`${form.endDate}T23:59:59`).toISOString() : null,
      includedHours: form.includedHours === "" ? null : Number(form.includedHours),
      notes: form.notes || null,
    };
    try {
      if (editRow) {
        await api.patch(`/api/maintenance/${editRow.id}`, payload);
        toast({ title: "Maintenance plan updated" });
        if (detailId === editRow.id) loadDetail(editRow.id);
      } else {
        await api.post("/api/maintenance", payload);
        toast({ title: "Maintenance plan created" });
      }
      setDialogOpen(false);
      setReloadKey((k) => k + 1);
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Save failed", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const quickStatus = async (row: PlanRow, next: string) => {
    try {
      await api.patch(`/api/maintenance/${row.id}`, { status: next });
      toast({ title: `Plan marked ${next.toLowerCase()}` });
      if (detailId === row.id) loadDetail(row.id);
      setReloadKey((k) => k + 1);
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Status change failed", variant: "destructive" });
    }
  };

  const doArchive = async () => {
    if (!archiveRow) return;
    try {
      await api.delete(`/api/maintenance/${archiveRow.id}`);
      toast({ title: "Plan archived", description: "The hour history is preserved." });
      if (detailId === archiveRow.id) setDetailId(null);
      setArchiveRow(null);
      setReloadKey((k) => k + 1);
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Archive failed", variant: "destructive" });
    }
  };

  const logHours = async () => {
    if (!detailId) return;
    const h = Number(hoursForm.hours);
    if (!hoursForm.hours || isNaN(h) || h <= 0) {
      toast({ title: "Enter the number of hours worked", variant: "destructive" });
      return;
    }
    setLoggingHours(true);
    try {
      const res = await api.post<{ usedHours: number; overBudget: boolean }>(`/api/maintenance/${detailId}/hours`, {
        hours: h,
        note: hoursForm.note || null,
        spentOn: hoursForm.spentOn ? new Date(`${hoursForm.spentOn}T12:00:00`).toISOString() : undefined,
      });
      toast({
        title: `${h}h logged`,
        description: res.overBudget
          ? "Heads up: the plan is now over its included hours."
          : `Plan total: ${res.usedHours}h used.`,
      });
      setHoursForm({ hours: "", note: "", spentOn: "" });
      await loadDetail(detailId);
      setReloadKey((k) => k + 1);
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Could not log hours", variant: "destructive" });
    } finally {
      setLoggingHours(false);
    }
  };

  const countBy = (s: string) => summary.byStatus.find((x) => x.status === s)?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasFilters = q !== "" || status !== "ALL";
  const hoursPct = summary.includedHours > 0 ? Math.min(100, Math.round((summary.usedHours / summary.includedHours) * 100)) : null;

  const clientProjects = form.clientId ? projects.filter((p) => p.clientId === form.clientId) : [];

  const planProgress = (row: PlanRow): { pct: number; over: boolean } | null => {
    if (row.includedHours == null || row.includedHours <= 0) return null;
    const pct = Math.round((row.usedHours / row.includedHours) * 100);
    return { pct: Math.min(100, pct), over: row.usedHours > row.includedHours };
  };

  return (
    <div>
      <PageHeader
        title="Maintenance"
        description="Recurring support plans with included hours — track every logged hour against what the client paid for."
        actions={can("maintenance.create") ? (
          <Button onClick={openCreate} className="bg-primary text-primary-foreground hover:bg-primary/90">
            <Plus className="w-4 h-4 mr-2" /> New plan
          </Button>
        ) : undefined}
      />

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-5">
        <StatCard label="Active plans" value={summary.activeCount} sub={`${countBy("EXPIRED")} expired · ${countBy("CANCELLED")} cancelled`} icon={<Wrench className="w-4 h-4" />} accent="emerald" />
        <StatCard label="Expiring in 30d" value={summary.expiringSoon} sub="renew or extend soon" icon={<CalendarClock className="w-4 h-4" />} accent={summary.expiringSoon > 0 ? "amber" : "violet"} />
        <StatCard
          label="Hours used"
          value={`${summary.usedHours}h`}
          sub={summary.includedHours > 0 ? `of ${summary.includedHours}h included` : "across limited plans"}
          icon={<Clock className="w-4 h-4" />}
          accent={hoursPct != null && hoursPct >= 90 ? "rose" : "cyan"}
        />
        <div className="apex-panel p-4 flex items-start justify-between gap-3 hover:border-primary/30 transition-colors">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Hour consumption</p>
            {summary.includedHours > 0 ? (
              <>
                <p className={cn("text-2xl font-semibold mt-1.5", hoursPct != null && hoursPct >= 90 ? "text-rose-300" : "")}>{hoursPct}%</p>
                <Progress value={hoursPct ?? 0} className="h-1.5 mt-2" />
              </>
            ) : (
              <p className="text-sm text-muted-foreground mt-2 flex items-center gap-1.5"><InfinityIcon className="w-4 h-4" /> No limited plans yet</p>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <div className="relative sm:max-w-xs w-full">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search client or project…" className="pl-8 bg-secondary/40" />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="sm:w-40 bg-secondary/40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {loading ? <ListSkeleton rows={6} /> : error ? <ErrorState onRetry={load} /> : rows.length === 0 ? (
        <EmptyState
          icon={<Wrench className="w-5 h-5" />}
          title={hasFilters ? "No plans match your filters" : "No maintenance plans yet"}
          description={hasFilters ? "Try adjusting the search or status filter." : "When a project is handed over, set up a maintenance plan so recurring work has a home and hours get tracked."}
          action={can("maintenance.create") && !hasFilters ? <Button onClick={openCreate}><Plus className="w-4 h-4 mr-2" /> Create first plan</Button> : undefined}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {rows.map((row) => {
              const prog = planProgress(row);
              const expiringSoon = row.status === "ACTIVE" && row.endDate && new Date(row.endDate).getTime() - Date.now() < 30 * 86400000;
              return (
                <button key={row.id} onClick={() => setDetailId(row.id)} className="apex-panel p-5 text-left hover:border-primary/40 transition-colors flex flex-col">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="font-medium truncate flex items-center gap-1.5">
                        <Building2 className="w-4 h-4 text-muted-foreground shrink-0" />{row.client?.companyName || "—"}
                      </h3>
                      {row.project && <p className="text-xs text-muted-foreground mt-0.5 truncate">{row.project.name}</p>}
                    </div>
                    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-md border text-[11px] font-medium shrink-0", PLAN_STYLES[row.plan])}>
                      {row.plan}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 mt-3">
                    <StatusBadge status={row.status} />
                    {expiringSoon && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-300 border border-amber-500/30 bg-amber-500/10 rounded-md px-2 py-0.5">
                        <TriangleAlert className="w-3 h-3" /> Expiring soon
                      </span>
                    )}
                  </div>

                  <div className="mt-3">
                    {row.includedHours != null ? (
                      <>
                        <div className="flex justify-between text-[11px] text-muted-foreground mb-1">
                          <span className="inline-flex items-center gap-1"><Timer className="w-3 h-3" />Hours</span>
                          <span className={cn(prog?.over && "text-rose-300 font-medium")}>
                            {row.usedHours} / {row.includedHours}h{prog?.over && " · over budget"}
                          </span>
                        </div>
                        <Progress value={prog?.pct ?? 0} className={cn("h-1.5", prog?.over && "[&>div]:bg-rose-400")} />
                      </>
                    ) : (
                      <p className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                        <Timer className="w-3 h-3" /> {row.usedHours}h used · unlimited plan
                      </p>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3 mt-3 text-xs">
                    <div>
                      <p className="text-muted-foreground">Started</p>
                      <p className="font-medium mt-0.5">{formatDate(row.startDate)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Ends</p>
                      <p className="font-medium mt-0.5">{row.endDate ? formatDate(row.endDate) : "Open-ended"}</p>
                    </div>
                  </div>

                  {row.logsCount > 0 && (
                    <p className="text-[11px] text-muted-foreground mt-3">{row.logsCount} hour log{row.logsCount === 1 ? "" : "s"}</p>
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between mt-4 text-xs text-muted-foreground">
            <span>{total} plan{total === 1 ? "" : "s"}</span>
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
            <DialogTitle>{editRow ? "Edit maintenance plan" : "New maintenance plan"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Client" required>
              <Select value={form.clientId || "NONE"} onValueChange={(v) => setForm((f) => ({ ...f, clientId: v === "NONE" ? "" : v, projectId: "" }))} disabled={!!editRow}>
                <SelectTrigger className="bg-secondary/40"><SelectValue placeholder="Select client" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE" disabled>Select client</SelectItem>
                  {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.companyName}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Project" hint={form.clientId && clientProjects.length === 0 ? "No projects for this client" : undefined}>
              <Select value={form.projectId || "NONE"} onValueChange={(v) => setForm((f) => ({ ...f, projectId: v === "NONE" ? "" : v }))} disabled={!form.clientId}>
                <SelectTrigger className="bg-secondary/40"><SelectValue placeholder="Optional" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">No project</SelectItem>
                  {clientProjects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Plan tier">
              <Select value={form.plan} onValueChange={(v) => setForm((f) => ({ ...f, plan: v }))}>
                <SelectTrigger className="bg-secondary/40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PLANS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Included hours" hint="Leave empty for unlimited hours">
              <Input type="number" min="0" step="0.5" value={form.includedHours} onChange={(e) => setForm((f) => ({ ...f, includedHours: e.target.value }))} placeholder="e.g. 8" className="bg-secondary/40" />
            </Field>
            <Field label="Start date" required>
              <Input type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} className="bg-secondary/40" />
            </Field>
            <Field label="End date">
              <Input type="date" value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} className="bg-secondary/40" />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Notes">
                <Textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="What is covered, response-time promises, exclusions…" className="bg-secondary/40" />
              </Field>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={doSave} disabled={saving} className="bg-primary text-primary-foreground hover:bg-primary/90">
              {saving ? "Saving…" : editRow ? "Save changes" : "Create plan"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ---------- Detail sheet ---------- */}
      <Sheet open={!!detailId} onOpenChange={(open) => { if (!open) setDetailId(null); }}>
        <SheetContent className="w-full sm:max-w-xl p-0 flex flex-col">
          <div className="p-5 border-b border-border">
            <SheetTitle className="text-base font-semibold leading-snug flex items-center gap-2">
              <Building2 className="w-4 h-4 text-muted-foreground shrink-0" />
              {detail?.plan.client?.companyName || "…"}
            </SheetTitle>
            {detail ? (
              <div className="flex items-center flex-wrap gap-2 mt-2">
                <span className={cn("inline-flex items-center px-2 py-0.5 rounded-md border text-[11px] font-medium", PLAN_STYLES[detail.plan.plan])}>
                  {detail.plan.plan} plan
                </span>
                <StatusBadge status={detail.plan.status} />
                {detail.plan.project && (
                  <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1"><FolderKanban className="w-3 h-3" />{detail.plan.project.name}</span>
                )}
              </div>
            ) : null}
          </div>
          {detailLoading || !detail ? (
            <div className="p-6 space-y-3"><ListSkeleton rows={5} /></div>
          ) : (
            <div className="flex flex-col flex-1 min-h-0">
              {/* Action row */}
              {can("maintenance.edit") && (
                <div className="px-5 py-3 border-b border-border flex flex-wrap items-center gap-1.5">
                  {(TRANSITIONS[detail.plan.status] || []).map((s) => (
                    <Button key={s} size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => quickStatus(detail.plan, s)}>
                      → {s.toLowerCase()}
                    </Button>
                  ))}
                  {can("maintenance.create") && (
                    <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => openEdit(detail.plan)}>
                      <Pencil className="w-3 h-3 mr-1" /> Edit
                    </Button>
                  )}
                  {can("maintenance.delete") && (
                    <Button size="sm" variant="outline" className="h-7 text-[11px] text-destructive hover:text-destructive" onClick={() => setArchiveRow(detail.plan)}>
                      <Archive className="w-3 h-3" />
                    </Button>
                  )}
                </div>
              )}

              <Tabs defaultValue="hours" className="flex flex-col flex-1 min-h-0">
                <TabsList className="mx-5 mt-3 mb-0 bg-secondary/40">
                  <TabsTrigger value="hours" className="text-xs">Hours ({detail.logs.length})</TabsTrigger>
                  <TabsTrigger value="details" className="text-xs">Details</TabsTrigger>
                  <TabsTrigger value="history" className="text-xs">History</TabsTrigger>
                </TabsList>

                <TabsContent value="hours" className="flex flex-col flex-1 min-h-0 mt-0">
                  <ScrollArea className="flex-1 min-h-0 apex-scroll px-5 py-4" style={{ height: "calc(100vh - 380px)" }}>
                    {/* Hours overview */}
                    <div className="rounded-lg border border-border bg-secondary/30 p-4 mb-4">
                      <div className="flex justify-between items-baseline mb-2">
                        <span className="text-xs text-muted-foreground">Consumption</span>
                        <span className={cn("text-sm font-semibold", detail.plan.includedHours != null && detail.plan.usedHours > detail.plan.includedHours && "text-rose-300")}>
                          {detail.plan.usedHours}h used
                          {detail.plan.includedHours != null ? ` · ${Math.max(0, detail.plan.includedHours - detail.plan.usedHours)}h remaining` : " · unlimited"}
                        </span>
                      </div>
                      {detail.plan.includedHours != null && (
                        <Progress
                          value={Math.min(100, Math.round((detail.plan.usedHours / detail.plan.includedHours) * 100))}
                          className={cn("h-2", detail.plan.usedHours > detail.plan.includedHours && "[&>div]:bg-rose-400")}
                        />
                      )}
                      {detail.plan.includedHours != null && detail.plan.usedHours > detail.plan.includedHours && (
                        <p className="text-[11px] text-rose-300 mt-2 flex items-center gap-1">
                          <TriangleAlert className="w-3 h-3" />
                          Over included hours by {Math.round((detail.plan.usedHours - detail.plan.includedHours) * 100) / 100}h — consider upselling or renewing.
                        </p>
                      )}
                    </div>

                    {/* Log hours form */}
                    {can("maintenance.edit") && detail.plan.status === "ACTIVE" && (
                      <div className="rounded-lg border border-border p-3 mb-4">
                        <p className="text-xs font-medium mb-2.5">Log hours</p>
                        <div className="grid grid-cols-2 gap-2.5">
                          <Field label="Hours" required>
                            <Input type="number" min="0.25" step="0.25" value={hoursForm.hours} onChange={(e) => setHoursForm((h) => ({ ...h, hours: e.target.value }))} placeholder="e.g. 1.5" className="bg-secondary/40" />
                          </Field>
                          <Field label="Date">
                            <Input type="date" value={hoursForm.spentOn} onChange={(e) => setHoursForm((h) => ({ ...h, spentOn: e.target.value }))} className="bg-secondary/40" />
                          </Field>
                          <div className="col-span-2">
                            <Field label="What was done">
                              <Input value={hoursForm.note} onChange={(e) => setHoursForm((h) => ({ ...h, note: e.target.value }))} placeholder="e.g. Monthly backup + plugin updates" className="bg-secondary/40" />
                            </Field>
                          </div>
                        </div>
                        <Button size="sm" onClick={logHours} disabled={loggingHours} className="mt-2.5 bg-primary text-primary-foreground hover:bg-primary/90">
                          <Clock className="w-3.5 h-3.5 mr-1.5" /> {loggingHours ? "Logging…" : "Log hours"}
                        </Button>
                      </div>
                    )}

                    {/* Logs list */}
                    {detail.logs.length === 0 ? (
                      <p className="text-xs text-muted-foreground py-4 text-center">No hours logged yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {detail.logs.map((l) => (
                          <div key={l.id} className="flex items-start gap-3 rounded-lg border border-border bg-secondary/20 px-3 py-2.5">
                            <span className="w-10 h-8 rounded-md bg-cyan-500/10 text-cyan-300 flex items-center justify-center text-[11px] font-bold shrink-0">
                              {l.hours}h
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs leading-relaxed">{l.note || "Maintenance work"}</p>
                              <p className="text-[10px] text-muted-foreground mt-0.5">
                                {l.loggedByName || "System"} · {formatDate(l.spentOn)} · {relativeTime(l.createdAt)}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                </TabsContent>

                <TabsContent value="details" className="mt-0 px-5 py-4">
                  <ScrollArea className="apex-scroll" style={{ height: "calc(100vh - 380px)" }}>
                    <div className="space-y-4 text-sm">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <p className="text-xs text-muted-foreground">Plan tier</p>
                          <p className="mt-0.5">{detail.plan.plan}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Included hours</p>
                          <p className="mt-0.5">{detail.plan.includedHours != null ? `${detail.plan.includedHours}h` : "Unlimited"}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Started</p>
                          <p className="mt-0.5">{formatDate(detail.plan.startDate)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Ends</p>
                          <p className="mt-0.5">{detail.plan.endDate ? formatDate(detail.plan.endDate) : "Open-ended"}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Client</p>
                          <p className="mt-0.5">{detail.plan.client?.companyName || "—"}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Project</p>
                          <p className="mt-0.5">{detail.plan.project?.name || "—"}</p>
                        </div>
                      </div>
                      {detail.plan.notes && (
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Notes</p>
                          <div className="rounded-lg border border-border bg-secondary/30 p-3 text-sm whitespace-pre-wrap">{detail.plan.notes}</div>
                        </div>
                      )}
                    </div>
                  </ScrollArea>
                </TabsContent>

                <TabsContent value="history" className="mt-0 px-5 py-4">
                  <ScrollArea className="apex-scroll" style={{ height: "calc(100vh - 380px)" }}>
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
                  </ScrollArea>
                </TabsContent>
              </Tabs>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* ---------- Archive confirm ---------- */}
      <AlertDialog open={!!archiveRow} onOpenChange={(open) => { if (!open) setArchiveRow(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive this maintenance plan?</AlertDialogTitle>
            <AlertDialogDescription>
              The {archiveRow?.plan} plan for {archiveRow?.client?.companyName} will be removed from active lists. Logged hours and history are preserved. This action is recorded in the audit log.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={doArchive}>Archive</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
