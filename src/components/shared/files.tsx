"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  File as FileIcon, FileText, FileSpreadsheet, FileCode, FileArchive,
  ImageIcon, FileSignature, Paperclip, UploadCloud, Download, Trash2, Loader2, X, ZoomIn,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { EmptyState } from "@/components/shared";
import { cn } from "@/lib/utils";
import { relativeTime, initials } from "@/lib/api-client";
import { useSession } from "next-auth/react";

// ============ Shared file attachment panel ============
// Used inside entity detail sheets (project / ticket) and the global Files view.
// Uploads go through POST /api/files (multipart); downloads via permission-checked
// /api/files/[id]/download (inline for images/PDF → thumbnails just work).

export const MAX_FILE_MB = 10;

export function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type AttachedFile = {
  id: string;
  originalName: string;
  size: number;
  mimeType: string | null;
  entityType: string;
  entityId: string;
  version: number;
  createdAt: string;
  uploader: { id: string; name: string; avatarColor: string } | null;
  entity?: { id: string; type: string; label: string; sub: string } | null;
};

/** Pick a lucide icon + accent color from the file's mime/extension. */
export function fileVisual(file: { mimeType: string | null; originalName: string }): { Icon: typeof FileIcon; cls: string } {
  const mime = file.mimeType || "";
  const name = file.originalName.toLowerCase();
  if (mime.startsWith("image/")) return { Icon: ImageIcon, cls: "text-violet-300 bg-violet-500/10" };
  if (mime === "application/pdf" || name.endsWith(".pdf")) return { Icon: FileText, cls: "text-rose-300 bg-rose-500/10" };
  if (/\.(xlsx?|csv|numbers)$/.test(name) || mime.includes("spreadsheet") || mime === "text/csv")
    return { Icon: FileSpreadsheet, cls: "text-emerald-300 bg-emerald-500/10" };
  if (/\.(zip|rar|7z|tar|gz)$/.test(name) || mime.includes("zip") || mime.includes("compressed"))
    return { Icon: FileArchive, cls: "text-amber-300 bg-amber-500/10" };
  if (/\.(tsx?|jsx?|py|php|sql|json|html|css|sh|yml|yaml|env)$/.test(name))
    return { Icon: FileCode, cls: "text-cyan-300 bg-cyan-500/10" };
  if (/\.(docx?|txt|md|rtf)$/.test(name) || mime.startsWith("text/"))
    return { Icon: FileText, cls: "text-sky-300 bg-sky-500/10" };
  if (/\.(png|jpe?g|webp|svg|gif|ico)$/.test(name)) return { Icon: ImageIcon, cls: "text-violet-300 bg-violet-500/10" };
  if (name.endsWith(".apk") || name.endsWith(".dmg") || name.endsWith(".exe"))
    return { Icon: FileSignature, cls: "text-slate-300 bg-slate-500/10" };
  return { Icon: FileIcon, cls: "text-slate-300 bg-slate-500/10" };
}

const isImage = (f: { mimeType: string | null; originalName: string }) =>
  (f.mimeType?.startsWith("image/") ?? false) || /\.(png|jpe?g|webp|gif|svg|ico)$/i.test(f.originalName);

// ---------- Image lightbox (click a thumbnail → full-screen preview) ----------
export function ImageLightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[90] bg-[#050a14]/95 backdrop-blur-sm flex items-center justify-center p-4 md:p-10"
      role="dialog"
      aria-modal="true"
      aria-label={`Image preview: ${alt}`}
      onClick={onClose}
    >
      <button
        className="absolute top-4 right-4 h-10 w-10 rounded-full bg-secondary/80 border border-border flex items-center justify-center hover:bg-secondary transition-colors"
        aria-label="Close preview"
        onClick={onClose}
      >
        <X className="w-5 h-5" />
      </button>
      <Button
        asChild
        variant="outline"
        size="sm"
        className="absolute top-4 right-16 h-10"
        onClick={(e) => e.stopPropagation()}
      >
        <a href={src} download aria-label={`Download ${alt}`}>
          <Download className="w-4 h-4 mr-1.5" /> Download
        </a>
      </Button>
      <figure className="max-w-full max-h-full flex flex-col items-center gap-3" onClick={(e) => e.stopPropagation()}>
        <img
          src={src}
          alt={alt}
          className="max-w-full max-h-[82vh] object-contain rounded-lg shadow-2xl border border-border/50 animate-in fade-in zoom-in-95 duration-200"
        />
        <figcaption className="text-xs text-muted-foreground flex items-center gap-2 max-w-full">
          <ImageIcon className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{alt}</span>
        </figcaption>
      </figure>
    </div>
  );
}

