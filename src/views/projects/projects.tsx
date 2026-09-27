"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { api, ApiClientError, formatCurrency, formatDate, relativeTime, initials } from "@/lib/api-client";
import { useToast } from "@/hooks/use-toast";
import { PageHeader, EmptyState, ErrorState, StatusBadge, PriorityBadge, Field } from "@/components/shared";
import { FileAttachments } from "@/components/shared/files";
import { TaskDetailSheet, UserAvatar } from "./tasks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import {
  Activity, ArrowRightLeft, Building2, CalendarClock, FolderKanban, ListTodo,
  PencilLine, Plus, PlusCircle, RefreshCw, Trash2, UserPlus, X,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ============================= Types =============================

type MiniUser = { id: string; name: string; avatarColor: string };
type ChecklistEntry = { text: string; isDone: boolean };
type Paged<T> = { items: T[]; total: number; page: number; pageSize: number };

type ProjectItem = {
  id: string;
  projectNumber: string;
  name: string;
  description?: string | null;
  type: string;
  status: string;
  priority: string;
  budget?: number | null;
  progress: number;
  health: string;
  startDate?: string | null;
  deadline?: string | null;
  createdAt: string;
  client: { id: string; companyName: string };
  manager?: MiniUser | null;
  totalTasks: number;
  doneTasks: number;
  phasesCount: number;
  membersCount: number;
};

type PhaseTask = {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate?: string | null;
  assignee?: MiniUser | null;
};

type ProjectDetail = {
  id: string;
  projectNumber: string;
  name: string;
  description?: string | null;
  type: string;
  status: string;
  priority: string;
  budget?: number | null;
  progress: number;
  health: string;
  startDate?: string | null;
  deadline?: string | null;
  createdAt: string;
  client: { id: string; companyName: string; clientNumber: string };
  manager?: (MiniUser & { title?: string | null }) | null;
  members: { id: string; role: string; user: MiniUser & { title?: string | null } }[];
  phases: { id: string; name: string; order: number; status: string; doneCount: number; tasks: PhaseTask[] }[];
  taskStats: { byStatus: Record<string, number>; total: number; done: number; open: number };
  invoices: { id: string; invoiceNumber: string; total: number; status: string; currency: string }[] | null;
  onboardingChecklist: ChecklistEntry[];
  completionChecklist: ChecklistEntry[];
  activities: { id: string; type: string; title: string; description?: string | null; actorName: string; actorColor: string; createdAt: string }[];
};

type ProjectTypeConfig = { key: string; label: string; phases: string[] };
type ClientOption = { id: string; companyName: string };
type TeamMemberOption = MiniUser & { title?: string | null };

// Fallback project types (mirrors seeded Settings — used when /api/settings is not permitted)
const FALLBACK_TYPES: ProjectTypeConfig[] = [
  { key: "BUSINESS_WEBSITE", label: "Business Website", phases: ["Discovery", "Requirements", "UI/UX", "Development", "Testing", "Client Review", "Deployment", "Handover"] },
  { key: "ECOMMERCE", label: "E-commerce", phases: ["Discovery", "Requirements", "UI/UX", "Development", "Payments Integration", "Testing", "Client Review", "Deployment", "Handover"] },
  { key: "WEB_APPLICATION", label: "Web Application", phases: ["Discovery", "Requirements", "UI/UX", "Development", "Integration", "Testing", "Client Review", "Revisions", "Deployment", "Handover"] },
  { key: "CUSTOM_SOFTWARE", label: "Custom Software", phases: ["Discovery", "Requirements", "UI/UX", "Development", "Integration", "Testing", "Client Review", "Revisions", "Deployment", "Handover"] },
  { key: "CRM", label: "CRM System", phases: ["Discovery", "Requirements", "UI/UX", "Development", "Integration", "Testing", "Client Review", "Deployment", "Handover"] },
  { key: "DASHBOARD", label: "Dashboard", phases: ["Discovery", "Requirements", "UI/UX", "Development", "Testing", "Client Review", "Deployment", "Handover"] },
  { key: "EDUCATIONAL_PLATFORM", label: "Educational Platform", phases: ["Discovery", "Requirements", "UI/UX", "Development", "Testing", "Client Review", "Deployment", "Handover"] },
  { key: "LANDING_PAGE", label: "Landing Page", phases: ["Requirements", "UI/UX", "Development", "Client Review", "Deployment"] },
  { key: "AUTOMATION_SYSTEM", label: "Automation System", phases: ["Discovery", "Requirements", "Development", "Testing", "Deployment", "Handover"] },
  { key: "MAINTENANCE", label: "Maintenance", phases: ["Assessment", "Execution", "Client Review"] },
];

