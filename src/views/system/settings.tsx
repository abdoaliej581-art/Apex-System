"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader, EmptyState, ErrorState, ListSkeleton, Field } from "@/components/shared";
import { api, relativeTime, formatDate } from "@/lib/api-client";
import { useSession } from "next-auth/react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  Building2, Users, ShieldCheck, SlidersHorizontal, Plus, X, Pencil,
  UserPlus, Save, Lock, AlertTriangle, RotateCcw, KeyRound,
  Send, Loader2, CheckCircle2, Mail,
} from "lucide-react";

// ==================== shared bits ====================

type RoleRef = { id: string; key: string; label: string; isSystem?: boolean };
type UserRow = {
  id: string; name: string; email: string; title: string | null; avatarColor: string;
  isActive: boolean; customPermissions: string | null; lastLoginAt: string | null; createdAt: string;
  roles: RoleRef[];
};

const MODULE_LABELS: Record<string, string> = {
  dashboard: "Dashboard", leads: "Leads (CRM)", followups: "Follow-ups", clients: "Clients",
  contacts: "Contacts", activities: "Activity", meetings: "Meetings", proposals: "Proposals",
  quotations: "Quotations", contracts: "Contracts", projects: "Projects", tasks: "Tasks",
  team: "Team", invoices: "Invoices", payments: "Payments", expenses: "Expenses",
  content: "Content", campaigns: "Campaigns", "marketing.analytics": "Marketing Analytics",
  tickets: "Tickets", maintenance: "Maintenance", kb: "Knowledge Base", reports: "Reports",
  audit: "Audit Log", settings: "Settings", automations: "Automations", notifications: "Notifications",
};

const ACTION_LABELS: Record<string, string> = {
  view: "View", create: "Create", edit: "Edit", delete: "Delete",
  assign: "Assign", manage: "Manage", export: "Export",
};

function actionLabel(permission: string) {
  const action = permission.split(".")[1] || "view";
  return ACTION_LABELS[action] || action;
}

function Avatar({ name, color, size = 9 }: { name: string; color: string; size?: number }) {
  const initials = name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div
      className="rounded-full flex items-center justify-center font-semibold text-white shrink-0"
      style={{ backgroundColor: color, width: `${size * 4}px`, height: `${size * 4}px`, fontSize: `${Math.max(10, size * 1.6)}px` }}
    >
      {initials}
    </div>
  );
}

/** Add/remove string list editor used across config sections */
function ListEditor({ items, onChange, placeholder, addLabel }: {
  items: string[]; onChange: (next: string[]) => void; placeholder: string; addLabel: string;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (!v || items.includes(v)) { setDraft(""); return; }
    onChange([...items, v]);
    setDraft("");
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <span key={item} className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-secondary border border-border text-xs font-medium">
            {item}
            <button
              type="button" aria-label={`Remove ${item}`}
              onClick={() => onChange(items.filter((i) => i !== item))}
              className="text-muted-foreground hover:text-destructive transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        {items.length === 0 && <span className="text-xs text-muted-foreground py-1">No items yet.</span>}
      </div>
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder={placeholder}
          className="h-8 bg-secondary/40 text-xs"
        />
        <Button type="button" variant="outline" size="sm" className="h-8 shrink-0" onClick={add}>
          <Plus className="w-3.5 h-3.5 mr-1" /> {addLabel}
        </Button>
      </div>
    </div>
  );
}

