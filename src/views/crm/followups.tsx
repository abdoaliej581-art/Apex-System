"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import {
  AlarmClock, CalendarClock, ChevronLeft, ChevronRight, Loader2,
  Pencil, Plus, RotateCcw, Trash2, XCircle,
} from "lucide-react";
import { PageHeader, EmptyState, ErrorState, ListSkeleton, PriorityBadge, StatusBadge, Field } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { api, qs, formatDateTime } from "@/lib/api-client";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { ViewProps } from "@/views/registry";
import {
  PRIORITIES, UserAvatar, toLocalInput, isOverdueDate,
  type FollowUpItem, type Lead, type TeamMember,
} from "@/views/crm/lead-detail";

type FollowUpsResponse = { items: FollowUpItem[]; total: number; page: number; pageSize: number };
type LeadsResponse = { items: Lead[]; total: number };
type ClientsResponse = { items: { id: string; companyName: string; clientNumber: string }[]; total: number };

type FollowUpTab = "today" | "upcoming" | "overdue" | "completed";

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function endOfToday(): Date {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}

type FormValues = {
  title: string;
  dueAt: string;
  relatedType: string; // NONE | LEAD | CLIENT
  leadId: string;
  clientId: string;
  assignedToId: string;
  priority: string;
  notes: string;
};

const emptyForm: FormValues = {
  title: "", dueAt: "", relatedType: "NONE", leadId: "", clientId: "",
  assignedToId: "", priority: "MEDIUM", notes: "",
};

