"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader, EmptyState, ErrorState, ListSkeleton, StatusBadge, PriorityBadge, Field, StatCard } from "@/components/shared";
import { api, qs, formatDate, relativeTime } from "@/lib/api-client";
import { useSession } from "next-auth/react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { FileAttachments } from "@/components/shared/files";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  LifeBuoy, Plus, Pencil, Archive, Search, MessageSquare, Lock, Send,
  UserRound, Building2, FolderKanban, Trash2, AlarmClock,
} from "lucide-react";
import { cn } from "@/lib/utils";

const STATUSES = ["OPEN", "IN_PROGRESS", "WAITING_CLIENT", "RESOLVED", "CLOSED"] as const;
const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
const CATEGORIES = ["BUG", "CHANGE_REQUEST", "QUESTION", "FEATURE_REQUEST", "TECHNICAL_ISSUE", "OTHER"] as const;

// Mirrors the server-side transition map (§60)
const TRANSITIONS: Record<string, string[]> = {
  OPEN: ["IN_PROGRESS", "WAITING_CLIENT", "RESOLVED", "CLOSED"],
  IN_PROGRESS: ["OPEN", "WAITING_CLIENT", "RESOLVED", "CLOSED"],
  WAITING_CLIENT: ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"],
  RESOLVED: ["OPEN", "IN_PROGRESS", "CLOSED"],
  CLOSED: ["OPEN"],
};

const CATEGORY_LABELS: Record<string, string> = {
  BUG: "Bug", CHANGE_REQUEST: "Change request", QUESTION: "Question",
  FEATURE_REQUEST: "Feature request", TECHNICAL_ISSUE: "Technical issue", OTHER: "Other",
};

type ClientRef = { id: string; companyName: string };
type ProjectRef = { id: string; name: string; projectNumber: string; clientId: string };
type UserRef = { id: string; name: string; avatarColor: string };

type TicketRow = {
  id: string; ticketNumber: string; subject: string; description: string | null;
  category: string; priority: string; status: string; closedAt: string | null;
  createdAt: string; updatedAt: string; messagesCount: number;
  client: ClientRef | null; project: ProjectRef | null; assignedTo: UserRef | null;
};

type MessageRow = {
  id: string; body: string; isInternal: boolean; createdAt: string;
  authorId: string | null; authorName: string | null;
};

type TicketDetail = {
  ticket: TicketRow;
  messages: MessageRow[];
  activities: { id: string; title: string; description: string | null; createdAt: string; actorName: string | null; actorColor: string | null }[];
};

type Summary = {
  byStatus: { status: string; count: number }[];
  unassigned: number;
  urgentOpen: number;
};

const emptyForm = {
  subject: "", clientId: "", projectId: "", category: "OTHER",
  priority: "MEDIUM", description: "", assignedToId: "",
};

