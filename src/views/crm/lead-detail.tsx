"use client";

/**
 * Shared CRM components: lead detail drawer, lead form dialog, conversion dialog,
 * lost-reason dialog and the activity timeline. Used by Leads table, Pipeline and Clients.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  PlusCircle, Pencil, ArrowRightLeft, Phone, MessageCircle, CalendarDays, FileText,
  FolderKanban, Receipt, Wallet, LifeBuoy, StickyNote, History, UserPlus, Loader2,
  ArrowUpRight,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { StatusBadge, PriorityBadge, ErrorState, ListSkeleton, Field } from "@/components/shared";
import { api, formatCurrency, formatDate, formatDateTime, relativeTime, initials } from "@/lib/api-client";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// ============ Constants ============

export const LEAD_STATUSES = ["NEW", "CONTACTED", "QUALIFIED", "MEETING", "PROPOSAL_SENT", "NEGOTIATION", "WON", "LOST"] as const;
export const LEAD_SOURCES = ["WEBSITE", "REFERRAL", "INSTAGRAM", "FACEBOOK", "LINKEDIN", "WHATSAPP", "EMAIL", "COLD_CALL", "EVENT", "OTHER"] as const;
export const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export const PROJECT_TYPES = [
  "BUSINESS_WEBSITE", "ECOMMERCE", "WEB_APPLICATION", "CUSTOM_SOFTWARE", "CRM",
  "DASHBOARD", "EDUCATIONAL_PLATFORM", "LANDING_PAGE", "AUTOMATION_SYSTEM", "MAINTENANCE",
] as const;

export const statusLabel = (s: string) => s.replace(/_/g, " ");
export const humanLabel = (s: string) =>
  s.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

// ============ Types ============

export type TeamMember = { id: string; name: string; avatarColor: string; title?: string | null };
export type LeadAssigned = { id: string; name: string; avatarColor: string };

export type Lead = {
  id: string;
  leadNumber: string;
  companyName: string;
  contactName: string;
  phone: string;
  email: string | null;
  website: string | null;
  instagram: string | null;
  facebook: string | null;
  linkedin: string | null;
  industry: string | null;
  location: string | null;
  source: string;
  serviceInterest: string | null;
  estimatedBudget: number | null;
  priority: string;
  status: string;
  notes: string | null;
  nextFollowUpAt: string | null;
  lostReason: string | null;
  convertedClientId: string | null;
  assignedToId: string | null;
  createdAt: string;
  deletedAt?: string | null;
  assignedTo?: LeadAssigned | null;
  convertedClient?: { id: string; companyName: string; clientNumber: string } | null;
};

export type FollowUpItem = {
  id: string;
  title: string;
  leadId: string | null;
  clientId: string | null;
  assignedToId: string | null;
  dueAt: string;
  priority: string;
  notes: string | null;
  status: string;
  completedAt: string | null;
  createdAt: string;
  lead?: { id: string; companyName: string; leadNumber: string } | null;
  client?: { id: string; companyName: string; clientNumber: string } | null;
  assignedTo?: LeadAssigned | null;
};

export type ActivityItem = {
  id: string;
  type: string;
  title: string;
  description?: string | null;
  actorName: string;
  actorColor: string;
  createdAt: string;
};

type LeadDetail = Lead & {
  createdBy?: LeadAssigned | null;
  followUps: FollowUpItem[];
  meetings: { id: string; title: string; date: string; startTime: string; endTime: string; status: string }[];
  proposals: { id: string; proposalNumber: string; title: string; status: string; total: number; createdAt: string }[];
};

type LeadDetailResponse = { lead: LeadDetail; activities: ActivityItem[] };

// ============ Helpers ============

/** Date → value usable by <input type="datetime-local"> in the user's local timezone. */
export function toLocalInput(d: string | Date | null | undefined): string {
  if (!d) return "";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

export function isOverdueDate(d: string | Date | null | undefined): boolean {
  if (!d) return false;
  const t = new Date(d).getTime();
  return !Number.isNaN(t) && t < Date.now();
}

/** Fetch active team members; returns empty list when the caller lacks team.view. */
export function useTeam(): { team: TeamMember[]; hasAccess: boolean } {
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [hasAccess, setHasAccess] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get<{ team: TeamMember[] }>("/api/team")
      .then((d) => { if (!cancelled) { setTeam(d.team); setHasAccess(true); } })
      .catch(() => { if (!cancelled) { setTeam([]); setHasAccess(false); } });
    return () => { cancelled = true; };
  }, []);

  return { team, hasAccess };
}