const PROJECT_STATUSES = ["PLANNING", "ACTIVE", "ON_HOLD", "REVIEW", "COMPLETED", "CANCELLED"];
const STATUS_TRANSITIONS: Record<string, string[]> = {
  PLANNING: ["PLANNING", "ACTIVE", "CANCELLED"],
  ACTIVE: ["ACTIVE", "PLANNING", "ON_HOLD", "REVIEW", "COMPLETED", "CANCELLED"],
  ON_HOLD: ["ON_HOLD", "ACTIVE", "REVIEW", "COMPLETED", "CANCELLED"],
  REVIEW: ["REVIEW", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"],
  COMPLETED: ["COMPLETED", "ACTIVE"],
  CANCELLED: ["CANCELLED", "PLANNING", "ACTIVE"],
};
const MEMBER_ROLES = ["MEMBER", "MANAGER", "REVIEWER", "QA"];

const HEALTH_STYLES: Record<string, { dot: string; text: string }> = {
  ON_TRACK: { dot: "bg-emerald-400", text: "text-emerald-300" },
  AT_RISK: { dot: "bg-amber-400", text: "text-amber-300" },
  DELAYED: { dot: "bg-rose-400", text: "text-rose-300" },
};

function HealthBadge({ health }: { health: string }) {
  const s = HEALTH_STYLES[health] ?? HEALTH_STYLES.ON_TRACK;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[11px] font-medium", s.text)}>
      <span className={cn("w-2 h-2 rounded-full", s.dot)} />
      {health.replace(/_/g, " ")}
    </span>
  );
}

function deadlineMeta(deadline?: string | null, status?: string): { text: string; cls: string } {
  if (!deadline) return { text: "No deadline", cls: "text-muted-foreground" };
  const d = new Date(deadline);
  d.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((d.getTime() - today.getTime()) / 86400000);
  const urgent = !!status && !["COMPLETED", "CANCELLED"].includes(status) && days < 7;
  return { text: formatDate(deadline), cls: urgent ? "text-rose-300 font-medium" : "text-muted-foreground" };
}

function typeLabel(key: string, types: ProjectTypeConfig[]): string {
  return types.find((t) => t.key === key)?.label ?? key.replace(/_/g, " ");
}

function extractClients(data: unknown): ClientOption[] {
  if (Array.isArray(data)) return data as ClientOption[];
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.items)) return obj.items as ClientOption[];
    if (Array.isArray(obj.clients)) return obj.clients as ClientOption[];
  }
  return [];
}

// ============================= New Project Dialog =============================

