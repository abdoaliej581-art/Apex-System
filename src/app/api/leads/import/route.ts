// POST /api/leads/import
//
// Bulk-imports up to 200 leads from a validated JSON array.
// Each row is created individually inside a try/catch so one bad row never
// rolls back the successful ones — the response reports per-row outcomes.

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  requirePermission, ok, handleError, ApiError, logAudit, clientIp,
} from "@/lib/api-helpers";
import { nextNumber } from "@/lib/numbering";
import { runAutomations } from "@/lib/automations";

const LEAD_SOURCES = [
  "WEBSITE", "REFERRAL", "INSTAGRAM", "FACEBOOK", "LINKEDIN",
  "WHATSAPP", "EMAIL", "COLD_CALL", "EVENT", "OTHER",
] as const;
const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

const optText = (max = 500) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : typeof v === "string" ? v.trim() : v),
    z.string().max(max).nullable().optional()
  );

const RowSchema = z.object({
  companyName: z.string().trim().min(2, "Company name must be ≥ 2 chars"),
  contactName: z.string().trim().min(2, "Contact name must be ≥ 2 chars"),
  phone: z.string().trim().min(7, "Phone must be ≥ 7 chars"),
  email: optText(200),
  website: optText(300),
  industry: optText(120),
  location: optText(200),
  source: z.preprocess(
    (v) => (typeof v === "string" ? v.toUpperCase().replace(/\s+/g, "_") : v),
    z.enum(LEAD_SOURCES).default("OTHER")
  ),
  serviceInterest: optText(300),
  estimatedBudget: z.preprocess(
    (v) => {
      if (v === undefined || v === null || v === "") return null;
      const n = Number(String(v).replace(/[^0-9.]/g, ""));
      return isNaN(n) ? null : n;
    },
    z.number().nullable().optional()
  ),
  priority: z.preprocess(
    (v) => (typeof v === "string" ? v.toUpperCase() : v),
    z.enum(PRIORITIES).default("MEDIUM")
  ),
  notes: optText(4000),
});

const BodySchema = z.object({
  rows: z.array(RowSchema).min(1, "At least one row required").max(200, "Maximum 200 rows per import"),
});

export async function POST(req: NextRequest) {
  try {
    const { session } = await requirePermission("leads.create");

    let raw: unknown;
    try { raw = await req.json(); } catch {
      throw new ApiError(400, "INVALID_JSON", "Invalid request body.");
    }
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw new ApiError(400, "VALIDATION_ERROR", first.message);
    }

    const { rows } = parsed.data;
    const results: { row: number; success: boolean; leadNumber?: string; error?: string }[] = [];
    let created = 0;
    let failed = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        const leadNumber = await nextNumber("lead");
        const lead = await db.lead.create({
          data: {
            leadNumber,
            companyName: row.companyName,
            contactName: row.contactName,
            phone: row.phone,
            email: row.email ?? null,
            website: row.website ?? null,
            industry: row.industry ?? null,
            location: row.location ?? null,
            source: row.source,
            serviceInterest: row.serviceInterest ?? null,
            estimatedBudget: row.estimatedBudget ?? null,
            priority: row.priority,
            notes: row.notes ?? null,
            createdById: session.user.id,
          },
        });

        // Fire automations non-blocking
        void runAutomations("LEAD_CREATED", {
          leadNumber: lead.leadNumber,
          companyName: lead.companyName,
          contactName: lead.contactName,
          priority: lead.priority,
          source: lead.source,
          serviceInterest: lead.serviceInterest ?? "",
          assignedTo: "",
        }).catch(() => undefined);

        results.push({ row: i + 1, success: true, leadNumber: lead.leadNumber });
        created++;
      } catch (e) {
        results.push({ row: i + 1, success: false, error: e instanceof Error ? e.message : "Unknown error" });
        failed++;
      }
    }

    await logAudit({
      actorId: session.user.id,
      actorName: session.user.name ?? null,
      action: "CREATE",
      entityType: "LEAD_IMPORT",
      metadata: { total: rows.length, created, failed },
      ip: clientIp(req),
    });

    return ok({ created, failed, total: rows.length, results });
  } catch (e) {
    return handleError(e);
  }
}