export function UserAvatar({ name, color, size = 28 }: { name: string | null | undefined; color?: string; size?: number }) {
  const c = color || "#22d3ee";
  return (
    <span
      className="inline-flex items-center justify-center rounded-full font-bold border shrink-0"
      style={{
        width: size, height: size, fontSize: size * 0.36,
        backgroundColor: `${c}22`, color: c, borderColor: `${c}55`,
      }}
      title={name || undefined}
    >
      {initials(name)}
    </span>
  );
}

// ============ Activity timeline ============

const ACTIVITY_ICONS: Record<string, LucideIcon> = {
  CREATED: PlusCircle,
  UPDATED: Pencil,
  STATUS_CHANGED: ArrowRightLeft,
  CALL: Phone,
  WHATSAPP: MessageCircle,
  MEETING: CalendarDays,
  PROPOSAL: FileText,
  PROJECT: FolderKanban,
  INVOICE: Receipt,
  PAYMENT: Wallet,
  TICKET: LifeBuoy,
  NOTE: StickyNote,
};

export function ActivityTimeline({ items, emptyText }: { items: ActivityItem[]; emptyText?: string }) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-10">{emptyText || "No activity recorded yet."}</p>;
  }
  return (
    <div className="space-y-4">
      {items.map((a) => {
        const Icon = ACTIVITY_ICONS[a.type] || History;
        return (
          <div key={a.id} className="flex gap-3">
            <div className="flex flex-col items-center shrink-0">
              <div className="w-7 h-7 rounded-lg bg-secondary/70 border border-border flex items-center justify-center">
                <Icon className="w-3.5 h-3.5 text-primary" />
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm leading-snug">{a.title}</p>
              {a.description && <p className="text-xs text-muted-foreground mt-0.5">{a.description}</p>}
              <div className="flex items-center gap-2 mt-1">
                <UserAvatar name={a.actorName} color={a.actorColor} size={18} />
                <span className="text-[11px] text-muted-foreground">{a.actorName} · {relativeTime(a.createdAt)}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============ Lost reason dialog (required when a lead is marked LOST) ============

export function LostReasonDialog({
  open, onOpenChange, companyName, onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  companyName?: string;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  // Reset on close (event-driven, not in an effect)
  const handleOpenChange = (o: boolean) => {
    if (!o) { setReason(""); setError(""); }
    onOpenChange(o);
  };

  const submit = () => {
    if (reason.trim().length < 3) { setError("Please describe why this lead is being lost."); return; }
    onConfirm(reason.trim());
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mark as lost</DialogTitle>
          <DialogDescription>
            {companyName ? `${companyName} — ` : ""}a lost reason is required for reporting.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="lost-reason">Lost reason *</Label>
          <Textarea
            id="lost-reason"
            value={reason}
            onChange={(e) => { setReason(e.target.value); setError(""); }}
            placeholder="e.g. Budget too low, chose a competitor, no response…"
            rows={3}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="destructive" onClick={submit}>Mark as lost</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============ Lead form dialog (create + edit) ============

type LeadFormValues = {
  companyName: string; contactName: string; phone: string; email: string; website: string;
  instagram: string; facebook: string; linkedin: string; industry: string; location: string;
  source: string; serviceInterest: string; estimatedBudget: string; priority: string;
  assignedToId: string; nextFollowUpAt: string; notes: string;
};

const emptyLeadForm: LeadFormValues = {
  companyName: "", contactName: "", phone: "", email: "", website: "",
  instagram: "", facebook: "", linkedin: "", industry: "", location: "",
  source: "OTHER", serviceInterest: "", estimatedBudget: "", priority: "MEDIUM",
  assignedToId: "", nextFollowUpAt: "", notes: "",
};

function leadToForm(l: Lead): LeadFormValues {
  return {
    companyName: l.companyName, contactName: l.contactName, phone: l.phone,
    email: l.email || "", website: l.website || "", instagram: l.instagram || "",
    facebook: l.facebook || "", linkedin: l.linkedin || "", industry: l.industry || "",
    location: l.location || "", source: l.source, serviceInterest: l.serviceInterest || "",
    estimatedBudget: l.estimatedBudget != null ? String(l.estimatedBudget) : "",
    priority: l.priority, assignedToId: l.assignedToId || "",
    nextFollowUpAt: toLocalInput(l.nextFollowUpAt), notes: l.notes || "",
  };
}

export function LeadFormDialog({
  open, onOpenChange, lead, onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  lead?: Lead | null;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const { team, hasAccess } = useTeam();
  const [values, setValues] = useState<LeadFormValues>(emptyLeadForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const isEdit = Boolean(lead);

  useEffect(() => {
    if (open) {
      setValues(lead ? leadToForm(lead) : emptyLeadForm);
      setErrors({});
    }
  }, [open, lead]);

  const set = (key: keyof LeadFormValues, value: string) =>
    setValues((v) => ({ ...v, [key]: value }));

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (values.companyName.trim().length < 2) e.companyName = "Company name is required (min 2 characters).";
    if (values.contactName.trim().length < 2) e.contactName = "Contact name is required (min 2 characters).";
    if (values.phone.trim().length < 7) e.phone = "Phone number is required (min 7 characters).";
    if (values.estimatedBudget && Number.isNaN(Number(values.estimatedBudget))) e.estimatedBudget = "Budget must be a number.";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async () => {
    if (!validate()) return;
    setSaving(true);
    const payload = {
      companyName: values.companyName.trim(),
      contactName: values.contactName.trim(),
      phone: values.phone.trim(),
      email: values.email.trim(),
      website: values.website.trim(),
      instagram: values.instagram.trim(),
      facebook: values.facebook.trim(),
      linkedin: values.linkedin.trim(),
      industry: values.industry.trim(),
      location: values.location.trim(),
      source: values.source,
      serviceInterest: values.serviceInterest.trim(),
      estimatedBudget: values.estimatedBudget === "" ? null : Number(values.estimatedBudget),
      priority: values.priority,
      assignedToId: values.assignedToId || null,
      nextFollowUpAt: values.nextFollowUpAt ? new Date(values.nextFollowUpAt).toISOString() : null,
      notes: values.notes.trim() || null,
    };
    try {
      if (isEdit && lead) {
        await api.patch<Lead>(`/api/leads/${lead.id}`, payload);
        toast({ title: "Lead updated", description: `${payload.companyName} was saved successfully.` });
      } else {
        const created = await api.post<Lead>("/api/leads", payload);
        toast({ title: "Lead created", description: `${created.leadNumber} — ${created.companyName}` });
      }
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast({ title: isEdit ? "Update failed" : "Create failed", description: err instanceof Error ? err.message : "Something went wrong.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[92vh] overflow-y-auto apex-scroll">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit lead — ${lead?.companyName}` : "New lead"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Update the lead details below." : "Capture a new sales opportunity. Fields marked * are required."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Company name" required>
            <Input value={values.companyName} onChange={(e) => set("companyName", e.target.value)} placeholder="Acme Ltd." />
            {errors.companyName && <p className="text-xs text-destructive">{errors.companyName}</p>}
          </Field>
          <Field label="Contact person" required>
            <Input value={values.contactName} onChange={(e) => set("contactName", e.target.value)} placeholder="John Smith" />
            {errors.contactName && <p className="text-xs text-destructive">{errors.contactName}</p>}
          </Field>
          <Field label="Phone" required>
            <Input value={values.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+20 100 000 0000" dir="ltr" />
            {errors.phone && <p className="text-xs text-destructive">{errors.phone}</p>}
          </Field>
          <Field label="Email">
            <Input value={values.email} onChange={(e) => set("email", e.target.value)} placeholder="hello@acme.com" type="email" dir="ltr" />
          </Field>
          <Field label="Website">
            <Input value={values.website} onChange={(e) => set("website", e.target.value)} placeholder="https://acme.com" dir="ltr" />
          </Field>
          <Field label="Industry">
            <Input value={values.industry} onChange={(e) => set("industry", e.target.value)} placeholder="Real estate, F&B…" />
          </Field>
          <Field label="Instagram">
            <Input value={values.instagram} onChange={(e) => set("instagram", e.target.value)} placeholder="@acme" dir="ltr" />
          </Field>
          <Field label="Facebook">
            <Input value={values.facebook} onChange={(e) => set("facebook", e.target.value)} placeholder="facebook.com/acme" dir="ltr" />
          </Field>
          <Field label="LinkedIn">
            <Input value={values.linkedin} onChange={(e) => set("linkedin", e.target.value)} placeholder="linkedin.com/company/acme" dir="ltr" />
          </Field>
          <Field label="Location">
            <Input value={values.location} onChange={(e) => set("location", e.target.value)} placeholder="Cairo, Egypt" />
          </Field>
          <Field label="Source">
            <Select value={values.source} onValueChange={(v) => set("source", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {LEAD_SOURCES.map((s) => <SelectItem key={s} value={s}>{humanLabel(s)}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Service interest">
            <Input value={values.serviceInterest} onChange={(e) => set("serviceInterest", e.target.value)} placeholder="E-commerce website…" />
          </Field>
          <Field label="Estimated budget (EGP)">
            <Input value={values.estimatedBudget} onChange={(e) => set("estimatedBudget", e.target.value)} type="number" min="0" placeholder="50000" dir="ltr" />
            {errors.estimatedBudget && <p className="text-xs text-destructive">{errors.estimatedBudget}</p>}
          </Field>
          <Field label="Priority">
            <Select value={values.priority} onValueChange={(v) => set("priority", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          {hasAccess && (
            <Field label="Assigned to">
              <Select value={values.assignedToId || "UNASSIGNED"} onValueChange={(v) => set("assignedToId", v === "UNASSIGNED" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="UNASSIGNED">Unassigned</SelectItem>
                  {team.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          )}
          <Field label="Next follow-up">
            <Input value={values.nextFollowUpAt} onChange={(e) => set("nextFollowUpAt", e.target.value)} type="datetime-local" />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Notes">
              <Textarea value={values.notes} onChange={(e) => set("notes", e.target.value)} rows={3} placeholder="Context, requirements, expectations…" />
            </Field>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>
            {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {isEdit ? "Save changes" : "Create lead"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============ Convert lead dialog (§62 smart conversion) ============

export function ConvertLeadDialog({
  open, onOpenChange, lead, onConverted,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  lead: Lead;
  onConverted: (clientId: string | null) => void;
}) {
  const { toast } = useToast();
  const { team } = useTeam();
  const [createClient, setCreateClient] = useState(true);
  const [createContact, setCreateContact] = useState(true);
  const [createProject, setCreateProject] = useState(false);
  const [notifyProjectManager, setNotifyProjectManager] = useState(true);

  const [client, setClient] = useState({ companyName: "", industry: "", location: "", website: "", email: "", phone: "" });
  const [contact, setContact] = useState({ name: "", position: "", email: "", phone: "" });
  const [project, setProject] = useState({ name: "", type: "BUSINESS_WEBSITE", managerId: "", deadline: "", budget: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && lead) {
      setCreateClient(true);
      setCreateContact(true);
      setCreateProject(false);
      setNotifyProjectManager(true);
      setClient({
        companyName: lead.companyName, industry: lead.industry || "", location: lead.location || "",
        website: lead.website || "", email: lead.email || "", phone: lead.phone || "",
      });
      setContact({ name: lead.contactName, position: "", email: lead.email || "", phone: lead.phone || "" });
      setProject({
        name: `${lead.companyName}${lead.serviceInterest ? ` — ${lead.serviceInterest}` : " project"}`,
        type: "BUSINESS_WEBSITE", managerId: "", deadline: "",
        budget: lead.estimatedBudget != null ? String(lead.estimatedBudget) : "",
      });
      setErrors({});
    }
  }, [open, lead]);

  const submit = async () => {
    const e: Record<string, string> = {};
    if (createClient && client.companyName.trim().length < 2) e.clientCompanyName = "Client company name is required.";
    if (createClient && createContact && contact.name.trim().length < 2) e.contactName = "Contact name is required.";
    if (createProject && project.name.trim().length < 2) e.projectName = "Project name is required.";
    setErrors(e);
    if (Object.keys(e).length > 0) return;

    setSaving(true);
    try {
      const result = await api.post<{ clientId: string | null; clientNumber: string | null; projectId: string | null; projectNumber: string | null }>(
        "/api/conversions",
        {
          leadId: lead.id,
          options: {
            createClient,
            client: createClient ? {
              companyName: client.companyName.trim(),
              industry: client.industry.trim() || undefined,
              location: client.location.trim() || undefined,
              website: client.website.trim() || undefined,
              email: client.email.trim() || undefined,
              phone: client.phone.trim() || undefined,
            } : undefined,
            contact: createClient && createContact ? {
              name: contact.name.trim(),
              position: contact.position.trim() || undefined,
              email: contact.email.trim() || undefined,
              phone: contact.phone.trim() || undefined,
            } : undefined,
            createProject,
            project: createProject ? {
              name: project.name.trim(),
              type: project.type,
              managerId: project.managerId || undefined,
              deadline: project.deadline || undefined,
              budget: project.budget === "" ? undefined : Number(project.budget),
            } : undefined,
            notifyProjectManager,
          },
        }
      );
      toast({
        title: "Lead converted",
        description: [
          result.clientNumber ? `Client ${result.clientNumber} created` : null,
          result.projectNumber ? `Project ${result.projectNumber} created` : null,
        ].filter(Boolean).join(" · ") || "Conversion completed.",
      });
      onOpenChange(false);
      onConverted(result.clientId);
    } catch (err) {
      toast({ title: "Conversion failed", description: err instanceof Error ? err.message : "Something went wrong.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[92vh] overflow-y-auto apex-scroll">
        <DialogHeader>
          <DialogTitle>Convert lead to client</DialogTitle>
          <DialogDescription>
            {lead.companyName} ({lead.leadNumber}) — choose what to create. Client and contact are prefilled from the lead.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <label className="flex items-center gap-2.5 p-3 rounded-lg border border-border bg-secondary/30 cursor-pointer">
            <Checkbox checked={createClient} onCheckedChange={(v) => setCreateClient(v === true)} />
            <span className="text-sm font-medium">Create client</span>
          </label>
          {createClient && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pl-3 border-l-2 border-primary/20 ml-2">
              <Field label="Client company" required>
                <Input value={client.companyName} onChange={(e) => setClient({ ...client, companyName: e.target.value })} />
                {errors.clientCompanyName && <p className="text-xs text-destructive">{errors.clientCompanyName}</p>}
              </Field>
              <Field label="Phone"><Input value={client.phone} onChange={(e) => setClient({ ...client, phone: e.target.value })} dir="ltr" /></Field>
              <Field label="Email"><Input value={client.email} onChange={(e) => setClient({ ...client, email: e.target.value })} dir="ltr" /></Field>
              <Field label="Website"><Input value={client.website} onChange={(e) => setClient({ ...client, website: e.target.value })} dir="ltr" /></Field>
              <Field label="Industry"><Input value={client.industry} onChange={(e) => setClient({ ...client, industry: e.target.value })} /></Field>
              <Field label="Location"><Input value={client.location} onChange={(e) => setClient({ ...client, location: e.target.value })} /></Field>
            </div>
          )}

          {createClient && (
            <label className={cn("flex items-center gap-2.5 p-3 rounded-lg border border-border bg-secondary/30 cursor-pointer", !createClient && "opacity-50 pointer-events-none")}>
              <Checkbox checked={createContact} onCheckedChange={(v) => setCreateContact(v === true)} disabled={!createClient} />
              <span className="text-sm font-medium">Create primary contact</span>
            </label>
          )}
          {createClient && createContact && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pl-3 border-l-2 border-primary/20 ml-2">
              <Field label="Contact name" required>
                <Input value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} />
                {errors.contactName && <p className="text-xs text-destructive">{errors.contactName}</p>}
              </Field>
              <Field label="Position"><Input value={contact.position} onChange={(e) => setContact({ ...contact, position: e.target.value })} placeholder="Marketing Manager" /></Field>
              <Field label="Contact email"><Input value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} dir="ltr" /></Field>
              <Field label="Contact phone"><Input value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} dir="ltr" /></Field>
            </div>
          )}

          <label className="flex items-center gap-2.5 p-3 rounded-lg border border-border bg-secondary/30 cursor-pointer">
            <Checkbox checked={createProject} onCheckedChange={(v) => setCreateProject(v === true)} />
            <span className="text-sm font-medium">Create project</span>
          </label>
          {createProject && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pl-3 border-l-2 border-primary/20 ml-2">
              <Field label="Project name" required>
                <Input value={project.name} onChange={(e) => setProject({ ...project, name: e.target.value })} />
                {errors.projectName && <p className="text-xs text-destructive">{errors.projectName}</p>}
              </Field>
              <Field label="Project type">
                <Select value={project.type} onValueChange={(v) => setProject({ ...project, type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PROJECT_TYPES.map((t) => <SelectItem key={t} value={t}>{humanLabel(t)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              {team.length > 0 && (
                <Field label="Project manager">
                  <Select value={project.managerId || "NONE"} onValueChange={(v) => setProject({ ...project, managerId: v === "NONE" ? "" : v })}>
                    <SelectTrigger><SelectValue placeholder="Select manager" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NONE">No manager yet</SelectItem>
                      {team.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
              )}
              <Field label="Deadline">
                <Input type="date" value={project.deadline} onChange={(e) => setProject({ ...project, deadline: e.target.value })} />
              </Field>
              <Field label="Budget (EGP)">
                <Input type="number" min="0" value={project.budget} onChange={(e) => setProject({ ...project, budget: e.target.value })} dir="ltr" />
              </Field>
              <label className="flex items-center gap-2.5 sm:col-span-2 cursor-pointer">
                <Checkbox checked={notifyProjectManager} onCheckedChange={(v) => setNotifyProjectManager(v === true)} />
                <span className="text-sm">Notify the project manager</span>
              </label>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ArrowUpRight className="w-4 h-4 mr-2" />}
            Convert to client
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============ Lead detail drawer ============

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <span className="text-xs text-muted-foreground shrink-0 pt-0.5">{label}</span>
      <span className="text-sm text-right break-words min-w-0">{value ?? "—"}</span>
    </div>
  );
}

function DrawerFollowUpForm({
  leadId, onCreated,
}: {
  leadId: string;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const { team, hasAccess } = useTeam();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [priority, setPriority] = useState("MEDIUM");
  const [assignedToId, setAssignedToId] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (title.trim().length < 2) { setError("Title is required."); return; }
    if (!dueAt) { setError("Due date is required."); return; }
    setSaving(true);
    try {
      await api.post("/api/followups", {
        title: title.trim(), leadId, priority,
        dueAt: new Date(dueAt).toISOString(),
        assignedToId: assignedToId || null,
      });
      toast({ title: "Follow-up added", description: `“${title.trim()}” was scheduled.` });
      setOpen(false);
      setTitle(""); setDueAt(""); setPriority("MEDIUM"); setAssignedToId(""); setError("");
      onCreated();
    } catch (err) {
      toast({ title: "Could not add follow-up", description: err instanceof Error ? err.message : "Something went wrong.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}><PlusCircle className="w-4 h-4 mr-2" /> Add follow-up</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add follow-up</DialogTitle>
            <DialogDescription>Quickly schedule a follow-up for this lead.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Field label="Title" required>
              <Input value={title} onChange={(e) => { setTitle(e.target.value); setError(""); }} placeholder="Call to discuss proposal" />
            </Field>
            <Field label="Due at" required>
              <Input type="datetime-local" value={dueAt} onChange={(e) => { setDueAt(e.target.value); setError(""); }} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Priority">
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              {hasAccess && (
                <Field label="Assign to">
                  <Select value={assignedToId || "ME"} onValueChange={(v) => setAssignedToId(v === "ME" ? "" : v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ME">Unassigned</SelectItem>
                      {team.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
              )}
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function LeadDetailDrawer({
  leadId, open, onOpenChange, onChanged, navigate, permissions,
}: {
  leadId: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onChanged: () => void;
  navigate: (p: string) => void;
  permissions: string[];
}) {
  const { toast } = useToast();
  const [data, setData] = useState<LeadDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [lostOpen, setLostOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const canEdit = permissions.includes("leads.edit");
  const canConvert = permissions.includes("clients.create");

  const load = useCallback(async () => {
    if (!leadId) return;
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<LeadDetailResponse>(`/api/leads/${leadId}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load this lead.");
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    if (open && leadId) load();
    if (!open) setData(null);
  }, [open, leadId, load]);

  const lead = data?.lead;

  const patch = async (payload: Record<string, unknown>, successTitle: string) => {
    if (!lead) return;
    setBusy(true);
    try {
      await api.patch<Lead>(`/api/leads/${lead.id}`, payload);
      toast({ title: successTitle });
      await load();
      onChanged();
    } catch (err) {
      toast({ title: "Update failed", description: err instanceof Error ? err.message : "Something went wrong.", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const onStatusChange = (status: string) => {
    if (!lead || status === lead.status) return;
    if (status === "LOST") { setLostOpen(true); return; }
    patch({ status }, `Status updated — ${humanLabel(status)}`);
  };

  const overdue = lead ? (isOverdueDate(lead.nextFollowUpAt) && !["WON", "LOST"].includes(lead.status)) : false;
  const showConvert = lead && canConvert && ["WON", "NEGOTIATION"].includes(lead.status) && !lead.convertedClientId;

  const nextFollowUpOptions = useMemo(() => {
    const options: { label: string; value: string }[] = [];
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const in1h = new Date(now.getTime() + 60 * 60 * 1000);
    const tomorrow9 = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0);
    const in3days = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3, 10, 0, 0);
    const nextWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7, 10, 0, 0);
    options.push({ label: "In 1 hour", value: fmt(in1h) });
    options.push({ label: "Tomorrow 9:00 AM", value: fmt(tomorrow9) });
    options.push({ label: "In 3 days 10:00 AM", value: fmt(in3days) });
    options.push({ label: "Next week 10:00 AM", value: fmt(nextWeek) });
    options.push({ label: "Clear follow-up", value: "CLEAR" });
    return options;
  }, []);

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-[520px] p-0 flex flex-col">
          {loading && !lead && (
            <div className="p-5">
              <ListSkeleton rows={8} />
            </div>
          )}
          {!loading && error && (
            <div className="p-5"><ErrorState message={error} onRetry={load} /></div>
          )}
          {lead && (
            <>
              <SheetHeader className="border-b border-border pb-4">
                <div className="flex items-start justify-between gap-3 pr-8">
                  <div className="min-w-0">
                    <SheetTitle className="truncate text-base">{lead.companyName}</SheetTitle>
                    <SheetDescription className="text-xs">
                      {lead.leadNumber} · created {formatDate(lead.createdAt)}
                    </SheetDescription>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <StatusBadge status={lead.status} />
                    <PriorityBadge priority={lead.priority} />
                  </div>
                </div>
                {lead.convertedClient && (
                  <button
                    onClick={() => { onOpenChange(false); navigate("crm/clients"); }}
                    className="mt-2 inline-flex items-center gap-1.5 text-xs text-emerald-300 hover:underline w-fit"
                  >
                    <ArrowUpRight className="w-3.5 h-3.5" />
                    Converted to {lead.convertedClient.companyName} ({lead.convertedClient.clientNumber})
                  </button>
                )}
              </SheetHeader>

              <Tabs defaultValue="overview" className="flex-1 flex flex-col min-h-0">
                <TabsList className="mx-4 mt-3 w-fit">
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="timeline">Timeline</TabsTrigger>
                  <TabsTrigger value="followups">Follow-ups{lead.followUps.length > 0 ? ` (${lead.followUps.length})` : ""}</TabsTrigger>
                </TabsList>

                <ScrollArea className="flex-1 min-h-0">
                  {/* Overview */}
                  <TabsContent value="overview" className="px-5 py-4 mt-0">
                    {(canEdit || showConvert) && (
                      <div className="flex flex-wrap gap-2 mb-4">
                        {canEdit && (
                          <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
                            <Pencil className="w-3.5 h-3.5 mr-1.5" /> Edit
                          </Button>
                        )}
                        {showConvert && (
                          <Button size="sm" onClick={() => setConvertOpen(true)}>
                            <ArrowUpRight className="w-3.5 h-3.5 mr-1.5" /> Convert to client
                          </Button>
                        )}
                      </div>
                    )}

                    {canEdit && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                        <Field label="Status">
                          <Select value={lead.status} onValueChange={onStatusChange} disabled={busy}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {LEAD_STATUSES.map((s) => <SelectItem key={s} value={s}>{humanLabel(s)}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </Field>
                        {permissions.includes("team.view") ? (
                          <Field label="Assigned to">
                            <AssignSelect
                              key={lead.assignedToId || "none"}
                              currentId={lead.assignedToId}
                              disabled={busy}
                              onChange={(id) => patch({ assignedToId: id || null }, id ? "Lead reassigned" : "Lead unassigned")}
                            />
                          </Field>
                        ) : (
                          <Field label="Assigned to">
                            <div className="h-9 flex items-center gap-2 text-sm">
                              {lead.assignedTo ? (
                                <><UserAvatar name={lead.assignedTo.name} color={lead.assignedTo.avatarColor} size={24} /> {lead.assignedTo.name}</>
                              ) : "Unassigned"}
                            </div>
                          </Field>
                        )}
                      </div>
                    )}
                    {!canEdit && lead.assignedTo && (
                      <DetailRow label="Assigned to" value={
                        <span className="inline-flex items-center gap-2">
                          <UserAvatar name={lead.assignedTo.name} color={lead.assignedTo.avatarColor} size={22} /> {lead.assignedTo.name}
                        </span>
                      } />
                    )}

                    <Separator className="my-3" />
                    <div className="divide-y divide-border/60">
                      <DetailRow label="Contact person" value={lead.contactName} />
                      <DetailRow label="Phone" value={<span dir="ltr">{lead.phone}</span>} />
                      <DetailRow label="Email" value={lead.email ? <span dir="ltr">{lead.email}</span> : "—"} />
                      <DetailRow label="Website" value={lead.website ? <span dir="ltr" className="break-all">{lead.website}</span> : "—"} />
                      <DetailRow label="Industry" value={lead.industry || "—"} />
                      <DetailRow label="Location" value={lead.location || "—"} />
                      <DetailRow label="Source" value={humanLabel(lead.source)} />
                      <DetailRow label="Service interest" value={lead.serviceInterest || "—"} />
                      <DetailRow label="Estimated budget" value={lead.estimatedBudget != null ? formatCurrency(lead.estimatedBudget) : "—"} />
                      <DetailRow
                        label="Next follow-up"
                        value={
                          lead.nextFollowUpAt
                            ? <span className={cn(overdue && "text-rose-300 font-medium")}>{formatDateTime(lead.nextFollowUpAt)}{overdue ? " · overdue" : ""}</span>
                            : "—"
                        }
                      />
                      {lead.status === "LOST" && <DetailRow label="Lost reason" value={lead.lostReason || "—"} />}
                      {canEdit && (
                        <DetailRow
                          label="Quick follow-up"
                          value={
                            <Select
                              value=""
                              onValueChange={(v) => {
                                if (v === "CLEAR") patch({ nextFollowUpAt: null }, "Follow-up cleared");
                                else patch({ nextFollowUpAt: new Date(v).toISOString() }, "Follow-up scheduled");
                              }}
                              disabled={busy}
                            >
                              <SelectTrigger className="h-8 w-[180px]"><SelectValue placeholder="Schedule…" /></SelectTrigger>
                              <SelectContent>
                                {nextFollowUpOptions.map((o) => (
                                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          }
                        />
                      )}
                    </div>
                    {lead.notes && (
                      <>
                        <Separator className="my-3" />
                        <p className="text-xs text-muted-foreground mb-1.5">Notes</p>
                        <p className="text-sm whitespace-pre-wrap">{lead.notes}</p>
                      </>
                    )}
                  </TabsContent>

                  {/* Timeline */}
                  <TabsContent value="timeline" className="px-5 py-4 mt-0">
                    <ActivityTimeline items={data?.activities ?? []} emptyText="No activity for this lead yet." />
                  </TabsContent>

                  {/* Follow-ups */}
                  <TabsContent value="followups" className="px-5 py-4 mt-0 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium">{lead.followUps.length} follow-up{lead.followUps.length === 1 ? "" : "s"}</p>
                      <DrawerFollowUpForm leadId={lead.id} onCreated={() => { load(); onChanged(); }} />
                    </div>
                    {lead.followUps.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-8">No follow-ups scheduled yet.</p>
                    ) : (
                      lead.followUps.map((f) => (
                        <div key={f.id} className="rounded-lg border border-border p-3 bg-card/50">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-medium">{f.title}</p>
                            <StatusBadge status={f.status} />
                          </div>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-xs text-muted-foreground">
                            <span className={cn(isOverdueDate(f.dueAt) && f.status === "PENDING" && "text-rose-300 font-medium")}>
                              {formatDateTime(f.dueAt)}{isOverdueDate(f.dueAt) && f.status === "PENDING" ? " · overdue" : ""}
                            </span>
                            <PriorityBadge priority={f.priority} />
                            {f.assignedTo && (
                              <span className="inline-flex items-center gap-1.5">
                                <UserAvatar name={f.assignedTo.name} color={f.assignedTo.avatarColor} size={18} />
                                {f.assignedTo.name}
                              </span>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </TabsContent>
                </ScrollArea>
              </Tabs>
            </>
          )}
        </SheetContent>
      </Sheet>

      {lead && (
        <>
          <LeadFormDialog
            open={editOpen}
            onOpenChange={setEditOpen}
            lead={lead}
            onSaved={() => { load(); onChanged(); }}
          />
          <ConvertLeadDialog
            open={convertOpen}
            onOpenChange={setConvertOpen}
            lead={lead}
            onConverted={() => { load(); onChanged(); onOpenChange(false); navigate("crm/clients"); }}
          />
          <LostReasonDialog
            open={lostOpen}
            onOpenChange={setLostOpen}
            companyName={lead.companyName}
            onConfirm={(reason) => {
              setLostOpen(false);
              patch({ status: "LOST", lostReason: reason }, "Status updated — Lost");
            }}
          />
        </>
      )}
    </>
  );
}

/** Assignee select used inside the drawer (loads team on mount). */
function AssignSelect({
  currentId, onChange, disabled,
}: {
  currentId: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
}) {
  const { team, hasAccess } = useTeam();
  const value = currentId || "UNASSIGNED";
  if (!hasAccess) {
    return <span className="text-sm text-muted-foreground h-9 flex items-center">—</span>;
  }
  return (
    <Select value={value} onValueChange={(v) => onChange(v === "UNASSIGNED" ? null : v)} disabled={disabled}>
      <SelectTrigger><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="UNASSIGNED">Unassigned</SelectItem>
        {team.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
