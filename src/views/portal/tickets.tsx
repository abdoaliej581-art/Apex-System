"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import {
  LifeBuoy, Plus, RefreshCw, Loader2, X, Send, Lock, Unlock,
  MessageSquare, FolderKanban, User, Paperclip,
} from "lucide-react";
import { PageHeader, EmptyState, ErrorState, StatusBadge, PriorityBadge, ListSkeleton, Field } from "@/components/shared";
import { FileAttachments } from "@/components/shared/files";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { api, qs, relativeTime } from "@/lib/api-client";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { ViewProps } from "@/views/registry";

type PortalTicket = {
  id: string; ticketNumber: string; subject: string; category: string; priority: string;
  status: string; closedAt: string | null; createdAt: string; updatedAt: string;
  project: { name: string; projectNumber: string } | null;
  assignedTo: { name: string; avatarColor: string } | null;
  messagesCount: number;
};

type TicketsResponse = { items: PortalTicket[]; total: number; page: number; pageSize: number };

type TicketDetail = {
  ticket: PortalTicket & { description: string | null };
  messages: { id: string; authorName: string | null; body: string; createdAt: string; authorIsClient: boolean; isMine: boolean }[];
};

const STATUS_FILTERS = ["", "OPEN", "IN_PROGRESS", "WAITING_CLIENT", "RESOLVED", "CLOSED"];
const CATEGORIES = ["BUG", "CHANGE_REQUEST", "QUESTION", "FEATURE_REQUEST", "TECHNICAL_ISSUE", "OTHER"];
const PRIORITIES = ["LOW", "MEDIUM", "HIGH"];
const dateShort = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";

