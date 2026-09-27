"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import {
  DndContext, DragOverlay, PointerSensor, pointerWithin, useDraggable, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { AlertCircle, GripVertical, MoreVertical } from "lucide-react";
import { PageHeader, ErrorState, ListSkeleton, PriorityBadge, EmptyState } from "@/components/shared";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api, formatCurrency, formatDate } from "@/lib/api-client";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { ViewProps } from "@/views/registry";
import {
  LeadDetailDrawer, LostReasonDialog, UserAvatar,
  LEAD_STATUSES, humanLabel, isOverdueDate,
  type Lead,
} from "@/views/crm/lead-detail";

type LeadsResponse = { items: Lead[]; total: number; page: number; pageSize: number };

/** Column accent colors (status badge palette is shared app-wide). */
const COLUMN_ACCENT: Record<string, string> = {
  NEW: "bg-sky-400",
  CONTACTED: "bg-violet-400",
  QUALIFIED: "bg-cyan-400",
  MEETING: "bg-blue-400",
  PROPOSAL_SENT: "bg-violet-400",
  NEGOTIATION: "bg-amber-400",
  WON: "bg-emerald-400",
  LOST: "bg-rose-400",
};

export function PipelineView({ navigate }: ViewProps) {
  const { data: session } = useSession();
  const permissions = session?.user?.permissions ?? [];
  const { toast } = useToast();
  const canMove = permissions.includes("leads.edit");

  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [lostTarget, setLostTarget] = useState<Lead | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.get<LeadsResponse>("/api/leads?pageSize=100");
      setLeads(result.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load the pipeline.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const byStatus = useMemo(() => {
    const map = new Map<string, Lead[]>();
    LEAD_STATUSES.forEach((s) => map.set(s, []));
    (leads ?? []).forEach((l) => {
      if (!map.has(l.status)) map.set(l.status, []);
      map.get(l.status)!.push(l);
    });
    return map;
  }, [leads]);

  const summary = useMemo(() => {
    const all = leads ?? [];
    const totalValue = all.reduce((a, l) => a + (l.estimatedBudget ?? 0), 0);
    const won = all.filter((l) => l.status === "WON").length;
    const lost = all.filter((l) => l.status === "LOST").length;
    const closed = won + lost;
    return {
      total: all.length,
      totalValue,
      conversion: closed > 0 ? Math.round((won / closed) * 100) : null,
      won,
      lost,
    };
  }, [leads]);

  const applyMove = useCallback(async (lead: Lead, status: string, extra?: Record<string, unknown>) => {
    const prevStatus = lead.status;
    // Optimistic update
    setLeads((prev) => (prev ?? []).map((l) => (l.id === lead.id ? { ...l, status } : l)));
    try {
      const updated = await api.patch<Lead>(`/api/leads/${lead.id}`, { status, ...extra });
      setLeads((prev) => (prev ?? []).map((l) => (l.id === lead.id ? { ...l, ...updated, status: updated.status } : l)));
      toast({ title: "Lead moved", description: `${lead.companyName} → ${humanLabel(status)}` });
    } catch (err) {
      // Revert on error
      setLeads((prev) => (prev ?? []).map((l) => (l.id === lead.id ? { ...l, status: prevStatus } : l)));
      toast({
        title: "Move failed",
        description: err instanceof Error ? err.message : "Something went wrong.",
        variant: "destructive",
      });
    }
  }, [toast]);

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));

  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const overId = e.over?.id;
    if (!overId || !canMove) return;
    const leadId = String(e.active.id);
    const targetStatus = String(overId);
    const lead = (leads ?? []).find((l) => l.id === leadId);
    if (!lead || lead.status === targetStatus) return;
    if (targetStatus === "LOST") { setLostTarget(lead); return; }
    applyMove(lead, targetStatus);
  };

  const activeLead = (leads ?? []).find((l) => l.id === activeId) ?? null;

  return (
    <div>
      <PageHeader
        title="Pipeline"
        description="Drag leads across stages — or use each card's menu on touch devices. Changes persist instantly."
      />

      {/* Summary bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <div className="apex-panel p-3.5">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">Total leads</p>
          <p className="text-xl font-semibold mt-1">{summary.total}</p>
        </div>
        <div className="apex-panel p-3.5">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">Estimated value</p>
          <p className="text-xl font-semibold mt-1 truncate">{formatCurrency(summary.totalValue)}</p>
        </div>
        <div className="apex-panel p-3.5">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">Won / Lost</p>
          <p className="text-xl font-semibold mt-1"><span className="text-emerald-300">{summary.won}</span> / <span className="text-rose-300">{summary.lost}</span></p>
        </div>
        <div className="apex-panel p-3.5">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">Conversion</p>
          <p className="text-xl font-semibold mt-1">{summary.conversion !== null ? `${summary.conversion}%` : "—"}</p>
        </div>
      </div>

      {loading && <ListSkeleton rows={6} />}
      {!loading && error && <ErrorState message={error} onRetry={load} />}
      {!loading && !error && leads && leads.length === 0 && (
        <EmptyState
          title="Pipeline is empty"
          description="No leads have been created yet — add your first lead from the Leads page."
        />
      )}

      {!loading && !error && leads && leads.length > 0 && (
        <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} collisionDetection={pointerWithin}>
          <div className="flex gap-3 overflow-x-auto pb-4 apex-scroll -mx-1 px-1">
            {LEAD_STATUSES.map((status) => (
              <PipelineColumn
                key={status}
                status={status}
                leads={byStatus.get(status) ?? []}
                canMove={canMove}
                onOpen={(lead) => { setDetailId(lead.id); setDetailOpen(true); }}
                onMove={(lead, target) => {
                  if (target === "LOST") { setLostTarget(lead); return; }
                  applyMove(lead, target);
                }}
              />
            ))}
          </div>

          <DragOverlay dropAnimation={null}>
            {activeLead && <KanbanCard lead={activeLead} overlay onOpen={() => undefined} onMove={() => undefined} canMove={false} />}
          </DragOverlay>
        </DndContext>
      )}

      <LeadDetailDrawer
        leadId={detailId}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onChanged={load}
        navigate={navigate}
        permissions={permissions}
      />

      {lostTarget && (
        <LostReasonDialog
          open
          onOpenChange={(o) => !o && setLostTarget(null)}
          companyName={lostTarget.companyName}
          onConfirm={(reason) => {
            const target = lostTarget;
            setLostTarget(null);
            applyMove(target, "LOST", { lostReason: reason });
          }}
        />
      )}
    </div>
  );
}

// ============ Column ============

function PipelineColumn({
  status, leads, canMove, onOpen, onMove,
}: {
  status: string;
  leads: Lead[];
  canMove: boolean;
  onOpen: (lead: Lead) => void;
  onMove: (lead: Lead, target: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status, disabled: !canMove });
  const totalBudget = leads.reduce((a, l) => a + (l.estimatedBudget ?? 0), 0);

  return (
    <div className="w-[272px] shrink-0 flex flex-col">
      {/* Header */}
      <div className="apex-panel px-3 py-2.5 mb-2 rounded-xl">
        <div className="flex items-center gap-2">
          <span className={cn("w-2 h-2 rounded-full shrink-0", COLUMN_ACCENT[status] || "bg-slate-400")} />
          <p className="text-sm font-semibold flex-1 truncate">{humanLabel(status)}</p>
          <span className="text-xs bg-secondary text-secondary-foreground rounded-full px-2 py-0.5 font-medium">{leads.length}</span>
        </div>
        <p className="text-[11px] text-muted-foreground mt-1 truncate">{formatCurrency(totalBudget)}</p>
      </div>

      {/* Droppable area */}
      <div
        ref={setNodeRef}
        className={cn(
          "flex-1 min-h-[140px] rounded-xl border border-dashed p-2 space-y-2 transition-colors max-h-[62vh] overflow-y-auto apex-scroll",
          isOver ? "border-primary/60 bg-primary/5" : "border-border/70 bg-secondary/20"
        )}
        aria-label={`${humanLabel(status)} column`}
      >
        {leads.length === 0 && (
          <p className="text-[11px] text-muted-foreground text-center py-6">Drop leads here</p>
        )}
        {leads.map((lead) => (
          <KanbanCard key={lead.id} lead={lead} onOpen={onOpen} onMove={onMove} canMove={canMove} />
        ))}
      </div>
    </div>
  );
}

