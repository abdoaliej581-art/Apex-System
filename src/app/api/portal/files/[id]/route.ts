import { NextRequest } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { db } from "@/lib/db";
import { requirePortal, ok, handleError, logAudit, clientIp, ApiError } from "@/lib/api-helpers";
import { assertPortalFileAccess } from "@/lib/portal-files";

const UPLOAD_DIR = path.join(process.cwd(), "db", "uploads");

type Params = { params: Promise<{ id: string }> };

// ---- DELETE /api/portal/files/[id] — client removes their OWN upload (§72)
// Scope: file must be portal-accessible (own ticket/project) AND uploaded by
// the caller. Staff-uploaded deliverables cannot be deleted from the portal.
export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const { session, clientId } = await requirePortal();
    const { id } = await params;

    const record = await db.fileRecord.findUnique({ where: { id } });
    if (!record) throw new ApiError(404, "NOT_FOUND", "File not found.");
    await assertPortalFileAccess(record, clientId);

    if (record.uploaderId !== session.user.id) {
      throw new ApiError(403, "FORBIDDEN", "You can only remove files you uploaded yourself.");
    }

    try {
      if (record.filename && !record.filename.includes("/") && !record.filename.includes("..")) {
        await fs.unlink(path.join(UPLOAD_DIR, record.filename));
      }
    } catch (err) {
      console.error("[portal-file-unlink-failed]", err instanceof Error ? err.message : err);
    }

    await db.fileRecord.delete({ where: { id } });
    await logAudit({
      actorId: session.user.id, actorName: session.user.name,
      action: "DELETE", entityType: "FILE", entityId: id,
      metadata: { originalName: record.originalName, attachedTo: `${record.entityType}:${record.entityId}`, viaPortal: true },
      ip: clientIp(req),
    });

    return ok({ deleted: true, id });
  } catch (e) {
    return handleError(e);
  }
}
