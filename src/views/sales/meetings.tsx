"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageHeader, EmptyState, ErrorState, ListSkeleton, StatusBadge, Field } from "@/components/shared";
import { api, qs, formatDate } from "@/lib/api-client";
import { useSession } from "next-auth/react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { CalendarPlus, CalendarDays, MapPin, ExternalLink, MoreHorizontal, Pencil, Trash2, Clock, StickyNote, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

type MeetingRow = {
  id: string; title: string; date: string; startTime: string; endTime: string;
  location?: string | null; meetingLink?: string | null; notes?: string | null;
  outcome?: string | null; nextAction?: string | null; status: string;
  lead?: { id: string; companyName: string } | null;
  client?: { id: string; companyName: string } | null;
  project?: { id: string; name: string } | null;
};

type Option = { id: string; label: string };

/** Robustly extract a list from any list-route payload ({ items } | array | { leads }...) */
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
  return api
    .get<unknown>(url)
    .then((data) =>
      extractList(data)
        .map((x) => ({ id: String(x.id), label: String(x[labelKey] ?? x.name ?? x.companyName ?? "") }))
        .filter((o) => o.label)
    )
    .catch(() => []); // 403 / unavailable → degrade gracefully to free text
}

function toDateInput(d: string | Date): string {
  const x = new Date(d);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
}

// ---- Per-tab empty states (spec: tabs Today / Upcoming / Past)
function TabEmpty({ tab, isFiltered, canCreate, onCreate }: {
  tab: "today" | "upcoming" | "past"; isFiltered: boolean; canCreate: boolean; onCreate: () => void;
}) {
  if (isFiltered) {
    return (
      <EmptyState
        icon={<CalendarDays className="w-5 h-5" />}
        title="No meetings match your filters"
        description="Try adjusting the search or status filter."
      />
    );
  }
  if (tab === "today") {
    return (
      <EmptyState
        icon={<CalendarDays className="w-5 h-5" />}
        title="No meetings today"
        description="Nothing scheduled for today. Enjoy the focus time — or plan your next client meeting."
        action={canCreate ? <Button size="sm" onClick={onCreate}><CalendarPlus className="w-4 h-4 mr-2" /> New Meeting</Button> : undefined}
      />
    );
  }
  if (tab === "upcoming") {
    return (
      <EmptyState
        icon={<CalendarDays className="w-5 h-5" />}
        title="No upcoming meetings"
        description="Schedule your next lead or client meeting to keep the pipeline moving."
        action={canCreate ? <Button size="sm" onClick={onCreate}><CalendarPlus className="w-4 h-4 mr-2" /> New Meeting</Button> : undefined}
      />
    );
  }
  return (
    <EmptyState
      icon={<CalendarDays className="w-5 h-5" />}
      title="No past meetings"
      description="Completed and past meetings will appear here with their outcomes."
    />
  );
}

