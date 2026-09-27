"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FolderKanban, ListTodo, LifeBuoy, Building2, Users, FileSpreadsheet, FileSignature,
  Paperclip, HardDrive, Clock, UploadCloud, Search, X, Layers, ChevronLeft, ChevronRight,
} from "lucide-react";
import { PageHeader, StatCard, ErrorState, ListSkeleton, EmptyState } from "@/components/shared";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { FileAttachmentRow, type AttachedFile } from "@/components/shared/files";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "next-auth/react";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { api, qs } from "@/lib/api-client";
import { cn } from "@/lib/utils";

// ============ Files — global attachment library ============
// One place to see every file in APEX, attached to projects, tasks, tickets,
// clients, leads, invoices and contracts. Uploads here pick a target entity.

type EntityTypeKey = "PROJECT" | "TASK" | "TICKET" | "CLIENT" | "LEAD" | "INVOICE" | "CONTRACT";

const ENTITY_META: Record<EntityTypeKey, { label: string; icon: typeof FolderKanban; listPath: string; nav: string }> = {
  PROJECT: { label: "Project", icon: FolderKanban, listPath: "/api/projects", nav: "projects" },
  TASK: { label: "Task", icon: ListTodo, listPath: "/api/tasks", nav: "tasks" },
  TICKET: { label: "Ticket", icon: LifeBuoy, listPath: "/api/tickets", nav: "support/tickets" },
  CLIENT: { label: "Client", icon: Building2, listPath: "/api/clients", nav: "crm/clients" },
  LEAD: { label: "Lead", icon: Users, listPath: "/api/leads", nav: "crm/leads" },
  INVOICE: { label: "Invoice", icon: FileSpreadsheet, listPath: "/api/invoices", nav: "finance/invoices" },
  CONTRACT: { label: "Contract", icon: FileSignature, listPath: "/api/contracts", nav: "sales/contracts" },
};
const ENTITY_KEYS = Object.keys(ENTITY_META) as EntityTypeKey[];

type FilesPayload = {
  files: AttachedFile[];
  pagination: { page: number; pageSize: number; total: number; pages: number };
  stats: {
    totalCount: number;
    totalBytes: number;
    recentCount: number;
    byType: { entityType: string; count: number }[];
    viewerId: string;
  };
};