function SaveBar({ dirty, onSave, saving, onReset }: { dirty: boolean; onSave: () => void; saving: boolean; onReset?: () => void }) {
  return (
    <div className={cn("flex items-center justify-end gap-2 pt-3 border-t border-border/60 transition-opacity", dirty ? "opacity-100" : "opacity-50 pointer-events-none")}>
      {dirty && (
        <span className="text-xs text-amber-300 flex items-center gap-1.5 mr-auto">
          <AlertTriangle className="w-3.5 h-3.5" /> Unsaved changes
        </span>
      )}
      {onReset && dirty && (
        <Button variant="ghost" size="sm" onClick={onReset}><RotateCcw className="w-3.5 h-3.5 mr-1.5" /> Discard</Button>
      )}
      <Button size="sm" onClick={onSave} disabled={!dirty || saving} className="bg-primary text-primary-foreground hover:bg-primary/90">
        {saving ? <RotateCcw className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1.5" />}
        {saving ? "Saving…" : "Save changes"}
      </Button>
    </div>
  );
}

// ==================== Organization tab ====================

type OrgSettings = {
  name: string; productName: string; tagline: string; email: string;
  phone: string; address: string; currency: string; timezone: string; services: string[];
};

const ORG_DEFAULT: OrgSettings = {
  name: "", productName: "", tagline: "", email: "", phone: "", address: "", currency: "EGP", timezone: "Africa/Cairo", services: [],
};

function OrganizationTab({ settings, onSaved }: { settings: Record<string, unknown>; onSaved: (key: string, value: unknown) => void }) {
  const { toast } = useToast();
  const original = useMemo<OrgSettings>(() => {
    const o = (settings.organization || {}) as Partial<OrgSettings>;
    return { ...ORG_DEFAULT, ...o, services: Array.isArray(o.services) ? o.services : [] };
  }, [settings]);
  const [form, setForm] = useState<OrgSettings>(original);
  const [saving, setSaving] = useState(false);
  useEffect(() => setForm(original), [original]);
  const dirty = JSON.stringify(form) !== JSON.stringify(original);
  const set = (k: keyof OrgSettings, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      await api.put("/api/settings", { key: "organization", value: form });
      onSaved("organization", form);
      toast({ title: "Organization profile saved" });
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Save failed", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="apex-panel p-5">
        <div className="flex items-center gap-2 mb-4">
          <Building2 className="w-4 h-4 text-primary" />
          <h3 className="font-medium text-sm">Organization profile</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Company name" required><Input value={form.name} onChange={(e) => set("name", e.target.value)} className="bg-secondary/40" /></Field>
          <Field label="Product name"><Input value={form.productName} onChange={(e) => set("productName", e.target.value)} className="bg-secondary/40" /></Field>
          <Field label="Tagline" hint="Shown on proposals and documents"><Input value={form.tagline} onChange={(e) => set("tagline", e.target.value)} className="bg-secondary/40" /></Field>
          <Field label="Public email"><Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} className="bg-secondary/40" /></Field>
          <Field label="Phone"><Input value={form.phone} onChange={(e) => set("phone", e.target.value)} className="bg-secondary/40" /></Field>
          <Field label="Currency" hint="Default for invoices, quotations, budgets"><Input value={form.currency} onChange={(e) => set("currency", e.target.value.toUpperCase())} maxLength={3} className="bg-secondary/40 w-24" /></Field>
          <Field label="Timezone"><Input value={form.timezone} onChange={(e) => set("timezone", e.target.value)} className="bg-secondary/40" /></Field>
          <div className="sm:col-span-2">
            <Field label="Address"><Textarea rows={2} value={form.address} onChange={(e) => set("address", e.target.value)} className="bg-secondary/40" /></Field>
          </div>
        </div>
      </div>

      <div className="apex-panel p-5">
        <h3 className="font-medium text-sm mb-1">Services offered</h3>
        <p className="text-xs text-muted-foreground mb-3">Used when creating leads and projects to classify work.</p>
        <ListEditor items={form.services} onChange={(services) => setForm((f) => ({ ...f, services }))} placeholder="e.g. E-commerce" addLabel="Add" />
      </div>

      <SaveBar dirty={dirty} onSave={save} saving={saving} onReset={() => setForm(original)} />
    </div>
  );
}

// ==================== Team tab ====================

