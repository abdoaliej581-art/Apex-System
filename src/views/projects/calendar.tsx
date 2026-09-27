"use client";

import { useEffect, useMemo, useState } from "react";
import {
  addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format,
  isSameMonth, isToday, startOfMonth, startOfWeek, subMonths,
} from "date-fns";
import { api } from "@/lib/api-client";
import { PageHeader, EmptyState, ErrorState } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

// ============================= Types =============================

type EventKind = "meeting" | "followup" | "task" | "deadline";

type CalItem = {
  id: string;
  kind: EventKind;
  title: string;
  date: Date;
  time?: string | null;
  status?: string | null;
  detail?: string | null;
  navigateTo: string;
};

const KIND_META: Record<EventKind, { letter: string; dot: string; chip: string; badge: string; label: string }> = {
  meeting: { letter: "M", dot: "bg-sky-400", chip: "bg-sky-500/10 text-sky-300 border-sky-500/30", badge: "bg-sky-500/15 text-sky-300 border-sky-500/30", label: "Meeting" },
  followup: { letter: "F", dot: "bg-amber-400", chip: "bg-amber-500/10 text-amber-300 border-amber-500/30", badge: "bg-amber-500/15 text-amber-300 border-amber-500/30", label: "Follow-up" },
  task: { letter: "T", dot: "bg-violet-400", chip: "bg-violet-500/10 text-violet-300 border-violet-500/30", badge: "bg-violet-500/15 text-violet-300 border-violet-500/30", label: "Task due" },
  deadline: { letter: "D", dot: "bg-rose-400", chip: "bg-rose-500/10 text-rose-300 border-rose-500/30", badge: "bg-rose-500/15 text-rose-300 border-rose-500/30", label: "Project deadline" },
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Defensive parsing — other agents own the meetings/followups APIs,
// so accept both { items: [...] } envelopes and bare arrays.
function asItems(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data && typeof data === "object" && Array.isArray((data as { items?: unknown }).items)) {
    return (data as { items: Record<string, unknown>[] }).items;
  }
  return [];
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function toDate(v: unknown): Date | null {
  if (typeof v !== "string" && !(v instanceof Date)) return null;
  const d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? null : d;
}

type Paged<T> = { items: T[]; total: number; page: number; pageSize: number };

type TaskRow = {
  id: string; title: string; status: string; priority: string;
  dueDate?: string | null; project?: { id: string; name: string } | null;
};
type ProjectRow = {
  id: string; name: string; projectNumber: string; status: string;
  deadline?: string | null; client?: { companyName: string } | null;
};

// ============================= Calendar View =============================

export function CalendarView({ navigate }: { navigate: (p: string) => void }) {
  const [cursor, setCursor] = useState<Date>(() => new Date());
  const [events, setEvents] = useState<CalItem[]>([]);
  const [availability, setAvailability] = useState({ meetings: true, followups: true });
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  const monthStart = startOfMonth(cursor);
  const monthEnd = endOfMonth(cursor);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setFailed(false);
      const from = startOfMonth(cursor).toISOString();
      const to = endOfMonth(cursor).toISOString();
      const enc = (v: string) => encodeURIComponent(v);
      const availabilityNext = { meetings: true, followups: true };
      const collected: CalItem[] = [];

      const [meetings, followups, tasks, projects] = await Promise.allSettled([
        api.get<unknown>(`/api/meetings?from=${enc(from)}&to=${enc(to)}`),
        api.get<unknown>(`/api/followups?from=${enc(from)}&to=${enc(to)}`),
        api.get<Paged<TaskRow>>(`/api/tasks?dueFrom=${enc(from)}&dueTo=${enc(to)}&pageSize=100`),
        api.get<Paged<ProjectRow>>("/api/projects?pageSize=100"),
      ]);

      if (meetings.status === "fulfilled") {
        asItems(meetings.value).forEach((m, idx) => {
          const date = toDate(m.date);
          const title = str(m.title);
          if (!date || !title) return;
          collected.push({
            id: `meeting-${str(m.id) ?? idx}`,
            kind: "meeting",
            title,
            date,
            time: str(m.startTime),
            status: str(m.status),
            detail: str(m.location) ?? str(m.meetingLink),
            navigateTo: "sales/meetings",
          });
        });
      } else {
        availabilityNext.meetings = false; // 403/404 → degrade gracefully
      }

      if (followups.status === "fulfilled") {
        asItems(followups.value).forEach((f, idx) => {
          const date = toDate(f.dueAt) ?? toDate(f.dueDate);
          const title = str(f.title);
          if (!date || !title) return;
          collected.push({
            id: `followup-${str(f.id) ?? idx}`,
            kind: "followup",
            title,
            date,
            status: str(f.status),
            detail: str(f.priority) ? `Priority: ${str(f.priority)}` : null,
            navigateTo: "crm/followups",
          });
        });
      } else {
        availabilityNext.followups = false;
      }

      if (tasks.status === "fulfilled") {
        const items = Array.isArray(tasks.value) ? (tasks.value as unknown as TaskRow[]) : tasks.value.items;
        items.forEach((t) => {
          const date = toDate(t.dueDate);
          if (!date || t.status === "DONE") return;
          collected.push({
            id: `task-${t.id}`,
            kind: "task",
            title: t.title,
            date,
            status: t.status,
            detail: t.project?.name ?? null,
            navigateTo: "tasks",
          });
        });
      }

      if (projects.status === "fulfilled") {
        const items = Array.isArray(projects.value) ? (projects.value as unknown as ProjectRow[]) : projects.value.items;
        items.forEach((p) => {
          const date = toDate(p.deadline);
          if (!date || ["COMPLETED", "CANCELLED"].includes(p.status)) return;
          collected.push({
            id: `deadline-${p.id}`,
            kind: "deadline",
            title: p.name,
            date,
            status: p.status,
            detail: p.projectNumber,
            navigateTo: "projects",
          });
        });
      }

      if (meetings.status === "rejected" && followups.status === "rejected" && tasks.status === "rejected" && projects.status === "rejected") {
        if (!cancelled) setFailed(true);
      }

      if (cancelled) return;
      setAvailability(availabilityNext);
      setEvents(collected.sort((a, b) => a.date.getTime() - b.date.getTime()));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [cursor, reloadKey]);

  const gridDays = useMemo(() => (
    eachDayOfInterval({
      start: startOfWeek(monthStart, { weekStartsOn: 0 }),
      end: endOfWeek(monthEnd, { weekStartsOn: 0 }),
    })
  ), [monthStart, monthEnd]);

  const byDay = useMemo(() => {
    const map = new Map<string, CalItem[]>();
    events.forEach((ev) => {
      const key = format(ev.date, "yyyy-MM-dd");
      const list = map.get(key);
      if (list) list.push(ev);
      else map.set(key, [ev]);
    });
    return map;
  }, [events]);

  const selectedItems = useMemo(() => {
    if (!selectedDay) return [];
    return byDay.get(format(selectedDay, "yyyy-MM-dd")) ?? [];
  }, [selectedDay, byDay]);

  const monthEventCount = events.filter((e) => isSameMonth(e.date, cursor)).length;

  return (
    <div>
      <PageHeader
        title="Calendar"
        description="Unified month view — meetings, client follow-ups, task deadlines and project deadlines."
        actions={
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="sm" onClick={() => setCursor((c) => subMonths(c, 1))} aria-label="Previous month">
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => setCursor(new Date())}>Today</Button>
            <Button variant="outline" size="sm" onClick={() => setCursor((c) => addMonths(c, 1))} aria-label="Next month">
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        }
      />

      {/* Legend + month title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <h2 className="text-lg font-semibold">{format(cursor, "MMMM yyyy")}</h2>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
          {(Object.keys(KIND_META) as EventKind[]).map((k) => (
            <span key={k} className="flex items-center gap-1.5">
              <span className={cn("w-2 h-2 rounded-full", KIND_META[k].dot)} />
              <span className={cn("font-bold w-3 text-center", KIND_META[k].chip.split(" ").find((c) => c.startsWith("text-")))}>{KIND_META[k].letter}</span>
              {KIND_META[k].label}
            </span>
          ))}
          {(!availability.meetings || !availability.followups) && (
            <span className="text-[10px] opacity-70">
              {!availability.meetings && "Meetings unavailable "}{!availability.followups && "· Follow-ups unavailable"}
            </span>
          )}
        </div>
      </div>

      {failed ? (
        <ErrorState message="Calendar data could not be loaded." onRetry={() => setReloadKey((k) => k + 1)} />
      ) : loading ? (
        <div className="grid grid-cols-7 gap-1.5">
          {WEEKDAYS.map((d) => <Skeleton key={d} className="h-8 w-full" />)}
          {Array.from({ length: 35 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      ) : (
        <div className="overflow-x-auto apex-scroll -mx-1 px-1 pb-2">
          <div className="min-w-[640px]">
            <div className="grid grid-cols-7 gap-1.5 mb-1.5">
              {WEEKDAYS.map((d) => (
                <div key={d} className="text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground py-1">
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1.5">
              {gridDays.map((day) => {
                const key = format(day, "yyyy-MM-dd");
                const items = byDay.get(key) ?? [];
                const inMonth = isSameMonth(day, cursor);
                return (
                  <button
                    key={key}
                    onClick={() => { setSelectedDay(day); setPanelOpen(true); }}
                    className={cn(
                      "min-h-[92px] rounded-lg border p-1.5 text-left flex flex-col gap-1 transition-colors",
                      inMonth ? "bg-card hover:border-primary/40" : "bg-card/40 opacity-55 hover:opacity-80",
                      isToday(day) && "border-primary apex-glow",
                    )}
                  >
                    <span className={cn("text-xs font-medium px-0.5", isToday(day) ? "text-primary font-bold" : inMonth ? "text-foreground" : "text-muted-foreground")}>
                      {format(day, "d")}
                    </span>
                    {items.slice(0, 3).map((ev) => (
                      <span key={ev.id} className={cn("flex items-center gap-1 rounded border px-1 py-0.5 text-[9px] leading-tight min-w-0", KIND_META[ev.kind].chip)}>
                        <span className="font-bold shrink-0">{KIND_META[ev.kind].letter}</span>
                        <span className="truncate">{ev.title}</span>
                      </span>
                    ))}
                    {items.length > 3 && (
                      <span className="text-[9px] text-muted-foreground px-0.5">+{items.length - 3} more</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {monthEventCount === 0 && !loading && !failed && (
        <div className="mt-4">
          <EmptyState
            icon={<CalendarPlus className="w-5 h-5" />}
            title="Nothing scheduled this month"
            description="Meetings, follow-ups, task deadlines and project deadlines will show up here as they are created."
          />
        </div>
      )}

      {/* Day details side panel */}
      <Sheet open={panelOpen} onOpenChange={setPanelOpen}>
        <SheetContent side="right" className="w-full sm:max-w-[420px] p-0 flex flex-col gap-0">
          <SheetHeader className="p-5 pb-4 border-b border-border space-y-1">
            <SheetDescription className="text-xs text-muted-foreground">
              {selectedDay ? format(selectedDay, "EEEE") : ""} · {selectedItems.length} item{selectedItems.length === 1 ? "" : "s"}
            </SheetDescription>
            <SheetTitle className="text-base">{selectedDay ? format(selectedDay, "d MMMM yyyy") : "Day"}</SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto apex-scroll p-5">
            {selectedItems.length === 0 ? (
              <EmptyState
                icon={<CalendarDays className="w-5 h-5" />}
                title="Nothing on this day"
                description="No meetings, follow-ups or deadlines scheduled."
              />
            ) : (
              <div className="space-y-2.5">
                {selectedItems.map((ev) => (
                  <div key={ev.id} className="rounded-lg border border-border p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded border", KIND_META[ev.kind].badge)}>
                        {KIND_META[ev.kind].label}
                      </span>
                      {ev.time && <span className="text-[11px] text-muted-foreground font-mono">{ev.time}</span>}
                      {ev.status && <span className="text-[10px] text-muted-foreground">{ev.status.replace(/_/g, " ")}</span>}
                    </div>
                    <p className="text-sm font-medium leading-snug">{ev.title}</p>
                    {ev.detail && <p className="text-[11px] text-muted-foreground">{ev.detail}</p>}
                    <Button
                      variant="outline" size="sm" className="h-7 text-[11px]"
                      onClick={() => { setPanelOpen(false); navigate(ev.navigateTo); }}
                    >
                      <ExternalLink className="w-3 h-3 mr-1.5" /> Open {KIND_META[ev.kind].label.toLowerCase()}s
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
