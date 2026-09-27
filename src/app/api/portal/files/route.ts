import { NextRequest } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  requirePortal, ok, handleError, logAudit, logActivity, clientIp,
  createNotification, notifyRole, ApiError,
} from "@/lib/api-helpers";
import { PORTAL_FILE_ENTITY_TYPES, assertPortalEntity, type PortalEntityType } from "@/lib/portal-files";

// ============ Client Portal file uploads (§72) ============
// Clients can attach evidence (screenshots, docs) to their own tickets and
// projects. Binary storage mirrors /api/files (db/uploads, never public/);
// downloads stream through /api/portal/files/[id]/download, re-checked against
// the caller's clientId on every request.

const UPLOAD_DIR = path.join(process.cwd(), "db", "uploads");
const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

// ---- GET /api/portal/files?entityType=&entityId= — list attachments on own entity
export async function GET(req: NextRequest) {
  try {
    const { clientId } = await requirePortal();
    const sp = req.nextUrl.searchParams;
    const entityType = (sp.get("entityType") || "").trim().toUpperCase();
    const entityId = (sp.get("entityId") || "").trim();

    if (!PORTAL_FILE_ENTITY_TYPES.includes(entityType as PortalEntityType)) {
      throw new ApiError(400, "INVALID_ENTITY_TYPE", "entityType must be TICKET or PROJECT.");
    }
    if (!entityId) throw new ApiError(400, "ENTITY_REQUIRED", "entityId is required.");
    await assertPortalEntity(entityType as PortalEntityType, entityId, clientId);

    const where: Prisma.FileRecordWhereInput = { entityType, entityId };
    const rows = await db.fileRecord.findMany({ where, orderBy: { createdAt: "desc" }, take: 100 });

    const uploaderIds = [...new Set(rows.map((r) => r.uploaderId).filter((v): v is string => !!v))];
    const uploaders = uploaderIds.length
      ? await db.user.findMany({ where: { id: { in: uploaderIds } }, select: { id: true, name: true, avatarColor: true } })
      : [];
    const uploaderMap = new Map(uploaders.map((u) => [u.id, u]));

    return ok({
      files: rows.map((r) => ({
        id: r.id,
        originalName: r.originalName,
        size: r.size,
        mimeType: r.mimeType,
        entityType: r.entityType,
        entityId: r.entityId,
        version: r.version,
        createdAt: r.createdAt,
        uploader: r.uploaderId ? uploaderMap.get(r.uploaderId) ?? null : null,
      })),
    });
  } catch (e) {
    return handleError(e);
  }
}

// ---- POST /api/portal/files (multipart/form-data: file, entityType, entityId)
export async function POST(req: NextRequest) {
  try {
    const { session, clientId } = await requirePortal();
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new ApiError(400, "INVALID_FORM", "Expected multipart/form-data with a file.");
    }

    const file = form.get("file");
    const entityTypeRaw = String(form.get("entityType") || "").trim().toUpperCase();
    const entityId = String(form.get("entityId") || "").trim();

    if (!(file instanceof File) || file.size === 0) {
      throw new ApiError(400, "FILE_REQUIRED", "Attach a file to upload.");
    }
    if (file.size > MAX_SIZE_BYTES) {
      throw new ApiError(413, "FILE_TOO_LARGE", "Files are limited to 10 MB.");
    }
    if (!PORTAL_FILE_ENTITY_TYPES.includes(entityTypeRaw as PortalEntityType)) {
      throw new ApiError(400, "INVALID_ENTITY_TYPE", "Clients can attach files to tickets and projects only.");
    }
    if (!entityId) throw new ApiError(400, "ENTITY_REQUIRED", "entityId is required.");
    await assertPortalEntity(entityTypeRaw as PortalEntityType, entityId, clientId);

    const originalName = path.basename(file.name || "file").replace(/[^\w.\- ()\u0600-\u06FF]/g, "_").slice(0, 180) || "file";
    const ext = path.extname(originalName).toLowerCase().slice(0, 10);
    const storedName = `${randomUUID()}${ext}`;

    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(path.join(UPLOAD_DIR, storedName), buffer);

    const record = await db.fileRecord.create({
      data: {
        filename: storedName,
        originalName,
        size: file.size,
        mimeType: file.type || null,
        entityType: entityTypeRaw,
        entityId,
        uploaderId: session.user.id,
      },
    });

    await logAudit({
      actorId: session.user.id, actorName: session.user.name,
      action: "UPLOAD", entityType: "FILE", entityId: record.id,
      metadata: { originalName, size: file.size, attachedTo: `${entityTypeRaw}:${entityId}`, viaPortal: true },
      ip: clientIp(req),
    });
    await logActivity({
      actorId: session.user.id, actorName: session.user.name,
      type: "CREATED", entityType: entityTypeRaw, entityId,
      title: `Client uploaded a file: ${originalName}`,
      description: `${Math.max(1, Math.round(file.size / 1024))} KB attachment added via Client Portal.`,
      metadata: { viaPortal: true },
    });

    // Staff heads-up: the assignee (or SUPPORT role) learns about new evidence
    if (entityTypeRaw === "TICKET") {
      const ticket = await db.ticket.findUnique({
        where: { id: entityId },
        select: { ticketNumber: true, subject: true, assignedToId: true },
      });
      if (ticket) {
        const payload = {
          type: "SUPPORT",
          title: `Client attached a file to ${ticket.ticketNumber}`,
          body: `${session.user.name} uploaded "${originalName}" on "${ticket.subject}".`,
          entityType: "TICKET",
          entityId,
        };
        if (ticket.assignedToId) await createNotification({ userId: ticket.assignedToId, ...payload });
        else await notifyRole("SUPPORT", payload);
      }
    }

    const portalUser = await db.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, name: true, avatarColor: true },
    });

    return ok({
      id: record.id,
      originalName: record.originalName,
      size: record.size,
      mimeType: record.mimeType,
      entityType: record.entityType,
      entityId: record.entityId,
      version: record.version,
      createdAt: record.createdAt,
      uploader: portalUser ?? { id: session.user.id, name: session.user.name ?? "Client", avatarColor: "#22d3ee" },
    }, 201);
  } catch (e) {
    return handleError(e);
  }
}
