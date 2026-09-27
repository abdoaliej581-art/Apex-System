"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader, EmptyState, ErrorState, ListSkeleton, StatusBadge, Field, StatCard } from "@/components/shared";
import { api, qs, formatDate, formatDateTime, relativeTime } from "@/lib/api-client";
import { useSession } from "next-auth/react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Megaphone, Plus, Pencil, Trash2, CalendarDays, ChevronLeft, ChevronRight,
  Instagram, Facebook, Linkedin, Youtube, Globe, FileText, Search, Sparkles, Send,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ---------- Domain constants ----------
const PLATFORMS = ["INSTAGRAM", "FACEBOOK", "LINKEDIN", "YOUTUBE", "X_TWITTER", "TIKTOK", "OTHER"] as const;
const CONTENT_TYPES = ["POST", "REEL", "STORY", "ARTICLE", "OFFER", "CASE_STUDY", "VIDEO"] as const;
const STATUSES = ["IDEA", "DRAFT", "REVIEW", "APPROVED", "SCHEDULED", "PUBLISHED", "ARCHIVED"] as const;
const WORKFLOW: Record<string, string | undefined> = {
  IDEA: "DRAFT", DRAFT: "REVIEW", REVIEW: "APPROVED", APPROVED: "SCHEDULED", SCHEDULED: "PUBLISHED", PUBLISHED: "ARCHIVED",
};

const PLATFORM_STYLE: Record<string, string> = {
  INSTAGRAM: "bg-pink-500/10 text-pink-300 border-pink-500/30",
  FACEBOOK: "bg-blue-500/10 text-blue-300 border-blue-500/30",
  LINKEDIN: "bg-sky-500/10 text-sky-300 border-sky-500/30",
  YOUTUBE: "bg-red-500/10 text-red-300 border-red-500/30",
  X_TWITTER: "bg-slate-500/10 text-slate-300 border-slate-500/30",
  TIKTOK: "bg-violet-500/10 text-violet-300 border-violet-500/30",
  OTHER: "bg-slate-500/10 text-slate-400 border-slate-500/30",
};

function PlatformIcon({ platform, className }: { platform: string; className?: string }) {
  const cls = className || "w-3.5 h-3.5";
  switch (platform) {
    case "INSTAGRAM": return <Instagram className={cls} />;
    case "FACEBOOK": return <Facebook className={cls} />;
    case "LINKEDIN": return <Linkedin className={cls} />;
    case "YOUTUBE": return <Youtube className={cls} />;
    default: return <Globe className={cls} />;
  }
}

// ---------- Types ----------
type Author = { id: string; name: string; avatarColor: string } | null;

type ContentRow = {
  id: string; title: string; platform: string; contentType: string;
  caption: string | null; cta: string | null; hashtags: string | null; mediaUrl: string | null;
  publishDate: string | null; status: string; campaignId: string | null;
  createdAt: string; updatedAt: string;
  author: Author; reviewer: Author;
  campaign: { id: string; name: string } | null;
};

type ContentSummary = {
  byStatus: { status: string; count: number }[];
  upcomingScheduled: number;
  publishedThisMonth: number;
};

type TeamMember = { id: string; name: string; avatarColor: string };
type CampaignOption = { id: string; name: string; status: string };

const emptyForm = {
  title: "", platform: "INSTAGRAM", contentType: "POST", status: "IDEA",
  publishDate: "", campaignId: "NONE", authorId: "NONE", reviewerId: "NONE",
  caption: "", cta: "", hashtags: "", mediaUrl: "",
};