export function FilesView({ navigate }: { navigate: (p: string) => void }) {
  const { data: session } = useSession();
  const me = session?.user;
  const [data, setData] = useState<FilesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [entityType, setEntityType] = useState<string>("");
  const [q, setQ] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(1);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<AttachedFile | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setError(null);
      const d = await api.get<FilesPayload>("/api/files" + qs({
        entityType: entityType || undefined, q: q || undefined, page, pageSize: 20,
      }));
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load files");
    } finally {
      setLoading(false);
    }
  }, [entityType, q, page]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const t = setTimeout(() => { setSearchInput((v) => { if (v !== q) setPage(1); return v; }); setQ(searchInput); }, 350);
    return () => clearTimeout(t);
  }, [searchInput, q]);

  const canUpload = !!me?.permissions?.includes("files.upload");
  const canDeleteFile = (f: AttachedFile) =>
    !!me && (f.uploader?.id === me.id || !!me.permissions?.includes("files.delete"));
  const removeFile = useCallback(async (file: AttachedFile) => {
    setConfirmDelete(null);
    try {
      await api.delete(`/api/files/${file.id}`);
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }, [load]);

  const topType = useMemo(() => {
    if (!data?.stats.byType.length) return null;
    return [...data.stats.byType].sort((a, b) => b.count - a.count)[0];
  }, [data]);

  const TopIcon = topType ? ENTITY_META[topType.entityType as EntityTypeKey]?.icon ?? Layers : Layers;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Files"
        description="Every file in APEX in one library — briefs, designs, exports and deliverables attached to the records they belong to."
        actions={(
          <Button size="sm" disabled={!canUpload} onClick={() => setUploadOpen(true)}>
            <UploadCloud className="w-4 h-4 mr-2" /> Upload file
          </Button>
        )}
      />

      {/* Summary strip */}
      {!loading && data && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <StatCard label="Total files" value={data.stats.totalCount} icon={<Paperclip className="w-4 h-4" />} accent="cyan" />
          <StatCard label="Storage used" value={<span className="text-lg">{formatBytes(data.stats.totalBytes)}</span>} icon={<HardDrive className="w-4 h-4" />} accent="violet" />
          <StatCard label="Uploaded this week" value={data.stats.recentCount} icon={<Clock className="w-4 h-4" />} accent="emerald" />
          <StatCard
            label="Most attached to"
            value={topType ? (
              <span className="flex items-center gap-2 text-lg">
                <TopIcon className="w-4 h-4 opacity-70" /> {ENTITY_META[topType.entityType as EntityTypeKey]?.label ?? topType.entityType}
              </span>
            ) : "—"}
            sub={topType ? `${topType.count} file${topType.count === 1 ? "" : "s"}` : "no attachments yet"}
            icon={<Layers className="w-4 h-4" />} accent="amber"
          />
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search file names…"
            className="pl-9 pr-8"
            aria-label="Search files"
          />
          {searchInput && (
            <button
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setSearchInput("")}
              aria-label="Clear search"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 apex-scroll" role="group" aria-label="Filter by entity type">
          <button
            onClick={() => { setEntityType(""); setPage(1); }}
            className={cn(
              "px-2.5 py-1.5 rounded-lg border text-[11px] font-medium whitespace-nowrap transition-colors",
              entityType === "" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
            )}
          >
            All
          </button>
          {ENTITY_KEYS.map((key) => {
            const Icon = ENTITY_META[key].icon;
            const count = data?.stats.byType.find((b) => b.entityType === key)?.count;
            return (
              <button
                key={key}
                onClick={() => { setEntityType(key === entityType ? "" : key); setPage(1); }}
                className={cn(
                  "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-medium whitespace-nowrap transition-colors",
                  entityType === key ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {ENTITY_META[key].label}
                {count ? <span className="opacity-60">{count}</span> : null}
              </button>
            );
          })}
        </div>
      </div>

      {/* List */}
      {loading ? (
        <ListSkeleton rows={7} />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : !data || data.files.length === 0 ? (
        <EmptyState
          icon={<Paperclip className="w-5 h-5" />}
          title={q || entityType ? "No files match this filter" : "No files yet"}
          description={q || entityType
            ? "Try a different search or clear the entity filter."
            : "Upload briefs, contracts, designs and deliverables — attach them to projects, tickets, clients and more."}
          action={(
            <Button size="sm" onClick={() => setUploadOpen(true)}>
              <UploadCloud className="w-4 h-4 mr-2" /> Upload the first file
            </Button>
          )}
        />
      ) : (
        <>
          <div className="space-y-2">
            {data.files.map((f) => (
              <FileAttachmentRow
                key={f.id}
                file={f}
                canDelete={canDeleteFile(f)}
                showEntity
                onDelete={setConfirmDelete}
              />
            ))}
          </div>
          {data.pagination.pages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <p className="text-xs text-muted-foreground">
                Page {data.pagination.page} of {data.pagination.pages} · {data.pagination.total} files
              </p>
              <div className="flex items-center gap-1.5">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Button variant="outline" size="sm" disabled={page >= data.pagination.pages} onClick={() => setPage((p) => p + 1)}>
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      <UploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        navigate={navigate}
        onUploaded={() => void load()}
      />

      <AlertDialog open={!!confirmDelete} onOpenChange={(open) => { if (!open) setConfirmDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this file?</AlertDialogTitle>
            <AlertDialogDescription>
              “{confirmDelete?.originalName}” will be permanently removed for everyone. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => confirmDelete && void removeFile(confirmDelete)}
            >
              Delete file
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ============ Upload dialog with entity picker ============

type EntityOption = { id: string; label: string; sub: string };

function UploadDialog({
  open, onOpenChange, onUploaded,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  navigate: (p: string) => void;
  onUploaded: () => void;
}) {
  const [entityType, setEntityType] = useState<EntityTypeKey>("PROJECT");
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<EntityOption[] | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const reset = useCallback(() => {
    setSearch(""); setOptions(null); setOptionsError(null);
    setSelectedId(null); setFile(null); setError(null);
  }, []);

  useEffect(() => {
    if (!open) { reset(); setEntityType("PROJECT"); }
  }, [open, reset]);

  // Load entity options whenever type/search changes (debounced)
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setOptions(null); setOptionsError(null);
      try {
        const meta = ENTITY_META[entityType];
        const d = await api.get<{ items: Record<string, unknown>[] }>(meta.listPath + qs({ q: search || undefined, pageSize: 25 }));
        if (cancelled) return;
        const mapped: EntityOption[] = d.items.map((item) => {
          const rec = item as Record<string, string | null>;
          switch (entityType) {
            case "PROJECT": return { id: String(item.id), label: rec.name ?? "Project", sub: rec.projectNumber ?? "" };
            case "TASK": return { id: String(item.id), label: rec.title ?? "Task", sub: "" };
            case "TICKET": return { id: String(item.id), label: rec.subject ?? "Ticket", sub: rec.ticketNumber ?? "" };
            case "CLIENT": return { id: String(item.id), label: rec.companyName ?? "Client", sub: rec.clientNumber ?? "" };
            case "LEAD": return { id: String(item.id), label: rec.companyName ?? "Lead", sub: rec.leadNumber ?? "" };
            case "INVOICE": return { id: String(item.id), label: rec.invoiceNumber ?? "Invoice", sub: "" };
            case "CONTRACT": return { id: String(item.id), label: rec.title ?? "Contract", sub: rec.contractNumber ?? "" };
          }
        });
        setOptions(mapped);
      } catch (e) {
        if (cancelled) return;
        setOptions([]);
        setOptionsError(e instanceof Error ? e.message : `Could not load ${ENTITY_META[entityType].label.toLowerCase()} list`);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [open, entityType, search]);

  const submit = useCallback(async () => {
    if (!selectedId || !file) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("entityType", entityType);
      fd.append("entityId", selectedId);
      const res = await fetch("/api/files", { method: "POST", body: fd });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body?.error?.message || "Upload failed");
      onOpenChange(false);
      onUploaded();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }, [selectedId, file, entityType, onOpenChange, onUploaded]);

  const TypeIcon = ENTITY_META[entityType].icon;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto apex-scroll">
        <DialogHeader>
          <DialogTitle>Upload a file</DialogTitle>
          <DialogDescription>
            Choose where the file belongs — it will appear on the record and in this library.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Entity type pills */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">Attach to</p>
            <div className="flex flex-wrap gap-1.5">
              {ENTITY_KEYS.map((key) => {
                const Icon = ENTITY_META[key].icon;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => { setEntityType(key); setSelectedId(null); }}
                    className={cn(
                      "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors",
                      entityType === key ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Icon className="w-3.5 h-3.5" /> {ENTITY_META[key].label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Entity picker */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">
              Select {ENTITY_META[entityType].label.toLowerCase()}
            </p>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${ENTITY_META[entityType].label.toLowerCase()}s…`}
              className="mb-2"
              aria-label={`Search ${ENTITY_META[entityType].label.toLowerCase()}`}
            />
            <div className="max-h-44 overflow-y-auto apex-scroll rounded-lg border border-border divide-y divide-border/60">
              {options === null ? (
                <div className="p-3 space-y-2">
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-9 w-full" />
                </div>
              ) : optionsError ? (
                <p className="p-3 text-xs text-muted-foreground">{optionsError}</p>
              ) : options.length === 0 ? (
                <p className="p-3 text-xs text-muted-foreground">No matches.</p>
              ) : (
                options.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setSelectedId(opt.id)}
                    className={cn(
                      "w-full text-left px-3 py-2 text-sm transition-colors flex items-center justify-between gap-2",
                      selectedId === opt.id ? "bg-primary/10 text-primary" : "hover:bg-accent/40"
                    )}
                  >
                    <span className="truncate">{opt.label}</span>
                    {opt.sub && <span className="text-[10px] font-mono text-muted-foreground shrink-0">{opt.sub}</span>}
                  </button>
                ))
              )}
            </div>
          </div>

          {/* File drop zone */}
          <div
            role="button"
            tabIndex={0}
            aria-label="Choose file"
            onClick={() => document.getElementById("global-file-input")?.click()}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") document.getElementById("global-file-input")?.click(); }}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]); }}
            className={cn(
              "flex flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed px-4 py-6 text-center cursor-pointer transition-colors",
              dragOver ? "border-primary bg-primary/10" : "border-border hover:border-primary/40 hover:bg-accent/30"
            )}
          >
            {file ? (
              <>
                <TypeIcon className="w-5 h-5 text-emerald-300" />
                <p className="text-sm font-medium truncate max-w-full">{file.name}</p>
                <p className="text-[11px] text-muted-foreground">{formatBytes(file.size)} · click to replace</p>
              </>
            ) : (
              <>
                <UploadCloud className="w-5 h-5 text-primary" />
                <p className="text-sm font-medium">Drop a file or click to browse</p>
                <p className="text-[11px] text-muted-foreground">Any format · up to 10 MB</p>
              </>
            )}
            <input
              id="global-file-input"
              type="file"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>

          {error && (
            <p className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2">{error}</p>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
            <Button disabled={!selectedId || !file || busy} onClick={() => void submit()}>
              {busy ? "Uploading…" : "Upload file"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