// ============ Card ============

function KanbanCard({
  lead, onOpen, onMove, canMove, overlay = false,
}: {
  lead: Lead;
  onOpen: (lead: Lead) => void;
  onMove: (lead: Lead, target: string) => void;
  canMove: boolean;
  overlay?: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: lead.id,
    disabled: !canMove || overlay,
    data: { status: lead.status },
  });

  const followUpOverdue = isOverdueDate(lead.nextFollowUpAt) && !["WON", "LOST"].includes(lead.status);

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={() => { if (!isDragging && !overlay) onOpen(lead); }}
      className={cn(
        "apex-panel rounded-lg p-3 cursor-grab active:cursor-grabbing select-none transition-shadow",
        isDragging && "opacity-30",
        overlay && "shadow-2xl shadow-black/50 rotate-1 cursor-grabbing",
        "hover:border-primary/40"
      )}
      role="button"
      aria-label={`Lead ${lead.companyName}, status ${humanLabel(lead.status)}`}
      onKeyDown={(e) => { if (e.key === "Enter") onOpen(lead); }}
      tabIndex={0}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">{lead.companyName}</p>
          <p className="text-[11px] text-muted-foreground truncate mt-0.5">{lead.contactName} · {lead.leadNumber}</p>
        </div>
        {!overlay && (
          <div
            className="shrink-0 flex items-center gap-0.5"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <span
              className="text-muted-foreground/60 cursor-grab p-1"
              {...listeners}
              {...attributes}
              aria-hidden
            >
              <GripVertical className="w-3.5 h-3.5" />
            </span>
            {canMove && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-6 w-6" aria-label={`Move ${lead.companyName}`}>
                    <MoreVertical className="w-3.5 h-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuLabel className="text-xs">Move to…</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {LEAD_STATUSES.filter((s) => s !== lead.status).map((s) => (
                    <DropdownMenuItem key={s} onClick={() => onMove(lead, s)}>
                      {humanLabel(s)}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 mt-2.5 flex-wrap">
        <PriorityBadge priority={lead.priority} />
        {lead.estimatedBudget != null && (
          <span className="text-[11px] font-medium text-muted-foreground tabular-nums">{formatCurrency(lead.estimatedBudget)}</span>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 mt-2.5">
        <div className="flex items-center gap-1.5 min-w-0">
          {lead.assignedTo ? (
            <>
              <UserAvatar name={lead.assignedTo.name} color={lead.assignedTo.avatarColor} size={20} />
              <span className="text-[11px] text-muted-foreground truncate">{lead.assignedTo.name}</span>
            </>
          ) : (
            <span className="text-[11px] text-muted-foreground/70">Unassigned</span>
          )}
        </div>
        {lead.nextFollowUpAt && (
          <span className={cn("text-[10px] inline-flex items-center gap-1 shrink-0", followUpOverdue ? "text-rose-300 font-semibold" : "text-muted-foreground")}>
            <AlertCircle className="w-3 h-3" />
            {formatDate(lead.nextFollowUpAt)}
          </span>
        )}
      </div>
    </div>
  );
}
