// GET /api/portal/maintenance
// Returns the active maintenance plan + hourly usage history for the portal client.
// Every query is scoped to the authenticated portal user's clientId (requirePortal).

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requirePortal, ok, handleError } from "@/lib/api-helpers";

export async function GET(_req: NextRequest) {
  try {
    const { clientId } = await requirePortal();

    // Find the active plan for this client
    const plan = await db.maintenancePlan.findFirst({
      where: { clientId, status: "ACTIVE", deletedAt: null },
      select: {
        id: true, plan: true, status: true,
        includedHours: true, usedHours: true,
        startDate: true, endDate: true, notes: true,
        project: { select: { id: true, name: true, projectNumber: true } },
        logs: {
          orderBy: { spentOn: "asc" },
          select: {
            id: true, hours: true, note: true,
            spentOn: true, createdAt: true,
            loggedByName: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!plan) {
      return ok({ plan: null, usageTrend: [], hourLogs: [] });
    }

    // Build a cumulative usage trend bucketed by month for the chart.
    // Group logs by month label (e.g. "Jan '26"), accumulate running total.
    type MonthBucket = { month: string; hours: number; cumulative: number };
    const monthBuckets: Record<string, number> = {};

    // Pre-fill months from startDate to now (max 12) so the chart has no gaps
    const start = new Date(plan.startDate);
    const now = new Date();
    const monthStart = new Date(start.getFullYear(), start.getMonth(), 1);
    const monthNow = new Date(now.getFullYear(), now.getMonth(), 1);
    let cur = new Date(monthStart);
    let iterations = 0;
    while (cur <= monthNow && iterations < 13) {
      const key = cur.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
      monthBuckets[key] = 0;
      cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
      iterations++;
    }

    for (const log of plan.logs) {
      const d = new Date(log.spentOn);
      const key = d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
      if (key in monthBuckets) monthBuckets[key] += log.hours;
    }

    // Build cumulative series
    let running = 0;
    const usageTrend: MonthBucket[] = Object.entries(monthBuckets).map(([month, hours]) => {
      running += hours;
      return { month, hours, cumulative: Math.round(running * 10) / 10 };
    });

    // Add the included-hours cap line value (for reference line on the chart)
    const includedLine = plan.includedHours ?? null;

    return ok({
      plan: {
        id: plan.id,
        tier: plan.plan,
        status: plan.status,
        includedHours: plan.includedHours,
        usedHours: plan.usedHours,
        startDate: plan.startDate,
        endDate: plan.endDate,
        project: plan.project,
        overBudget: plan.includedHours !== null && plan.usedHours > plan.includedHours,
        remaining: plan.includedHours !== null ? Math.max(0, plan.includedHours - plan.usedHours) : null,
        consumptionPct: plan.includedHours && plan.includedHours > 0
          ? Math.round((plan.usedHours / plan.includedHours) * 100)
          : null,
      },
      usageTrend,
      includedLine,
      hourLogs: plan.logs.map((l) => ({
        id: l.id,
        hours: l.hours,
        note: l.note,
        spentOn: l.spentOn,
        loggedByName: l.loggedByName,
      })),
    });
  } catch (e) {
    return handleError(e);
  }
}