export function ContentView({ navigate: _navigate }: { navigate: (p: string) => void }) {
  const { data: session } = useSession();
  const { toast } = useToast();
  const perms = session?.user?.permissions || [];
  const can = (p: string) => perms.includes(p);

  const [rows, setRows] = useState<ContentRow[]>([]);
  const [summary, setSummary] = useState<ContentSummary>({ byStatus: [], upcomingScheduled: 0, publishedThisMonth: 0 });
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("ALL");
  const [platform, setPlatform] = useState("ALL");
  const [tab, setTab] = useState("pipeline");
  const [reloadKey, setReloadKey] = useState(0);

  // dialogs
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editRow, setEditRow] = useState<ContentRow | null>(null);
  const [deleteRow, setDeleteRow] = useState<ContentRow | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ content: ContentRow; activities: { id: string; title: string; description: string | null; createdAt: string; actorName: string | null; actorColor: string | null }[] } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // form
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [team, setTeam] = useState<TeamMember[] | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignOption[] | null>(null);

  const pageSize = 15;

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const data = await api.get<{ items: ContentRow[]; total: number; summary: ContentSummary }>(
        `/api/content${qs({
          q, status: status === "ALL" ? undefined : status,
          platform: platform === "ALL" ? undefined : platform,
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
  }, [q, status, platform, page, reloadKey]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [q, status, platform]);

  // Team for author/reviewer pickers + campaigns for linking (graceful if no permission)
  useEffect(() => {
    let cancelled = false;
    api.get<{ team: TeamMember[] }>("/api/team")
      .then((d) => { if (!cancelled) setTeam(d.team); })
      .catch(() => { if (!cancelled) setTeam(null); });
    api.get<{ items: CampaignOption[] }>("/api/campaigns?pageSize=100")
      .then((d) => { if (!cancelled) setCampaigns(d.items); })
      .catch(() => { if (!cancelled) setCampaigns(null); });
    return () => { cancelled = true; };
  }, [reloadKey]);

  // Detail sheet loader
  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const d = await api.get<{ content: ContentRow; activities: { id: string; title: string; description: string | null; createdAt: string; actorName: string | null; actorColor: string | null }[] }>(`/api/content/${id}`);
      setDetail(d);
    } catch {
      toast({ title: "Could not load content details", variant: "destructive" });
      setDetailId(null);
    } finally {
      setDetailLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (detailId) loadDetail(detailId);
    else setDetail(null);
  }, [detailId, loadDetail]);

  // ---------- Mutations ----------
  const openCreate = () => { setEditRow(null); setForm(emptyForm); setDialogOpen(true); };
  const openEdit = (row: ContentRow) => {
    setEditRow(row);
    setForm({
      title: row.title, platform: row.platform, contentType: row.contentType, status: row.status,
      publishDate: row.publishDate ? new Date(row.publishDate).toISOString().slice(0, 16) : "",
      campaignId: row.campaignId || "NONE",
      authorId: row.author?.id || "NONE",
      reviewerId: row.reviewer?.id || "NONE",
      caption: row.caption || "", cta: row.cta || "", hashtags: row.hashtags || "", mediaUrl: row.mediaUrl || "",
    });
    setDialogOpen(true);
  };

  const doSave = async () => {
    if (form.title.trim().length < 2) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }
    setSaving(true);
    const payload = {
      title: form.title.trim(),
      platform: form.platform,
      contentType: form.contentType,
      status: form.status,
      publishDate: form.publishDate ? new Date(form.publishDate).toISOString() : null,
      campaignId: form.campaignId === "NONE" ? null : form.campaignId,
      authorId: form.authorId === "NONE" ? null : form.authorId,
      reviewerId: form.reviewerId === "NONE" ? null : form.reviewerId,
      caption: form.caption || null,
      cta: form.cta || null,
      hashtags: form.hashtags || null,
      mediaUrl: form.mediaUrl || null,
    };
    try {
      if (editRow) {
        await api.patch(`/api/content/${editRow.id}`, payload);
        toast({ title: "Content updated" });
      } else {
        await api.post("/api/content", payload);
        toast({ title: "Content created" });
      }
      setDialogOpen(false);
      setReloadKey((k) => k + 1);
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Save failed", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const advanceStatus = async (row: ContentRow) => {
    const next = WORKFLOW[row.status];
    if (!next) return;
    try {
      await api.patch(`/api/content/${row.id}`, { status: next });
      toast({ title: `Moved to ${next.replace(/_/g, " ").toLowerCase()}` });
      if (detailId === row.id) loadDetail(row.id);
      setReloadKey((k) => k + 1);
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Status change failed", variant: "destructive" });
    }
  };

  const doDelete = async () => {
    if (!deleteRow) return;
    try {
      await api.delete(`/api/content/${deleteRow.id}`);
      toast({ title: "Content deleted" });
      if (detailId === deleteRow.id) setDetailId(null);
      setDeleteRow(null);
      setReloadKey((k) => k + 1);
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Delete failed", variant: "destructive" });
    }
  };

  // ---------- Derived ----------
  const countBy = (s: string) => summary.byStatus.find((x) => x.status === s)?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasFilters = q !== "" || status !== "ALL" || platform !== "ALL";

  return (
    <div>
      <PageHeader
        title="Content"
        description="Marketing content pipeline — from idea to published, with the publishing calendar for the whole team."
        actions={can("content.create") ? (
          <Button onClick={openCreate} className="bg-primary text-primary-foreground hover:bg-primary/90">
            <Plus className="w-4 h-4 mr-2" /> New content
          </Button>
        ) : undefined}
      />

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-5">
        <StatCard label="Ideas & drafts" value={countBy("IDEA") + countBy("DRAFT")} sub={`${countBy("IDEA")} ideas · ${countBy("DRAFT")} drafts`} icon={<Sparkles className="w-4 h-4" />} accent="violet" />
        <StatCard label="In review / approved" value={countBy("REVIEW") + countBy("APPROVED")} sub={`${countBy("REVIEW")} in review · ${countBy("APPROVED")} approved`} icon={<FileText className="w-4 h-4" />} accent="cyan" />
        <StatCard label="Scheduled ahead" value={summary.upcomingScheduled} sub="waiting on their publish date" icon={<CalendarDays className="w-4 h-4" />} accent="amber" />
        <StatCard label="Published this month" value={summary.publishedThisMonth} sub={`${countBy("PUBLISHED")} total published`} icon={<Send className="w-4 h-4" />} accent="emerald" />
      </div>

      <Tabs value={tab} onValueChange={setTab} className="mb-4">
        <TabsList>
          <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
          <TabsTrigger value="calendar">Calendar</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "pipeline" ? (
        <>
          <div className="flex flex-col sm:flex-row gap-2 mb-4">
            <div className="relative sm:max-w-xs w-full">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, caption, hashtags…" className="pl-8 bg-secondary/40" />
            </div>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="sm:w-44 bg-secondary/40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All statuses</SelectItem>
                {STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={platform} onValueChange={setPlatform}>
              <SelectTrigger className="sm:w-44 bg-secondary/40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All platforms</SelectItem>
                {PLATFORMS.map((p) => <SelectItem key={p} value={p}>{p.replace(/_/g, " ")}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {loading ? <ListSkeleton rows={6} /> : error ? <ErrorState onRetry={load} /> : rows.length === 0 ? (
            <EmptyState
              icon={<Megaphone className="w-5 h-5" />}
              title={hasFilters ? "No content matches your filters" : "No content yet"}
              description={hasFilters ? "Try adjusting the search or filters." : "Start with an idea — every post, reel and article APEX publishes lives here."}
              action={can("content.create") && !hasFilters ? <Button onClick={openCreate}><Plus className="w-4 h-4 mr-2" /> Add first content</Button> : undefined}
            />
          ) : (
            <>
              {/* Desktop table */}
              <div className="apex-panel overflow-x-auto hidden md:block apex-scroll">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase tracking-wide">
                      <th className="px-4 py-3 font-medium">Title</th>
                      <th className="px-4 py-3 font-medium">Platform</th>
                      <th className="px-4 py-3 font-medium">Type</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium hidden xl:table-cell">Author</th>
                      <th className="px-4 py-3 font-medium">Publish date</th>
                      <th className="px-4 py-3 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id} className="border-b border-border/60 hover:bg-secondary/20 transition-colors">
                        <td className="px-4 py-3">
                          <button className="text-left hover:text-primary transition-colors" onClick={() => setDetailId(row.id)}>
                            <span className="font-medium">{row.title}</span>
                          </button>
                          {row.campaign && <span className="ml-2 text-[10px] text-muted-foreground border border-border rounded px-1.5 py-0.5">{row.campaign.name}</span>}
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[11px] font-medium", PLATFORM_STYLE[row.platform])}>
                            <PlatformIcon platform={row.platform} /> {row.platform.replace(/_/g, " ")}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground text-xs">{row.contentType.replace(/_/g, " ")}</td>
                        <td className="px-4 py-3"><StatusBadge status={row.status} /></td>
                        <td className="px-4 py-3 hidden xl:table-cell">
                          {row.author ? (
                            <span className="inline-flex items-center gap-1.5 text-xs">
                              <span className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold" style={{ background: row.author.avatarColor || "#22d3ee", color: "#0A1120" }}>
                                {row.author.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
                              </span>
                              {row.author.name}
                            </span>
                          ) : <span className="text-muted-foreground text-xs">—</span>}
                        </td>
                        <td className={cn("px-4 py-3 text-xs", row.publishDate ? (row.status === "PUBLISHED" ? "text-emerald-300" : "text-foreground") : "text-muted-foreground")}>
                          {row.publishDate ? formatDate(row.publishDate) : "Not set"}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            {can("content.edit") && WORKFLOW[row.status] && (
                              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" title={`Move to ${WORKFLOW[row.status]}`} onClick={() => advanceStatus(row)}>
                                <ChevronRight className="w-3.5 h-3.5 mr-1" /> {WORKFLOW[row.status]}
                              </Button>
                            )}
                            {can("content.edit") && (
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(row)}><Pencil className="w-3.5 h-3.5" /></Button>
                            )}
                            {can("content.delete") && (
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setDeleteRow(row)}><Trash2 className="w-3.5 h-3.5" /></Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <div className="md:hidden space-y-3">
                {rows.map((row) => (
                  <button key={row.id} className="apex-panel p-4 w-full text-left hover:border-primary/30 transition-colors" onClick={() => setDetailId(row.id)}>
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium text-sm">{row.title}</span>
                      <StatusBadge status={row.status} />
                    </div>
                    <div className="flex flex-wrap items-center gap-2 mt-2.5">
                      <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px]", PLATFORM_STYLE[row.platform])}>
                        <PlatformIcon platform={row.platform} className="w-3 h-3" /> {row.platform.replace(/_/g, " ")}
                      </span>
                      <span className="text-[10px] text-muted-foreground">{row.contentType.replace(/_/g, " ")}</span>
                      <span className={cn("text-[10px]", row.publishDate ? "text-foreground/80" : "text-muted-foreground")}>
                        {row.publishDate ? `📅 ${formatDate(row.publishDate)}` : "No date"}
                      </span>
                    </div>
                  </button>
                ))}
              </div>

              <div className="flex items-center justify-between mt-4 text-xs text-muted-foreground">
                <span>{total} item{total === 1 ? "" : "s"}</span>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
                  <span>{page} / {totalPages}</span>
                  <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</Button>
                </div>
              </div>
            </>
          )}
        </>
      ) : (
        <CalendarTab
          onOpen={(id) => setDetailId(id)}
          canCreate={can("content.create")}
          onCreate={openCreate}
          reloadKey={reloadKey}
        />
      )}

      {/* ---------- Create / edit dialog ---------- */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editRow ? "Edit content" : "New content"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <Field label="Title" required>
                <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Launch post: new dashboard features" className="bg-secondary/40" />
              </Field>
            </div>
            <Field label="Platform" required>
              <Select value={form.platform} onValueChange={(v) => setForm({ ...form, platform: v })}>
                <SelectTrigger className="bg-secondary/40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PLATFORMS.map((p) => <SelectItem key={p} value={p}>{p.replace(/_/g, " ")}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Content type" required>
              <Select value={form.contentType} onValueChange={(v) => setForm({ ...form, contentType: v })}>
                <SelectTrigger className="bg-secondary/40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CONTENT_TYPES.map((t) => <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Status" required>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger className="bg-secondary/40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Publish date" hint="Required before marking as scheduled">
              <Input type="datetime-local" value={form.publishDate} onChange={(e) => setForm({ ...form, publishDate: e.target.value })} className="bg-secondary/40" />
            </Field>
            <Field label="Campaign">
              <Select value={form.campaignId} onValueChange={(v) => setForm({ ...form, campaignId: v })}>
                <SelectTrigger className="bg-secondary/40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">No campaign</SelectItem>
                  {(campaigns || []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Author">
              <Select value={form.authorId} onValueChange={(v) => setForm({ ...form, authorId: v })}>
                <SelectTrigger className="bg-secondary/40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">Unassigned</SelectItem>
                  {(team || []).map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Reviewer">
              <Select value={form.reviewerId} onValueChange={(v) => setForm({ ...form, reviewerId: v })}>
                <SelectTrigger className="bg-secondary/40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">Unassigned</SelectItem>
                  {(team || []).map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <div className="sm:col-span-2">
              <Field label="Caption">
                <Textarea rows={3} value={form.caption} onChange={(e) => setForm({ ...form, caption: e.target.value })} placeholder="Post caption / copy…" className="bg-secondary/40" />
              </Field>
            </div>
            <Field label="Call to action">
              <Input value={form.cta} onChange={(e) => setForm({ ...form, cta: e.target.value })} placeholder="e.g. Book a free demo" className="bg-secondary/40" />
            </Field>
            <Field label="Hashtags">
              <Input value={form.hashtags} onChange={(e) => setForm({ ...form, hashtags: e.target.value })} placeholder="#webdev #automation" className="bg-secondary/40" />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Media URL">
                <Input value={form.mediaUrl} onChange={(e) => setForm({ ...form, mediaUrl: e.target.value })} placeholder="https://…" className="bg-secondary/40" />
              </Field>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={doSave} disabled={saving} className="bg-primary text-primary-foreground hover:bg-primary/90">
              {saving ? "Saving…" : editRow ? "Save changes" : "Create content"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ---------- Detail sheet ---------- */}
      <Sheet open={!!detailId} onOpenChange={(open) => { if (!open) setDetailId(null); }}>
        <SheetContent className="w-full sm:max-w-lg p-0 flex flex-col">
          {/* Header always rendered — Radix requires SheetTitle for a11y */}
          <div className="p-5 border-b border-border">
            <SheetTitle className="text-base font-semibold">{detail?.content.title || "…"}</SheetTitle>
            {detail && (
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <StatusBadge status={detail.content.status} />
                <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px]", PLATFORM_STYLE[detail.content.platform])}>
                  <PlatformIcon platform={detail.content.platform} /> {detail.content.platform.replace(/_/g, " ")}
                </span>
                <span className="text-[11px] text-muted-foreground">{detail.content.contentType.replace(/_/g, " ")}</span>
              </div>
            )}
          </div>
          {detailLoading || !detail ? (
            <div className="p-6 space-y-3"><ListSkeleton rows={5} /></div>
          ) : (
            <ScrollArea className="flex-1 apex-scroll">
                <div className="p-5 space-y-5">
                  {/* Workflow actions */}
                  {can("content.edit") && WORKFLOW[detail.content.status] && (
                    <div className="flex items-center gap-2">
                      <Button size="sm" onClick={() => advanceStatus(detail.content)} className="bg-primary text-primary-foreground hover:bg-primary/90">
                        <ChevronRight className="w-4 h-4 mr-1" /> Move to {WORKFLOW[detail.content.status]}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => openEdit(detail.content)}><Pencil className="w-3.5 h-3.5 mr-1" /> Edit</Button>
                      {can("content.delete") && (
                        <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => setDeleteRow(detail.content)}><Trash2 className="w-3.5 h-3.5" /></Button>
                      )}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div><p className="text-xs text-muted-foreground">Publish date</p><p className="mt-0.5">{detail.content.publishDate ? formatDateTime(detail.content.publishDate) : "Not set"}</p></div>
                    <div><p className="text-xs text-muted-foreground">Campaign</p><p className="mt-0.5">{detail.content.campaign?.name || "—"}</p></div>
                    <div><p className="text-xs text-muted-foreground">Author</p><p className="mt-0.5">{detail.content.author?.name || "—"}</p></div>
                    <div><p className="text-xs text-muted-foreground">Reviewer</p><p className="mt-0.5">{detail.content.reviewer?.name || "—"}</p></div>
                    {detail.content.cta && <div className="col-span-2"><p className="text-xs text-muted-foreground">Call to action</p><p className="mt-0.5">{detail.content.cta}</p></div>}
                    {detail.content.hashtags && <div className="col-span-2"><p className="text-xs text-muted-foreground">Hashtags</p><p className="mt-0.5 text-primary/90">{detail.content.hashtags}</p></div>}
                    {detail.content.mediaUrl && <div className="col-span-2"><p className="text-xs text-muted-foreground">Media</p><a href={detail.content.mediaUrl} target="_blank" rel="noreferrer" className="mt-0.5 text-primary hover:underline break-all">{detail.content.mediaUrl}</a></div>}
                    {detail.content.caption && (
                      <div className="col-span-2">
                        <p className="text-xs text-muted-foreground mb-1">Caption</p>
                        <div className="rounded-lg border border-border bg-secondary/30 p-3 text-sm whitespace-pre-wrap">{detail.content.caption}</div>
                      </div>
                    )}
                  </div>

                  {/* Timeline */}
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">History</p>
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
                  </div>
                </div>
              </ScrollArea>
          )}
        </SheetContent>
      </Sheet>

      {/* ---------- Delete confirm ---------- */}
      <AlertDialog open={!!deleteRow} onOpenChange={(open) => { if (!open) setDeleteRow(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this content?</AlertDialogTitle>
            <AlertDialogDescription>
              “{deleteRow?.title}” will be permanently removed. This action is recorded in the audit log.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={doDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ============================================================
// Publishing calendar (month grid) — fetches its own month data
// ============================================================
function CalendarTab({
  onOpen, canCreate, onCreate, reloadKey,
}: {
  onOpen: (id: string) => void;
  canCreate: boolean;
  onCreate: () => void;
  reloadKey: number;
}) {
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [monthItems, setMonthItems] = useState<ContentRow[]>([]);
  const [loadedMonthKey, setLoadedMonthKey] = useState<string | null>(null);
  const [calError, setCalError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const key = `${month.getFullYear()}-${month.getMonth()}`;
    const from = new Date(month.getFullYear(), month.getMonth(), 1);
    const to = new Date(month.getFullYear(), month.getMonth() + 1, 0, 23, 59, 59);
    api.get<{ items: ContentRow[] }>(`/api/content${qs({
      from: from.toISOString(), to: to.toISOString(), pageSize: 200,
    })}`)
      .then((d) => { if (!cancelled) { setMonthItems(d.items); setLoadedMonthKey(key); setCalError(false); } })
      .catch(() => { if (!cancelled) { setCalError(true); setLoadedMonthKey(key); } });
    return () => { cancelled = true; };
  }, [month, reloadKey]);

  const calLoading = loadedMonthKey !== `${month.getFullYear()}-${month.getMonth()}`;

  const days = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const startDow = first.getDay(); // 0 = Sunday
    const gridStart = new Date(first);
    gridStart.setDate(first.getDate() - startDow);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      return d;
    });
  }, [month]);

  const byDay = useMemo(() => {
    const map = new Map<string, ContentRow[]>();
    for (const r of monthItems || []) {
      if (!r.publishDate) continue;
      const d = new Date(r.publishDate);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return map;
  }, [monthItems]);

  const today = new Date();
  const isThisMonth = (d: Date) => d.getMonth() === month.getMonth() && d.getFullYear() === month.getFullYear();
  const isToday = (d: Date) => d.toDateString() === today.toDateString();

  const monthLabel = month.toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  if (calError) return <ErrorState onRetry={() => setMonth((m) => new Date(m.getTime()))} />;
  if (calLoading) return <ListSkeleton rows={5} />;

  return (
    <div className="apex-panel p-4 overflow-x-auto apex-scroll">
      <div className="flex items-center justify-between mb-4 min-w-[640px]">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Previous month">
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Next month">
            <ChevronRight className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="sm" className="ml-1 h-8 text-xs" onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); }}>Today</Button>
        </div>
        <h3 className="text-sm font-semibold">{monthLabel}</h3>
        {canCreate && (
          <Button size="sm" variant="outline" onClick={onCreate}><Plus className="w-3.5 h-3.5 mr-1" /> Plan content</Button>
        )}
      </div>

      <div className="grid grid-cols-7 gap-1.5 min-w-[640px]">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="text-center text-[10px] text-muted-foreground uppercase tracking-wide py-1">{d}</div>
        ))}
        {days.map((d, i) => {
          const items = byDay.get(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`) || [];
          return (
            <div
              key={i}
              className={cn(
                "min-h-[84px] rounded-lg border p-1.5 transition-colors",
                isThisMonth(d) ? "border-border bg-secondary/20" : "border-border/40 bg-transparent opacity-40",
                isToday(d) && "border-primary/60 bg-primary/5"
              )}
            >
              <div className={cn("text-[10px] mb-1 px-0.5", isToday(d) ? "text-primary font-bold" : "text-muted-foreground")}>{d.getDate()}</div>
              <div className="space-y-1">
                {items.slice(0, 2).map((item) => (
                  <button
                    key={item.id}
                    onClick={() => onOpen(item.id)}
                    className={cn(
                      "w-full text-left text-[10px] leading-tight px-1.5 py-1 rounded border truncate hover:border-primary/50 transition-colors flex items-center gap-1",
                      item.status === "PUBLISHED" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                        : item.status === "SCHEDULED" ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-200"
                        : "border-border bg-secondary/40 text-muted-foreground"
                    )}
                    title={item.title}
                  >
                    <PlatformIcon platform={item.platform} className="w-2.5 h-2.5 shrink-0" />
                    <span className="truncate">{item.title}</span>
                  </button>
                ))}
                {items.length > 2 && (
                  <div className="text-[9px] text-muted-foreground px-1">+{items.length - 2} more</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-3 mt-4 text-[10px] text-muted-foreground min-w-[640px]">
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-cyan-500/40 border border-cyan-500/40" /> Scheduled</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500/40 border border-emerald-500/40" /> Published</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-secondary border border-border" /> In progress</span>
        <span className="ml-auto hidden sm:inline">Navigate months — content loads per month from the server.</span>
      </div>
    </div>
  );
}
