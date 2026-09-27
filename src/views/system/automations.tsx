"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader, EmptyState, ErrorState, ListSkeleton, Field } from "@/components/shared";
import { api, relativeTime, formatDateTime } from "@/lib/api-client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import {
  Sparkles, Plus, Pencil, Trash2, Zap, PlayCircle, Users, LifeBuoy,
  FileSpreadsheet, CreditCard, FolderKanban, BellRing, User as UserIcon,
  CheckCircle2, Filter, Activity, PowerOff, Info,
} from "lucide-react";

// ==================== types ====================

type TriggerDef = {
  key: string; label: string; description: string;
  icon: "USERS" | "LIFE_BUOY" | "FILE_SPREADSHEET" | "CREDIT_CARD" | "FOLDER_KANBAN";
  fields: { key: string; label: string; sample: string }[];
};
type ActionType = { type: "NOTIFY_ROLE" | "NOTIFY_ASSIGNEE"; label: string; needsRole: boolean; description: string };
type AutomationAction = { type: "NOTIFY_ROLE" | "NOTIFY_ASSIGNEE"; roleKey?: string; title: string; body?: string };
type Condition = { field: string; equals?: string; in?: string[] } | null;
type Automation = {
  id: string; name: string; description: string | null; trigger: string;
  condition: Condition; actions: AutomationAction[]; isActive: boolean;
  lastRunAt: string | null; runCount: number; updatedAt: string;
};

const TRIGGER_ICON: Record<string, typeof Zap> = {
  USERS: Users, LIFE_BUOY: LifeBuoy, FILE_SPREADSHEET: FileSpreadsheet,
  CREDIT_CARD: CreditCard, FOLDER_KANBAN: FolderKanban,
};
const TRIGGER_STYLE: Record<string, string> = {
  LEAD_CREATED: "bg-sky-500/10 text-sky-300 border-sky-500/30",
  TICKET_CREATED: "bg-rose-500/10 text-rose-300 border-rose-500/30",
  INVOICE_SENT: "bg-cyan-500/10 text-cyan-300 border-cyan-500/30",
  PAYMENT_RECEIVED: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  PROJECT_COMPLETED: "bg-violet-500/10 text-violet-300 border-violet-500/30",
};
const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: "Super Admin", ADMIN: "Admin", SALES: "Sales", PROJECT_MANAGER: "Project Manager",
  DEVELOPER: "Developer", DESIGNER: "Designer", MARKETING: "Marketing", SUPPORT: "Support",
};

function describeCondition(c: Condition): string | null {
  if (!c || !c.field) return null;
  if (c.in && c.in.length) return `${c.field} is ${c.in.join(" or ")}`;
  if (c.equals !== undefined) return `${c.field} is ${c.equals}`;
  return null;
}

// ==================== main view ====================

