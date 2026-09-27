import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { db } from "@/lib/db";
import { requirePortal, handleError, ApiError } from "@/lib/api-helpers";
import { assertPortalFileAccess } from "@/lib/portal-files";

const UPLOAD_DIR = path.join(process.cwd(), "db", "uploads");

type Params = { params: Promise<{ id: string }> };

// ---- GET /api/portal/files/[id]/download — client-scoped binary stream (§72)
// The file's TICKET/PROJECT owner must match the caller's clientId; internal-only
// entity types are unreachable through the portal by design.
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { clientId } = await requirePortal();
    const { id } = await params;

    const record = await db.fileRecord.findUnique({ where: { id } });
    if (!record) throw new ApiError(404, "NOT_FOUND", "File not found.");
    await assertPortalFileAccess(record, clientId);

    if (!record.filename || record.filename.includes("/") || record.filename.includes("..")) {
      throw new ApiError(404, "NOT_FOUND", "File storage path is invalid.");
    }
    const filePath = path.join(UPLOAD_DIR, record.filename);
    let data: Buffer;
    try {
      data = await fs.readFile(filePath);
    } catch {
      throw new ApiError(410, "FILE_MISSING", "The file binary is no longer available on disk.");
    }

    const inline = !!record.mimeType && /^(image\/|application\/pdf|text\/plain)/.test(record.mimeType);
    const asciiName = record.originalName.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "");

    return new NextResponse(new Uint8Array(data), {
      status: 200,
      headers: {
        "Content-Type": record.mimeType || "application/octet-stream",
        "Content-Length": String(data.length),
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(record.originalName)}`,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