export function FileAttachmentRow({
  file, canDelete, onDelete, showEntity, downloadBase = "/api/files",
}: {
  file: AttachedFile;
  canDelete: boolean;
  onDelete: (file: AttachedFile) => void;
  showEntity?: boolean;
  downloadBase?: string;
}) {
  const { Icon, cls } = fileVisual(file);
  const [lightbox, setLightbox] = useState(false);
  return (
    <div className="group flex items-center gap-3 p-2.5 rounded-lg border border-border/70 bg-card/50 hover:border-primary/30 transition-colors">
      {isImage(file) ? (
        <button
          type="button"
          className="relative w-10 h-10 rounded-lg overflow-hidden border border-border/60 shrink-0 bg-secondary/40 cursor-zoom-in group/thumb"
          aria-label={`Preview ${file.originalName}`}
          onClick={() => setLightbox(true)}
        >
          <img
            src={`${downloadBase}/${file.id}/download`}
            alt={file.originalName}
            className="w-full h-full object-cover"
            loading="lazy"
          />
          <span className="absolute inset-0 hidden group-hover/thumb:flex items-center justify-center bg-[#050a14]/60">
            <ZoomIn className="w-4 h-4 text-white" />
          </span>
        </button>
      ) : (
        <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center shrink-0", cls)}>
          <Icon className="w-[18px] h-[18px]" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate" title={file.originalName}>{file.originalName}</p>
        <p className="text-[11px] text-muted-foreground flex items-center gap-1.5 flex-wrap">
          <span>{formatBytes(file.size)}</span>
          <span className="opacity-50">·</span>
          <span>{relativeTime(file.createdAt)}</span>
          {file.uploader && (
            <>
              <span className="opacity-50">·</span>
              <span className="inline-flex items-center gap-1">
                <span
                  className="w-3.5 h-3.5 rounded-full inline-flex items-center justify-center text-[7px] font-bold text-white"
                  style={{ backgroundColor: file.uploader.avatarColor || "#22d3ee" }}
                >
                  {initials(file.uploader.name)}
                </span>
                {file.uploader.name}
              </span>
            </>
          )}
          {showEntity && file.entity && (
            <>
              <span className="opacity-50">·</span>
              <span className="font-mono">{file.entity.sub || file.entity.label}</span>
            </>
          )}
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button asChild variant="ghost" size="sm" className="h-8 w-8 p-0" aria-label={`Download ${file.originalName}`}>
          <a href={`${downloadBase}/${file.id}/download`} download>
            <Download className="w-4 h-4" />
          </a>
        </Button>
        {canDelete && (
          <Button
            variant="ghost" size="sm"
            className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
            aria-label={`Delete ${file.originalName}`}
            onClick={() => onDelete(file)}
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        )}
      </div>
      {lightbox && (
        <ImageLightbox src={`${downloadBase}/${file.id}/download`} alt={file.originalName} onClose={() => setLightbox(false)} />
      )}
    </div>
  );
}

/**
 * Full attachment panel for one entity: drag & drop zone, list, delete.
 * Permission-aware via the caller's session (canUpload/canDelete props).
 * Portal reuse: pass apiBase="/api/portal/files" + capability overrides
 * (portal users have no files.* permissions — the server still enforces scope).
 */
export function FileAttachments({
  entityType, entityId, onChanged, className,
  apiBase = "/api/files",
  canUploadOverride,
  canDeleteOverride,
  uploadHint,
}: {
  entityType: string;
  entityId: string;
  onChanged?: () => void;
  className?: string;
  apiBase?: string;
  canUploadOverride?: boolean;
  canDeleteOverride?: (file: AttachedFile) => boolean;
  uploadHint?: string;
}) {
  const { data: session } = useSession();
  const me = session?.user;
  const canUpload = canUploadOverride ?? !!me?.permissions?.includes("files.upload");
  const canDelete = (f: AttachedFile) =>
    canDeleteOverride ? canDeleteOverride(f) : !!me && (f.uploader?.id === me.id || !!me.permissions?.includes("files.delete"));

  const [files, setFiles] = useState<AttachedFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<AttachedFile | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch(`${apiBase}?entityType=${entityType}&entityId=${entityId}&pageSize=100`);
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body?.error?.message || "Could not load attachments");
      setFiles(body.data.files);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load attachments");
      setFiles([]);
    }
  }, [entityType, entityId, apiBase]);

  useEffect(() => {
    setFiles(null);
    void load();
  }, [load]);

  const upload = useCallback(async (list: FileList | File[]) => {
    const arr = Array.from(list);
    if (arr.length === 0) return;
    setBusy(true);
    let succeeded = 0;
    let lastError: string | null = null;
    for (const f of arr) {
      if (f.size > MAX_FILE_MB * 1024 * 1024) { lastError = `"${f.name}" exceeds the ${MAX_FILE_MB} MB limit.`; continue; }
      try {
        const fd = new FormData();
        fd.append("file", f);
        fd.append("entityType", entityType);
        fd.append("entityId", entityId);
        const res = await fetch(`${apiBase}`, { method: "POST", body: fd });
        const body = await res.json();
        if (!res.ok || !body.success) throw new Error(body?.error?.message || "Upload failed");
        succeeded += 1;
      } catch (e) {
        lastError = e instanceof Error ? e.message : "Upload failed";
      }
    }
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
    if (succeeded > 0) { await load(); onChanged?.(); }
    if (lastError) setError(lastError);
  }, [entityType, entityId, load, onChanged, apiBase]);

  const remove = useCallback(async (file: AttachedFile) => {
    setConfirmDelete(null);
    try {
      const res = await fetch(`${apiBase}/${file.id}`, { method: "DELETE" });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body?.error?.message || "Delete failed");
      await load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }, [load, onChanged, apiBase]);

  if (files === null) {
    return (
      <div className={cn("space-y-2", className)}>
        <Skeleton className="h-16 w-full rounded-lg" />
        <Skeleton className="h-16 w-full rounded-lg" />
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      {error && (
        <div className="flex items-center justify-between gap-2 text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2">
          <span className="truncate">{error}</span>
          <button className="underline shrink-0" onClick={() => setError(null)}>dismiss</button>
        </div>
      )}

      {canUpload && (
        <div
          role="button"
          tabIndex={0}
          aria-label="Upload files"
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click(); }}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); void upload(e.dataTransfer.files); }}
          className={cn(
            "flex flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed px-4 py-6 text-center cursor-pointer transition-colors",
            dragOver ? "border-primary bg-primary/10" : "border-border hover:border-primary/40 hover:bg-accent/30"
          )}
        >
          {busy ? (
            <Loader2 className="w-5 h-5 text-primary animate-spin" />
          ) : (
            <UploadCloud className="w-5 h-5 text-primary" />
          )}
          <p className="text-sm font-medium">{busy ? "Uploading…" : uploadHint || "Drop files here or click to upload"}</p>
          <p className="text-[11px] text-muted-foreground">Any format · up to {MAX_FILE_MB} MB per file</p>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => { if (e.target.files?.length) void upload(e.target.files); }}
          />
        </div>
      )}

      {files.length === 0 ? (
        <EmptyState
          icon={<Paperclip className="w-5 h-5" />}
          title="No attachments yet"
          description={canUpload ? "Upload briefs, designs, exports or any reference material for this record." : "Files uploaded by teammates will appear here."}
        />
      ) : (
        <div className="space-y-2">
          {files.map((f) => (
            <FileAttachmentRow
              key={f.id}
              file={f}
              canDelete={canDelete(f)}
              onDelete={setConfirmDelete}
              downloadBase={apiBase}
            />
          ))}
        </div>
      )}

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
              onClick={() => confirmDelete && void remove(confirmDelete)}
            >
              Delete file
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