function NewProjectDialog({
  open, onOpenChange, onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [clients, setClients] = useState<ClientOption[] | null>(null);
  const [clientUnavailable, setClientUnavailable] = useState(false);
  const [clientId, setClientId] = useState("none");
  const [manualClientId, setManualClientId] = useState("");
  const [types, setTypes] = useState<ProjectTypeConfig[]>(FALLBACK_TYPES);
  const [type, setType] = useState("BUSINESS_WEBSITE");
  const [team, setTeam] = useState<TeamMemberOption[]>([]);
  const [teamUnavailable, setTeamUnavailable] = useState(false);
  const [managerId, setManagerId] = useState("none");
  const [budget, setBudget] = useState("");
  const [startDate, setStartDate] = useState("");
  const [deadline, setDeadline] = useState("");
  const [priority, setPriority] = useState("MEDIUM");
  const [saving, setSaving] = useState(false);

  // Load dialog data (degrade gracefully per source)
  useEffect(() => {
    if (!open) return;
    setName(""); setDescription(""); setClientId("none"); setManualClientId("");
    setType("BUSINESS_WEBSITE"); setManagerId("none"); setBudget("");
    setStartDate(""); setDeadline(""); setPriority("MEDIUM");
    setClientUnavailable(false); setTeamUnavailable(false);

    api.get<unknown>("/api/clients?pageSize=100")
      .then((d) => {
        const list = extractClients(d).filter((c) => c && typeof c.id === "string");
        setClients(list);
        // Empty list is NOT an error — user just has no clients yet (create them in CRM).
        setClientUnavailable(false);
      })
      .catch(() => { setClients([]); setClientUnavailable(true); });

    api.get<{ settings: Record<string, unknown> }>("/api/settings")
      .then((d) => {
        const projectsSetting = d.settings?.projects as { types?: ProjectTypeConfig[] } | undefined;
        if (projectsSetting && Array.isArray(projectsSetting.types) && projectsSetting.types.length > 0) {
          setTypes(projectsSetting.types);
        }
      })
      .catch(() => setTypes(FALLBACK_TYPES)); // no settings.manage → hardcoded defaults

    api.get<{ team: TeamMemberOption[] }>("/api/team")
      .then((d) => setTeam(d.team))
      .catch(() => setTeamUnavailable(true));
  }, [open]);

  const submit = async () => {
    const resolvedClientId = clientUnavailable ? manualClientId.trim() : clientId === "none" ? "" : clientId;
    if (!name.trim() || !resolvedClientId) return;
    setSaving(true);
    try {
      await api.post("/api/projects", {
        name: name.trim(),
        clientId: resolvedClientId,
        type,
        managerId: managerId === "none" ? undefined : managerId,
        description: description.trim() || undefined,
        budget: budget ? Number(budget) : undefined,
        priority,
        startDate: startDate || undefined,
        deadline: deadline || undefined,
      });
      toast({ title: "Project created", description: `${name.trim()} is now in planning.` });
      onOpenChange(false);
      onCreated();
    } catch (e) {
      toast({
        title: "Could not create project",
        description: e instanceof ApiClientError ? e.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto apex-scroll">
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
        </DialogHeader>
        <div className="space-y-3.5 py-1">
          <Field label="Project name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Nile Commerce Platform" />
          </Field>

          {clientUnavailable ? (
            <Field
              label="Client ID" required
              hint="Client list is unavailable (missing clients.view or the CRM module is not ready). Paste a Client ID from the CRM module."
            >
              <Input value={manualClientId} onChange={(e) => setManualClientId(e.target.value)} placeholder="e.g. cm5x… (APX-CLT-0001 ID)" />
            </Field>
          ) : (
            <Field label="Client" required hint={(clients ?? []).length === 0 ? "No clients yet — win a lead in the CRM pipeline and convert it to a client first." : undefined}>
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Select client" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" disabled>Select a client</SelectItem>
                  {(clients ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.companyName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}

          <Field label="Project type" hint="Phases are generated automatically from the type template.">
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {types.map((t) => <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Manager" hint={teamUnavailable ? "Team list unavailable — manager can be assigned later." : undefined}>
            <Select value={managerId} onValueChange={setManagerId} disabled={teamUnavailable}>
              <SelectTrigger className="h-9"><SelectValue placeholder="No manager" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No manager</SelectItem>
                {team.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Budget (EGP)">
              <Input type="number" min="0" value={budget} onChange={(e) => setBudget(e.target.value)} className="h-9" placeholder="0" />
            </Field>
            <Field label="Priority">
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["LOW", "MEDIUM", "HIGH", "URGENT"].map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Start date">
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-9" />
            </Field>
            <Field label="Deadline">
              <Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className="h-9" />
            </Field>
          </div>

          <Field label="Description">
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Scope summary, goals, notes…" />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!name.trim() || (clientUnavailable ? !manualClientId.trim() : clientId === "none") || saving} onClick={() => void submit()}>
            {saving ? "Creating…" : "Create project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================= Quick add task per phase =============================

function QuickAddTask({
  projectId, phaseId, onAdded, canCreate,
}: {
  projectId: string;
  phaseId: string;
  onAdded: () => void;
  canCreate: boolean;
}) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  if (!canCreate) return null;

  const add = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      await api.post("/api/tasks", { title: title.trim(), projectId, phaseId });
      setTitle("");
      toast({ title: "Task added to phase" });
      onAdded();
    } catch (e) {
      toast({
        title: "Could not add task",
        description: e instanceof ApiClientError ? e.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex gap-1.5 mt-2">
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void add(); } }}
        placeholder="Quick add task…"
        className="h-8 text-xs"
      />
      <Button size="sm" variant="outline" className="h-8 px-2.5" disabled={!title.trim() || busy} onClick={() => void add()} aria-label="Add task">
        <Plus className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}

// ============================= Project Detail Sheet =============================

const ACTIVITY_ICONS: Record<string, React.ReactNode> = {
  CREATED: <PlusCircle className="w-3.5 h-3.5" />,
  STATUS_CHANGED: <ArrowRightLeft className="w-3.5 h-3.5" />,
  UPDATED: <PencilLine className="w-3.5 h-3.5" />,
  PROJECT: <FolderKanban className="w-3.5 h-3.5" />,
  TASK: <ListTodo className="w-3.5 h-3.5" />,
};

function ChecklistSection({
  title, entries, onToggle,
}: {
  title: string;
  entries: ChecklistEntry[];
  onToggle: (index: number) => void;
}) {
  const done = entries.filter((e) => e.isDone).length;
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-medium">{title}</p>
        <span className="text-xs text-muted-foreground">
          {entries.length > 0 ? `${done}/${entries.length} · ${Math.round((done / entries.length) * 100)}%` : "Empty"}
        </span>
      </div>
      {entries.length > 0 && <Progress value={(done / entries.length) * 100} className="h-1.5 mb-3" />}
      <div className="space-y-1">
        {entries.map((entry, i) => (
          <label key={`${entry.text}-${i}`} className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-accent/50 cursor-pointer">
            <Checkbox checked={entry.isDone} onCheckedChange={() => onToggle(i)} aria-label={`Toggle ${entry.text}`} />
            <span className={cn("text-sm", entry.isDone && "line-through text-muted-foreground")}>{entry.text}</span>
          </label>
        ))}
        {entries.length === 0 && (
          <p className="text-xs text-muted-foreground py-2">No checklist items yet.</p>
        )}
      </div>
    </div>
  );
}

function ProjectDetailSheet({
  projectId, open, onOpenChange, onChanged, navigate,
}: {
  projectId: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onChanged?: () => void;
  navigate: (p: string) => void;
}) {
  const { data: session } = useSession();
  const me = session?.user;
  const { toast } = useToast();
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("overview");
  const [team, setTeam] = useState<TeamMemberOption[]>([]);
  const [teamUnavailable, setTeamUnavailable] = useState(false);
  const [addUserId, setAddUserId] = useState("none");
  const [addRole, setAddRole] = useState("MEMBER");
  const [taskSheetId, setTaskSheetId] = useState<string | null>(null);
  const [taskSheetOpen, setTaskSheetOpen] = useState(false);

  const canEdit = !!me?.permissions?.includes("projects.edit");
  const canAssign = !!me?.permissions?.includes("projects.assign");
  const canDelete = !!me?.permissions?.includes("projects.delete");
  const canCreateTasks = !!me?.permissions?.includes("tasks.create");
  const canViewFiles = !!me?.permissions?.includes("files.view");

  const loadDetail = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const d = await api.get<ProjectDetail>(`/api/projects/${projectId}`);
      setDetail(d);
    } catch (e) {
      toast({
        title: "Could not load project",
        description: e instanceof ApiClientError ? e.message : undefined,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [projectId, toast]);

  useEffect(() => {
    if (open && projectId) {
      setTab("overview");
      void loadDetail();
    }
    if (!open) setDetail(null);
  }, [open, projectId, loadDetail]);

  useEffect(() => {
    if (!open || team.length > 0 || teamUnavailable) return;
    api.get<{ team: TeamMemberOption[] }>("/api/team")
      .then((d) => setTeam(d.team))
      .catch(() => setTeamUnavailable(true));
  }, [open, team.length, teamUnavailable]);

  const patchProject = useCallback(async (fields: Record<string, unknown>, opts?: { silent?: boolean }) => {
    if (!projectId) return;
    try {
      const d = await api.patch<{
        project: { status: string; health: string; progress: number; onboardingChecklist: ChecklistEntry[]; completionChecklist: ChecklistEntry[] };
      }>(`/api/projects/${projectId}`, fields);
      setDetail((prev) => prev ? {
        ...prev,
        status: d.project.status,
        health: d.project.health,
        progress: d.project.progress,
        onboardingChecklist: d.project.onboardingChecklist,
        completionChecklist: d.project.completionChecklist,
      } : prev);
      if (!opts?.silent) toast({ title: "Project updated" });
      onChanged?.();
    } catch (e) {
      toast({
        title: "Update failed",
        description: e instanceof ApiClientError ? e.message : undefined,
        variant: "destructive",
      });
      void loadDetail();
    }
  }, [projectId, toast, onChanged, loadDetail]);

  const toggleChecklist = useCallback((kind: "onboardingChecklist" | "completionChecklist", index: number) => {
    if (!detail || !canEdit) return;
    const next = detail[kind].map((entry, i) => (i === index ? { ...entry, isDone: !entry.isDone } : entry));
    setDetail({ ...detail, [kind]: next });
    void patchProject({ [kind]: next }, { silent: true });
  }, [detail, canEdit, patchProject]);

  const addMember = useCallback(async () => {
    if (!projectId || addUserId === "none") return;
    try {
      await api.post(`/api/projects/${projectId}/members`, { userId: addUserId, role: addRole });
      toast({ title: "Member added", description: "They have been notified." });
      setAddUserId("none");
      void loadDetail();
      onChanged?.();
    } catch (e) {
      toast({
        title: "Could not add member",
        description: e instanceof ApiClientError ? e.message : undefined,
        variant: "destructive",
      });
    }
  }, [projectId, addUserId, addRole, toast, loadDetail, onChanged]);

  const removeMember = useCallback(async (userId: string) => {
    if (!projectId) return;
    try {
      await api.delete(`/api/projects/${projectId}/members?userId=${userId}`);
      toast({ title: "Member removed" });
      void loadDetail();
      onChanged?.();
    } catch (e) {
      toast({
        title: "Could not remove member",
        description: e instanceof ApiClientError ? e.message : undefined,
        variant: "destructive",
      });
    }
  }, [projectId, toast, loadDetail, onChanged]);

  const archiveProject = useCallback(async () => {
    if (!projectId) return;
    try {
      await api.delete(`/api/projects/${projectId}`);
      toast({ title: "Project archived" });
      onOpenChange(false);
      onChanged?.();
    } catch (e) {
      toast({
        title: "Could not archive project",
        description: e instanceof ApiClientError ? e.message : undefined,
        variant: "destructive",
      });
    }
  }, [projectId, toast, onOpenChange, onChanged]);

  const openTask = (taskId: string) => {
    setTaskSheetId(taskId);
    setTaskSheetOpen(true);
  };

  const memberUserIds = new Set(detail?.members.map((m) => m.user.id) ?? []);
  const availableUsers = team.filter((u) => !memberUserIds.has(u.id));

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-[560px] p-0 flex flex-col gap-0">
          <SheetHeader className="p-5 pb-4 border-b border-border space-y-1">
            <SheetDescription className="text-xs text-muted-foreground font-mono flex items-center gap-2">
              {detail?.projectNumber ?? "—"}
              {detail && <StatusBadge status={detail.status} />}
              {detail && <PriorityBadge priority={detail.priority} />}
            </SheetDescription>
            <SheetTitle className="text-base leading-snug pr-6">{loading && !detail ? "Loading project…" : detail?.name ?? "Project"}</SheetTitle>
            {detail && (
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Building2 className="w-3 h-3" /> {detail.client.companyName}
                <span className="opacity-50">·</span>
                {typeLabel(detail.type, FALLBACK_TYPES)}
              </p>
            )}
          </SheetHeader>

          {loading && !detail ? (
            <div className="p-5 space-y-3">
              {Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : !detail ? (
            <div className="p-5"><ErrorState message="Project could not be loaded." onRetry={() => void loadDetail()} /></div>
          ) : (
            <Tabs value={tab} onValueChange={setTab} className="flex flex-col flex-1 min-h-0">
              <div className="px-5 pt-3 border-b border-border">
                <TabsList className="bg-secondary/60 h-9">
                  <TabsTrigger value="overview" className="text-xs">Overview</TabsTrigger>
                  <TabsTrigger value="phases" className="text-xs">Phases &amp; Tasks</TabsTrigger>
                  <TabsTrigger value="members" className="text-xs">Members</TabsTrigger>
                  <TabsTrigger value="checklists" className="text-xs">Checklists</TabsTrigger>
                  {canViewFiles && <TabsTrigger value="files" className="text-xs">Files</TabsTrigger>}
                  <TabsTrigger value="activity" className="text-xs">Activity</TabsTrigger>
                </TabsList>
              </div>

              <div className="flex-1 overflow-y-auto apex-scroll p-5">
                {/* ---------- Overview ---------- */}
                <TabsContent value="overview" className="mt-0 space-y-4 focus-visible:outline-none">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Status">
                      {canEdit ? (
                        <Select value={detail.status} onValueChange={(v) => void patchProject({ status: v })}>
                          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {(STATUS_TRANSITIONS[detail.status] ?? PROJECT_STATUSES).map((s) => (
                              <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : <StatusBadge status={detail.status} />}
                    </Field>
                    <Field label="Health">
                      {canEdit ? (
                        <Select value={detail.health} onValueChange={(v) => void patchProject({ health: v })}>
                          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {["ON_TRACK", "AT_RISK", "DELAYED"].map((h) => (
                              <SelectItem key={h} value={h}>{h.replace(/_/g, " ")}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : <HealthBadge health={detail.health} />}
                    </Field>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-xs font-medium text-muted-foreground">PROGRESS</p>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">{detail.progress}%</span>
                        {canEdit && (
                          <Button
                            size="sm" variant="ghost" className="h-6 px-2 text-[11px] text-primary"
                            onClick={() => void patchProject({ recomputeProgress: true })}
                            title="Recompute from completed tasks"
                          >
                            <RefreshCw className="w-3 h-3 mr-1" /> Recompute
                          </Button>
                        )}
                      </div>
                    </div>
                    <Progress value={detail.progress} className="h-2" />
                    <p className="text-[11px] text-muted-foreground mt-1.5">
                      {detail.taskStats.done}/{detail.taskStats.total} tasks done · {detail.taskStats.open} open
                    </p>
                  </div>

                  <Separator />

                  <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                    <div>
                      <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Client</p>
                      <p className="mt-0.5">{detail.client.companyName}</p>
                      <p className="text-[11px] text-muted-foreground">{detail.client.clientNumber}</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Manager</p>
                      <div className="mt-0.5 flex items-center gap-2">
                        {detail.manager ? (
                          <>
                            <UserAvatar name={detail.manager.name} color={detail.manager.avatarColor} />
                            <span className="text-sm">{detail.manager.name}</span>
                          </>
                        ) : <span className="text-sm text-muted-foreground">No manager</span>}
                      </div>
                    </div>
                    <div>
                      <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Start date</p>
                      <p className="mt-0.5">{formatDate(detail.startDate)}</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Deadline</p>
                      <p className={cn("mt-0.5 flex items-center gap-1.5", deadlineMeta(detail.deadline, detail.status).cls)}>
                        <CalendarClock className="w-3.5 h-3.5" />
                        {deadlineMeta(detail.deadline, detail.status).text}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Budget</p>
                      <p className="mt-0.5">{detail.budget != null ? formatCurrency(detail.budget) : "—"}</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Team</p>
                      <p className="mt-0.5">{detail.members.length} members · {detail.phases.length} phases</p>
                    </div>
                  </div>

                  {detail.description && (
                    <div>
                      <p className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1">Description</p>
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap">{detail.description}</p>
                    </div>
                  )}

                  {detail.invoices && detail.invoices.length > 0 && (
                    <div>
                      <p className="text-[11px] text-muted-foreground uppercase tracking-wide mb-2">Recent invoices</p>
                      <div className="space-y-1.5">
                        {detail.invoices.map((inv) => (
                          <div key={inv.id} className="flex items-center justify-between gap-2 p-2 rounded-lg border border-border/70 text-sm">
                            <span className="font-mono text-xs">{inv.invoiceNumber}</span>
                            <div className="flex items-center gap-2">
                              <span className="text-xs">{formatCurrency(inv.total, inv.currency)}</span>
                              <StatusBadge status={inv.status} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {canDelete && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="outline" className="w-full text-destructive hover:text-destructive border-destructive/40">
                          <Trash2 className="w-4 h-4 mr-2" /> Archive project
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Archive this project?</AlertDialogTitle>
                          <AlertDialogDescription>
                            “{detail.name}” will be hidden from the active list. Projects with open tasks cannot be archived.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={() => void archiveProject()}
                          >
                            Archive
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </TabsContent>

                {/* ---------- Phases & Tasks ---------- */}
                <TabsContent value="phases" className="mt-0 space-y-3 focus-visible:outline-none">
                  {detail.phases.length === 0 ? (
                    <EmptyState
                      icon={<FolderKanban className="w-5 h-5" />}
                      title="No phases"
                      description="This project was created without a type template."
                    />
                  ) : (
                    detail.phases.map((ph) => (
                      <div key={ph.id} className="rounded-lg border border-border overflow-hidden">
                        <div className="flex items-center justify-between gap-2 px-3 py-2 bg-secondary/40">
                          <span className="text-sm font-medium">{ph.name}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] text-muted-foreground">{ph.doneCount}/{ph.tasks.length} done</span>
                            <StatusBadge status={ph.status} />
                          </div>
                        </div>
                        <div className="divide-y divide-border/50">
                          {ph.tasks.map((t) => (
                            <button
                              key={t.id}
                              onClick={() => openTask(t.id)}
                              className="w-full flex items-center justify-between gap-2 px-3 py-2 hover:bg-accent/40 text-left transition-colors"
                            >
                              <div className="min-w-0">
                                <p className="text-sm truncate">{t.title}</p>
                                <p className="text-[10px] text-muted-foreground mt-0.5">
                                  {t.assignee?.name ?? "Unassigned"}
                                  {t.dueDate ? ` · due ${formatDate(t.dueDate)}` : ""}
                                </p>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <PriorityBadge priority={t.priority} />
                                <StatusBadge status={t.status} />
                              </div>
                            </button>
                          ))}
                          {ph.tasks.length === 0 && (
                            <p className="text-xs text-muted-foreground px-3 pt-2">No tasks in this phase yet.</p>
                          )}
                          <div className="px-3 pb-2.5">
                            <QuickAddTask projectId={detail.id} phaseId={ph.id} canCreate={canCreateTasks} onAdded={() => { void loadDetail(); onChanged?.(); }} />
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </TabsContent>

                {/* ---------- Members ---------- */}
                <TabsContent value="members" className="mt-0 focus-visible:outline-none">
                  {canAssign && (
                    <div className="flex flex-col sm:flex-row gap-2 mb-4">
                      <Select value={addUserId} onValueChange={setAddUserId} disabled={teamUnavailable}>
                        <SelectTrigger className="h-9 flex-1"><SelectValue placeholder="Select teammate" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none" disabled>Select teammate</SelectItem>
                          {availableUsers.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Select value={addRole} onValueChange={setAddRole}>
                        <SelectTrigger className="h-9 sm:w-32"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {MEMBER_ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Button className="h-9" disabled={addUserId === "none"} onClick={() => void addMember()}>
                        <UserPlus className="w-4 h-4 mr-1.5" /> Add
                      </Button>
                    </div>
                  )}
                  {canAssign && teamUnavailable && (
                    <p className="text-[11px] text-muted-foreground mb-3">
                      Team list requires the team.view permission — ask an admin to manage members.
                    </p>
                  )}
                  <div className="space-y-1.5">
                    {detail.members.map((m) => (
                      <div key={m.id} className="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-border/70">
                        <div className="flex items-center gap-3 min-w-0">
                          <UserAvatar name={m.user.name} color={m.user.avatarColor} className="w-8 h-8 text-[11px]" />
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{m.user.name}</p>
                            <p className="text-[11px] text-muted-foreground truncate">{m.user.title ?? "—"}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-secondary border border-border text-muted-foreground">
                            {m.role}
                          </span>
                          {canAssign && (
                            <button
                              onClick={() => void removeMember(m.user.id)}
                              className="text-muted-foreground hover:text-destructive transition-colors"
                              aria-label={`Remove ${m.user.name}`}
                            >
                              <X className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </TabsContent>

                {/* ---------- Checklists ---------- */}
                <TabsContent value="checklists" className="mt-0 space-y-6 focus-visible:outline-none">
                  <ChecklistSection
                    title="Onboarding"
                    entries={detail.onboardingChecklist}
                    onToggle={(i) => toggleChecklist("onboardingChecklist", i)}
                  />
                  <Separator />
                  <ChecklistSection
                    title="Completion"
                    entries={detail.completionChecklist}
                    onToggle={(i) => toggleChecklist("completionChecklist", i)}
                  />
                  {!canEdit && (
                    <p className="text-[11px] text-muted-foreground">You need projects.edit permission to update checklists.</p>
                  )}
                </TabsContent>

                {/* ---------- Files ---------- */}
                {canViewFiles && (
                  <TabsContent value="files" className="mt-0 focus-visible:outline-none">
                    <FileAttachments entityType="PROJECT" entityId={detail.id} />
                  </TabsContent>
                )}

                {/* ---------- Activity ---------- */}
                <TabsContent value="activity" className="mt-0 focus-visible:outline-none">
                  {detail.activities.length === 0 ? (
                    <EmptyState icon={<Activity className="w-5 h-5" />} title="No activity yet" description="Changes to this project will appear here." />
                  ) : (
                    <div className="space-y-4">
                      {detail.activities.map((a) => (
                        <div key={a.id} className="flex gap-3">
                          <div className="w-7 h-7 rounded-full bg-secondary border border-border flex items-center justify-center shrink-0 text-primary">
                            {ACTIVITY_ICONS[a.type] ?? <Activity className="w-3.5 h-3.5" />}
                          </div>
                          <div className="min-w-0 flex-1 border-b border-border/40 pb-3">
                            <p className="text-sm leading-snug">{a.title}</p>
                            {a.description && <p className="text-xs text-muted-foreground mt-0.5">{a.description}</p>}
                            <p className="text-[11px] text-muted-foreground mt-1">
                              <span
                                className="inline-flex w-4 h-4 rounded-full items-center justify-center text-[8px] font-bold mr-1 border align-middle"
                                style={{ backgroundColor: `${a.actorColor}22`, color: a.actorColor, borderColor: `${a.actorColor}55` }}
                              >
                                {initials(a.actorName)}
                              </span>
                              {a.actorName} · {relativeTime(a.createdAt)}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </TabsContent>
              </div>
            </Tabs>
          )}
        </SheetContent>
      </Sheet>

      <TaskDetailSheet
        taskId={taskSheetId}
        open={taskSheetOpen}
        onOpenChange={setTaskSheetOpen}
        onChanged={() => { void loadDetail(); onChanged?.(); }}
        navigate={navigate}
      />
    </>
  );
}

// ============================= Projects View =============================

export function ProjectsView({ navigate }: { navigate: (p: string) => void }) {
  const { data: session } = useSession();
  const me = session?.user;
  const { toast } = useToast();
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [newOpen, setNewOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [searchDraft, setSearchDraft] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const canCreate = !!me?.permissions?.includes("projects.create");

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const d = await api.get<Paged<ProjectItem>>("/api/projects?pageSize=100");
      setProjects(d.items);
    } catch (e) {
      setError(true);
      if (e instanceof ApiClientError && e.status === 403) {
        toast({ title: "Access denied", description: "You do not have permission to view projects.", variant: "destructive" });
      }
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load, reloadKey]);

  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);

  const stats = useMemo(() => {
    const isOpen = (p: ProjectItem) => !["COMPLETED", "CANCELLED"].includes(p.status);
    return {
      active: projects.filter((p) => p.status === "ACTIVE").length,
      onTrack: projects.filter((p) => p.health === "ON_TRACK" && isOpen(p)).length,
      atRisk: projects.filter((p) => p.health === "AT_RISK").length,
      delayed: projects.filter((p) => p.health === "DELAYED").length,
    };
  }, [projects]);

  const filtered = useMemo(() => {
    const q = searchDraft.trim().toLowerCase();
    return projects.filter((p) => {
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      if (q && !p.name.toLowerCase().includes(q) && !p.projectNumber.toLowerCase().includes(q) && !p.client.companyName.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [projects, searchDraft, statusFilter]);

  return (
    <div>
      <PageHeader
        title="Projects"
        description="Client delivery at a glance — health, progress, phases and deadlines."
        actions={
          canCreate ? (
            <Button onClick={() => setNewOpen(true)}>
              <Plus className="w-4 h-4 mr-2" /> New Project
            </Button>
          ) : undefined
        }
      />

      {/* Header stats mini-row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        {([
          { label: "Active", value: stats.active, dot: "bg-emerald-400" },
          { label: "On track", value: stats.onTrack, dot: "bg-cyan-400" },
          { label: "At risk", value: stats.atRisk, dot: "bg-amber-400" },
          { label: "Delayed", value: stats.delayed, dot: "bg-rose-400" },
        ] as const).map((s) => (
          <div key={s.label} className="apex-panel p-3.5 flex items-center gap-3">
            <span className={cn("w-2.5 h-2.5 rounded-full shrink-0", s.dot)} />
            <div>
              <p className="text-xl font-semibold leading-none">{loading ? "–" : s.value}</p>
              <p className="text-[11px] text-muted-foreground mt-1">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <Input
          value={searchDraft}
          onChange={(e) => setSearchDraft(e.target.value)}
          placeholder="Search projects…"
          className="h-9 sm:max-w-xs"
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-9 sm:w-44"><SelectValue placeholder="All statuses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {PROJECT_STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {error ? (
        <ErrorState message="Projects could not be loaded." onRetry={() => void load()} />
      ) : loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-48 w-full rounded-xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<FolderKanban className="w-5 h-5" />}
          title={projects.length === 0 ? "No projects yet" : "No projects match"}
          description={projects.length === 0
            ? canCreate
              ? "Create your first project to start planning delivery phases and tasks."
              : "Projects created by managers will appear here."
            : "Try adjusting the search or status filter."}
          action={
            projects.length === 0 && canCreate ? (
              <Button size="sm" onClick={() => setNewOpen(true)}><Plus className="w-4 h-4 mr-2" /> New Project</Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((p) => {
            const dl = deadlineMeta(p.deadline, p.status);
            return (
              <button
                key={p.id}
                onClick={() => { setDetailId(p.id); setDetailOpen(true); }}
                className="apex-panel p-4 text-left space-y-3 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5 transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-muted-foreground font-mono">{p.projectNumber}</span>
                  <StatusBadge status={p.status} />
                </div>
                <div>
                  <p className="font-semibold leading-snug line-clamp-1">{p.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{p.client?.companyName}</p>
                </div>
                <div className="flex items-center gap-2.5 flex-wrap">
                  <PriorityBadge priority={p.priority} />
                  <HealthBadge health={p.health} />
                  <span className="text-[10px] text-muted-foreground">{p.phasesCount} phases · {p.membersCount} members</span>
                </div>
                <div>
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
                    <span>{p.doneTasks}/{p.totalTasks} tasks done</span>
                    <span className="font-medium">{p.progress}%</span>
                  </div>
                  <Progress value={p.progress} className="h-1.5" />
                </div>
                <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/60">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <UserAvatar name={p.manager?.name} color={p.manager?.avatarColor} />
                    <span className="text-[11px] truncate text-muted-foreground">{p.manager?.name ?? "No manager"}</span>
                  </div>
                  <span className={cn("text-[11px] flex items-center gap-1 shrink-0", dl.cls)}>
                    <CalendarClock className="w-3 h-3" /> {dl.text}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <ProjectDetailSheet
        projectId={detailId}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onChanged={refresh}
        navigate={navigate}
      />
      <NewProjectDialog open={newOpen} onOpenChange={setNewOpen} onCreated={refresh} />
    </div>
  );
}