function TeamTab() {
  const { data: session } = useSession();
  const { toast } = useToast();
  const meId = session?.user?.id;
  const [users, setUsers] = useState<UserRow[]>([]);
  const [roleList, setRoleList] = useState<RoleRef[]>([]);
  const [colors, setColors] = useState<string[]>(["#22d3ee"]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [q, setQ] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<UserRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(false);
    try {
      const data = await api.get<{ users: UserRow[]; roles: RoleRef[]; avatarColors: string[] }>("/api/users");
      setUsers(data.users); setRoleList(data.roles); setColors(data.avatarColors);
    } catch { setError(true); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load, reloadKey]);

  const filtered = users.filter((u) =>
    !q || u.name.toLowerCase().includes(q.toLowerCase()) || u.email.toLowerCase().includes(q.toLowerCase())
  );

  const doDeactivate = async (u: UserRow) => {
    try {
      await api.patch(`/api/users/${u.id}`, { isActive: !u.isActive });
      toast({ title: u.isActive ? `${u.name} deactivated` : `${u.name} reactivated` });
      setReloadKey((k) => k + 1);
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Update failed", variant: "destructive" });
    }
  };

  if (loading) return <ListSkeleton rows={5} />;
  if (error) return <ErrorState onRetry={() => setReloadKey((k) => k + 1)} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search team members…" className="sm:max-w-xs bg-secondary/40" />
        <div className="flex gap-2 sm:ml-auto">
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground px-3 py-2 rounded-md bg-secondary/40 border border-border">
            <Users className="w-3.5 h-3.5" /> {users.filter((u) => u.isActive).length} active · {users.filter((u) => !u.isActive).length} deactivated
          </span>
          <Button onClick={() => setCreateOpen(true)} className="bg-primary text-primary-foreground hover:bg-primary/90">
            <UserPlus className="w-4 h-4 mr-2" /> New member
          </Button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={<Users className="w-5 h-5" />} title="No members found" description="Try a different search, or invite a new team member." />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {filtered.map((u) => (
            <div key={u.id} className={cn("apex-panel p-4 flex items-start gap-3", !u.isActive && "opacity-60")}>
              <Avatar name={u.name} color={u.avatarColor} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-medium text-sm truncate">{u.name}</p>
                  {u.id === meId && <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/30 font-medium">YOU</span>}
                  {!u.isActive && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-500/10 text-slate-400 border border-slate-500/30 font-medium">DEACTIVATED</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate">{u.email}{u.title ? ` · ${u.title}` : ""}</p>
                <div className="flex items-center gap-1.5 flex-wrap mt-2">
                  {u.roles.map((r) => (
                    <span key={r.key} className="text-[10px] px-1.5 py-0.5 rounded bg-secondary border border-border font-medium">{r.label}</span>
                  ))}
                  {u.customPermissions && <span className="text-[10px] text-amber-300/80">+ custom permissions</span>}
                </div>
                <p className="text-[11px] text-muted-foreground mt-2">
                  Last login {relativeTime(u.lastLoginAt)} · joined {formatDate(u.createdAt)}
                </p>
              </div>
              <div className="flex flex-col gap-1.5 shrink-0">
                <Button variant="outline" size="sm" onClick={() => setEditUser(u)}>
                  <Pencil className="w-3.5 h-3.5 mr-1.5" /> Edit
                </Button>
                {u.id !== meId && (
                  <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => doDeactivate(u)}>
                    {u.isActive ? "Deactivate" : "Reactivate"}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <CreateUserDialog open={createOpen} onOpenChange={setCreateOpen} roles={roleList} colors={colors} onCreated={() => setReloadKey((k) => k + 1)} />
      {editUser && (
        <EditUserDialog
          user={editUser} roles={roleList} colors={colors} meId={meId}
          onClose={() => setEditUser(null)}
          onSaved={() => { setEditUser(null); setReloadKey((k) => k + 1); }}
        />
      )}
    </div>
  );
}

function RolesPicker({ roles, selected, onChange, disabledKeys }: {
  roles: RoleRef[]; selected: string[]; onChange: (keys: string[]) => void; disabledKeys?: string[];
}) {
  return (
    <div className="space-y-2">
      {roles.map((r) => {
        const checked = selected.includes(r.key);
        const disabled = disabledKeys?.includes(r.key);
        return (
          <label key={r.key} className={cn(
            "flex items-center gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-colors",
            checked ? "border-primary/50 bg-primary/5" : "border-border bg-secondary/30 hover:border-primary/30",
            disabled && "opacity-60 cursor-not-allowed"
          )}>
            <Checkbox checked={checked} disabled={disabled} onCheckedChange={(v) => {
              if (disabled) return;
              onChange(v ? [...selected, r.key] : selected.filter((k) => k !== r.key));
            }} />
            <div className="min-w-0">
              <p className="text-sm font-medium leading-tight">{r.label}</p>
              <p className="text-[11px] text-muted-foreground">{r.key}</p>
            </div>
          </label>
        );
      })}
    </div>
  );
}

function CreateUserDialog({ open, onOpenChange, roles, colors, onCreated }: {
  open: boolean; onOpenChange: (v: boolean) => void; roles: RoleRef[]; colors: string[]; onCreated: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState({ name: "", email: "", title: "", password: "", roleKeys: [] as string[], avatarColor: colors[0] || "#22d3ee" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setForm({ name: "", email: "", title: "", password: "", roleKeys: [], avatarColor: colors[0] || "#22d3ee" });
  }, [open, colors]);

  const submit = async () => {
    setSaving(true);
    try {
      await api.post("/api/users", form);
      toast({ title: "Team member created", description: `${form.name} can now sign in.` });
      onOpenChange(false); onCreated();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Create failed", variant: "destructive" });
    } finally { setSaving(false); }
  };

  const valid = form.name.trim().length >= 2 && /.+@.+\..+/.test(form.email) && form.password.length >= 8 && form.roleKeys.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><UserPlus className="w-4 h-4 text-primary" /> New team member</DialogTitle>
          <DialogDescription>Create an account and assign at least one role.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Full name" required><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="bg-secondary/40" /></Field>
          <Field label="Job title"><Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Backend Developer" className="bg-secondary/40" /></Field>
          <Field label="Email" required><Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} className="bg-secondary/40" /></Field>
          <Field label="Temporary password" required hint="Minimum 8 characters — share it securely."><Input type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} className="bg-secondary/40" /></Field>
        </div>
        <Field label="Avatar color">
          <div className="flex gap-2">
            {colors.map((c) => (
              <button key={c} type="button" aria-label={`Color ${c}`} onClick={() => setForm((f) => ({ ...f, avatarColor: c }))}
                className={cn("w-7 h-7 rounded-full border-2 transition-transform", form.avatarColor === c ? "border-foreground scale-110" : "border-transparent")}>
                <span className="block w-full h-full rounded-full" style={{ backgroundColor: c }} />
              </button>
            ))}
          </div>
        </Field>
        <Field label="Roles" required>
          <RolesPicker roles={roles} selected={form.roleKeys} onChange={(roleKeys) => setForm((f) => ({ ...f, roleKeys }))} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!valid || saving} className="bg-primary text-primary-foreground hover:bg-primary/90">
            {saving ? "Creating…" : "Create member"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EditUserDialog({ user, roles, colors, meId, onClose, onSaved }: {
  user: UserRow; roles: RoleRef[]; colors: string[]; meId?: string; onClose: () => void; onSaved: () => void;
}) {
  const { toast } = useToast();
  const isSelf = user.id === meId;
  const [form, setForm] = useState({
    name: user.name, title: user.title || "", avatarColor: user.avatarColor,
    roleKeys: user.roles.map((r) => r.key), isActive: user.isActive, newPassword: "",
  });
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      await api.patch(`/api/users/${user.id}`, {
        name: form.name,
        title: form.title,
        avatarColor: form.avatarColor,
        ...(isSelf ? {} : { roleKeys: form.roleKeys, isActive: form.isActive }),
        ...(form.newPassword ? { newPassword: form.newPassword } : {}),
      });
      toast({ title: "Member updated" });
      onSaved();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Update failed", variant: "destructive" });
    } finally { setSaving(false); }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Pencil className="w-4 h-4 text-primary" /> Edit {user.name}</DialogTitle>
          <DialogDescription>
            {isSelf
              ? "You can update your profile. Role and status changes require another Super Admin."
              : "Changes take effect after the member signs out and back in."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Full name" required><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="bg-secondary/40" /></Field>
          <Field label="Job title"><Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} className="bg-secondary/40" /></Field>
        </div>
        <Field label="Avatar color">
          <div className="flex gap-2">
            {colors.map((c) => (
              <button key={c} type="button" aria-label={`Color ${c}`} onClick={() => setForm((f) => ({ ...f, avatarColor: c }))}
                className={cn("w-7 h-7 rounded-full border-2 transition-transform", form.avatarColor === c ? "border-foreground scale-110" : "border-transparent")}>
                <span className="block w-full h-full rounded-full" style={{ backgroundColor: c }} />
              </button>
            ))}
          </div>
        </Field>
        <Field label="Roles" hint={isSelf ? "You cannot change your own roles." : undefined}>
          <RolesPicker
            roles={roles} selected={form.roleKeys}
            onChange={(roleKeys) => setForm((f) => ({ ...f, roleKeys }))}
            disabledKeys={isSelf ? roles.map((r) => r.key) : undefined}
          />
        </Field>
        {!isSelf && (
          <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-secondary/30">
            <div>
              <p className="text-sm font-medium">Account active</p>
              <p className="text-[11px] text-muted-foreground">Deactivated members cannot sign in.</p>
            </div>
            <Switch checked={form.isActive} onCheckedChange={(isActive) => setForm((f) => ({ ...f, isActive }))} />
          </div>
        )}
        <Field label="Reset password" hint={isSelf ? "Use the sign-in screen to reset your own password." : "Leave empty to keep the current password."}>
          <div className="relative">
            <KeyRound className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="password" value={form.newPassword} disabled={isSelf}
              onChange={(e) => setForm((f) => ({ ...f, newPassword: e.target.value }))}
              placeholder={isSelf ? "Not available for your own account" : "New password (min 8 chars)"}
              className="pl-9 bg-secondary/40"
            />
          </div>
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving || form.name.trim().length < 2} className="bg-primary text-primary-foreground hover:bg-primary/90">
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ==================== Roles tab ====================

type RoleDetail = RoleRef & { description: string | null; userCount: number; permissions: string[] };

function RolesTab() {
  const { toast } = useToast();
  const [roles, setRoles] = useState<RoleDetail[]>([]);
  const [allPermissions, setAllPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [editRole, setEditRole] = useState<RoleDetail | null>(null);
  const [deleteRole, setDeleteRole] = useState<RoleDetail | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(false);
    try {
      const data = await api.get<{ roles: RoleDetail[]; allPermissions: string[] }>("/api/roles");
      setRoles(data.roles); setAllPermissions(data.allPermissions);
    } catch { setError(true); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load, reloadKey]);

  const doDelete = async () => {
    if (!deleteRole) return;
    try {
      await api.delete(`/api/roles/${deleteRole.id}`);
      toast({ title: "Role deleted" });
      setDeleteRole(null); setReloadKey((k) => k + 1);
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Delete failed", variant: "destructive" });
    }
  };

  if (loading) return <ListSkeleton rows={5} />;
  if (error) return <ErrorState onRetry={() => setReloadKey((k) => k + 1)} />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Roles group permissions. Members inherit every permission of their roles.
        </p>
        <Button onClick={() => setCreateOpen(true)} className="bg-primary text-primary-foreground hover:bg-primary/90">
          <Plus className="w-4 h-4 mr-2" /> New role
        </Button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {roles.map((r) => (
          <div key={r.id} className="apex-panel p-4 flex flex-col">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <p className="font-medium text-sm truncate">{r.label}</p>
                  {r.isSystem && (
                    <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-slate-500/10 text-slate-400 border border-slate-500/30 font-medium">
                      <Lock className="w-2.5 h-2.5" /> SYSTEM
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground truncate">{r.key}{r.description ? ` · ${r.description}` : ""}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5 text-primary" /> {r.permissions.length} permissions</span>
              <span className="inline-flex items-center gap-1"><Users className="w-3.5 h-3.5" /> {r.userCount} member{r.userCount === 1 ? "" : "s"}</span>
            </div>
            <div className="flex gap-2 mt-3 pt-3 border-t border-border/60">
              <Button variant="outline" size="sm" className="flex-1" onClick={() => setEditRole(r)}>
                <Pencil className="w-3.5 h-3.5 mr-1.5" /> Edit
              </Button>
              {!r.isSystem && (
                <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDeleteRole(r)}>
                  <X className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      <CreateRoleDialog open={createOpen} onOpenChange={setCreateOpen} allPermissions={allPermissions} onCreated={() => setReloadKey((k) => k + 1)} />
      {editRole && (
        <EditRoleDialog role={editRole} allPermissions={allPermissions} onClose={() => setEditRole(null)} onSaved={() => { setEditRole(null); setReloadKey((k) => k + 1); }} />
      )}
      <AlertDialog open={!!deleteRole} onOpenChange={(v) => !v && setDeleteRole(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete role “{deleteRole?.label}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This custom role will be removed permanently. Roles assigned to members cannot be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={doDelete}>Delete role</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Permission matrix grouped by module with select-all-per-module */
function PermissionMatrix({ allPermissions, selected, onChange }: {
  allPermissions: string[]; selected: string[]; onChange: (perms: string[]) => void;
}) {
  const modules = useMemo(() => {
    const map = new Map<string, string[]>();
    allPermissions.forEach((p) => {
      const mod = p.split(".")[0];
      if (!map.has(mod)) map.set(mod, []);
      map.get(mod)!.push(p);
    });
    return [...map.entries()];
  }, [allPermissions]);

  return (
    <div className="space-y-3">
      {modules.map(([mod, perms]) => {
        const allSelected = perms.every((p) => selected.includes(p));
        return (
          <div key={mod} className="rounded-lg border border-border overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 bg-secondary/40 border-b border-border">
              <p className="text-xs font-semibold">{MODULE_LABELS[mod] || mod}</p>
              <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer hover:text-foreground">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={(v) =>
                    onChange(v
                      ? [...new Set([...selected, ...perms])]
                      : selected.filter((p) => !perms.includes(p)))
                  }
                />
                All
              </label>
            </div>
            <div className="p-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1">
              {perms.map((p) => (
                <label key={p} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-secondary/40 cursor-pointer text-xs">
                  <Checkbox
                    checked={selected.includes(p)}
                    onCheckedChange={(v) => onChange(v ? [...selected, p] : selected.filter((x) => x !== p))}
                  />
                  <span className="font-medium">{actionLabel(p)}</span>
                  <span className="text-[10px] text-muted-foreground truncate">{p}</span>
                </label>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CreateRoleDialog({ open, onOpenChange, allPermissions, onCreated }: {
  open: boolean; onOpenChange: (v: boolean) => void; allPermissions: string[]; onCreated: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState({ key: "", label: "", description: "", permissions: [] as string[] });
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setForm({ key: "", label: "", description: "", permissions: [] }); }, [open]);

  const submit = async () => {
    setSaving(true);
    try {
      await api.post("/api/roles", form);
      toast({ title: "Role created" });
      onOpenChange(false); onCreated();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Create failed", variant: "destructive" });
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-primary" /> New custom role</DialogTitle>
          <DialogDescription>Define a key, a label and pick the permissions this role grants.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Key" required hint="UPPER_SNAKE_CASE, e.g. CONTENT_LEAD"><Input value={form.key} onChange={(e) => setForm((f) => ({ ...f, key: e.target.value.toUpperCase() }))} className="bg-secondary/40" /></Field>
          <Field label="Label" required><Input value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} placeholder="e.g. Content Lead" className="bg-secondary/40" /></Field>
          <div className="sm:col-span-2">
            <Field label="Description"><Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} className="bg-secondary/40" /></Field>
          </div>
        </div>
        <Field label={`Permissions (${form.permissions.length} selected)`} required>
          <ScrollArea className="h-64 rounded-lg border border-border">
            <div className="p-2">
              <PermissionMatrix allPermissions={allPermissions} selected={form.permissions} onChange={(permissions) => setForm((f) => ({ ...f, permissions }))} />
            </div>
          </ScrollArea>
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={saving || form.key.length < 3 || form.label.trim().length < 2 || form.permissions.length === 0} className="bg-primary text-primary-foreground hover:bg-primary/90">
            {saving ? "Creating…" : "Create role"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EditRoleDialog({ role, allPermissions, onClose, onSaved }: {
  role: RoleDetail; allPermissions: string[]; onClose: () => void; onSaved: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState({ label: role.label, description: role.description || "", permissions: role.permissions });
  const [saving, setSaving] = useState(false);
  const changed = form.label !== role.label || form.description !== (role.description || "") ||
    form.permissions.length !== role.permissions.length || form.permissions.some((p) => !role.permissions.includes(p));

  const submit = async () => {
    setSaving(true);
    try {
      await api.patch(`/api/roles/${role.id}`, { label: form.label, description: form.description, permissions: form.permissions });
      toast({ title: "Role updated", description: "Affected members should sign out and back in." });
      onSaved();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Update failed", variant: "destructive" });
    } finally { setSaving(false); }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-primary" /> Edit role — {role.label}
            {role.isSystem && <Lock className="w-3.5 h-3.5 text-slate-400" />}
          </DialogTitle>
          <DialogDescription>
            {role.userCount > 0 ? `${role.userCount} member(s) hold this role. ` : ""}Permission changes are audited.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Label" required><Input value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} className="bg-secondary/40" /></Field>
          <Field label="Description"><Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} className="bg-secondary/40" /></Field>
        </div>
        <Field label={`Permissions (${form.permissions.length} selected)`} required>
          <ScrollArea className="h-64 rounded-lg border border-border">
            <div className="p-2">
              <PermissionMatrix allPermissions={allPermissions} selected={form.permissions} onChange={(permissions) => setForm((f) => ({ ...f, permissions }))} />
            </div>
          </ScrollArea>
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving || !changed} className="bg-primary text-primary-foreground hover:bg-primary/90">
            {saving ? "Saving…" : "Save role"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ==================== Workspace Config tab ====================

type ProjectType = { key: string; label: string; phases: string[] };

function ConfigTab({ settings, onSaved }: { settings: Record<string, unknown>; onSaved: (key: string, value: unknown) => void }) {
  const { toast } = useToast();
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [finance, setFinance] = useState({
    currency: "EGP", invoicePrefix: "APX-INV", taxPercentDefault: 0,
    paymentMethods: [] as string[], expenseCategories: [] as string[],
  });
  const [crm, setCrm] = useState({ leadSources: [] as string[] });
  const [projectTypes, setProjectTypes] = useState<ProjectType[]>([]);
  const [checklists, setChecklists] = useState({ onboarding: [] as string[], completion: [] as string[] });
  const [editingType, setEditingType] = useState<ProjectType | null>(null);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (initialized || Object.keys(settings).length === 0) return;
    const f = (settings.finance || {}) as Partial<typeof finance>;
    setFinance({ currency: f.currency || "EGP", invoicePrefix: f.invoicePrefix || "APX-INV", taxPercentDefault: Number(f.taxPercentDefault ?? 0), paymentMethods: f.paymentMethods || [], expenseCategories: f.expenseCategories || [] });
    const c = (settings.crm || {}) as Partial<{ leadSources: string[] }>;
    setCrm({ leadSources: c.leadSources || [] });
    const p = (settings.projects || {}) as Partial<{ types: ProjectType[] }>;
    setProjectTypes(p.types || []);
    setChecklists({
      onboarding: (settings.onboardingChecklist as string[]) || [],
      completion: (settings.completionChecklist as string[]) || [],
    });
    setInitialized(true);
  }, [settings, initialized]);

  const save = async (key: string, value: unknown) => {
    setSavingKey(key);
    try {
      await api.put("/api/settings", { key, value });
      onSaved(key, value);
      toast({ title: "Configuration saved" });
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Save failed", variant: "destructive" });
    } finally { setSavingKey(null); }
  };

  const financeOriginal = {
    currency: ((settings.finance || {}) as { currency?: string }).currency || "EGP",
    invoicePrefix: ((settings.finance || {}) as { invoicePrefix?: string }).invoicePrefix || "APX-INV",
    taxPercentDefault: Number(((settings.finance || {}) as { taxPercentDefault?: number }).taxPercentDefault ?? 0),
    paymentMethods: ((settings.finance || {}) as { paymentMethods?: string[] }).paymentMethods || [],
    expenseCategories: ((settings.finance || {}) as { expenseCategories?: string[] }).expenseCategories || [],
  };
  const financeDirty = JSON.stringify(finance) !== JSON.stringify(financeOriginal);

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Finance */}
      <div className="apex-panel p-5">
        <div className="flex items-center gap-2 mb-4">
          <SlidersHorizontal className="w-4 h-4 text-primary" />
          <h3 className="font-medium text-sm">Finance defaults</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Currency"><Input value={finance.currency} maxLength={3} onChange={(e) => setFinance((f) => ({ ...f, currency: e.target.value.toUpperCase() }))} className="bg-secondary/40" /></Field>
          <Field label="Invoice prefix" hint="Numbering: APX-INV-2026-0001"><Input value={finance.invoicePrefix} onChange={(e) => setFinance((f) => ({ ...f, invoicePrefix: e.target.value.toUpperCase() }))} className="bg-secondary/40" /></Field>
          <Field label="Default tax %"><Input type="number" min={0} max={100} value={finance.taxPercentDefault} onChange={(e) => setFinance((f) => ({ ...f, taxPercentDefault: Number(e.target.value) }))} className="bg-secondary/40" /></Field>
        </div>
        <div className="mt-4 space-y-4">
          <Field label="Payment methods"><ListEditor items={finance.paymentMethods} onChange={(paymentMethods) => setFinance((f) => ({ ...f, paymentMethods }))} placeholder="e.g. ETISALAT_CASH" addLabel="Add" /></Field>
          <Field label="Expense categories"><ListEditor items={finance.expenseCategories} onChange={(expenseCategories) => setFinance((f) => ({ ...f, expenseCategories }))} placeholder="e.g. OFFICE" addLabel="Add" /></Field>
        </div>
        <SaveBar dirty={financeDirty} saving={savingKey === "finance"} onSave={() => save("finance", finance)} onReset={() => setFinance(financeOriginal)} />
      </div>

      {/* CRM */}
      <div className="apex-panel p-5">
        <h3 className="font-medium text-sm mb-1">CRM sources</h3>
        <p className="text-xs text-muted-foreground mb-3">Where leads come from — selectable in the lead form.</p>
        <ListEditor items={crm.leadSources} onChange={(leadSources) => setCrm({ leadSources })} placeholder="e.g. REFERRAL" addLabel="Add" />
        <SaveBar
          dirty={JSON.stringify(crm.leadSources) !== JSON.stringify(((settings.crm || {}) as { leadSources?: string[] }).leadSources || [])}
          saving={savingKey === "crm"}
          onSave={() => save("crm", { ...((settings.crm || {}) as object), leadSources: crm.leadSources })}
          onReset={() => setCrm({ leadSources: ((settings.crm || {}) as { leadSources?: string[] }).leadSources || [] })}
        />
      </div>

      {/* Project types */}
      <div className="apex-panel p-5">
        <h3 className="font-medium text-sm mb-1">Project types & phase templates</h3>
        <p className="text-xs text-muted-foreground mb-3">New projects generate their phases from the template of the chosen type.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {projectTypes.map((t) => (
            <div key={t.key} className="rounded-lg border border-border bg-secondary/30 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium truncate">{t.label}</p>
                <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setEditingType(t)}>
                  <Pencil className="w-3 h-3 mr-1" /> Phases
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5">{t.key} · {t.phases.length} phases</p>
              <div className="flex flex-wrap gap-1 mt-2">
                {t.phases.map((ph, i) => (
                  <span key={`${ph}-${i}`} className="text-[10px] px-1.5 py-0.5 rounded bg-secondary border border-border text-muted-foreground">
                    {i + 1}. {ph}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Checklists */}
      <div className="apex-panel p-5 space-y-5">
        <div>
          <h3 className="font-medium text-sm mb-1">Project onboarding checklist</h3>
          <p className="text-xs text-muted-foreground mb-3">Applied to every new client project (§63).</p>
          <ListEditor items={checklists.onboarding} onChange={(onboarding) => setChecklists((c) => ({ ...c, onboarding }))} placeholder="Add onboarding step…" addLabel="Add" />
        </div>
        <div>
          <h3 className="font-medium text-sm mb-1">Project completion checklist</h3>
          <p className="text-xs text-muted-foreground mb-3">Verified before a project is marked Completed.</p>
          <ListEditor items={checklists.completion} onChange={(completion) => setChecklists((c) => ({ ...c, completion }))} placeholder="Add completion step…" addLabel="Add" />
        </div>
        <SaveBar
          dirty={
            JSON.stringify(checklists.onboarding) !== JSON.stringify((settings.onboardingChecklist as string[]) || []) ||
            JSON.stringify(checklists.completion) !== JSON.stringify((settings.completionChecklist as string[]) || [])
          }
          saving={savingKey === "checklists"}
          onSave={async () => { await save("onboardingChecklist", checklists.onboarding); await save("completionChecklist", checklists.completion); }}
          onReset={() => setChecklists({
            onboarding: (settings.onboardingChecklist as string[]) || [],
            completion: (settings.completionChecklist as string[]) || [],
          })}
        />
      </div>

      {editingType && (
        <EditProjectTypeDialog
          projectType={editingType} allTypes={projectTypes}
          onClose={() => setEditingType(null)}
          onSaved={(types) => { setEditingType(null); save("projects", { ...((settings.projects || {}) as object), types }); }}
        />
      )}
    </div>
  );
}

function EditProjectTypeDialog({ projectType, allTypes, onClose, onSaved }: {
  projectType: ProjectType; allTypes: ProjectType[]; onClose: () => void; onSaved: (types: ProjectType[]) => void;
}) {
  const { toast } = useToast();
  const [phases, setPhases] = useState<string[]>(projectType.phases);
  const [draft, setDraft] = useState("");

  const add = () => {
    const v = draft.trim();
    if (!v) return;
    setPhases((p) => [...p, v]); setDraft("");
  };
  const move = (i: number, dir: -1 | 1) => {
    setPhases((p) => {
      const next = [...p];
      const j = i + dir;
      if (j < 0 || j >= next.length) return p;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Phase template — {projectType.label}</DialogTitle>
          <DialogDescription>Order matters: new projects get phases in this sequence.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          {phases.map((ph, i) => (
            <div key={`${ph}-${i}`} className="flex items-center gap-2 p-2 rounded-lg border border-border bg-secondary/30">
              <span className="w-5 h-5 rounded bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center shrink-0">{i + 1}</span>
              <Input
                value={ph} className="h-8 bg-transparent border-0 focus-visible:ring-0 px-1 text-sm"
                onChange={(e) => setPhases((p) => p.map((x, j) => (j === i ? e.target.value : x)))}
              />
              <div className="flex flex-col">
                <button type="button" aria-label="Move up" onClick={() => move(i, -1)} className="text-muted-foreground hover:text-foreground leading-none text-[9px]">▲</button>
                <button type="button" aria-label="Move down" onClick={() => move(i, 1)} className="text-muted-foreground hover:text-foreground leading-none text-[9px]">▼</button>
              </div>
              <button type="button" aria-label="Remove phase" onClick={() => setPhases((p) => p.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          {phases.length === 0 && <p className="text-xs text-muted-foreground py-2">No phases — add at least one.</p>}
        </div>
        <div className="flex gap-2">
          <Input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} placeholder="Add phase…" className="bg-secondary/40" />
          <Button variant="outline" size="sm" onClick={add}><Plus className="w-3.5 h-3.5 mr-1" /> Add</Button>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={phases.length === 0 || phases.some((p) => !p.trim())}
            onClick={() => {
              const next = allTypes.map((t) => (t.key === projectType.key ? { ...t, phases: phases.map((p) => p.trim()) } : t));
              if (!next.some((t) => t.key === projectType.key)) return;
              onSaved(next);
              toast({ title: "Phase template updated" });
            }}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            Save template
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ==================== Email tab ====================

function EmailTab() {
  const { toast } = useToast();
  const { data: session } = useSession();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [to, setTo] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ configured: boolean }>("/api/mail/test");
      setConfigured(r.configured);
    } catch { setConfigured(false); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Derived default recipient — no effect needed, the field starts empty and
  // falls back to the signed-in account on the server when left blank.
  const recipient = to.trim() || session?.user?.email || "";

  const send = async () => {
    setSending(true);
    try {
      const r = await api.post<{ sent: boolean; to: string }>("/api/mail/test", { to: to.trim() || undefined });      toast({ title: "Test email sent", description: `Delivered to ${r.to}` });
    } catch (e) {
      toast({ title: "Send failed", description: e instanceof Error ? e.message : "Check your SMTP settings", variant: "destructive" });
    } finally { setSending(false); }
  };

  return (
    <div className="space-y-4">
      <div className="apex-panel p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="font-semibold mb-1">Outbound email (SMTP)</h2>
            <p className="text-sm text-muted-foreground max-w-xl">
              APEX sends real emails to clients for invoices, payment receipts, proposals, contracts and
              ticket confirmations. SMTP credentials live in the server environment (<code className="text-xs">.env</code>) and are never exposed to the browser.
            </p>
          </div>
          {loading ? (
            <Skeleton className="h-6 w-24" />
          ) : (
            <span className={cn(
              "text-[11px] font-bold px-2.5 py-1 rounded-md whitespace-nowrap",
              configured ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"
            )}>
              {configured ? "CONFIGURED" : "NOT CONFIGURED"}
            </span>
          )}
        </div>

        {!configured && !loading && (
          <div className="mt-4 rounded-lg border border-amber-500/25 bg-amber-500/8 p-4">
            <p className="text-sm font-semibold text-amber-300 mb-2">Add these to your <code className="text-xs">.env</code> to enable sending</p>
            <pre className="text-[11px] leading-relaxed text-muted-foreground overflow-x-auto">{`SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=resend
SMTP_PASS=re_your_api_key
MAIL_FROM="APEX <invoices@yourdomain.com>"
MAIL_FROM_NAME="APEX SYSTEM"
APP_URL=https://yourdomain.com`}</pre>
            <p className="text-[11px] text-muted-foreground mt-2">
              Works with Resend, SendGrid, Mailgun, Gmail or your Supabase SMTP relay. Restart the dev server after editing.
            </p>
          </div>
        )}

        <div className="flex items-end gap-2 mt-5">
          <div className="flex-1">
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Send a test to</label>
            <Input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder={session?.user?.email || "you@example.com"}
              type="email"
            />
          </div>
          <Button onClick={send} disabled={sending || !configured || !recipient}>
            {sending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
            Send test
          </Button>
        </div>
      </div>

      <div className="apex-panel p-5">
        <h2 className="font-semibold mb-3">What APEX sends automatically</h2>
        <ul className="space-y-2.5 text-sm">
          {[
            ["Invoice sent", "The full invoice with items, totals, payment terms and a portal link."],
            ["Payment received", "A receipt confirming the amount, method and invoice it was applied to."],
            ["Ticket created", "A confirmation to the client plus a ticket reference number."],
            ["Proposal sent", "The proposal summary, total investment and validity date."],
            ["Contract issued", "Contract number, status and term dates."],
            ["New team member", "A welcome email with the temporary password."],
            ["Automations", "Any rule using the “Email a role” action can reach a whole team by email."],
          ].map(([label, desc]) => (
            <li key={label} className="flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <span><span className="font-medium">{label}.</span> <span className="text-muted-foreground">{desc}</span></span>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-muted-foreground mt-4 pt-3 border-t border-border/60">
          Emails are fire-and-forget: a delivery failure never blocks or rolls back the business action that triggered it.
        </p>
      </div>
    </div>
  );
}

// ==================== Main Settings view ====================

export function SettingsView() {
  const { data: session } = useSession();
  const perms = session?.user?.permissions || [];
  const can = (p: string) => perms.includes(p);

  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(async () => {
    setLoading(true); setError(false);
    try {
      const data = await api.get<{ settings: Record<string, unknown> }>("/api/settings");
      setSettings(data.settings);
    } catch { setError(true); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load, reloadKey]);

  const onSaved = (key: string, value: unknown) => setSettings((s) => ({ ...s, [key]: value }));

  const tabs: { key: string; label: string; icon: typeof Building2; show: boolean }[] = [
    { key: "organization", label: "Organization", icon: Building2, show: can("settings.manage") },
    { key: "team", label: "Team", icon: Users, show: can("team.manage") },
    { key: "roles", label: "Roles & Permissions", icon: ShieldCheck, show: can("permissions.manage") },
    { key: "config", label: "Workspace Config", icon: SlidersHorizontal, show: can("settings.manage") },
    { key: "email", label: "Email", icon: Mail, show: can("settings.manage") },
  ];
  const visible = tabs.filter((t) => t.show);
  const firstAvailable = visible[0]?.key;

  if (loading && !error) {
    return (
      <div>
        <PageHeader title="Settings" description="Organization, team, roles and module configuration." />
        <ListSkeleton rows={6} />
      </div>
    );
  }
  if (error) {
    return (
      <div>
        <PageHeader title="Settings" description="Organization, team, roles and module configuration." />
        <ErrorState onRetry={() => setReloadKey((k) => k + 1)} />
      </div>
    );
  }
  if (visible.length === 0) {
    return (
      <div>
        <PageHeader title="Settings" description="Organization, team, roles and module configuration." />
        <EmptyState
          icon={<Lock className="w-5 h-5" />}
          title="No settings available"
          description="Your role does not include any settings permissions. Ask a Super Admin if you need access."
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Settings" description="Organization profile, team members, roles and workspace-wide configuration." />
      <Tabs defaultValue={firstAvailable} className="space-y-5">
        <TabsList className="bg-secondary/50 border border-border h-auto flex-wrap">
          {visible.map((t) => (
            <TabsTrigger key={t.key} value={t.key} className="gap-1.5 data-[state=active]:bg-background">
              <t.icon className="w-3.5 h-3.5" /> {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {can("settings.manage") && (
          <TabsContent value="organization">
            <OrganizationTab settings={settings} onSaved={onSaved} />
          </TabsContent>
        )}
        {can("team.manage") && (
          <TabsContent value="team"><TeamTab /></TabsContent>
        )}
        {can("permissions.manage") && (
          <TabsContent value="roles"><RolesTab /></TabsContent>
        )}
        {can("settings.manage") && (
          <TabsContent value="config">
            <ConfigTab settings={settings} onSaved={onSaved} />
          </TabsContent>
        )}
        {can("settings.manage") && (
          <TabsContent value="email"><EmailTab /></TabsContent>
        )}
      </Tabs>
    </div>
  );
}