export function FollowUpsView({ navigate }: ViewProps) {
  const { data: session } = useSession();
  const permissions = session?.user?.permissions ?? [];
  const { toast } = useToast();

  const [items, setItems] = useState<FollowUpItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 100;

  const [leads, setLeads] = useState<Lead[]>([]);
  const [clients, setClients] = useState<{ id: string; companyName: string; clientNumber: string }[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [teamAccess, setTeamAccess] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editItem, setEditItem] = useState<FollowUpItem | null>(null);
  const [deleteItem, setDeleteItem] = useState<FollowUpItem | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.get<FollowUpsResponse>(`/api/followups${qs({ page, pageSize })}`);
      setItems(result.items);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load follow-ups.");
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    let cancelled = false;
    api.get<LeadsResponse>("/api/leads?pageSize=100").then((d) => { if (!cancelled) setLeads(d.items); }).catch(() => undefined);
    api.get<ClientsResponse>("/api/clients?pageSize=100").then((d) => { if (!cancelled) setClients(d.items); }).catch(() => undefined);
    api.get<{ team: TeamMember[] }>("/api/team")
      .then((d) => { if (!cancelled) { setTeam(d.team); setTeamAccess(true); } })
      .catch(() => { if (!cancelled) setTeamAccess(false); });
    return () => { cancelled = true; };
  }, []);

  const buckets = useMemo(() => {
    const all = items ?? [];
    const today = startOfToday().getTime();
    const endToday = endOfToday().getTime();
    return {
      today: all.filter((f) => f.status === "PENDING" && new Date(f.dueAt).getTime() >= today && new Date(f.dueAt).getTime() <= endToday),
      upcoming: all.filter((f) => f.status === "PENDING" && new Date(f.dueAt).getTime() > endToday),
      overdue: all.filter((f) => f.status === "PENDING" && new Date(f.dueAt).getTime() < today),
      completed: all.filter((f) => f.status === "COMPLETED"),
    } satisfies Record<FollowUpTab, FollowUpItem[]>;
  }, [items]);

  const patchStatus = (f: FollowUpItem, status: string) => {
    setRowBusy(f.id);
    api.patch<FollowUpItem>(`/api/followups/${f.id}`, { status })
      .then(() => {
        toast({
          title: status === "COMPLETED" ? "Follow-up completed" : status === "CANCELLED" ? "Follow-up cancelled" : "Follow-up reopened",
          description: f.title,
        });
        load();
      })
      .catch((err) => toast({ title: "Update failed", description: err instanceof Error ? err.message : "Something went wrong.", variant: "destructive" }))
      .finally(() => setRowBusy(null));
  };

  const confirmDelete = () => {
    if (!deleteItem) return;
    const target = deleteItem;
    api.delete(`/api/followups/${target.id}`)
      .then(() => { toast({ title: "Follow-up deleted", description: target.title }); setDeleteItem(null); load(); })
      .catch((err) => { toast({ title: "Delete failed", description: err instanceof Error ? err.message : "Something went wrong.", variant: "destructive" }); setDeleteItem(null); });
  };

  const relatedEntity = (f: FollowUpItem) => f.lead ?? f.client ?? null;
  const relatedIsLead = (f: FollowUpItem) => Boolean(f.lead);
  const canCreate = permissions.includes("followups.create");
  const canEdit = permissions.includes("followups.edit");
  const canDelete = permissions.includes("followups.delete");

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      <PageHeader
        title="Follow-ups"
        description="Everything the team promised to do next — today, upcoming and overdue."
        actions={canCreate ? <Button onClick={() => setFormOpen(true)}><Plus className="w-4 h-4 mr-2" /> New Follow-up</Button> : undefined}
      />

      <Tabs defaultValue="today">
        <TabsList className="mb-4 flex-wrap h-auto">
          <TabsTrigger value="today" className="gap-1.5"><CalendarClock className="w-3.5 h-3.5" /> Today{buckets.today.length > 0 && <span className="text-[10px] bg-secondary rounded-full px-1.5">{buckets.today.length}</span>}</TabsTrigger>
          <TabsTrigger value="upcoming">Upcoming{buckets.upcoming.length > 0 && <span className="text-[10px] bg-secondary rounded-full px-1.5 ml-1">{buckets.upcoming.length}</span>}</TabsTrigger>
          <TabsTrigger value="overdue" className="gap-1.5"><AlarmClock className="w-3.5 h-3.5" /> Overdue{buckets.overdue.length > 0 && <span className="text-[10px] bg-rose-500/20 text-rose-300 rounded-full px-1.5">{buckets.overdue.length}</span>}</TabsTrigger>
          <TabsTrigger value="completed">Completed{buckets.completed.length > 0 && <span className="text-[10px] bg-secondary rounded-full px-1.5 ml-1">{buckets.completed.length}</span>}</TabsTrigger>
        </TabsList>

        {loading && <ListSkeleton rows={7} />}
        {!loading && error && <ErrorState message={error} onRetry={load} />}

        {!loading && !error && (["today", "upcoming", "overdue", "completed"] as FollowUpTab[]).map((tab) => {
          const list = buckets[tab];
          const emptyText: Record<FollowUpTab, { title: string; description: string }> = {
            today: { title: "Nothing due today", description: "No follow-ups are scheduled for today. Enjoy the focus time." },
            upcoming: { title: "No upcoming follow-ups", description: "Schedule one to keep the pipeline moving." },
            overdue: { title: "Nothing overdue", description: "Great — the team is on top of every follow-up." },
            completed: { title: "No completed follow-ups yet", description: "Completed and cancelled follow-ups will appear here once the team closes them." },
          };
          return (
            <TabsContent key={tab} value={tab} className="mt-0">
              {list.length === 0 ? (
                <EmptyState
                  icon={<CalendarClock className="w-5 h-5" />}
                  title={emptyText[tab].title}
                  description={emptyText[tab].description}
                  action={canCreate && (tab === "today" || tab === "upcoming" || tab === "overdue") ? (
                    <Button size="sm" onClick={() => setFormOpen(true)}><Plus className="w-4 h-4 mr-2" /> New Follow-up</Button>
                  ) : undefined}
                />
              ) : (
                <div className="space-y-2">
                  {list.map((f) => {
                    const related = relatedEntity(f);
                    const isOverdue = isOverdueDate(f.dueAt) && f.status === "PENDING";
                    const busy = rowBusy === f.id;
                    return (
                      <div
                        key={f.id}
                        className={cn(
                          "apex-panel rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-3",
                          isOverdue && "border-rose-500/30"
                        )}
                      >
                        {/* Complete checkbox */}
                        {canEdit && (
                          <label className="flex items-center shrink-0 cursor-pointer" aria-label={f.status === "COMPLETED" ? "Reopen follow-up" : "Complete follow-up"}>
                            {busy ? (
                              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                            ) : (
                              <Checkbox
                                checked={f.status === "COMPLETED"}
                                onCheckedChange={() => patchStatus(f, f.status === "COMPLETED" ? "PENDING" : "COMPLETED")}
                              />
                            )}
                          </label>
                        )}

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className={cn("text-sm font-medium", f.status === "COMPLETED" && "line-through text-muted-foreground")}>{f.title}</p>
                            <StatusBadge status={f.status} />
                          </div>
                          <div className="flex items-center gap-2.5 mt-1.5 flex-wrap text-xs text-muted-foreground">
                            <span className={cn(isOverdue && "text-rose-300 font-medium")}>{formatDateTime(f.dueAt)}{isOverdue ? " · overdue" : ""}</span>
                            <PriorityBadge priority={f.priority} />
                            {related ? (
                              <button
                                onClick={() => navigate(relatedIsLead(f) ? "crm/leads" : "crm/clients")}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-secondary/70 hover:bg-accent border border-border transition-colors"
                              >
                                {relatedIsLead(f) ? "Lead" : "Client"} · {related.companyName}
                              </button>
                            ) : null}
                            {f.assignedTo && (
                              <span className="inline-flex items-center gap-1.5">
                                <UserAvatar name={f.assignedTo.name} color={f.assignedTo.avatarColor} size={18} />
                                {f.assignedTo.name}
                              </span>
                            )}
                          </div>
                          {f.notes && <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2">{f.notes}</p>}
                        </div>

                        {(canEdit || canDelete) && (
                          <div className="flex items-center gap-1 shrink-0">
                            {canEdit && f.status === "PENDING" && (
                              <>
                                <Button variant="ghost" size="icon" className="h-8 w-8" title="Edit" aria-label={`Edit ${f.title}`} onClick={() => setEditItem(f)}>
                                  <Pencil className="w-3.5 h-3.5" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-amber-300" title="Cancel" aria-label={`Cancel ${f.title}`} disabled={busy} onClick={() => patchStatus(f, "CANCELLED")}>
                                  <XCircle className="w-3.5 h-3.5" />
                                </Button>
                              </>
                            )}
                            {canEdit && f.status !== "PENDING" && (
                              <Button variant="ghost" size="icon" className="h-8 w-8" title="Reopen" aria-label={`Reopen ${f.title}`} disabled={busy} onClick={() => patchStatus(f, "PENDING")}>
                                <RotateCcw className="w-3.5 h-3.5" />
                              </Button>
                            )}
                            {canDelete && (
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-rose-300" title="Delete" aria-label={`Delete ${f.title}`} onClick={() => setDeleteItem(f)}>
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </TabsContent>
          );
        })}
      </Tabs>

      {/* Pagination (server page over 100 rows each) */}
      {total > pageSize && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-xs text-muted-foreground">Page {page} of {totalPages} · {total} follow-ups</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}><ChevronLeft className="w-4 h-4 mr-1" /> Prev</Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next <ChevronRight className="w-4 h-4 ml-1" /></Button>
          </div>
        </div>
      )}

      {/* New dialog */}
      <FollowUpFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        leads={leads}
        clients={clients}
        team={team}
        teamAccess={teamAccess}
        onSaved={load}
      />

      {/* Edit dialog */}
      {editItem && (
        <FollowUpFormDialog
          open
          onOpenChange={(o) => !o && setEditItem(null)}
          followUp={editItem}
          leads={leads}
          clients={clients}
          team={team}
          teamAccess={teamAccess}
          onSaved={load}
        />
      )}

      {/* Delete confirmation */}
      <AlertDialog open={deleteItem !== null} onOpenChange={(o) => !o && setDeleteItem(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this follow-up?</AlertDialogTitle>
            <AlertDialogDescription>
              “{deleteItem?.title}” will be permanently removed. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={confirmDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ============ Create / Edit dialog ============

function FollowUpFormDialog({
  open, onOpenChange, followUp, leads, clients, team, teamAccess, onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  followUp?: FollowUpItem | null;
  leads: Lead[];
  clients: { id: string; companyName: string; clientNumber: string }[];
  team: TeamMember[];
  teamAccess: boolean;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [values, setValues] = useState<FormValues>(emptyForm);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const isEdit = Boolean(followUp);

  useEffect(() => {
    if (open) {
      if (followUp) {
        setValues({
          title: followUp.title,
          dueAt: toLocalInput(followUp.dueAt),
          relatedType: followUp.leadId ? "LEAD" : followUp.clientId ? "CLIENT" : "NONE",
          leadId: followUp.leadId || "",
          clientId: followUp.clientId || "",
          assignedToId: followUp.assignedToId || "",
          priority: followUp.priority,
          notes: followUp.notes || "",
        });
      } else {
        setValues({ ...emptyForm, dueAt: toLocalInput(new Date(Date.now() + 60 * 60 * 1000)) });
      }
      setFormError("");
    }
  }, [open, followUp]);

  const submit = async () => {
    if (values.title.trim().length < 2) { setFormError("Title is required (min 2 characters)."); return; }
    if (!values.dueAt) { setFormError("Due date is required."); return; }
    if (values.relatedType === "LEAD" && !values.leadId) { setFormError("Select a lead or switch related to None."); return; }
    if (values.relatedType === "CLIENT" && !values.clientId) { setFormError("Select a client or switch related to None."); return; }

    setSaving(true);
    const payload = {
      title: values.title.trim(),
      dueAt: new Date(values.dueAt).toISOString(),
      leadId: values.relatedType === "LEAD" ? values.leadId : null,
      clientId: values.relatedType === "CLIENT" ? values.clientId : null,
      assignedToId: values.assignedToId || null,
      priority: values.priority,
      notes: values.notes.trim() || null,
    };
    try {
      if (isEdit && followUp) {
        await api.patch(`/api/followups/${followUp.id}`, payload);
        toast({ title: "Follow-up updated", description: payload.title });
      } else {
        await api.post("/api/followups", payload);
        toast({ title: "Follow-up scheduled", description: payload.title });
      }
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast({ title: isEdit ? "Update failed" : "Could not schedule", description: err instanceof Error ? err.message : "Something went wrong.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[92vh] overflow-y-auto apex-scroll">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit follow-up" : "New follow-up"}</DialogTitle>
          <DialogDescription>Link it to a lead or client so it shows up in their history.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field label="Title" required>
            <Input value={values.title} onChange={(e) => { setValues({ ...values, title: e.target.value }); setFormError(""); }} placeholder="Call to discuss proposal" />
          </Field>
          <Field label="Due at" required>
            <Input type="datetime-local" value={values.dueAt} onChange={(e) => { setValues({ ...values, dueAt: e.target.value }); setFormError(""); }} />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Related to">
              <Select value={values.relatedType} onValueChange={(v) => setValues({ ...values, relatedType: v, leadId: "", clientId: "" })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">Nothing (standalone)</SelectItem>
                  <SelectItem value="LEAD">A lead</SelectItem>
                  <SelectItem value="CLIENT">A client</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {values.relatedType === "LEAD" && (
              <Field label="Lead">
                <Select value={values.leadId || "PICK"} onValueChange={(v) => setValues({ ...values, leadId: v === "PICK" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="Select lead" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PICK" disabled>Select a lead…</SelectItem>
                    {leads.map((l) => <SelectItem key={l.id} value={l.id}>{l.companyName} ({l.leadNumber})</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            )}
            {values.relatedType === "CLIENT" && (
              <Field label="Client">
                <Select value={values.clientId || "PICK"} onValueChange={(v) => setValues({ ...values, clientId: v === "PICK" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PICK" disabled>Select a client…</SelectItem>
                    {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.companyName} ({c.clientNumber})</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            )}
            <Field label="Priority">
              <Select value={values.priority} onValueChange={(v) => setValues({ ...values, priority: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            {teamAccess && (
              <Field label="Assign to">
                <Select value={values.assignedToId || "UNASSIGNED"} onValueChange={(v) => setValues({ ...values, assignedToId: v === "UNASSIGNED" ? "" : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="UNASSIGNED">Unassigned</SelectItem>
                    {team.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            )}
          </div>
          <Field label="Notes">
            <Textarea value={values.notes} onChange={(e) => setValues({ ...values, notes: e.target.value })} rows={3} placeholder="Agenda, context, links…" />
          </Field>
          {formError && <p className="text-xs text-destructive">{formError}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>
            {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {isEdit ? "Save changes" : "Schedule follow-up"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
