import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requirePermission, ok, handleError } from "@/lib/api-helpers";

export async function GET(_req: NextRequest) {
  try {
    await requirePermission("settings.manage");
    const rows = await db.setting.findMany();
    const settings: Record<string, unknown> = {};
    rows.forEach((r) => {
      try { settings[r.key] = JSON.parse(r.value); } catch { settings[r.key] = r.value; }
    });
    return ok({ settings });
  } catch (e) {
    return handleError(e);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { session } = await requirePermission("settings.manage");
    const body = await req.json().catch(() => null);
    if (!body || typeof body.key !== "string" || !("value" in body)) {
      return handleError(new Error("key and value are required"));
    }
    const { key, value } = body as { key: string; value: unknown };
    await db.setting.upsert({
      where: { key },
      update: { value: JSON.stringify(value) },
      create: { key, value: JSON.stringify(value) },
    });
    await db.auditLog.create({
      data: {
        actorId: session.user.id, actorName: session.user.name,
        action: "UPDATE", entityType: "SETTING", entityId: key,
        metadata: JSON.stringify({ settingKey: key }),
      },
    });
    return ok({ updated: true });
  } catch (e) {
    return handleError(e);
  }
}
