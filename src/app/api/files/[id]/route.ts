import { NextRequest } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { db } from "@/lib/db";
import {
  requirePermission, ok, handleError, logAudit, clientIp, ApiError,
} from "@/lib/api-helpers";

const UPLOAD_DIR = path.join(process.cwd(), "db", "uploads");

type Params = { params: Promise<{ id: string }> };

// ---- DELETE /api/files/[id] — uploader OR files.delete permission
export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const { session } = await requirePermission("files.view");
    const { id } = await params;

    const record = await db.fileRecord.findUnique({ where: { id } });
    if (!record) throw new ApiError(404, "NOT_FOUND", "File not found.");

    const isUploader = record.uploaderId === session.user.id;
    if (!isUploader && !session.user.permissions.includes("files.delete")) {
      throw new ApiError(403, "FORBIDDEN", "Only the uploader or a file administrator can delete this file.");
    }

    // Best-effort disk cleanup — DB record removal is the source of truth.
    try {
      if (record.filename && !record.filename.includes("/") && !record.filename.includes("..")) {
        await fs.unlink(path.join(UPLOAD_DIR, record.filename));
      }
    } catch (err) {
      console.error("[file-unlink-failed]", err instanceof Error ? err.message : err);
    }

    await db.fileRecord.delete({ where: { id } });
    await logAudit({
      actorId: session.user.id, actorName: session.user.name,
      action: "DELETE", entityType: "FILE", entityId: id,
      metadata: { originalName: record.originalName, attachedTo: `${record.entityType}:${record.entityId}` },
      ip: clientIp(req),
    });

    return ok({ deleted: true, id });
  } catch (e) {
    return handleError(e);
  }
}