// ---- Single meeting row (shared by all three tabs)
function MeetingRowItem({ m, navigate, canEdit, canDelete, onEdit, onComplete, onStatus, onDelete }: {
  m: MeetingRow; navigate: (p: string) => void;
  canEdit: boolean; canDelete: boolean;
  onEdit: (m: MeetingRow) => void;
  onComplete: (m: MeetingRow) => void;
  onStatus: (m: MeetingRow, status: string) => void;
  onDelete: (m: MeetingRow) => void;
}) {
  return (
    <div className="p-4 hover:bg-accent/40 transition-colors">
      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <button
          className="flex-1 min-w-0 text-left group"
          onClick={() => canEdit && onEdit(m)}
          title={canEdit ? "Open meeting" : undefined}
        >
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-medium truncate group-hover:text-primary transition-colors">{m.title}</p>
            <StatusBadge status={m.status} />
          </div>
          <div className="flex items-center gap-2 flex-wrap mt-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" /> {formatDate(m.date)} · {m.startTime}–{m.endTime}</span>
            {m.lead && (
              <button className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-secondary hover:bg-accent border border-border" onClick={(e) => { e.stopPropagation(); navigate("crm/leads"); }}>
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" /> {m.lead.companyName}
              </button>
            )}
            {m.client && (
              <button className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-secondary hover:bg-accent border border-border" onClick={(e) => { e.stopPropagation(); navigate("crm/clients"); }}>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> {m.client.companyName}
              </button>
            )}
            {m.project && (
              <button className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-secondary hover:bg-accent border border-border" onClick={(e) => { e.stopPropagation(); navigate("projects"); }}>
                <span className="w-1.5 h-1.5 rounded-full bg-violet-400" /> {m.project.name}
              </button>
            )}
            {m.location && <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3" /> {m.location}</span>}
            {m.meetingLink && (
              <a href={m.meetingLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                <ExternalLink className="w-3 h-3" /> Join link
              </a>
            )}
          </div>
          {m.status === "COMPLETED" && (m.outcome || m.nextAction) && (
            <div className="mt-2 flex items-start gap-2 text-xs">
              <StickyNote className="w-3.5 h-3.5 mt-0.5 text-muted-foreground shrink-0" />
              <span className="text-muted-foreground">
                {m.outcome && <span>Outcome: {m.outcome}</span>}
                {m.outcome && m.nextAction && <span className="mx-1.5 opacity-50">·</span>}
                {m.nextAction && <span>Next: {m.nextAction}</span>}
              </span>
            </div>
          )}
        </button>

        <div className="flex items-center gap-1.5 shrink-0 self-end md:self-center">
          {canEdit && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">Status <ChevronRight className="w-3.5 h-3.5 ml-1" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {(m.status === "SCHEDULED" || m.status === "RESCHEDULED") && (
                  <DropdownMenuItem onClick={() => onComplete(m)}>
                    Mark completed
                  </DropdownMenuItem>
                )}
                {(m.status === "RESCHEDULED" || m.status === "CANCELLED") && (
                  <DropdownMenuItem onClick={() => onStatus(m, "SCHEDULED")}>Mark scheduled</DropdownMenuItem>
                )}
                {m.status === "SCHEDULED" && (
                  <DropdownMenuItem onClick={() => onStatus(m, "RESCHEDULED")}>Mark rescheduled</DropdownMenuItem>
                )}
                {m.status !== "COMPLETED" && m.status !== "CANCELLED" && (
                  <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => onStatus(m, "CANCELLED")}>
                    Cancel meeting
                  </DropdownMenuItem>
                )}
                {canDelete && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => onDelete(m)}>
                      <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {canEdit && (
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEdit(m)} title="Edit">
              <Pencil className="w-3.5 h-3.5" />
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
      </div>
    </div>
  );
}

export function MeetingsView({ navigate }: { navigate: (p: string) => void }) {
  const { toast } = useToast();
  const { data: session } = useSession();
  const perms = session?.user?.permissions || [];
  const canCreate = perms.includes("meetings.create");
  const canEdit = perms.includes("meetings.edit");
  const canDelete = perms.includes("meetings.delete");

  const [items, setItems] = useState<MeetingRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [tab, setTab] = useState("TODAY");

  // Link options (degrade to free text if not fetchable)
  const [leadOpts, setLeadOpts] = useState<Option[]>([]);
  const [clientOpts, setClientOpts] = useState<Option[]>([]);
  const [projectOpts, setProjectOpts] = useState<Option[]>([]);
  const [optsTried, setOptsTried] = useState(false);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<MeetingRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title: "", date: "", startTime: "", endTime: "", location: "", meetingLink: "",
    leadId: "", clientId: "", projectId: "", notes: "", relatedName: "",
  });
  // Complete dialog (capture outcome)
  const [completing, setCompleting] = useState<MeetingRow | null>(null);
  const [outcome, setOutcome] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [deleting, setDeleting] = useState<MeetingRow | null>(null);

  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [query, setQuery] = useState("");

  const load = useCallback(async (opts?: { page?: number; status?: string; q?: string }) => {
    const p = opts?.page ?? page;
    const st = opts?.status ?? statusFilter;
    const q = opts?.q ?? query;
    setLoading(true);
    setError(false);
    try {
      const data = await api.get<{ items: MeetingRow[]; total: number }>(
        `/api/meetings${qs({ page: p, pageSize, status: st === "ALL" ? undefined : st, q: q || undefined })}`
      );
      setItems(data.items);
      setTotal(data.total);
      setPage(p);
    } catch (e) {
      setError(true);
      toast({ title: "Could not load meetings", description: e instanceof Error ? e.message : undefined });
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, query, pageSize, toast]);

  useEffect(() => {
    load({ page: 1, status: statusFilter, q: query });
  }, [statusFilter, query]);

  useEffect(() => {
    Promise.all([
      toOptions("/api/leads?pageSize=100", "companyName"),
      toOptions("/api/clients?pageSize=100", "companyName"),
      toOptions("/api/projects?pageSize=100", "name"),
    ]).then(([l, c, p]) => {
      setLeadOpts(l);
      setClientOpts(c);
      setProjectOpts(p);
      setOptsTried(true);
    });
  }, []);

  const onSearchInput = (v: string) => {
    setSearch(v);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => setQuery(v), 300);
  };

  // ---- Buckets for the Today / Upcoming / Past tabs
  const buckets = useMemo(() => {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end = new Date(); end.setHours(23, 59, 59, 999);
    const today: MeetingRow[] = [];
    const upcoming: MeetingRow[] = [];
    const past: MeetingRow[] = [];
    items.forEach((m) => {
      const d = new Date(m.date);
      if (d >= start && d <= end) today.push(m);
      else if (d > end) upcoming.push(m);
      else past.push(m);
    });
    past.reverse(); // most recent past first
    return { today, upcoming, past };
  }, [items]);

  // On the first successful load, land the user on a tab that actually has meetings
  const autoPicked = useRef(false);
  useEffect(() => {
    if (autoPicked.current || loading) return;
    autoPicked.current = true;
    if (buckets.today.length === 0) {
      if (buckets.upcoming.length > 0) setTab("UPCOMING");
      else if (buckets.past.length > 0) setTab("PAST");
    }
  }, [loading, buckets]);

  const openCreate = () => {
    setEditing(null);
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    setForm({
      title: "", date: toDateInput(tomorrow), startTime: "10:00", endTime: "11:00",
      location: "", meetingLink: "", leadId: "", clientId: "", projectId: "", notes: "", relatedName: "",
    });
    setDialogOpen(true);
  };

  const openEdit = (m: MeetingRow) => {
    setEditing(m);
    setForm({
      title: m.title, date: toDateInput(m.date), startTime: m.startTime, endTime: m.endTime,
      location: m.location ?? "", meetingLink: m.meetingLink ?? "",
      leadId: m.lead?.id ?? "", clientId: m.client?.id ?? "", projectId: m.project?.id ?? "",
      notes: m.notes ?? "", relatedName: "",
    });
    setDialogOpen(true);
  };

  const submit = async () => {
    if (!form.title.trim()) return toast({ title: "Title is required" });
    if (!form.date || !form.startTime || !form.endTime) return toast({ title: "Date and times are required" });
    setSaving(true);
    try {
      const notes = form.relatedName.trim() && !form.leadId && !form.clientId
        ? `Related to: ${form.relatedName.trim()}${form.notes ? `\n${form.notes}` : ""}`
        : form.notes;
      const payload = {
        title: form.title.trim(), date: form.date, startTime: form.startTime, endTime: form.endTime,
        location: form.location || null, meetingLink: form.meetingLink || null, notes: notes || null,
        leadId: form.leadId || null, clientId: form.clientId || null, projectId: form.projectId || null,
      };
      if (editing) {
        await api.patch(`/api/meetings/${editing.id}`, payload);
        toast({ title: "Meeting updated" });
      } else {
        await api.post("/api/meetings", payload);
        toast({ title: "Meeting scheduled" });
      }
      setDialogOpen(false);
      load();
    } catch (e) {
      toast({ title: "Save failed", description: e instanceof Error ? e.message : undefined });
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (m: MeetingRow, status: string) => {
    try {
      await api.patch(`/api/meetings/${m.id}`, { status });
      toast({ title: `Meeting ${status.toLowerCase()}` });
      load();
    } catch (e) {
      toast({ title: "Status change failed", description: e instanceof Error ? e.message : undefined });
    }
  };

  const submitComplete = async () => {
    if (!completing) return;
    try {
      await api.patch(`/api/meetings/${completing.id}`, {
        status: "COMPLETED",
        outcome: outcome.trim() || null,
        nextAction: nextAction.trim() || null,
      });
      toast({ title: "Meeting completed" });
      setCompleting(null);
      setOutcome("");
      setNextAction("");
      load();
    } catch (e) {
      toast({ title: "Status change failed", description: e instanceof Error ? e.message : undefined });
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await api.delete(`/api/meetings/${deleting.id}`);
      toast({ title: "Meeting deleted" });
      setDeleting(null);
      load();
    } catch (e) {
      toast({ title: "Delete failed", description: e instanceof Error ? e.message : undefined });
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const isFiltered = query !== "" || statusFilter !== "ALL";

  const renderRows = (rows: MeetingRow[]) => (
    <div className="apex-panel divide-y divide-border overflow-hidden">
      {rows.map((m) => (
        <MeetingRowItem
          key={m.id} m={m} navigate={navigate}
          canEdit={canEdit} canDelete={canDelete}
          onEdit={openEdit}
          onComplete={(x) => { setCompleting(x); setOutcome(""); setNextAction(""); }}
          onStatus={changeStatus}
          onDelete={setDeleting}
        />
      ))}
    </div>
  );

  return (
    <div>
      <PageHeader
        title="Meetings"
        description="Schedule client and lead meetings, log outcomes and keep next actions visible."
        actions={canCreate && <Button onClick={openCreate}><CalendarPlus className="w-4 h-4 mr-2" /> New Meeting</Button>}
      />

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <Input
          placeholder="Search title, location, notes…"
          value={search}
          onChange={(e) => onSearchInput(e.target.value)}
          className="sm:max-w-xs"
        />
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v)}>
          <SelectTrigger className="sm:w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            <SelectItem value="SCHEDULED">Scheduled</SelectItem>
            <SelectItem value="COMPLETED">Completed</SelectItem>
            <SelectItem value="CANCELLED">Cancelled</SelectItem>
            <SelectItem value="RESCHEDULED">Rescheduled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <ListSkeleton />
      ) : error ? (
        <ErrorState onRetry={() => load()} />
      ) : (
        <>
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="mb-4">
              <TabsTrigger value="TODAY" className="gap-1.5">
                Today<span className="text-[11px] text-muted-foreground font-normal">{buckets.today.length}</span>
              </TabsTrigger>
              <TabsTrigger value="UPCOMING" className="gap-1.5">
                Upcoming<span className="text-[11px] text-muted-foreground font-normal">{buckets.upcoming.length}</span>
              </TabsTrigger>
              <TabsTrigger value="PAST" className="gap-1.5">
                Past<span className="text-[11px] text-muted-foreground font-normal">{buckets.past.length}</span>
              </TabsTrigger>
            </TabsList>
            <TabsContent value="TODAY" className="mt-0">
              {buckets.today.length === 0
                ? <TabEmpty tab="today" isFiltered={isFiltered} canCreate={canCreate} onCreate={openCreate} />
                : renderRows(buckets.today)}
            </TabsContent>
            <TabsContent value="UPCOMING" className="mt-0">
              {buckets.upcoming.length === 0
                ? <TabEmpty tab="upcoming" isFiltered={isFiltered} canCreate={canCreate} onCreate={openCreate} />
                : renderRows(buckets.upcoming)}
            </TabsContent>
            <TabsContent value="PAST" className="mt-0">
              {buckets.past.length === 0
                ? <TabEmpty tab="past" isFiltered={isFiltered} canCreate={canCreate} onCreate={openCreate} />
                : renderRows(buckets.past)}
            </TabsContent>
          </Tabs>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between text-sm mt-4">
              <p className="text-muted-foreground">Page {page} of {totalPages} · {total} meetings</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => load({ page: page - 1 })}>Previous</Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => load({ page: page + 1 })}>Next</Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit meeting" : "New meeting"}</DialogTitle>
            <DialogDescription>
              {editing ? "Update the schedule or details of this meeting." : "Link it to a lead, client or project to keep the timeline connected."}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[65vh] overflow-y-auto apex-scroll pr-1 space-y-4">
            <Field label="Title" required>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Requirements workshop with Nile" />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Date" required>
                <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              </Field>
              <Field label="Start" required>
                <Input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} />
              </Field>
              <Field label="End" required>
                <Input type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} />
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
                <Field label="Linked lead" hint={optsTried ? "Lead list unavailable — type a reference name instead" : undefined}>
                  <Input value={form.relatedName} onChange={(e) => setForm({ ...form, relatedName: e.target.value })} placeholder="Company / person (unlinked)" disabled={!!form.clientId} />
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
                <Field label="Linked client" hint={optsTried ? "Client list unavailable — type a reference name instead" : undefined}>
                  <Input value={form.relatedName} onChange={(e) => setForm({ ...form, relatedName: e.target.value })} placeholder="Company (unlinked)" disabled={!!form.leadId} />
                </Field>
              )}
            </div>
            {projectOpts.length > 0 && (
              <Field label="Linked project">
                <Select value={form.projectId || "NONE"} onValueChange={(v) => setForm({ ...form, projectId: v === "NONE" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent className="max-h-60">
                    <SelectItem value="NONE">None</SelectItem>
                    {projectOpts.map((o) => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Location">
                <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Office / client site" />
              </Field>
              <Field label="Meeting link">
                <Input value={form.meetingLink} onChange={(e) => setForm({ ...form, meetingLink: e.target.value })} placeholder="https://meet.google.com/…" />
              </Field>
            </div>
            <Field label="Notes">
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} placeholder="Agenda, attendees, preparation…" />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={saving}>{saving ? "Saving…" : editing ? "Save changes" : "Schedule meeting"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Complete dialog (outcome) */}
      <Dialog open={!!completing} onOpenChange={(o) => !o && setCompleting(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Complete meeting</DialogTitle>
            <DialogDescription>Record what happened and what comes next.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Field label="Outcome">
              <Textarea value={outcome} onChange={(e) => setOutcome(e.target.value)} rows={3} placeholder="e.g. Client approved scope, wants the proposal by Sunday." />
            </Field>
            <Field label="Next action">
              <Input value={nextAction} onChange={(e) => setNextAction(e.target.value)} placeholder="e.g. Send proposal before Thursday" />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompleting(null)}>Cancel</Button>
            <Button onClick={submitComplete}>Mark completed</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this meeting?</AlertDialogTitle>
            <AlertDialogDescription>
              &quot;{deleting?.title}&quot; will be permanently removed. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep meeting</AlertDialogCancel>
            <AlertDialogAction className={cn("bg-destructive text-destructive-foreground hover:bg-destructive/90")} onClick={confirmDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
