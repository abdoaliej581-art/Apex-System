"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import {
  DndContext, DragOverlay, PointerSensor,
  useDraggable, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { api, ApiClientError, qs, formatDate, relativeTime, initials } from "@/lib/api-client";
import { useToast } from "@/hooks/use-toast";
import { PageHeader, EmptyState, ErrorState, StatusBadge, PriorityBadge, Field } from "@/components/shared";
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import {
  CalendarDays, CheckSquare, ClipboardList, Clock, Flag, FolderKanban, GripVertical, ListTodo,
  MessageSquare, MoreVertical, Plus, Search, Trash2, X,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ============================= Types =============================

type MiniUser = { id: string; name: string; avatarColor: string };
type TaskItem = {
  id: string;
  title: string;
  description?: string | null;
  projectId?: string | null;
  project?: { id: string; name: string } | null;
  phaseId?: string | null;
  phase?: { id: string; name: string } | null;
  assigneeId?: string | null;
  assignee?: MiniUser | null;
  reporter?: MiniUser | null;
  priority: string;
  status: string;
  dueDate?: string | null;
  estimatedHours?: number | null;
  actualHours?: number | null;
  labels?: string[] | null;
  position?: number;
  completedAt?: string | null;
  createdAt: string;
  checklistDone?: number;
  checklistTotal?: number;
  commentsCount?: number;
};
type ChecklistRow = { id: string; text: string; isDone: boolean; order: number };
type TaskDetail = TaskItem & { checklist: ChecklistRow[] };
type CommentItem = { id: string; body: string; createdAt: string; author?: MiniUser | null };
type Paged<T> = { items: T[]; total: number; page: number; pageSize: number };
type ProjectOption = { id: string; name: string };
type TeamOption = MiniUser & { title?: string | null };

const TASK_STATUSES = ["BACKLOG", "TODO", "IN_PROGRESS", "REVIEW", "BLOCKED", "DONE"] as const;
type TaskStatus = (typeof TASK_STATUSES)[number];

const STATUS_LABELS: Record<string, string> = {
  BACKLOG: "Backlog", TODO: "To Do", IN_PROGRESS: "In Progress",
  REVIEW: "Review", BLOCKED: "Blocked", DONE: "Done",
};

const COLUMN_ACCENTS: Record<string, string> = {
  BACKLOG: "text-slate-300",
  TODO: "text-sky-300",
  IN_PROGRESS: "text-cyan-300",
  REVIEW: "text-violet-300",
  BLOCKED: "text-rose-300",
  DONE: "text-emerald-300",
};

const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"];

function statusLabel(s: string): string {
  return STATUS_LABELS[s] ?? s.replace(/_/g, " ");
}

function dueMeta(due?: string | null): { text: string; cls: string } {
  if (!due) return { text: "No due date", cls: "text-muted-foreground" };
  const day = new Date(due);
  day.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((day.getTime() - today.getTime()) / 86400000);
  if (diff < 0) return { text: formatDate(due), cls: "text-rose-300 font-medium" };
  if (diff === 0) return { text: "Today", cls: "text-amber-300 font-medium" };
  return { text: formatDate(due), cls: "text-muted-foreground" };
}

function toISODate(d?: string | null): string {
  if (!d) return "";
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

export function UserAvatar({ name, color, className }: { name?: string | null; color?: string | null; className?: string }) {
  const c = color || "#22d3ee";
  return (
    <div
      className={cn("w-6 h-6 rounded-full border flex items-center justify-center text-[9px] font-bold shrink-0", className)}
      style={{ backgroundColor: `${c}22`, color: c, borderColor: `${c}55` }}
      title={name ?? undefined}
      aria-label={name ?? "user"}
    >
      {initials(name)}
    </div>
  );
}

// ============================= Task Detail Sheet (shared) =============================

function InlineText({
  value, onCommit, placeholder, multiline, className, disabled,
}: {
  value: string | null | undefined;
  onCommit: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  className?: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(value ?? "");
  const [syncedFrom, setSyncedFrom] = useState(value ?? "");
  // Render-time state adjustment (React docs: adjusting state when props change)
  if (syncedFrom !== (value ?? "")) {
    setSyncedFrom(value ?? "");
    setDraft(value ?? "");
  }
  const commit = () => { if (draft.trim() !== (value ?? "")) onCommit(draft.trim()); };
  const shared = {
    value: draft,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
    onBlur: commit,
    placeholder,
    disabled,
    className,
  };
  return multiline ? <Textarea rows={3} {...shared} /> : <Input {...shared} />;
}

function InlineNumber({
  value, onCommit, placeholder, step,
}: {
  value: number | null | undefined;
  onCommit: (v: number | null) => void;
  placeholder?: string;
  step?: string;
}) {
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  const [syncedFrom, setSyncedFrom] = useState(value == null ? "" : String(value));
  if (syncedFrom !== (value == null ? "" : String(value))) {
    setSyncedFrom(value == null ? "" : String(value));
    setDraft(value == null ? "" : String(value));
  }
  const commit = () => {
    if (draft === "") { if (value != null) onCommit(null); return; }
    const n = Number(draft);
    if (!Number.isNaN(n) && n !== value) onCommit(n);
  };
  return (
    <Input
      type="number" min="0" step={step} value={draft}
      onChange={(e) => setDraft(e.target.value)} onBlur={commit}
      placeholder={placeholder} className="h-9"
    />
  );
}

function InlineDate({ value, onCommit }: { value: string | null | undefined; onCommit: (v: string | null) => void }) {
  const [draft, setDraft] = useState(toISODate(value));
  const [syncedFrom, setSyncedFrom] = useState(toISODate(value));
  if (syncedFrom !== toISODate(value)) {
    setSyncedFrom(toISODate(value));
    setDraft(toISODate(value));
  }
  const commit = () => {
    const next = draft || null;
    if (next !== toISODate(value)) onCommit(next);
  };
  return <Input type="date" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} className="h-9" />;
}

export function TaskDetailSheet({
  taskId, open, onOpenChange, onChanged, navigate,
}: {
  taskId: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onChanged?: () => void;
  navigate: (p: string) => void;
}) {
  const { data: session } = useSession();
  const me = session?.user;
  const { toast } = useToast();
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("overview");
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [commentDraft, setCommentDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [newItemText, setNewItemText] = useState("");
  const [teamList, setTeamList] = useState<MiniUser[] | null>(null);

  const canEdit = !!me?.permissions?.includes("tasks.edit");
  const canDelete = !!me?.permissions?.includes("tasks.delete");

  const loadDetail = useCallback(async () => {
    if (!taskId) return;
    setLoading(true);
    try {
      const [d, c] = await Promise.all([
        api.get<{ task: TaskDetail }>(`/api/tasks/${taskId}`),
        api.get<{ comments: CommentItem[] }>(`/api/tasks/${taskId}/comments`),
      ]);
      setTask(d.task);
      setComments(c.comments);
    } catch (e) {
      toast({
        title: "Could not load task",
        description: e instanceof ApiClientError ? e.message : undefined,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [taskId, toast]);

  useEffect(() => {
    if (open && taskId) {
      setTab("overview");
      void loadDetail();
    }
    if (!open) setTask(null);
  }, [open, taskId, loadDetail]);

  // Team list for assignee select (may be unavailable without team.view)
  useEffect(() => {
    if (!open || teamList) return;
    api.get<{ team: TeamOption[] }>("/api/team")
      .then((d) => setTeamList(d.team.map((m) => ({ id: m.id, name: m.name, avatarColor: m.avatarColor }))))
      .catch(() => setTeamList(null));
  }, [open, teamList]);

  const patchTask = useCallback(async (fields: Record<string, unknown>, opts?: { silent?: boolean }) => {
    if (!taskId) return;
    try {
      const d = await api.patch<{ task: TaskDetail }>(`/api/tasks/${taskId}`, fields);
      setTask(d.task);
      if (!opts?.silent) toast({ title: "Task updated" });
      onChanged?.();
    } catch (e) {
      toast({
        title: "Update failed",
        description: e instanceof ApiClientError ? e.message : "Please try again.",
        variant: "destructive",
      });
      void loadDetail();
    }
  }, [taskId, toast, onChanged, loadDetail]);

  // ---- checklist actions (optimistic) ----
  const toggleItem = useCallback(async (itemId: string, isDone: boolean) => {
    if (!taskId || !task) return;
    const prev = task;
    setTask({ ...task, checklist: task.checklist.map((i) => (i.id === itemId ? { ...i, isDone } : i)) });
    try {
      await api.patch(`/api/tasks/${taskId}/checklist/${itemId}`, { isDone });
      onChanged?.();
    } catch (e) {
      setTask(prev);
      toast({
        title: "Could not update checklist",
        description: e instanceof ApiClientError ? e.message : undefined,
        variant: "destructive",
      });
    }
  }, [taskId, task, toast, onChanged]);

  const addItem = useCallback(async () => {
    const text = newItemText.trim();
    if (!taskId || !text) return;
    setNewItemText("");
    try {
      const d = await api.post<{ item: ChecklistRow }>(`/api/tasks/${taskId}/checklist`, { text });
      setTask((t) => (t ? { ...t, checklist: [...t.checklist, d.item] } : t));
      onChanged?.();
    } catch (e) {
      toast({
        title: "Could not add item",
        description: e instanceof ApiClientError ? e.message : undefined,
        variant: "destructive",
      });
    }
  }, [taskId, newItemText, toast, onChanged]);

  const removeItem = useCallback(async (itemId: string) => {
    if (!taskId || !task) return;
    const prev = task;
    setTask({ ...task, checklist: task.checklist.filter((i) => i.id !== itemId) });
    try {
      await api.delete(`/api/tasks/${taskId}/checklist/${itemId}`);
      onChanged?.();
    } catch (e) {
      setTask(prev);
      toast({
        title: "Could not remove item",
        description: e instanceof ApiClientError ? e.message : undefined,
        variant: "destructive",
      });
    }
  }, [taskId, task, toast, onChanged]);

  // ---- comments ----
  const addComment = useCallback(async () => {
    const body = commentDraft.trim();
    if (!taskId || !body) return;
    setPosting(true);
    try {
      const d = await api.post<{ comment: CommentItem }>(`/api/tasks/${taskId}/comments`, { body });
      setComments((list) => [...list, d.comment]);
      setCommentDraft("");
      onChanged?.();
    } catch (e) {
      toast({
        title: "Could not post comment",
        description: e instanceof ApiClientError ? e.message : undefined,
        variant: "destructive",
      });
    } finally {
      setPosting(false);
    }
  }, [taskId, commentDraft, toast, onChanged]);

  const deleteTask = useCallback(async () => {
    if (!taskId) return;
    try {
      await api.delete(`/api/tasks/${taskId}`);
      toast({ title: "Task deleted" });
      onOpenChange(false);
      onChanged?.();
    } catch (e) {
      toast({
        title: "Could not delete task",
        description: e instanceof ApiClientError ? e.message : undefined,
        variant: "destructive",
      });
    }
  }, [taskId, toast, onOpenChange, onChanged]);

  const doneCount = task?.checklist.filter((i) => i.isDone).length ?? 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-[560px] p-0 flex flex-col gap-0">
        <SheetHeader className="p-5 pb-4 border-b border-border space-y-1">
          <SheetDescription className="text-xs text-muted-foreground">
            {task?.project ? (
              <button
                className="hover:text-primary underline-offset-2 hover:underline"
                onClick={() => { onOpenChange(false); navigate("projects"); }}
              >
                {task.project.name}
              </button>
            ) : ("Standalone task")}
            {task?.phase ? ` · ${task.phase.name}` : ""}
          </SheetDescription>
          <SheetTitle className="text-base leading-snug pr-6">
            {loading && !task ? "Loading task…" : task?.title ?? "Task"}
          </SheetTitle>
        </SheetHeader>

        {loading && !task ? (
          <div className="p-5 space-y-3">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : !task ? (
          <div className="p-5"><ErrorState message="Task could not be loaded." onRetry={() => void loadDetail()} /></div>
        ) : (
          <>
            <Tabs value={tab} onValueChange={setTab} className="flex flex-col flex-1 min-h-0">
              <div className="px-5 pt-3 border-b border-border">
                <TabsList className="bg-secondary/60 h-9">
                  <TabsTrigger value="overview" className="text-xs">Overview</TabsTrigger>
                  <TabsTrigger value="checklist" className="text-xs">
                    Checklist{task.checklist.length > 0 ? ` (${doneCount}/${task.checklist.length})` : ""}
                  </TabsTrigger>
                  <TabsTrigger value="comments" className="text-xs">
                    Comments{task.commentsCount ? ` (${task.commentsCount})` : ""}
                  </TabsTrigger>
                </TabsList>
              </div>

              <div className="flex-1 overflow-y-auto apex-scroll p-5">
                {/* ---------- Overview ---------- */}
                <TabsContent value="overview" className="mt-0 space-y-4 focus-visible:outline-none">
                  {canEdit ? (
                    <Field label="Title">
                      <InlineText value={task.title} onCommit={(v) => v && patchTask({ title: v })} />
                    </Field>
                  ) : (
                    <p className="text-sm font-medium">{task.title}</p>
                  )}

                  {canEdit ? (
                    <Field label="Description">
                      <InlineText
                        value={task.description}
                        onCommit={(v) => patchTask({ description: v || null })}
                        placeholder="Add a description…"
                        multiline
                      />
                    </Field>
                  ) : task.description ? (
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{task.description}</p>
                  ) : null}

                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Status">
                      {canEdit ? (
                        <Select value={task.status} onValueChange={(v) => void patchTask({ status: v })}>
                          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {TASK_STATUSES.map((s) => (
                              <SelectItem key={s} value={s}>{statusLabel(s)}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : <StatusBadge status={task.status} />}
                    </Field>
                    <Field label="Priority">
                      {canEdit ? (
                        <Select value={task.priority} onValueChange={(v) => void patchTask({ priority: v })}>
                          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      ) : <PriorityBadge priority={task.priority} />}
                    </Field>
                  </div>

                  <Field label="Assignee">
                    {canEdit && teamList ? (
                      <Select
                        value={task.assigneeId ?? "none"}
                        onValueChange={(v) => void patchTask({ assigneeId: v === "none" ? null : v })}
                      >
                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Unassigned</SelectItem>
                          {teamList.map((u) => (
                            <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : canEdit && !teamList && me ? (
                      <div className="flex items-center gap-2">
                        <span className="text-sm flex-1">{task.assignee?.name ?? "Unassigned"}</span>
                        {task.assigneeId !== me.id && (
                          <Button size="sm" variant="outline" onClick={() => void patchTask({ assigneeId: me.id })}>
                            Assign to me
                          </Button>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-sm">
                        {task.assignee ? (
                          <><UserAvatar name={task.assignee.name} color={task.assignee.avatarColor} />{task.assignee.name}</>
                        ) : ("Unassigned")}
                      </div>
                    )}
                  </Field>

                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Due date">
                      {canEdit ? (
                        <InlineDate value={task.dueDate} onCommit={(v) => void patchTask({ dueDate: v })} />
                      ) : (
                        <p className={cn("text-sm h-9 flex items-center", dueMeta(task.dueDate).cls)}>{dueMeta(task.dueDate).text}</p>
                      )}
                    </Field>
                    <Field label="Estimated hours">
                      {canEdit ? (
                        <InlineNumber value={task.estimatedHours} onCommit={(v) => void patchTask({ estimatedHours: v })} step="0.5" placeholder="0" />
                      ) : (
                        <p className="text-sm h-9 flex items-center">{task.estimatedHours ?? "—"}</p>
                      )}
                    </Field>
                  </div>

                  {canEdit && (
                    <Field label="Actual hours">
                      <InlineNumber value={task.actualHours} onCommit={(v) => void patchTask({ actualHours: v })} step="0.5" placeholder="0" />
                    </Field>
                  )}

                  <Field label="Labels">
                    {canEdit ? (
                      <InlineText
                        value={(task.labels ?? []).join(", ")}
                        onCommit={(v) => patchTask({ labels: v || null })}
                        placeholder="comma separated, e.g. frontend, urgent"
                      />
                    ) : (task.labels ?? []).length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {task.labels?.map((l) => (
                          <span key={l} className="text-[11px] px-2 py-0.5 rounded-md bg-secondary border border-border">{l}</span>
                        ))}
                      </div>
                    ) : <p className="text-sm text-muted-foreground">—</p>}
                  </Field>

                  <Separator />
                  <div className="text-[11px] text-muted-foreground space-y-1">
                    <p>Created {relativeTime(task.createdAt)}{task.reporter ? ` by ${task.reporter.name}` : ""}</p>
                    {task.completedAt && <p>Completed {relativeTime(task.completedAt)}</p>}
                  </div>

                  {canDelete && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="outline" className="w-full text-destructive hover:text-destructive border-destructive/40">
                          <Trash2 className="w-4 h-4 mr-2" /> Delete task
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete this task?</AlertDialogTitle>
                          <AlertDialogDescription>
                            “{task.title}” will be removed from the board. This cannot be undone from the UI.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={() => void deleteTask()}
                          >
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </TabsContent>

                {/* ---------- Checklist ---------- */}
                <TabsContent value="checklist" className="mt-0 focus-visible:outline-none">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-medium">
                      {task.checklist.length > 0 ? `${doneCount}/${task.checklist.length} completed` : "No items yet"}
                    </p>
                    {task.checklist.length > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {Math.round((doneCount / task.checklist.length) * 100)}%
                      </span>
                    )}
                  </div>
                  {task.checklist.length > 0 && (
                    <Progress value={(doneCount / task.checklist.length) * 100} className="h-1.5 mb-4" />
                  )}
                  <div className="space-y-1.5">
                    {task.checklist.map((item) => (
                      <div key={item.id} className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-accent/50 group">
                        <Checkbox
                          checked={item.isDone}
                          disabled={!canEdit}
                          onCheckedChange={(v) => void toggleItem(item.id, v === true)}
                          aria-label={`Toggle ${item.text}`}
                        />
                        <span className={cn("text-sm flex-1", item.isDone && "line-through text-muted-foreground")}>{item.text}</span>
                        {canEdit && (
                          <button
                            onClick={() => void removeItem(item.id)}
                            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                            aria-label={`Delete ${item.text}`}
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  {canEdit && (
                    <div className="flex gap-2 mt-4">
                      <Input
                        value={newItemText}
                        onChange={(e) => setNewItemText(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void addItem(); } }}
                        placeholder="Add checklist item…"
                        className="h-9"
                      />
                      <Button size="sm" className="h-9" disabled={!newItemText.trim()} onClick={() => void addItem()}>
                        <Plus className="w-4 h-4 mr-1" /> Add
                      </Button>
                    </div>
                  )}
                </TabsContent>

                {/* ---------- Comments ---------- */}
                <TabsContent value="comments" className="mt-0 focus-visible:outline-none">
                  {comments.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-6">No comments yet. Start the discussion.</p>
                  ) : (
                    <div className="space-y-4">
                      {comments.map((c) => (
                        <div key={c.id} className="flex gap-3">
                          <UserAvatar name={c.author?.name} color={c.author?.avatarColor} className="w-7 h-7 text-[10px]" />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs">
                              <span className="font-medium">{c.author?.name ?? "Unknown"}</span>
                              <span className="text-muted-foreground ml-2">{relativeTime(c.createdAt)}</span>
                            </p>
                            <p className="text-sm mt-1 whitespace-pre-wrap break-words">{c.body}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <Separator className="my-4" />
                  <div className="space-y-2">
                    <Textarea
                      value={commentDraft}
                      onChange={(e) => setCommentDraft(e.target.value)}
                      placeholder="Write a comment…"
                      rows={3}
                    />
                    <div className="flex justify-end">
                      <Button size="sm" disabled={!commentDraft.trim() || posting} onClick={() => void addComment()}>
                        <MessageSquare className="w-4 h-4 mr-2" /> {posting ? "Posting…" : "Comment"}
                      </Button>
                    </div>
                  </div>
                </TabsContent>
              </div>
            </Tabs>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ============================= Kanban =============================

function KanbanCard({
  task, onOpen, onMoveTo, onOpenProject,
}: {
  task: TaskItem;
  onOpen: () => void;
  onMoveTo: (s: string) => void;
  onOpenProject: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id });
  const due = dueMeta(task.dueDate);
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={transform ? { transform: `translate(${transform.x}px, ${transform.y}px)`, zIndex: 60, position: "relative" } : undefined}
      className={cn(
        "rounded-lg border bg-card p-3 space-y-2.5 select-none touch-none",
        isDragging ? "opacity-35 border-primary/50" : "hover:border-primary/40 cursor-grab active:cursor-grabbing",
      )}
    >
      <div className="flex items-start justify-between gap-1.5">
        <button
          onClick={onOpen}
          className="text-sm font-medium text-left leading-snug hover:text-primary transition-colors line-clamp-2"
        >
          {task.title}
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              className="p-1 rounded hover:bg-accent shrink-0"
              aria-label={`Actions for ${task.title}`}
            >
              <MoreVertical className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuLabel className="text-xs">Move to…</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {TASK_STATUSES.filter((s) => s !== task.status).map((s) => (
              <DropdownMenuItem key={s} onClick={() => onMoveTo(s)} className="text-xs">
                {statusLabel(s)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {task.project && (
        <button
          onClick={(e) => { e.stopPropagation(); onOpenProject(); }}
          onPointerDown={(e) => e.stopPropagation()}
          className="text-[11px] text-cyan-300/90 hover:text-cyan-200 truncate block max-w-full text-left"
        >
          {task.project.name}
        </button>
      )}

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <PriorityBadge priority={task.priority} />
          {!!task.checklistTotal && (
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
              <CheckSquare className="w-3 h-3" />
              {task.checklistDone ?? 0}/{task.checklistTotal}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={cn("text-[10px]", due.cls)}>{due.text}</span>
          <UserAvatar name={task.assignee?.name} color={task.assignee?.avatarColor} />
        </div>
      </div>
    </div>
  );
}

function KanbanColumn({
  status, tasks, onOpenTask, onMoveTo, onOpenProject,
}: {
  status: TaskStatus;
  tasks: TaskItem[];
  onOpenTask: (t: TaskItem) => void;
  onMoveTo: (taskId: string, s: string) => void;
  onOpenProject: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "w-[272px] shrink-0 rounded-xl border flex flex-col bg-card/50 transition-colors",
        isOver ? "border-primary/60 bg-primary/5" : "border-border",
      )}
    >
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border/60">
        <span className={cn("text-xs font-semibold uppercase tracking-wide flex items-center gap-2", COLUMN_ACCENTS[status])}>
          <GripVertical className="w-3 h-3 opacity-50" />
          {statusLabel(status)}
        </span>
        <span className="text-[11px] text-muted-foreground bg-secondary px-1.5 py-0.5 rounded">{tasks.length}</span>
      </div>
      <div className="flex-1 overflow-y-auto apex-scroll p-2 space-y-2 min-h-[140px] max-h-[calc(100vh-340px)]">
        {tasks.map((t) => (
          <KanbanCard key={t.id} task={t} onOpen={() => onOpenTask(t)} onMoveTo={(s) => onMoveTo(t.id, s)} onOpenProject={onOpenProject} />
        ))}
        {tasks.length === 0 && (
          <p className="text-center text-[11px] text-muted-foreground py-8 border border-dashed border-border/60 rounded-lg">
            Drop tasks here
          </p>
        )}
      </div>
    </div>
  );
}

// ============================= New Task Dialog =============================

function NewTaskDialog({
  open, onOpenChange, projects, team, teamUnavailable, canAssign, meId, onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projects: ProjectOption[];
  team: MiniUser[];
  teamUnavailable: boolean;
  canAssign: boolean;
  meId?: string;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState("none");
  const [phaseId, setPhaseId] = useState("none");
  const [phases, setPhases] = useState<{ id: string; name: string }[]>([]);
  const [assigneeId, setAssigneeId] = useState("none");
  const [priority, setPriority] = useState("MEDIUM");
  const [dueDate, setDueDate] = useState("");
  const [estimatedHours, setEstimatedHours] = useState("");
  const [labels, setLabels] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setTitle(""); setDescription(""); setProjectId("none"); setPhaseId("none");
      setPhases([]); setAssigneeId("none"); setPriority("MEDIUM");
      setDueDate(""); setEstimatedHours(""); setLabels("");
    }
  }, [open]);

  useEffect(() => {
    setPhaseId("none");
    setPhases([]);
    if (projectId === "none") return;
    api.get<{ phases: { id: string; name: string }[] }>(`/api/projects/${projectId}`)
      .then((d) => setPhases(d.phases))
      .catch(() => setPhases([]));
  }, [projectId]);

  const submit = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await api.post("/api/tasks", {
        title: title.trim(),
        description: description.trim() || undefined,
        projectId: projectId === "none" ? undefined : projectId,
        phaseId: phaseId === "none" ? undefined : phaseId,
        assigneeId: assigneeId === "none" ? undefined : assigneeId,
        priority,
        dueDate: dueDate || undefined,
        estimatedHours: estimatedHours ? Number(estimatedHours) : undefined,
        labels: labels.trim() || undefined,
      });
      toast({ title: "Task created", description: title.trim() });
      onOpenChange(false);
      onCreated();
    } catch (e) {
      toast({
        title: "Could not create task",
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
          <DialogTitle>New task</DialogTitle>
        </DialogHeader>
        <div className="space-y-3.5 py-1">
          <Field label="Title" required>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs to be done?" />
          </Field>
          <Field label="Description">
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Optional details…" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Project">
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger className="h-9"><SelectValue placeholder="No project" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No project</SelectItem>
                  {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Phase" hint={projectId !== "none" && phases.length === 0 ? "No phases for this project" : undefined}>
              <Select value={phaseId} onValueChange={setPhaseId} disabled={projectId === "none" || phases.length === 0}>
                <SelectTrigger className="h-9"><SelectValue placeholder={projectId === "none" ? "Select project first" : "No phase"} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No phase</SelectItem>
                  {phases.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Assignee" hint={teamUnavailable && canAssign ? "Team list unavailable" : undefined}>
              {canAssign ? (
                <Select value={assigneeId} onValueChange={setAssigneeId} disabled={teamUnavailable}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Unassigned</SelectItem>
                    {team.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <Select value={assigneeId === meId ? "me" : "none"} onValueChange={(v) => setAssigneeId(v === "me" ? (meId ?? "none") : "none")}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Unassigned</SelectItem>
                    <SelectItem value="me">Assign to me</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </Field>
            <Field label="Priority">
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Due date">
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="h-9" />
            </Field>
            <Field label="Estimated hours">
              <Input type="number" min="0" step="0.5" value={estimatedHours} onChange={(e) => setEstimatedHours(e.target.value)} className="h-9" placeholder="0" />
            </Field>
          </div>
          <Field label="Labels" hint="Comma separated">
            <Input value={labels} onChange={(e) => setLabels(e.target.value)} placeholder="e.g. frontend, urgent" />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!title.trim() || saving} onClick={() => void submit()}>
            {saving ? "Creating…" : "Create task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================= Tasks View =============================

export function TasksView({ navigate }: { navigate: (p: string) => void }) {
  const { data: session } = useSession();
  const me = session?.user;
  const { toast } = useToast();

  const [tab, setTab] = useState<"kanban" | "list" | "mine">("kanban");
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const [filters, setFilters] = useState({
    q: "", projectId: "all", assigneeId: "all", status: "all", priority: "all", dueFrom: "", dueTo: "",
  });
  const [searchDraft, setSearchDraft] = useState("");

  const [projectsList, setProjectsList] = useState<ProjectOption[]>([]);
  const [teamList, setTeamList] = useState<MiniUser[]>([]);
  const [teamUnavailable, setTeamUnavailable] = useState(false);

  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);

  const [activeTask, setActiveTask] = useState<TaskItem | null>(null);
  const tasksRef = useRef<TaskItem[]>([]);
  tasksRef.current = tasks;

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const canCreate = !!me?.permissions?.includes("tasks.create");
  const canAssign = !!me?.permissions?.includes("tasks.assign");

  // Lookup data for selects (degrade silently when permission missing)
  useEffect(() => {
    api.get<Paged<ProjectOption>>("/api/projects?pageSize=100")
      .then((d) => setProjectsList(d.items.map((p) => ({ id: p.id, name: p.name }))))
      .catch(() => setProjectsList([]));
    api.get<{ team: TeamOption[] }>("/api/team")
      .then((d) => setTeamList(d.team.map((m) => ({ id: m.id, name: m.name, avatarColor: m.avatarColor }))))
      .catch(() => setTeamUnavailable(true));
  }, []);

  // Main data fetch — query built per tab
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(false);
      try {
        const params: Record<string, string | number> = {};
        if (tab === "kanban") {
          params.pageSize = 100;
          if (filters.q) params.q = filters.q;
          if (filters.projectId !== "all") params.projectId = filters.projectId;
          if (filters.priority !== "all") params.priority = filters.priority;
        } else if (tab === "list") {
          params.page = page;
          params.pageSize = pageSize;
          if (filters.q) params.q = filters.q;
          if (filters.projectId !== "all") params.projectId = filters.projectId;
          if (filters.assigneeId !== "all") params.assigneeId = filters.assigneeId;
          if (filters.status !== "all") params.status = filters.status;
          if (filters.priority !== "all") params.priority = filters.priority;
          if (filters.dueFrom) params.dueFrom = new Date(`${filters.dueFrom}T00:00:00Z`).toISOString();
          if (filters.dueTo) params.dueTo = new Date(`${filters.dueTo}T23:59:59Z`).toISOString();
        } else {
          params.view = "my";
          params.pageSize = 100;
        }
        const data = await api.get<Paged<TaskItem>>(`/api/tasks${qs(params)}`);
        if (!cancelled) {
          setTasks(data.items);
          setTotal(data.total);
        }
      } catch (e) {
        if (!cancelled) {
          setError(true);
          if (e instanceof ApiClientError && e.status === 403) {
            toast({ title: "Access denied", description: "You do not have permission to view tasks.", variant: "destructive" });
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tab, page, filters, reloadKey, toast]);

  const updateFilters = useCallback((patch: Partial<typeof filters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  }, []);

  const openTask = useCallback((t: TaskItem) => {
    setDetailId(t.id);
    setDetailOpen(true);
  }, []);

  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);

  // ---- Kanban move (optimistic) ----
  const moveTask = useCallback(async (taskId: string, status: string) => {
    const task = tasksRef.current.find((t) => t.id === taskId);
    if (!task || task.status === status) return;
    const prev = tasksRef.current;
    setTasks((list) => list.map((t) => (t.id === taskId ? { ...t, status } : t)));
    try {
      const d = await api.patch<{ task: TaskItem }>(`/api/tasks/${taskId}`, { status });
      setTasks((list) => list.map((t) => (t.id === taskId ? { ...t, ...d.task } : t)));
      toast({ title: `Moved to ${statusLabel(status)}`, description: task.title });
    } catch (e) {
      setTasks(prev);
      toast({
        title: "Could not move task",
        description: e instanceof ApiClientError ? e.message : "Please try again.",
        variant: "destructive",
      });
    }
  }, [toast]);

  const onDragStart = useCallback((e: DragStartEvent) => {
    setActiveTask(tasksRef.current.find((t) => t.id === e.active.id) ?? null);
  }, []);

  const onDragEnd = useCallback((e: DragEndEvent) => {
    setActiveTask(null);
    const overId = e.over?.id;
    if (!overId || typeof overId !== "string") return;
    if (!(TASK_STATUSES as readonly string[]).includes(overId)) return;
    void moveTask(String(e.active.id), overId);
  }, [moveTask]);

  // ---- My Tasks: complete (optimistic) ----
  const completeTask = useCallback(async (taskId: string) => {
    const prev = tasksRef.current;
    setTasks((list) => list.filter((t) => t.id !== taskId));
    try {
      await api.patch(`/api/tasks/${taskId}`, { status: "DONE" });
      toast({ title: "Task completed 🎉" });
      refresh();
    } catch (e) {
      setTasks(prev);
      toast({
        title: "Could not complete task",
        description: e instanceof ApiClientError ? e.message : "Please try again.",
        variant: "destructive",
      });
    }
  }, [toast, refresh]);

  const kanbanGroups = useMemo(() => {
    const map = new Map<string, TaskItem[]>();
    TASK_STATUSES.forEach((s) => map.set(s, []));
    tasks.forEach((t) => {
      if ((TASK_STATUSES as readonly string[]).includes(t.status)) map.get(t.status)?.push(t);
      else map.get("BACKLOG")?.push(t);
    });
    return map;
  }, [tasks]);

  const myGroups = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const open = tasks.filter((t) => t.status !== "DONE");
    const groups: { key: string; label: string; icon: React.ReactNode; items: TaskItem[] }[] = [
      { key: "overdue", label: "Overdue", icon: <Flag className="w-3.5 h-3.5" />, items: [] },
      { key: "today", label: "Today", icon: <Clock className="w-3.5 h-3.5" />, items: [] },
      { key: "upcoming", label: "Upcoming", icon: <CalendarDays className="w-3.5 h-3.5" />, items: [] },
      { key: "nodate", label: "No due date", icon: <ListTodo className="w-3.5 h-3.5" />, items: [] },
    ];
    open.forEach((t) => {
      if (!t.dueDate) { groups[3].items.push(t); return; }
      const d = new Date(t.dueDate);
      d.setHours(0, 0, 0, 0);
      if (d.getTime() < today.getTime()) groups[0].items.push(t);
      else if (d.getTime() === today.getTime()) groups[1].items.push(t);
      else groups[2].items.push(t);
    });
    return groups;
  }, [tasks]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasActiveFilters = Object.values(filters).some((v) => v && v !== "all");

  const projectChip = (task: TaskItem) =>
    task.project ? (
      <button
        onClick={(e) => { e.stopPropagation(); navigate("projects"); }}
        className="text-[11px] text-cyan-300/90 hover:text-cyan-200 truncate max-w-[180px] text-left"
        title={task.project.name}
      >
        {task.project.name}
      </button>
    ) : <span className="text-[11px] text-muted-foreground">No project</span>;

  return (
    <div>
      <PageHeader
        title="Tasks"
        description="Plan and execute the team's work — kanban board, filtered list and your personal focus."
        actions={
          canCreate ? (
            <Button onClick={() => setNewOpen(true)}>
              <Plus className="w-4 h-4 mr-2" /> New Task
            </Button>
          ) : undefined
        }
      />

      <Tabs
        value={tab}
        onValueChange={(v) => { setTab(v as typeof tab); setPage(1); }}
      >
        <TabsList className="bg-secondary/60 mb-4">
          <TabsTrigger value="kanban" className="text-xs sm:text-sm">Kanban</TabsTrigger>
          <TabsTrigger value="list" className="text-xs sm:text-sm">List</TabsTrigger>
          <TabsTrigger value="mine" className="text-xs sm:text-sm">My Tasks</TabsTrigger>
        </TabsList>

        {error ? (
          <ErrorState message="Tasks could not be loaded." onRetry={refresh} />
        ) : (
          <>
            {/* ---------------- KANBAN ---------------- */}
            <TabsContent value="kanban" className="mt-0 focus-visible:outline-none">
              <div className="flex flex-col sm:flex-row gap-2 mb-4">
                <div className="relative flex-1 sm:max-w-xs">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={searchDraft}
                    onChange={(e) => setSearchDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") updateFilters({ q: searchDraft }); }}
                    onBlur={() => { if (searchDraft !== filters.q) updateFilters({ q: searchDraft }); }}
                    placeholder="Search tasks…"
                    className="pl-9 h-9"
                  />
                </div>
                <Select value={filters.projectId} onValueChange={(v) => updateFilters({ projectId: v })}>
                  <SelectTrigger className="h-9 sm:w-52"><SelectValue placeholder="All projects" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All projects</SelectItem>
                    {projectsList.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={filters.priority} onValueChange={(v) => updateFilters({ priority: v })}>
                  <SelectTrigger className="h-9 sm:w-36"><SelectValue placeholder="Priority" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All priorities</SelectItem>
                    {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {loading ? (
                <div className="flex gap-3 overflow-hidden">
                  {TASK_STATUSES.map((s) => (
                    <div key={s} className="w-[272px] shrink-0 space-y-2">
                      <Skeleton className="h-9 w-full" />
                      <Skeleton className="h-24 w-full" />
                      <Skeleton className="h-24 w-full" />
                    </div>
                  ))}
                </div>
              ) : tasks.length === 0 ? (
                <EmptyState
                  icon={<ListTodo className="w-5 h-5" />}
                  title="No tasks found"
                  description={filters.q || filters.projectId !== "all" || filters.priority !== "all"
                    ? "Try adjusting the filters."
                    : canCreate
                      ? "Create the first task to start planning the delivery."
                      : "No tasks have been created yet."}
                  action={canCreate ? <Button size="sm" onClick={() => setNewOpen(true)}><Plus className="w-4 h-4 mr-2" /> New Task</Button> : undefined}
                />
              ) : (
                <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
                  <div className="flex gap-3 overflow-x-auto apex-scroll pb-3 -mx-1 px-1">
                    {TASK_STATUSES.map((s) => (
                      <KanbanColumn
                        key={s}
                        status={s}
                        tasks={kanbanGroups.get(s) ?? []}
                        onOpenTask={openTask}
                        onMoveTo={moveTask}
                        onOpenProject={() => navigate("projects")}
                      />
                    ))}
                  </div>
                  <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.2, 0, 0, 1)" }}>
                    {activeTask ? (
                      <div className="w-[264px] rounded-lg border border-primary/60 bg-card p-3 shadow-xl apex-glow rotate-1">
                        <p className="text-sm font-medium line-clamp-2">{activeTask.title}</p>
                        <p className="text-[11px] text-muted-foreground mt-1">
                          {activeTask.project?.name ?? "Standalone"} · {statusLabel(activeTask.status)}
                        </p>
                      </div>
                    ) : null}
                  </DragOverlay>
                </DndContext>
              )}
            </TabsContent>

            {/* ---------------- LIST ---------------- */}
            <TabsContent value="list" className="mt-0 focus-visible:outline-none">
              <div className="apex-panel p-3 mb-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2">
                <div className="relative col-span-2 sm:col-span-3 lg:col-span-2">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={searchDraft}
                    onChange={(e) => setSearchDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") updateFilters({ q: searchDraft }); }}
                    placeholder="Search…"
                    className="pl-9 h-9"
                  />
                </div>
                <Select value={filters.projectId} onValueChange={(v) => updateFilters({ projectId: v })}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Project" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All projects</SelectItem>
                    {projectsList.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={filters.assigneeId} onValueChange={(v) => updateFilters({ assigneeId: v })} disabled={teamUnavailable}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Assignee" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All assignees</SelectItem>
                    {teamList.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={filters.status} onValueChange={(v) => updateFilters({ status: v })}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Status" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    {TASK_STATUSES.map((s) => <SelectItem key={s} value={s}>{statusLabel(s)}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={filters.priority} onValueChange={(v) => updateFilters({ priority: v })}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Priority" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All priorities</SelectItem>
                    {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
                <div className="flex gap-2">
                  <Input type="date" value={filters.dueFrom} onChange={(e) => updateFilters({ dueFrom: e.target.value })} className="h-9 text-xs" title="Due from" aria-label="Due from" />
                  <Input type="date" value={filters.dueTo} onChange={(e) => updateFilters({ dueTo: e.target.value })} className="h-9 text-xs" title="Due to" aria-label="Due to" />
                </div>
              </div>

              {loading ? (
                <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
              ) : tasks.length === 0 ? (
                <EmptyState
                  icon={<ClipboardList className="w-5 h-5" />}
                  title="No tasks match"
                  description={hasActiveFilters ? "Try clearing some filters." : "Create a task to get started."}
                  action={
                    hasActiveFilters ? (
                      <Button size="sm" variant="outline" onClick={() => { setFilters({ q: "", projectId: "all", assigneeId: "all", status: "all", priority: "all", dueFrom: "", dueTo: "" }); setSearchDraft(""); }}>
                        Clear filters
                      </Button>
                    ) : undefined
                  }
                />
              ) : (
                <div className="apex-panel overflow-hidden">
                  <div className="overflow-x-auto apex-scroll">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                          <th className="px-4 py-3 font-medium">Task</th>
                          <th className="px-4 py-3 font-medium">Status</th>
                          <th className="px-4 py-3 font-medium hidden md:table-cell">Assignee</th>
                          <th className="px-4 py-3 font-medium">Priority</th>
                          <th className="px-4 py-3 font-medium hidden sm:table-cell">Due</th>
                          <th className="px-4 py-3 font-medium hidden lg:table-cell">Checklist</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tasks.map((t) => {
                          const due = dueMeta(t.dueDate);
                          return (
                            <tr
                              key={t.id}
                              onClick={() => openTask(t)}
                              className="border-b border-border/60 last:border-0 hover:bg-accent/40 cursor-pointer transition-colors"
                            >
                              <td className="px-4 py-3">
                                <p className="font-medium leading-snug line-clamp-1">{t.title}</p>
                                <div className="mt-0.5">{projectChip(t)}</div>
                              </td>
                              <td className="px-4 py-3"><StatusBadge status={t.status} /></td>
                              <td className="px-4 py-3 hidden md:table-cell">
                                {t.assignee ? (
                                  <span className="flex items-center gap-2">
                                    <UserAvatar name={t.assignee.name} color={t.assignee.avatarColor} />
                                    <span className="text-xs">{t.assignee.name}</span>
                                  </span>
                                ) : <span className="text-xs text-muted-foreground">Unassigned</span>}
                              </td>
                              <td className="px-4 py-3"><PriorityBadge priority={t.priority} /></td>
                              <td className={cn("px-4 py-3 text-xs hidden sm:table-cell", due.cls)}>{due.text}</td>
                              <td className="px-4 py-3 text-xs text-muted-foreground hidden lg:table-cell">
                                {t.checklistTotal ? `${t.checklistDone ?? 0}/${t.checklistTotal}` : "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex items-center justify-between px-4 py-3 border-t border-border text-xs text-muted-foreground">
                    <span>
                      Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
                    </span>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" className="h-7 text-xs" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                        Previous
                      </Button>
                      <span>Page {page} / {totalPages}</span>
                      <Button variant="outline" size="sm" className="h-7 text-xs" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                        Next
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </TabsContent>

            {/* ---------------- MY TASKS ---------------- */}
            <TabsContent value="mine" className="mt-0 focus-visible:outline-none">
              {loading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-40 w-full" />)}
                </div>
              ) : tasks.filter((t) => t.status !== "DONE").length === 0 ? (
                <EmptyState
                  icon={<CheckSquare className="w-5 h-5" />}
                  title="All clear!"
                  description="You have no open tasks assigned to you. Enjoy the calm."
                />
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {myGroups.map((g) => (
                    <div
                      key={g.key}
                      className={cn(
                        "apex-panel p-4",
                        g.key === "overdue" && g.items.length > 0 && "border-rose-500/30",
                        g.key === "today" && g.items.length > 0 && "border-amber-500/30",
                      )}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <span className={cn(
                          "text-xs font-semibold uppercase tracking-wide flex items-center gap-1.5",
                          g.key === "overdue" ? "text-rose-300" : g.key === "today" ? "text-amber-300" : "text-muted-foreground",
                        )}>
                          {g.icon} {g.label}
                        </span>
                        <span className="text-xs text-muted-foreground">{g.items.length}</span>
                      </div>
                      {g.items.length === 0 ? (
                        <p className="text-xs text-muted-foreground py-4 text-center">Nothing here.</p>
                      ) : (
                        <div className="space-y-2 max-h-96 overflow-y-auto apex-scroll pr-1">
                          {g.items.map((t) => (
                            <div key={t.id} className="flex items-start gap-3 p-2.5 rounded-lg border border-border/70 hover:border-primary/40 transition-colors">
                              <Checkbox
                                className="mt-0.5"
                                onCheckedChange={() => void completeTask(t.id)}
                                aria-label={`Complete ${t.title}`}
                              />
                              <div className="min-w-0 flex-1 cursor-pointer" onClick={() => openTask(t)}>
                                <p className="text-sm font-medium leading-snug line-clamp-2">{t.title}</p>
                                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                                  <PriorityBadge priority={t.priority} />
                                  {t.dueDate && <span className={cn("text-[10px]", dueMeta(t.dueDate).cls)}>{dueMeta(t.dueDate).text}</span>}
                                  {t.project && (
                                    <span className="text-[10px] text-cyan-300/80 truncate max-w-[140px]">{t.project.name}</span>
                                  )}
                                </div>
                              </div>
                              {t.project && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); navigate("projects"); }}
                                  className="text-muted-foreground hover:text-primary shrink-0"
                                  title="Open projects"
                                  aria-label="Open projects"
                                >
                                  <FolderKanban className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
          </>
        )}
      </Tabs>

      <TaskDetailSheet
        taskId={detailId}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onChanged={refresh}
        navigate={navigate}
      />
      <NewTaskDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        projects={projectsList}
        team={teamList}
        teamUnavailable={teamUnavailable}
        canAssign={canAssign}
        meId={me?.id}
        onCreated={refresh}
      />
    </div>
  );
}
