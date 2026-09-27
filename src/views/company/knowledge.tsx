"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader, EmptyState, ErrorState, ListSkeleton, Field } from "@/components/shared";
import { api, qs, relativeTime, formatDateTime } from "@/lib/api-client";
import { useSession } from "next-auth/react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  BookOpen, Plus, Search, Pencil, Archive, Users2, Layers, User, History, Lock,
} from "lucide-react";

// ==================== types & constants ====================

type Article = {
  id: string; title: string; category: string; content: string;
  visibility: string; version: number; createdAt: string; updatedAt: string;
  author?: { id: string; name: string; avatarColor: string } | null;
};

const CATEGORIES = ["SALES", "DEVELOPMENT", "DESIGN", "DEPLOYMENT", "MARKETING", "OPERATIONS", "SOP", "TROUBLESHOOTING", "TEMPLATES"] as const;

const CATEGORY_STYLE: Record<string, string> = {
  SALES: "bg-sky-500/10 text-sky-300 border-sky-500/30",
  DEVELOPMENT: "bg-cyan-500/10 text-cyan-300 border-cyan-500/30",
  DESIGN: "bg-violet-500/10 text-violet-300 border-violet-500/30",
  DEPLOYMENT: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  MARKETING: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  OPERATIONS: "bg-slate-500/10 text-slate-300 border-slate-500/30",
  SOP: "bg-blue-500/10 text-blue-300 border-blue-500/30",
  TROUBLESHOOTING: "bg-rose-500/10 text-rose-300 border-rose-500/30",
  TEMPLATES: "bg-teal-500/10 text-teal-300 border-teal-500/30",
};

function CategoryBadge({ category }: { category: string }) {
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-md border text-[10px] font-medium tracking-wide", CATEGORY_STYLE[category] || CATEGORY_STYLE.OPERATIONS)}>
      {category}
    </span>
  );
}