export function PortalTicketsView(_props: ViewProps) {
  const { data: session } = useSession();
  const { toast } = useToast();
  const meId = session?.user?.id;

  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 12;

  const [data, setData] = useState<TicketsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Detail + conversation
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [sheetTab, setSheetTab] = useState<"thread" | "files">("thread");
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [closeConfirm, setCloseConfirm] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ subject: "", category: "OTHER", priority: "MEDIUM", description: "", projectId: "none" });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [projects, setProjects] = useState<{ id: string; name: string; projectNumber: string }[]>([]);

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedQ(q.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<TicketsResponse>(`/api/portal/tickets${qs({ q: debouncedQ, status, page, pageSize })}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load your tickets.");
    } finally {
      setLoading(false);
    }
  }, [debouncedQ, status, page]);

  useEffect(() => { load(); }, [load, reloadKey]);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    setDetailError(null);
    try {
      setDetail(await api.get<TicketDetail>(`/api/portal/tickets/${id}`));
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "Failed to load ticket.");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!detailId) { setDetail(null); setDetailError(null); setReply(""); setSheetTab("thread"); return; }
    loadDetail(detailId);
  }, [detailId, loadDetail]);

  // Scroll to newest message after load/send
  useEffect(() => {
    if (detail?.messages.length) bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [detail?.messages.length]);

  // Load own projects for the create dialog
  useEffect(() => {
    if (!createOpen) return;
    api.get<{ items: { id: string; name: string; projectNumber: string }[] }>("/api/portal/projects?pageSize=100")
      .then((d) => setProjects(d.items))
      .catch(() => setProjects([]));
  }, [createOpen]);

  const sendReply = async () => {
    if (!detailId || !reply.trim()) return;
    setSending(true);
    try {
      await api.post(`/api/portal/tickets/${detailId}`, { body: reply.trim() });
      setReply("");
      await loadDetail(detailId);
      setReloadKey((k) => k + 1); // refresh list ordering/counts
      toast({ title: "Reply sent", description: "Our team has been notified." });
    } catch (err) {
      toast({ title: "Could not send reply", description: err instanceof Error ? err.message : "Please try again.", variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  const changeStatus = async (next: "CLOSED" | "OPEN") => {
    if (!detailId) return;
    setStatusBusy(true);
    try {
      await api.patch(`/api/portal/tickets/${detailId}`, { status: next });
      await loadDetail(detailId);
      setReloadKey((k) => k + 1);
      toast({ title: next === "CLOSED" ? "Ticket closed" : "Ticket reopened", description: next === "CLOSED" ? "Thanks for confirming." : "Our team will pick it up again." });
    } catch (err) {
      toast({ title: "Action failed", description: err instanceof Error ? err.message : "Please try again.", variant: "destructive" });
    } finally {
      setStatusBusy(false);
      setCloseConfirm(false);
    }
  };

  const submitCreate = async () => {
    const errors: Record<string, string> = {};
    if (form.subject.trim().length < 3) errors.subject = "Subject must be at least 3 characters.";
    if (form.description.trim().length > 5000) errors.description = "Description is too long (max 5000 characters).";
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setCreating(true);
    try {
      await api.post("/api/portal/tickets", {
        subject: form.subject.trim(),
        category: form.category,
        priority: form.priority,
        description: form.description.trim() || null,
        projectId: form.projectId === "none" ? null : form.projectId,
      });
      setCreateOpen(false);
      setForm({ subject: "", category: "OTHER", priority: "MEDIUM", description: "", projectId: "none" });
      setReloadKey((k) => k + 1);
      toast({ title: "Ticket submitted", description: "The APEX team has been notified and will follow up." });
    } catch (err) {
      toast({ title: "Could not submit ticket", description: err instanceof Error ? err.message : "Please try again.", variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;
  const hasFilters = debouncedQ !== "" || status !== "";

  return (
    <div>
      <PageHeader
        title="Support"
        description="Open tickets, follow conversations and get help from the APEX team."
        actions={
          <Button onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4 mr-1.5" /> New Ticket</Button>
        }
      />

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your tickets…" className="sm:max-w-xs bg-secondary/40" aria-label="Search tickets" />
        <div className="flex gap-1.5 overflow-x-auto apex-scroll pb-1" role="group" aria-label="Filter by status">
          {STATUS_FILTERS.map((s) => (
            <button key={s || "all"} onClick={() => { setStatus(s); setPage(1); }}
              className={cn("px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border transition-colors",
                status === s ? "bg-primary/15 text-primary border-primary/40" : "text-muted-foreground border-border hover:border-primary/30 hover:text-foreground")}>
              {s ? s.replace(/_/g, " ") : "All"}
            </button>
          ))}
        </div>
        <div className="sm:ml-auto">
          <Button variant="ghost" size="icon" onClick={() => setReloadKey((k) => k + 1)} aria-label="Refresh tickets"><RefreshCw className="w-4 h-4" /></Button>
        </div>
      </div>

      {loading ? (
        <ListSkeleton rows={5} />
      ) : error ? (
        <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
      ) : !data || data.items.length === 0 ? (
        <EmptyState icon={<LifeBuoy className="w-5 h-5" />}
          title={hasFilters ? "No tickets match your filters" : "No tickets yet"}
          description={hasFilters ? "Try adjusting the search or status filter." : "Need something fixed, changed or explained? Open your first ticket — we usually reply within one business day."}
          action={!hasFilters ? <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4 mr-1.5" /> Open a ticket</Button> : undefined} />
      ) : (
        <>
          <ul className="space-y-3">
            {data.items.map((t) => (
              <li key={t.id}>
                <button onClick={() => setDetailId(t.id)}
                  className="w-full text-left apex-panel p-4 hover:border-primary/40 transition-colors group">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">{t.subject}</p>
                      <p className="text-[11px] text-muted-foreground font-mono mt-1">{t.ticketNumber} · opened {dateShort(t.createdAt)}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <PriorityBadge priority={t.priority} />
                      <StatusBadge status={t.status} />
                    </div>
                  </div>
                  <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1"><MessageSquare className="w-3 h-3" /> {t.messagesCount} message{t.messagesCount === 1 ? "" : "s"}</span>
                    {t.project && <span className="flex items-center gap-1"><FolderKanban className="w-3 h-3" /> {t.project.name}</span>}
                    {t.assignedTo && <span className="flex items-center gap-1"><User className="w-3 h-3" /> Handled by {t.assignedTo.name}</span>}
                    <span className="sm:ml-auto">Updated {relativeTime(t.updatedAt)}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 mt-6">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <span className="text-xs text-muted-foreground">Page {page} of {totalPages}</span>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          )}
        </>
      )}

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New support ticket</DialogTitle>
            <DialogDescription>Tell us what you need — the APEX team is notified immediately.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <Field label="Subject" required>
              <Input value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
                placeholder="Short summary of the issue" className="bg-secondary/40" aria-label="Ticket subject" />
              {formErrors.subject && <p className="text-xs text-rose-300 mt-1">{formErrors.subject}</p>}
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Category">
                <Select value={form.category} onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}>
                  <SelectTrigger className="bg-secondary/40" aria-label="Category"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c.replace(/_/g, " ")}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Priority" hint="URGENT is applied by the APEX team when needed">
                <Select value={form.priority} onValueChange={(v) => setForm((f) => ({ ...f, priority: v }))}>
                  <SelectTrigger className="bg-secondary/40" aria-label="Priority"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field label="Related project" hint="Optional">
              <Select value={form.projectId} onValueChange={(v) => setForm((f) => ({ ...f, projectId: v }))}>
                <SelectTrigger className="bg-secondary/40" aria-label="Related project"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No specific project</SelectItem>
                  {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} ({p.projectNumber})</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Description">
              <Textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={5} placeholder="Describe the issue, expected behavior, anything that helps us reproduce or understand it…" className="bg-secondary/40 resize-none" aria-label="Ticket description" />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>Cancel</Button>
            <Button onClick={submitCreate} disabled={creating}>
              {creating ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Send className="w-4 h-4 mr-1.5" />}
              Submit ticket
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Conversation sheet */}
      <Sheet open={!!detailId} onOpenChange={(o) => { if (!o) setDetailId(null); }}>
        <SheetContent side="right" className="w-full sm:max-w-xl p-0 flex flex-col">
          <SheetHeader className="px-5 py-4 border-b border-border">
            {detailLoading && !detail ? (
              <>
                <SheetTitle className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin text-primary" /> Loading conversation…</SheetTitle>
                <SheetDescription className="sr-only">Ticket conversation</SheetDescription>
              </>
            ) : detailError && !detail ? (
              <>
                <SheetTitle>Ticket unavailable</SheetTitle>
                <SheetDescription>{detailError}</SheetDescription>
              </>
            ) : detail ? (
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <SheetTitle className="truncate">{detail.ticket.subject}</SheetTitle>
                  <SheetDescription className="flex flex-wrap items-center gap-2 mt-1.5">
                    <span className="font-mono text-xs">{detail.ticket.ticketNumber}</span>
                    <StatusBadge status={detail.ticket.status} />
                    <PriorityBadge priority={detail.ticket.priority} />
                  </SheetDescription>
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => setDetailId(null)} aria-label="Close conversation">
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ) : (
              <>
                <SheetTitle>Ticket</SheetTitle>
                <SheetDescription className="sr-only">Ticket conversation</SheetDescription>
              </>
            )}
            {detail && !detailLoading && !detailError && (
              <div className="flex gap-1.5 mt-3" role="tablist" aria-label="Ticket sections">
                {([
                  { key: "thread" as const, label: "Conversation", icon: MessageSquare },
                  { key: "files" as const, label: "Files", icon: Paperclip },
                ]).map((t) => (
                  <button key={t.key} role="tab" aria-selected={sheetTab === t.key}
                    onClick={() => setSheetTab(t.key)}
                    className={cn("inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                      sheetTab === t.key
                        ? "bg-primary/15 text-primary border-primary/40"
                        : "text-muted-foreground border-border hover:border-primary/30 hover:text-foreground")}>
                    <t.icon className="w-3.5 h-3.5" /> {t.label}
                  </button>
                ))}
              </div>
            )}
          </SheetHeader>

          {detail && !detailLoading && (
            <div className="px-5 pt-3 pb-2 border-b border-border/60 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              {detail.ticket.project && <span className="flex items-center gap-1"><FolderKanban className="w-3 h-3" /> {detail.ticket.project.name}</span>}
              {detail.ticket.assignedTo && <span className="flex items-center gap-1"><User className="w-3 h-3" /> {detail.ticket.assignedTo.name}</span>}
              <span>Opened {dateShort(detail.ticket.createdAt)}</span>
              <div className="sm:ml-auto flex gap-2">
                {detail.ticket.status !== "CLOSED" ? (
                  <Button size="sm" variant="outline" className="h-7 text-xs" disabled={statusBusy} onClick={() => setCloseConfirm(true)}>
                    <Lock className="w-3 h-3 mr-1" /> Close ticket
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" className="h-7 text-xs" disabled={statusBusy} onClick={() => changeStatus("OPEN")}>
                    <Unlock className="w-3 h-3 mr-1" /> Reopen
                  </Button>
                )}
              </div>
            </div>
          )}

          <ScrollArea className="flex-1 min-h-0">
            <div className="px-5 py-4">
              {detailLoading && (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-16 rounded-lg bg-secondary/30 animate-pulse" />)}
                </div>
              )}
              {detailError && !detailLoading && (
                <ErrorState message={detailError} onRetry={() => detailId && loadDetail(detailId)} />
              )}
              {detail && !detailLoading && sheetTab === "thread" && (
                <div className="space-y-4">
                  {/* Opening description */}
                  {detail.ticket.description && (
                    <div className="flex flex-col items-start gap-1.5">
                      <div className="max-w-[85%] rounded-2xl rounded-tl-md border border-primary/30 bg-primary/10 px-4 py-3">
                        <p className="text-sm whitespace-pre-wrap break-words">{detail.ticket.description}</p>
                      </div>
                      <p className="text-[10px] text-muted-foreground px-1">
                        {session?.user?.name} · {relativeTime(detail.ticket.createdAt)}
                      </p>
                    </div>
                  )}
                  {/* Thread */}
                  {detail.messages.length === 0 && !detail.ticket.description ? (
                    <p className="text-sm text-muted-foreground text-center py-8 border border-dashed border-border rounded-lg">
                      No messages yet.
                    </p>
                  ) : (
                    detail.messages.map((m) => (
                      <div key={m.id} className={cn("flex flex-col gap-1.5", m.isMine ? "items-end" : "items-start")}>
                        <div className={cn("max-w-[85%] rounded-2xl px-4 py-3 border",
                          m.isMine
                            ? "rounded-br-md border-primary/30 bg-primary/10"
                            : "rounded-bl-md border-border bg-card/60")}>
                          <p className="text-[11px] font-semibold mb-1 flex items-center gap-1.5">
                            {!m.isMine && <span className="text-primary">APEX Support</span>}
                            {m.isMine && <span>{m.authorName || "You"}</span>}
                            {!m.isMine && m.authorName && <span className="font-normal text-muted-foreground">· {m.authorName}</span>}
                          </p>
                          <p className="text-sm whitespace-pre-wrap break-words">{m.body}</p>
                        </div>
                        <p className="text-[10px] text-muted-foreground px-1">{relativeTime(m.createdAt)}</p>
                      </div>
                    ))
                  )}
                  <div ref={bottomRef} />
                </div>
              )}
              {detail && !detailLoading && sheetTab === "files" && (
                <FileAttachments
                  entityType="TICKET"
                  entityId={detail.ticket.id}
                  apiBase="/api/portal/files"
                  canUploadOverride={detail.ticket.status !== "CLOSED"}
                  canDeleteOverride={(f) => f.uploader?.id === meId}
                  uploadHint="Attach a screenshot or document for the APEX team"
                  className="py-2"
                />
              )}
            </div>
          </ScrollArea>

          {/* Reply box (conversation tab only) */}
          {detail && !detailLoading && sheetTab === "thread" && (
            <div className="border-t border-border p-3.5">
              {detail.ticket.status === "CLOSED" ? (
                <p className="text-xs text-muted-foreground text-center py-2">
                  This ticket is closed. Reopen it above to continue the conversation.
                </p>
              ) : (
                <div className="flex items-end gap-2">
                  <Textarea
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendReply(); }
                    }}
                    rows={2}
                    placeholder="Write a reply… (⌘/Ctrl + Enter to send)"
                    className="bg-secondary/40 resize-none min-h-[44px]"
                    aria-label="Reply message"
                  />
                  <Button onClick={sendReply} disabled={sending || !reply.trim()} className="h-10 px-4 shrink-0" aria-label="Send reply">
                    {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </Button>
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Close confirm */}
      <AlertDialog open={closeConfirm} onOpenChange={setCloseConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Close this ticket?</AlertDialogTitle>
            <AlertDialogDescription>
              Closing tells us the issue is resolved. You can reopen it later if the problem comes back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep open</AlertDialogCancel>
            <AlertDialogAction onClick={() => changeStatus("CLOSED")} className="bg-amber-500/90 hover:bg-amber-500 text-[#0a1120] font-semibold">
              Close ticket
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