export function TicketsView({ navigate: _navigate }: { navigate: (p: string) => void }) {
  const { data: session } = useSession();
  const { toast } = useToast();
  const perms = session?.user?.permissions || [];
  const can = (p: string) => perms.includes(p);

  const [rows, setRows] = useState<TicketRow[]>([]);
  const [summary, setSummary] = useState<Summary>({ byStatus: [], unassigned: 0, urgentOpen: 0 });
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("ALL");
  const [priority, setPriority] = useState("ALL");
  const [assignment, setAssignment] = useState("ALL");
  const [reloadKey, setReloadKey] = useState(0);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editRow, setEditRow] = useState<TicketRow | null>(null);
  const [archiveRow, setArchiveRow] = useState<TicketRow | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  // reference data
  const [clients, setClients] = useState<ClientRef[]>([]);
  const [projects, setProjects] = useState<ProjectRef[]>([]);
  const [team, setTeam] = useState<UserRef[]>([]);

  // detail
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [composer, setComposer] = useState("");
  const [internalNote, setInternalNote] = useState(false);
  const [sending, setSending] = useState(false);

  const pageSize = 15;

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const data = await api.get<{ items: TicketRow[]; total: number; summary: Summary }>(
        `/api/tickets${qs({
          q, status: status === "ALL" ? undefined : status,
          priority: priority === "ALL" ? undefined : priority,
          assignment: assignment === "ALL" ? undefined : assignment,
          page, pageSize,
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
  }, [q, status, priority, assignment, page, reloadKey]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [q, status, priority, assignment]);

  const loadRefs = useCallback(async () => {
    const results = await Promise.allSettled([
      api.get<{ items?: ClientRef[] }>("/api/clients?pageSize=100&status=ACTIVE"),
      api.get<{ items?: ProjectRef[] }>("/api/projects?pageSize=100"),
      api.get<{ team?: UserRef[] }>("/api/team"),
    ]);
    if (results[0].status === "fulfilled") setClients(results[0].value.items || []);
    if (results[1].status === "fulfilled") setProjects(results[1].value.items || []);
    if (results[2].status === "fulfilled") setTeam(results[2].value.team || []);
  }, []);

  useEffect(() => { loadRefs(); }, [loadRefs]);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const d = await api.get<TicketDetail>(`/api/tickets/${id}`);
      setDetail(d);
    } catch {
      toast({ title: "Could not load ticket details", variant: "destructive" });
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
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (row: TicketRow) => {
    setEditRow(row);
    setForm({
      subject: row.subject, clientId: row.client?.id || "",
      projectId: row.project?.id || "", category: row.category,
      priority: row.priority, description: row.description || "",
      assignedToId: row.assignedTo?.id || "",
    });
    setDialogOpen(true);
  };

  const doSave = async () => {
    if (form.subject.trim().length < 3) {
      toast({ title: "Subject is required (min 3 characters)", variant: "destructive" });
      return;
    }
    if (!form.clientId) {
      toast({ title: "Please choose a client", variant: "destructive" });
      return;
    }
    setSaving(true);
    const payload = {
      subject: form.subject.trim(),
      clientId: form.clientId,
      projectId: form.projectId || null,
      category: form.category,
      priority: form.priority,
      description: form.description || null,
      assignedToId: form.assignedToId || null,
    };
    try {
      if (editRow) {
        await api.patch(`/api/tickets/${editRow.id}`, payload);
        toast({ title: "Ticket updated" });
        if (detailId === editRow.id) loadDetail(editRow.id);
      } else {
        await api.post("/api/tickets", payload);
        toast({ title: "Ticket created" });
      }
      setDialogOpen(false);
      setReloadKey((k) => k + 1);
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Save failed", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const quickStatus = async (row: TicketRow, next: string) => {
    try {
      await api.patch(`/api/tickets/${row.id}`, { status: next });
      toast({ title: next === "CLOSED" ? "Ticket closed" : `Ticket moved to ${next.replace(/_/g, " ").toLowerCase()}` });
      if (detailId === row.id) loadDetail(row.id);
      setReloadKey((k) => k + 1);
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Status change failed", variant: "destructive" });
    }
  };

  const doArchive = async () => {
    if (!archiveRow) return;
    try {
      await api.delete(`/api/tickets/${archiveRow.id}`);
      toast({ title: "Ticket archived", description: `${archiveRow.ticketNumber} was removed from active lists. The audit trail is preserved.` });
      if (detailId === archiveRow.id) setDetailId(null);
      setArchiveRow(null);
      setReloadKey((k) => k + 1);
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Archive failed", variant: "destructive" });
    }
  };

  const sendMessage = async () => {
    if (!detailId || composer.trim().length === 0) return;
    setSending(true);
    try {
      await api.post(`/api/tickets/${detailId}/messages`, { body: composer.trim(), isInternal: internalNote });
      setComposer("");
      setInternalNote(false);
      await loadDetail(detailId);
      setReloadKey((k) => k + 1);
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Could not send message", variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  const deleteMessage = async (messageId: string) => {
    if (!detailId) return;
    try {
      await api.delete(`/api/tickets/${detailId}/messages/${messageId}`);
      await loadDetail(detailId);
      setReloadKey((k) => k + 1);
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Could not delete message", variant: "destructive" });
    }
  };

  const countBy = (s: string) => summary.byStatus.find((x) => x.status === s)?.count ?? 0;
  const openCount = countBy("OPEN") + countBy("IN_PROGRESS") + countBy("WAITING_CLIENT");
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasFilters = q !== "" || status !== "ALL" || priority !== "ALL" || assignment !== "ALL";

  const clientProjects = form.clientId ? projects.filter((p) => p.clientId === form.clientId) : [];
  const sessionUserId = session?.user?.id;

  // Age of an open ticket in days
  const ageDays = (row: { createdAt: string; status: string }) => {
    if (row.status === "CLOSED" || row.status === "RESOLVED") return null;
    return Math.floor((Date.now() - new Date(row.createdAt).getTime()) / 86400000);
  };

  return (
    <div>
      <PageHeader
        title="Tickets"
        description="Client support requests with full conversation history — internal notes stay internal, replies stay traceable."
        actions={can("tickets.create") ? (
          <Button onClick={openCreate} className="bg-primary text-primary-foreground hover:bg-primary/90">
            <Plus className="w-4 h-4 mr-2" /> New ticket
          </Button>
        ) : undefined}
      />

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-5">
        <StatCard label="Open work" value={openCount} sub={`${countBy("OPEN")} new · ${countBy("IN_PROGRESS")} in progress`} icon={<LifeBuoy className="w-4 h-4" />} accent="cyan" />
        <StatCard label="Urgent open" value={summary.urgentOpen} sub="need attention first" icon={<AlarmClock className="w-4 h-4" />} accent={summary.urgentOpen > 0 ? "rose" : "violet"} />
        <StatCard label="Unassigned" value={summary.unassigned} sub="waiting for an owner" icon={<UserRound className="w-4 h-4" />} accent={summary.unassigned > 0 ? "amber" : "emerald"} />
        <StatCard label="Resolved" value={countBy("RESOLVED")} sub={`${countBy("CLOSED")} closed`} icon={<MessageSquare className="w-4 h-4" />} accent="emerald" />
      </div>

      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <div className="relative sm:max-w-xs w-full">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search subject, number, client…" className="pl-8 bg-secondary/40" />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="sm:w-40 bg-secondary/40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            {STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={priority} onValueChange={setPriority}>
          <SelectTrigger className="sm:w-36 bg-secondary/40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All priorities</SelectItem>
            {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={assignment} onValueChange={setAssignment}>
          <SelectTrigger className="sm:w-36 bg-secondary/40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Everyone</SelectItem>
            <SelectItem value="MINE">Mine</SelectItem>
            <SelectItem value="UNASSIGNED">Unassigned</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? <ListSkeleton rows={6} /> : error ? <ErrorState onRetry={load} /> : rows.length === 0 ? (
        <EmptyState
          icon={<LifeBuoy className="w-5 h-5" />}
          title={hasFilters ? "No tickets match your filters" : "No tickets yet"}
          description={hasFilters ? "Try adjusting the search or filters." : "When a client reports a bug or requests a change, log it here so nothing gets lost in WhatsApp."}
          action={can("tickets.create") && !hasFilters ? <Button onClick={openCreate}><Plus className="w-4 h-4 mr-2" /> Create first ticket</Button> : undefined}
        />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block rounded-xl border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-secondary/40 text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Ticket</th>
                  <th className="px-4 py-2.5 font-medium">Client</th>
                  <th className="px-4 py-2.5 font-medium">Priority</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Assignee</th>
                  <th className="px-4 py-2.5 font-medium text-right">Updated</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const age = ageDays(row);
                  return (
                    <tr key={row.id} onClick={() => setDetailId(row.id)} className="border-t border-border hover:bg-secondary/20 cursor-pointer transition-colors">
                      <td className="px-4 py-3">
                        <p className="font-medium truncate max-w-[280px]">{row.subject}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5 font-mono">{row.ticketNumber} · {CATEGORY_LABELS[row.category] || row.category}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-xs truncate max-w-[140px]">{row.client?.companyName || "—"}</p>
                        {row.project && <p className="text-[10px] text-muted-foreground truncate max-w-[140px]">{row.project.name}</p>}
                      </td>
                      <td className="px-4 py-3"><PriorityBadge priority={row.priority} /></td>
                      <td className="px-4 py-3"><StatusBadge status={row.status} /></td>
                      <td className="px-4 py-3">
                        {row.assignedTo ? (
                          <span className="inline-flex items-center gap-1.5 text-xs">
                            <span className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold" style={{ background: row.assignedTo.avatarColor || "#22d3ee", color: "#0A1120" }}>
                              {row.assignedTo.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
                            </span>
                            {row.assignedTo.name.split(" ")[0]}
                          </span>
                        ) : (
                          <span className="text-[11px] text-amber-300/80">Unassigned</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
                          {row.messagesCount > 0 && (
                            <span className="inline-flex items-center gap-1"><MessageSquare className="w-3 h-3" />{row.messagesCount}</span>
                          )}
                          {age != null && age >= 7 && (
                            <span className="text-rose-300 text-[11px] font-medium">{age}d open</span>
                          )}
                          <span>{relativeTime(row.updatedAt)}</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-2.5">
            {rows.map((row) => (
              <button key={row.id} onClick={() => setDetailId(row.id)} className="apex-panel p-4 w-full text-left hover:border-primary/40 transition-colors">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium text-sm leading-snug">{row.subject}</p>
                  <StatusBadge status={row.status} />
                </div>
                <p className="text-[11px] text-muted-foreground mt-1 font-mono">{row.ticketNumber}</p>
                <div className="flex items-center flex-wrap gap-2 mt-2.5">
                  <PriorityBadge priority={row.priority} />
                  <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1"><Building2 className="w-3 h-3" />{row.client?.companyName || "—"}</span>
                  <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1"><MessageSquare className="w-3 h-3" />{row.messagesCount}</span>
                  <span className="text-[11px] text-muted-foreground ml-auto">{relativeTime(row.updatedAt)}</span>
                </div>
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between mt-4 text-xs text-muted-foreground">
            <span>{total} ticket{total === 1 ? "" : "s"}</span>
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
            <DialogTitle>{editRow ? "Edit ticket" : "New ticket"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <Field label="Subject" required>
                <Input value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} placeholder="e.g. Checkout page breaks on Safari" className="bg-secondary/40" />
              </Field>
            </div>
            <Field label="Client" required>
              <Select value={form.clientId || "NONE"} onValueChange={(v) => setForm((f) => ({ ...f, clientId: v === "NONE" ? "" : v, projectId: "" }))}>
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
            <Field label="Category">
              <Select value={form.category} onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}>
                <SelectTrigger className="bg-secondary/40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{CATEGORY_LABELS[c]}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Priority">
              <Select value={form.priority} onValueChange={(v) => setForm((f) => ({ ...f, priority: v }))}>
                <SelectTrigger className="bg-secondary/40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <div className="sm:col-span-2">
              <Field label="Description" hint="What happened, where, and what the client expects.">
                <Textarea rows={3} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Describe the issue or request…" className="bg-secondary/40" />
              </Field>
            </div>
            {can("tickets.assign") && (
              <div className="sm:col-span-2">
                <Field label="Assign to">
                  <Select value={form.assignedToId || "NONE"} onValueChange={(v) => setForm((f) => ({ ...f, assignedToId: v === "NONE" ? "" : v }))}>
                    <SelectTrigger className="bg-secondary/40"><SelectValue placeholder="Leave unassigned" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NONE">Leave unassigned</SelectItem>
                      {team.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={doSave} disabled={saving} className="bg-primary text-primary-foreground hover:bg-primary/90">
              {saving ? "Saving…" : editRow ? "Save changes" : "Create ticket"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ---------- Detail sheet ---------- */}
      <Sheet open={!!detailId} onOpenChange={(open) => { if (!open) setDetailId(null); }}>
        <SheetContent className="w-full sm:max-w-xl p-0 flex flex-col">
          {/* Header always rendered — Radix requires SheetTitle for a11y */}
          <div className="p-5 border-b border-border">
            <SheetTitle className="text-base font-semibold leading-snug">{detail?.ticket.subject || "…"}</SheetTitle>
            {detail ? (
              <div className="flex items-center flex-wrap gap-2 mt-2">
                <span className="text-[11px] font-mono text-muted-foreground">{detail.ticket.ticketNumber}</span>
                <StatusBadge status={detail.ticket.status} />
                <PriorityBadge priority={detail.ticket.priority} />
                <span className="text-[11px] text-muted-foreground">{CATEGORY_LABELS[detail.ticket.category] || detail.ticket.category}</span>
              </div>
            ) : null}
          </div>
          {detailLoading || !detail ? (
            <div className="p-6 space-y-3"><ListSkeleton rows={5} /></div>
          ) : (
            <div className="flex flex-col flex-1 min-h-0">
              {/* Action row */}
              {can("tickets.edit") && (
                <div className="px-5 py-3 border-b border-border flex flex-wrap items-center gap-1.5">
                  {(TRANSITIONS[detail.ticket.status] || []).map((s) => (
                    <Button key={s} size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => quickStatus(detail.ticket, s)}>
                      → {s.replace(/_/g, " ").toLowerCase()}
                    </Button>
                  ))}
                  {can("tickets.create") && (
                    <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => openEdit(detail.ticket)}>
                      <Pencil className="w-3 h-3 mr-1" /> Edit
                    </Button>
                  )}
                  {can("tickets.delete") && (
                    <Button size="sm" variant="outline" className="h-7 text-[11px] text-destructive hover:text-destructive" onClick={() => setArchiveRow(detail.ticket)}>
                      <Archive className="w-3 h-3" />
                    </Button>
                  )}
                </div>
              )}

              <Tabs defaultValue="conversation" className="flex flex-col flex-1 min-h-0">
                <TabsList className="mx-5 mt-3 mb-0 bg-secondary/40">
                  <TabsTrigger value="conversation" className="text-xs">Conversation ({detail.messages.length})</TabsTrigger>
                  <TabsTrigger value="details" className="text-xs">Details</TabsTrigger>
                  <TabsTrigger value="history" className="text-xs">History</TabsTrigger>
                  {can("files.view") && <TabsTrigger value="files" className="text-xs">Files</TabsTrigger>}
                </TabsList>

                <TabsContent value="conversation" className="flex flex-col flex-1 min-h-0 mt-0">
                  <ScrollArea className="flex-1 min-h-0 apex-scroll px-5 py-4" style={{ height: "calc(100vh - 320px)" }}>
                    <div className="space-y-3">
                      {detail.ticket.description && (
                        <div className="rounded-lg border border-border bg-secondary/30 p-3">
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Original request</p>
                          <p className="text-sm whitespace-pre-wrap leading-relaxed">{detail.ticket.description}</p>
                        </div>
                      )}
                      {detail.messages.length === 0 && !detail.ticket.description ? (
                        <p className="text-xs text-muted-foreground py-6 text-center">No messages yet — start the conversation below.</p>
                      ) : (
                        detail.messages.map((m) => (
                          <div key={m.id} className={cn(
                            "rounded-lg border p-3 group relative",
                            m.isInternal ? "border-amber-500/30 bg-amber-500/5" : "border-border bg-secondary/20"
                          )}>
                            <div className="flex items-center gap-2 mb-1.5">
                              <span className="text-xs font-medium">{m.authorName || "System"}</span>
                              {m.isInternal && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-300 border border-amber-500/30 bg-amber-500/10 rounded px-1.5 py-0.5">
                                  <Lock className="w-2.5 h-2.5" /> Internal
                                </span>
                              )}
                              <span className="text-[10px] text-muted-foreground ml-auto">{formatDate(m.createdAt)} · {relativeTime(m.createdAt)}</span>
                              {(m.authorId === sessionUserId || can("tickets.delete")) && (
                                <button
                                  onClick={() => deleteMessage(m.id)}
                                  className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                                  aria-label="Delete message"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                            <p className="text-sm whitespace-pre-wrap leading-relaxed">{m.body}</p>
                          </div>
                        ))
                      )}
                    </div>
                  </ScrollArea>
                  {can("tickets.edit") && detail.ticket.status !== "CLOSED" && (
                    <div className="p-4 border-t border-border bg-card/60">
                      <Textarea
                        rows={2}
                        value={composer}
                        onChange={(e) => setComposer(e.target.value)}
                        placeholder={internalNote ? "Write an internal note (clients never see this)…" : "Write a reply…"}
                        className="bg-secondary/40 text-sm"
                      />
                      <div className="flex items-center justify-between mt-2">
                        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                          <Switch checked={internalNote} onCheckedChange={setInternalNote} />
                          <Lock className={cn("w-3 h-3", internalNote ? "text-amber-300" : "")} />
                          Internal note
                        </label>
                        <Button size="sm" onClick={sendMessage} disabled={sending || composer.trim().length === 0} className="bg-primary text-primary-foreground hover:bg-primary/90">
                          <Send className="w-3.5 h-3.5 mr-1.5" /> {sending ? "Sending…" : "Send"}
                        </Button>
                      </div>
                    </div>
                  )}
                  {detail.ticket.status === "CLOSED" && (
                    <div className="p-4 border-t border-border text-xs text-muted-foreground bg-card/60">
                      This ticket is closed — reopen it to continue the conversation.
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="details" className="mt-0 px-5 py-4">
                  <ScrollArea className="apex-scroll" style={{ height: "calc(100vh - 320px)" }}>
                    <div className="space-y-4 text-sm">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <p className="text-xs text-muted-foreground flex items-center gap-1"><Building2 className="w-3 h-3" /> Client</p>
                          <p className="mt-0.5">{detail.ticket.client?.companyName || "—"}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground flex items-center gap-1"><FolderKanban className="w-3 h-3" /> Project</p>
                          <p className="mt-0.5">{detail.ticket.project ? detail.ticket.project.name : "—"}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Assignee</p>
                          <p className="mt-0.5">{detail.ticket.assignedTo?.name || "Unassigned"}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Opened</p>
                          <p className="mt-0.5">{formatDate(detail.ticket.createdAt)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Closed</p>
                          <p className="mt-0.5">{detail.ticket.closedAt ? formatDate(detail.ticket.closedAt) : "—"}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Category</p>
                          <p className="mt-0.5">{CATEGORY_LABELS[detail.ticket.category] || detail.ticket.category}</p>
                        </div>
                      </div>
                      {detail.ticket.description && (
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Description</p>
                          <div className="rounded-lg border border-border bg-secondary/30 p-3 text-sm whitespace-pre-wrap">{detail.ticket.description}</div>
                        </div>
                      )}
                    </div>
                  </ScrollArea>
                </TabsContent>

                <TabsContent value="history" className="mt-0 px-5 py-4">
                  <ScrollArea className="apex-scroll" style={{ height: "calc(100vh - 320px)" }}>
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

                {can("files.view") && (
                  <TabsContent value="files" className="mt-0 px-5 py-4">
                    <ScrollArea className="apex-scroll" style={{ height: "calc(100vh - 320px)" }}>
                      <FileAttachments entityType="TICKET" entityId={detail.ticket.id} />
                    </ScrollArea>
                  </TabsContent>
                )}
              </Tabs>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* ---------- Archive confirm ---------- */}
      <AlertDialog open={!!archiveRow} onOpenChange={(open) => { if (!open) setArchiveRow(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive this ticket?</AlertDialogTitle>
            <AlertDialogDescription>
              “{archiveRow?.subject}” ({archiveRow?.ticketNumber}) will be removed from active lists but the full history is preserved and recoverable. This action is recorded in the audit log.
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