function excerpt(content: string, len = 150) {
  const flat = content.replace(/[#*`>\-]/g, " ").replace(/\s+/g, " ").trim();
  return flat.length > len ? `${flat.slice(0, len)}…` : flat;
}

// ==================== lightweight content renderer ====================

function ArticleContent({ content }: { content: string }) {
  const blocks = useMemo(() => {
    const lines = content.split("\n");
    const out: { type: "h1" | "h2" | "p" | "li" | "code"; text: string }[] = [];
    let inCode = false;
    let codeBuf: string[] = [];
    for (const line of lines) {
      if (line.trim().startsWith("```")) {
        if (inCode) { out.push({ type: "code", text: codeBuf.join("\n") }); codeBuf = []; inCode = false; }
        else inCode = true;
        continue;
      }
      if (inCode) { codeBuf.push(line); continue; }
      const t = line.trim();
      if (!t) continue;
      if (t.startsWith("## ")) out.push({ type: "h2", text: t.slice(3) });
      else if (t.startsWith("# ")) out.push({ type: "h1", text: t.slice(2) });
      else if (t.startsWith("- ") || t.startsWith("* ")) out.push({ type: "li", text: t.slice(2) });
      else out.push({ type: "p", text: t });
    }
    if (inCode && codeBuf.length) out.push({ type: "code", text: codeBuf.join("\n") });
    return out;
  }, [content]);

  return (
    <div className="space-y-2.5 text-sm leading-relaxed text-foreground/90">
      {blocks.map((b, i) => {
        if (b.type === "h1") return <h3 key={i} className="text-base font-semibold text-foreground pt-2">{b.text}</h3>;
        if (b.type === "h2") return <h4 key={i} className="text-sm font-semibold text-foreground/90 pt-1">{b.text}</h4>;
        if (b.type === "li") {
          return (
            <div key={i} className="flex gap-2 pl-1">
              <span className="w-1.5 h-1.5 rounded-full bg-primary/60 mt-2 shrink-0" />
              <p>{b.text}</p>
            </div>
          );
        }
        if (b.type === "code") {
          return (
            <pre key={i} className="rounded-lg bg-black/40 border border-border p-3 text-xs font-mono overflow-x-auto whitespace-pre-wrap">
              {b.text}
            </pre>
          );
        }
        return <p key={i}>{b.text}</p>;
      })}
    </div>
  );
}

// ==================== create / edit dialog ====================

function ArticleDialog({ open, onOpenChange, editArticle, onSaved }: {
  open: boolean; onOpenChange: (v: boolean) => void; editArticle: Article | null; onSaved: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState({ title: "", category: "OPERATIONS", visibility: "INTERNAL", content: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(editArticle
        ? { title: editArticle.title, category: editArticle.category, visibility: editArticle.visibility, content: editArticle.content }
        : { title: "", category: "OPERATIONS", visibility: "INTERNAL", content: "" });
    }
  }, [open, editArticle]);

  const submit = async () => {
    setSaving(true);
    try {
      if (editArticle) {
        await api.patch(`/api/knowledge/${editArticle.id}`, form);
        toast({ title: "Article updated", description: "Version incremented on content change." });
      } else {
        await api.post("/api/knowledge", form);
        toast({ title: "Article published" });
      }
      onOpenChange(false); onSaved();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Save failed", variant: "destructive" });
    } finally { setSaving(false); }
  };

  const valid = form.title.trim().length >= 3 && form.content.trim().length >= 10;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-primary" /> {editArticle ? "Edit article" : "New knowledge article"}
          </DialogTitle>
          <DialogDescription>
            Internal SOPs, guides and templates. Supports simple formatting: <code className="text-[11px] bg-secondary px-1 rounded"># heading</code>, <code className="text-[11px] bg-secondary px-1 rounded">- bullet</code>, <code className="text-[11px] bg-secondary px-1 rounded">``` code</code>.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="sm:col-span-2">
            <Field label="Title" required><Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Deployment checklist — Next.js to client VPS" className="bg-secondary/40" /></Field>
          </div>
          <Field label="Category" required>
            <Select value={form.category} onValueChange={(category) => setForm((f) => ({ ...f, category }))}>
              <SelectTrigger className="bg-secondary/40"><SelectValue /></SelectTrigger>
              <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
        </div>
        <Field label="Content" required hint="First heading becomes the article structure. Minimum 10 characters.">
          <Textarea
            rows={12} value={form.content}
            onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
            placeholder={"# Overview\nWhat this article covers…\n\n## Steps\n- Step one\n- Step two"}
            className="bg-secondary/40 font-mono text-xs leading-relaxed"
          />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!valid || saving} className="bg-primary text-primary-foreground hover:bg-primary/90">
            {saving ? "Saving…" : editArticle ? "Save changes" : "Publish article"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ==================== detail sheet ====================

function ArticleSheet({ articleId, onClose, onEdit, onArchived }: {
  articleId: string; onClose: () => void; onEdit: (a: Article) => void; onArchived: () => void;
}) {
  const { toast } = useToast();
  const [article, setArticle] = useState<Article | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(false);
    try {
      const data = await api.get<{ article: Article }>(`/api/knowledge/${articleId}`);
      setArticle(data.article);
    } catch { setError(true); } finally { setLoading(false); }
  }, [articleId]);
  useEffect(() => { load(); }, [load]);

  const doArchive = async () => {
    try {
      await api.delete(`/api/knowledge/${articleId}`);
      toast({ title: "Article archived" });
      setConfirmArchive(false); onArchived();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Archive failed", variant: "destructive" });
    }
  };

  return (
    <Sheet open onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-xl p-0 flex flex-col">
        {/* Header always rendered so SheetTitle exists in every state (a11y) */}
        <div className="p-5 border-b border-border bg-card/50">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <SheetTitle className="text-base font-semibold leading-snug">
                {article?.title ?? "Loading article…"}
              </SheetTitle>
              {article && (
                <>
                  <div className="flex items-center gap-2 flex-wrap mt-2">
                    <CategoryBadge category={article.category} />
                    <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                      v{article.version}
                    </span>
                    <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                      <History className="w-3 h-3" /> Updated {relativeTime(article.updatedAt)}
                    </span>
                    {article.visibility === "TEAM" && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/30 font-medium inline-flex items-center gap-1">
                        <Users2 className="w-2.5 h-2.5" /> TEAM
                      </span>
                    )}
                    {article.visibility === "INTERNAL" && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary border border-border font-medium inline-flex items-center gap-1 text-muted-foreground">
                        <Lock className="w-2.5 h-2.5" /> INTERNAL
                      </span>
                    )}
                  </div>
                  {article.author && (
                    <div className="flex items-center gap-2 mt-3">
                      <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white" style={{ backgroundColor: article.author.avatarColor }}>
                        {article.author.name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase()}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        By {article.author.name} · published {formatDateTime(article.createdAt)}
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>
            {article && (
              <div className="flex gap-1.5 shrink-0">
                <Button variant="outline" size="sm" onClick={() => onEdit(article)}>
                  <Pencil className="w-3.5 h-3.5 mr-1.5" /> Edit
                </Button>
                <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => setConfirmArchive(true)}>
                  <Archive className="w-3.5 h-3.5" />
                </Button>
              </div>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-5 w-1/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : error ? (
            <ErrorState onRetry={load} />
          ) : article && (
            <ArticleContent content={article.content} />
          )}
        </div>
      </SheetContent>

      <AlertDialog open={confirmArchive} onOpenChange={setConfirmArchive}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive “{article?.title}”?</AlertDialogTitle>
            <AlertDialogDescription>The article will be hidden from the knowledge base. This follows the archive-first policy and keeps the audit trail.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={doArchive}>Archive article</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}

// ==================== main view ====================

export function KnowledgeView() {
  const { data: session } = useSession();
  const perms = session?.user?.permissions || [];
  const can = (p: string) => perms.includes(p);

  const [items, setItems] = useState<Article[]>([]);
  const [summary, setSummary] = useState<{ totalArticles: number; categories: { category: string; count: number }[]; contributors: { id: string; name: string; avatarColor: string }[] }>({ totalArticles: 0, categories: [], contributors: [] });
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("ALL");
  const [reloadKey, setReloadKey] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editArticle, setEditArticle] = useState<Article | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const pageSize = 12;

  const load = useCallback(async () => {
    setLoading(true); setError(false);
    try {
      const data = await api.get<{ items: Article[]; total: number; summary: typeof summary }>(
        `/api/knowledge${qs({ q, category: category === "ALL" ? undefined : category, page, pageSize })}`
      );
      setItems(data.items); setTotal(data.total); setSummary(data.summary);
    } catch { setError(true); } finally { setLoading(false); }
  }, [q, category, page, reloadKey]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [q, category]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      <PageHeader
        title="Knowledge Base"
        description="Internal SOPs, troubleshooting guides, templates and team know-how — one searchable source of truth."
        actions={can("kb.create") ? (
          <Button onClick={() => { setEditArticle(null); setDialogOpen(true); }} className="bg-primary text-primary-foreground hover:bg-primary/90">
            <Plus className="w-4 h-4 mr-2" /> New article
          </Button>
        ) : undefined}
      />

      {/* summary strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <div className="apex-panel p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Articles</p>
          <p className="text-2xl font-semibold mt-1">{summary.totalArticles}</p>
        </div>
        <div className="apex-panel p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium flex items-center gap-1.5"><Layers className="w-3 h-3" /> Categories in use</p>
          <p className="text-2xl font-semibold mt-1">{summary.categories.length}</p>
        </div>
        <div className="apex-panel p-4 col-span-2">
          <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium flex items-center gap-1.5 mb-2"><Users2 className="w-3 h-3" /> Contributors</p>
          <div className="flex items-center gap-2 flex-wrap">
            {summary.contributors.length === 0 ? (
              <span className="text-xs text-muted-foreground">No contributors yet</span>
            ) : summary.contributors.map((c) => (
              <span key={c.id} className="inline-flex items-center gap-1.5 text-xs">
                <span className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white" style={{ backgroundColor: c.avatarColor }}>
                  {c.name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase()}
                </span>
                {c.name}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* filters */}
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <div className="relative sm:max-w-xs w-full">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search articles…" className="pl-9 bg-secondary/40" />
        </div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="sm:w-48 bg-secondary/40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All categories</SelectItem>
            {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground self-center sm:ml-auto whitespace-nowrap">
          {total} article{total === 1 ? "" : "s"}
        </span>
      </div>

      {loading ? (
        <ListSkeleton rows={5} />
      ) : error ? (
        <ErrorState onRetry={() => setReloadKey((k) => k + 1)} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="w-5 h-5" />}
          title={q || category !== "ALL" ? "No articles match your filters" : "The knowledge base is empty"}
          description={q || category !== "ALL"
            ? "Try a different search term or category."
            : "Document your SOPs, deployment guides and troubleshooting steps so the whole team benefits."}
          action={can("kb.create") && !q && category === "ALL" ? (
            <Button onClick={() => { setEditArticle(null); setDialogOpen(true); }}>
              <Plus className="w-4 h-4 mr-2" /> Write the first article
            </Button>
          ) : undefined}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {items.map((a) => (
              <button
                key={a.id}
                onClick={() => setOpenId(a.id)}
                className="apex-panel p-4 text-left hover:border-primary/40 transition-colors group"
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <CategoryBadge category={a.category} />
                  <span className="text-[10px] text-muted-foreground">v{a.version}</span>
                </div>
                <p className="font-medium text-sm leading-snug group-hover:text-primary transition-colors line-clamp-2">{a.title}</p>
                <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2">{excerpt(a.content)}</p>
                <div className="flex items-center gap-2 mt-3 pt-2.5 border-t border-border/60">
                  {a.author ? (
                    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground min-w-0">
                      <span className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white shrink-0" style={{ backgroundColor: a.author.avatarColor }}>
                        {a.author.name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase()}
                      </span>
                      <span className="truncate">{a.author.name}</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><User className="w-3 h-3" /> Unknown</span>
                  )}
                  <span className="text-[11px] text-muted-foreground ml-auto whitespace-nowrap">{relativeTime(a.updatedAt)}</span>
                </div>
              </button>
            ))}
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 mt-5">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <span className="text-xs text-muted-foreground">Page {page} of {totalPages}</span>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          )}
        </>
      )}

      <ArticleDialog open={dialogOpen} onOpenChange={setDialogOpen} editArticle={editArticle} onSaved={() => setReloadKey((k) => k + 1)} />
      {openId && (
        <ArticleSheet
          articleId={openId}
          onClose={() => setOpenId(null)}
          onEdit={(a) => { setOpenId(null); setEditArticle(a); setDialogOpen(true); }}
          onArchived={() => { setOpenId(null); setReloadKey((k) => k + 1); }}
        />
      )}
    </div>
  );
}
