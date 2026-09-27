import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, ok, handleError } from "@/lib/api-helpers";

// GET /api/org — public-safe organization identity, available to any
// authenticated user (internal staff AND portal clients use it for invoice
// print headers). Contains no sensitive configuration.
export async function GET(_req: NextRequest) {
  try {
    await requireAuth();
    const setting = await db.setting.findUnique({ where: { key: "organization" } });
    const raw = setting?.value ? (JSON.parse(setting.value) as Record<string, unknown>) : null;
    return ok({
      name: (raw?.name as string) || "APEX",
      productName: (raw?.productName as string) || "APEX SYSTEM",
      tagline: (raw?.tagline as string) || "",
      email: (raw?.email as string) || null,
      phone: (raw?.phone as string) || null,
      address: (raw?.address as string) || null,
      currency: (raw?.currency as string) || "EGP",
      timezone: (raw?.timezone as string) || "Africa/Cairo",
    });
  } catch (e) {
    return handleError(e);
  }
}