export function AutomationsView() {
  const { toast } = useToast();
  const [rows, setRows] = useState<Automation[]>([]);
  const [registry, setRegistry] = useState<TriggerDef[]>([]);
  const [actionTypes, setActionTypes] = useState<ActionType[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [filter, setFilter] = useState("ALL");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editRow, setEditRow] = useState<Automation | null>(null);
  const [deleteRow, setDeleteRow] = useState<Automation | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(false);
    try {
      const data = await api.get<{ automations: Automation[]; registry: TriggerDef[]; actionTypes: ActionType[]; roles: string[] }>("/api/automations");
      setRows(data.automations); setRegistry(data.registry); setActionTypes(data.actionTypes); setRoles(data.roles);
    } catch { setError(true); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load, reloadKey]);

  const toggleActive = async (a: Automation) => {
    try {
      await api.patch(`/api/automations/${a.id}`, { isActive: !a.isActive });
      setRows((rs) => rs.map((r) => (r.id === a.id ? { ...r, isActive: !r.isActive } : r)));
      toast({ title: a.isActive ? `${a.name} paused` : `${a.name} activated` });
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Toggle failed", variant: "destructive" });
    }
  };

  const doDelete = async () => {
    if (!deleteRow) return;
    try {
      await api.delete(`/api/automations/${deleteRow.id}`);
      toast({ title: "Automation deleted" });
      setDeleteRow(null); setReloadKey((k) => k + 1);
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Delete failed", variant: "destructive" });
    }
  };

  const filtered = filter === "ALL" ? rows : rows.filter((r) => r.trigger === filter);
  const activeCount = rows.filter((r) => r.isActive).length;
  const totalRuns = rows.reduce((s, r) => s + r.runCount, 0);

  return (
    <div>
      <PageHeader
        title="Automations"
        description="Event-driven rules that notify the right people the moment something happens — no babysitting required."
        actions={(
          <Button onClick={() => { setEditRow(null); setDialogOpen(true); }} className="bg-primary text-primary-foreground hover:bg-primary/90">
            <Plus className="w-4 h-4 mr-2" /> New automation
          </Button>
        )}
      />

      {/* summary */}
      <div className="grid grid-cols-3 gap-3 mb-5 max-w-2xl">
        <div className="apex-panel p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Rules</p>
          <p className="text-2xl font-semibold mt-1">{rows.length}</p>
        </div>
        <div className="apex-panel p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Active</p>
          <p className="text-2xl font-semibold mt-1 text-emerald-300">{activeCount}</p>
        </div>
        <div className="apex-panel p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Total runs</p>
          <p className="text-2xl font-semibold mt-1">{totalRuns}</p>
        </div>
      </div>

      {/* how it works */}
      <div className="apex-panel p-4 mb-5 flex items-start gap-3 border-primary/20">
        <Info className="w-4 h-4 text-primary mt-0.5 shrink-0" />
        <div className="text-xs text-muted-foreground leading-relaxed">
          <span className="text-foreground font-medium">How it works:</span> when a business event fires (new lead, urgent ticket, invoice sent, payment received, project completed),
          every active rule for that event checks its optional condition, renders the templates, and executes its actions.
          Rules run silently — failures never interrupt the underlying operation.
        </div>
      </div>

      {/* trigger filter */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        <button
          onClick={() => setFilter("ALL")}
          className={cn("px-2.5 py-1 rounded-md border text-xs font-medium transition-colors",
            filter === "ALL" ? "bg-primary/10 text-primary border-primary/40" : "bg-secondary/40 text-muted-foreground border-border hover:text-foreground")}
        >
          All events
        </button>
        {registry.map((t) => (
          <button
            key={t.key}
            onClick={() => setFilter(t.key)}
            className={cn("px-2.5 py-1 rounded-md border text-xs font-medium transition-colors",
              filter === t.key ? TRIGGER_STYLE[t.key] : "bg-secondary/40 text-muted-foreground border-border hover:text-foreground")}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <ListSkeleton rows={4} />
      ) : error ? (
        <ErrorState onRetry={() => setReloadKey((k) => k + 1)} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Sparkles className="w-5 h-5" />}
          title={filter === "ALL" ? "No automations yet" : "No rules for this event"}
          description={filter === "ALL"
            ? "Create your first rule — e.g. “Notify admins when an urgent ticket arrives”."
            : "Try a different event, or create a rule for it."}
          action={filter === "ALL" ? (
            <Button onClick={() => { setEditRow(null); setDialogOpen(true); }}>
              <Plus className="w-4 h-4 mr-2" /> Create automation
            </Button>
          ) : undefined}
        />
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {filtered.map((a) => {
            const t = registry.find((r) => r.key === a.trigger);
            const Icon = TRIGGER_ICON[t?.icon || "USERS"] || Zap;
            return (
              <div key={a.id} className={cn("apex-panel p-4", !a.isActive && "opacity-70")}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center shrink-0 border", TRIGGER_STYLE[a.trigger])}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{a.name}</p>
                      {a.description && <p className="text-xs text-muted-foreground line-clamp-1">{a.description}</p>}
                    </div>
                  </div>
                  <Switch checked={a.isActive} onCheckedChange={() => toggleActive(a)} />
                </div>

                <div className="flex items-center gap-1.5 flex-wrap mt-3">
                  <span className={cn("text-[10px] px-1.5 py-0.5 rounded border font-medium", TRIGGER_STYLE[a.trigger])}>
                    {t?.label ?? a.trigger}
                  </span>
                  {a.condition && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-amber-300 font-medium inline-flex items-center gap-1">
                      <Filter className="w-2.5 h-2.5" /> {describeCondition(a.condition)}
                    </span>
                  )}
                  {a.actions.map((act, i) => (
                    <span key={i} className="text-[10px] px-1.5 py-0.5 rounded border border-border bg-secondary text-secondary-foreground font-medium inline-flex items-center gap-1">
                      {act.type === "NOTIFY_ROLE" ? <><BellRing className="w-2.5 h-2.5" /> {ROLE_LABELS[act.roleKey || ""] || act.roleKey}</> : <><UserIcon className="w-2.5 h-2.5" /> Assignee</>}
                    </span>
                  ))}
                </div>

                <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/60">
                  <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1.5">
                    <Activity className="w-3 h-3" /> {a.runCount} run{a.runCount === 1 ? "" : "s"}
                    {a.lastRunAt ? ` · last ${relativeTime(a.lastRunAt)}` : " · never ran"}
                  </span>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => { setEditRow(a); setDialogOpen(true); }}>
                      <Pencil className="w-3 h-3" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-destructive hover:text-destructive" onClick={() => setDeleteRow(a)}>
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <AutomationDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editRow={editRow}
        registry={registry}
        actionTypes={actionTypes}
        roles={roles}
        onSaved={() => { setDialogOpen(false); setEditRow(null); setReloadKey((k) => k + 1); }}
      />

      <AlertDialog open={!!deleteRow} onOpenChange={(v) => !v && setDeleteRow(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleteRow?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The rule stops immediately and its run history is removed. Notifications already sent are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={doDelete}>Delete rule</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ==================== create / edit dialog ====================

function AutomationDialog({ open, onOpenChange, editRow, registry, actionTypes, roles, onSaved }: {
  open: boolean; onOpenChange: (v: boolean) => void; editRow: Automation | null;
  registry: TriggerDef[]; actionTypes: ActionType[]; roles: string[];
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    name: "", description: "", trigger: "TICKET_CREATED",
    conditionField: "", conditionValues: "",
    actions: [{ type: "NOTIFY_ROLE", roleKey: "SUPER_ADMIN", title: "", body: "" }] as AutomationAction[],
  });
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<{ conditionMet: boolean; actions: { type: string; roleKey?: string; title: string; body?: string }[] } | null>(null);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    if (open) {
      setPreview(null);
      if (editRow) {
        setForm({
          name: editRow.name, description: editRow.description || "",
          trigger: editRow.trigger,
          conditionField: editRow.condition?.field || "",
          conditionValues: editRow.condition?.in?.join(", ") ?? editRow.condition?.equals ?? "",
          actions: editRow.actions.map((a) => ({ ...a, body: a.body || "" })),
        });
      } else {
        setForm({ name: "", description: "", trigger: "TICKET_CREATED", conditionField: "", conditionValues: "", actions: [{ type: "NOTIFY_ROLE", roleKey: "SUPER_ADMIN", title: "", body: "" }] });
      }
    }
  }, [open, editRow]);

  const triggerDef = registry.find((t) => t.key === form.trigger);
  const setAction = (i: number, patch: Partial<AutomationAction>) =>
    setForm((f) => ({ ...f, actions: f.actions.map((a, j) => (j === i ? { ...a, ...patch } : a)) }));

  const buildPayload = () => ({
    name: form.name.trim(),
    description: form.description.trim(),
    trigger: form.trigger,
    condition: form.conditionField.trim()
      ? {
          field: form.conditionField.trim(),
          ...(form.conditionValues.trim().includes(",")
            ? { in: form.conditionValues.split(",").map((s) => s.trim()).filter(Boolean) }
            : { equals: form.conditionValues.trim() }),
        }
      : null,
    actions: form.actions.map((a) => ({
      type: a.type,
      ...(a.type === "NOTIFY_ROLE" ? { roleKey: a.roleKey } : {}),
      title: a.title.trim(),
      body: a.body?.trim() || undefined,
    })),
  });

  const valid =
    form.name.trim().length >= 3 &&
    form.actions.every((a) => a.title.trim().length >= 3 && (a.type !== "NOTIFY_ROLE" || !!a.roleKey));

  const submit = async () => {
    setSaving(true);
    try {
      const payload = buildPayload();
      if (editRow) {
        await api.patch(`/api/automations/${editRow.id}`, payload);
        toast({ title: "Automation updated" });
      } else {
        await api.post("/api/automations", payload);
        toast({ title: "Automation created", description: "It will fire on the next matching event." });
      }
      onSaved();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Save failed", variant: "destructive" });
    } finally { setSaving(false); }
  };

  const runPreview = async () => {
    if (editRow) {
      setPreviewing(true);
      try {
        const data = await api.post<{ preview: { conditionMet: boolean; actions: { title: string; body?: string; type: string; roleKey?: string }[] } }>(`/api/automations/${editRow.id}/test`);
        setPreview(data.preview);
      } catch (e) {
        toast({ title: e instanceof Error ? e.message : "Preview failed", variant: "destructive" });
      } finally { setPreviewing(false); }
    } else {
      // client-side render with sample data (not saved yet)
      const context: Record<string, string> = {};
      triggerDef?.fields.forEach((f) => { context[f.key] = f.sample; });
      const cond = buildPayload().condition as { field: string; equals?: string; in?: string[] } | null;
      const condValue = cond && context[cond.field];
      const meets = !cond || cond.field === "" || (cond.in ? cond.in.includes(String(condValue)) : String(condValue ?? "") === cond.equals);
      setPreview({
        conditionMet: meets,
        actions: form.actions.map((a) => ({
          type: a.type, roleKey: a.roleKey,
          title: a.title.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k: string) => context[k] ?? `{{${k}}}`),
          body: a.body?.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k: string) => context[k] ?? `{{${k}}}`) || undefined,
        })),
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-primary" /> {editRow ? "Edit automation" : "New automation"}</DialogTitle>
          <DialogDescription>Pick an event, optionally narrow it with a condition, then define the actions.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Name" required><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Urgent ticket escalation" className="bg-secondary/40" /></Field>
          <Field label="Event trigger" required>
            <Select value={form.trigger} onValueChange={(trigger) => setForm((f) => ({ ...f, trigger }))}>
              <SelectTrigger className="bg-secondary/40"><SelectValue /></SelectTrigger>
              <SelectContent>
                {registry.map((t) => <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Description" hint="What is this rule for?"><Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} className="bg-secondary/40" /></Field>
          </div>
        </div>

        {/* condition builder */}
        {triggerDef && (
          <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 space-y-2.5">
            <p className="text-xs font-medium text-amber-300 flex items-center gap-1.5"><Filter className="w-3 h-3" /> Condition (optional)</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Only run when field…">
                <Select value={form.conditionField || "NONE"} onValueChange={(v) => setForm((f) => ({ ...f, conditionField: v === "NONE" ? "" : v }))}>
                  <SelectTrigger className="bg-secondary/40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">Always run</SelectItem>
                    {triggerDef.fields.map((f) => <SelectItem key={f.key} value={f.key}>{f.label} ({f.key})</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="…equals value(s)" hint="Comma = match any of them">
                <Input
                  value={form.conditionValues} disabled={!form.conditionField}
                  onChange={(e) => setForm((f) => ({ ...f, conditionValues: e.target.value.toUpperCase() }))}
                  placeholder={form.conditionField ? "e.g. URGENT, HIGH" : "Pick a field first"}
                  className="bg-secondary/40"
                />
              </Field>
            </div>
          </div>
        )}

        {/* actions builder */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground">Actions</p>
            {form.actions.length < 3 && (
              <Button
                variant="outline" size="sm" className="h-7"
                onClick={() => setForm((f) => ({ ...f, actions: [...f.actions, { type: "NOTIFY_ROLE", roleKey: "ADMIN", title: "", body: "" }] }))}
              >
                <Plus className="w-3 h-3 mr-1" /> Add action
              </Button>
            )}
          </div>
          {form.actions.map((a, i) => (
            <div key={i} className="rounded-lg border border-border bg-secondary/30 p-3 space-y-3">
              <div className="flex items-center gap-2">
                <Select value={a.type} onValueChange={(type) => setAction(i, { type: type as AutomationAction["type"], ...(type === "NOTIFY_ASSIGNEE" ? { roleKey: undefined } : { roleKey: a.roleKey || "ADMIN" }) })}>
                  <SelectTrigger className="bg-secondary/40 h-8 text-xs flex-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {actionTypes.map((at) => <SelectItem key={at.type} value={at.type}>{at.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                {a.type === "NOTIFY_ROLE" && (
                  <Select value={a.roleKey || "SUPER_ADMIN"} onValueChange={(roleKey) => setAction(i, { roleKey })}>
                    <SelectTrigger className="bg-secondary/40 h-8 text-xs w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {roles.map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r] || r}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
                {form.actions.length > 1 && (
                  <Button variant="ghost" size="sm" className="h-8 px-2 text-muted-foreground hover:text-destructive" onClick={() => setForm((f) => ({ ...f, actions: f.actions.filter((_, j) => j !== i) }))}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
              <Field label="Notification title" required>
                <Input value={a.title} onChange={(e) => setAction(i, { title: e.target.value })} placeholder="e.g. Urgent ticket {{ticketNumber}}: {{subject}}" className="bg-secondary/40" />
              </Field>
              <Field label="Body (optional)">
                <Textarea rows={2} value={a.body} onChange={(e) => setAction(i, { body: e.target.value })} placeholder="e.g. {{clientName}} reported an urgent issue — priority {{priority}}." className="bg-secondary/40" />
              </Field>
            </div>
          ))}
          {triggerDef && (
            <div className="flex flex-wrap gap-1.5">
              <span className="text-[11px] text-muted-foreground self-center mr-1">Insert placeholder:</span>
              {triggerDef.fields.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setForm((prev) => ({ ...prev, actions: prev.actions.map((a, j) => (j === prev.actions.length - 1 ? { ...a, title: `${a.title}{{${f.key}}}` } : a)) }))}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/30 font-mono hover:bg-primary/20"
                  title={f.label}
                >
                  {`{{${f.key}}}`}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* dry-run preview */}
        {preview && (
          <div className={cn("rounded-lg border p-3 space-y-2", preview.conditionMet ? "border-emerald-500/30 bg-emerald-500/5" : "border-slate-500/30 bg-slate-500/5")}>
            <p className="text-xs font-medium flex items-center gap-1.5">
              {preview.conditionMet
                ? <><CheckCircle2 className="w-3.5 h-3.5 text-emerald-300" /> <span className="text-emerald-300">Condition met — would execute:</span></>
                : <><PowerOff className="w-3.5 h-3.5 text-slate-400" /> <span className="text-slate-400">Condition NOT met with sample data — rule would skip.</span></>}
            </p>
            {preview.conditionMet && preview.actions.map((a, i) => (
              <div key={i} className="rounded-md bg-black/30 border border-border p-2.5 text-xs">
                <p className="font-medium">{a.title}</p>
                {a.body && <p className="text-muted-foreground mt-0.5">{a.body}</p>}
                <p className="text-[10px] text-muted-foreground mt-1">
                  → {a.type === "NOTIFY_ROLE" ? `notify role ${ROLE_LABELS[a.roleKey || ""] || a.roleKey}` : "notify the assignee"}
                </p>
              </div>
            ))}
            <p className="text-[10px] text-muted-foreground">Dry run only — nothing was sent. Sample data: {triggerDef?.fields.slice(0, 2).map((f) => `${f.key}="${f.sample}"`).join(", ")}…</p>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={runPreview} disabled={previewing || !valid}>
            <PlayCircle className="w-3.5 h-3.5 mr-1.5" /> {previewing ? "Rendering…" : "Preview with sample data"}
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={submit} disabled={!valid || saving} className="bg-primary text-primary-foreground hover:bg-primary/90">
              {saving ? "Saving…" : editRow ? "Save changes" : "Create automation"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
