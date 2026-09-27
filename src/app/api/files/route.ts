import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import {
  requirePermission, ok, handleError, paginationFrom,
  logAudit, logActivity, clientIp, ApiError,
} from "@/lib/api-helpers";

// ============ Files & Attachments (polymorphic FileRecord) ============
// Binary storage lives in db/uploads (NEVER public/) — downloads stream
// through /api/files/[id]/download so access is always permission-checked.

const UPLOAD_DIR = path.join(process.cwd(), "db", "uploads");
const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

/** entityType allowlist → existence check + display label resolver */
const ENTITY_TYPES = ["PROJECT", "TASK", "TICKET", "CLIENT", "LEAD", "INVOICE", "CONTRACT"] as const;
type EntityType = (typeof ENTITY_TYPES)[number];

async function assertEntityExists(entityType: EntityType, entityId: string): Promise<void> {
  const probe =
    entityType === "PROJECT" ? db.project.findUnique({ where: { id: entityId }, select: { id: true } })
    : entityType === "TASK" ? db.task.findUnique({ where: { id: entityId }, select: { id: true } })
    : entityType === "TICKET" ? db.ticket.findUnique({ where: { id: entityId }, select: { id: true } })
    : entityType === "CLIENT" ? db.client.findUnique({ where: { id: entityId }, select: { id: true } })
    : entityType === "LEAD" ? db.lead.findUnique({ where: { id: entityId }, select: { id: true } })
    : entityType === "INVOICE" ? db.invoice.findUnique({ where: { id: entityId }, select: { id: true } })
    : db.contract.findUnique({ where: { id: entityId }, select: { id: true } });
  const found = await probe;
  if (!found) throw new ApiError(404, "ENTITY_NOT_FOUND", `The referenced ${entityType.toLowerCase()} does not exist.`);
}

type EntityLabel = { id: string; type: string; label: string; sub: string };

/** Resolve human-readable labels for a mixed set of entity references. */
async function resolveEntityLabels(refs: { entityType: string; entityId: string }[]): Promise<Map<string, EntityLabel>> {
  const map = new Map<string, EntityLabel>();
  const byType = new Map<string, string[]>();
  refs.forEach(({ entityType, entityId }) => {
    const list = byType.get(entityType) ?? [];
    if (!list.includes(entityId)) list.push(entityId);
    byType.set(entityType, list);
  });
  await Promise.all(
    [...byType.entries()].map(async ([entityType, ids]) => {
      if (entityType === "PROJECT") {
        const rows = await db.project.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, projectNumber: true } });
        rows.forEach((r) => map.set(r.id, { id: r.id, type: "PROJECT", label: r.name, sub: r.projectNumber }));
      } else if (entityType === "TASK") {
        const rows = await db.task.findMany({ where: { id: { in: ids } }, select: { id: true, title: true } });
        rows.forEach((r) => map.set(r.id, { id: r.id, type: "TASK", label: r.title, sub: "" }));
      } else if (entityType === "TICKET") {
        const rows = await db.ticket.findMany({ where: { id: { in: ids } }, select: { id: true, ticketNumber: true, subject: true } });
        rows.forEach((r) => map.set(r.id, { id: r.id, type: "TICKET", label: r.subject, sub: r.ticketNumber }));
      } else if (entityType === "CLIENT") {
        const rows = await db.client.findMany({ where: { id: { in: ids } }, select: { id: true, companyName: true, clientNumber: true } });
        rows.forEach((r) => map.set(r.id, { id: r.id, type: "CLIENT", label: r.companyName, sub: r.clientNumber }));
      } else if (entityType === "LEAD") {
        const rows = await db.lead.findMany({ where: { id: { in: ids } }, select: { id: true, leadNumber: true, companyName: true } });
        rows.forEach((r) => map.set(r.id, { id: r.id, type: "LEAD", label: r.companyName, sub: r.leadNumber }));
      } else if (entityType === "INVOICE") {
        const rows = await db.invoice.findMany({ where: { id: { in: ids } }, select: { id: true, invoiceNumber: true } });
        rows.forEach((r) => map.set(r.id, { id: r.id, type: "INVOICE", label: r.invoiceNumber, sub: "" }));
      } else if (entityType === "CONTRACT") {
        const rows = await db.contract.findMany({ where: { id: { in: ids } }, select: { id: true, contractNumber: true, title: true } });
        rows.forEach((r) => map.set(r.id, { id: r.id, type: "CONTRACT", label: r.title, sub: r.contractNumber }));
      }
    })
  );
  return map;
}

const serializeFile = (
  f: {
    id: string; originalName: string; filename: string; size: number; mimeType: string | null;
    entityType: string; entityId: string; version: number; createdAt: Date; uploaderId: string | null;
  },
  uploader?: { id: string; name: string; avatarColor: string } | null,
  entity?: EntityLabel | null
) => ({
  id: f.id,
  originalName: f.originalName,
  size: f.size,
  mimeType: f.mimeType,
  entityType: f.entityType,
  entityId: f.entityId,
  version: f.version,
  createdAt: f.createdAt,
  uploader: uploader ?? null,
  entity: entity ?? null,
});

// ---- GET /api/files?entityType=&entityId=&q=&page=&pageSize=
export async function GET(req: NextRequest) {
  try {
    const { session } = await requirePermission("files.view");
    const { page, pageSize, skip, take, sp } = paginationFrom(req);
    const entityType = (sp.get("entityType") || "").trim().toUpperCase();
    const entityId = (sp.get("entityId") || "").trim();
    const q = (sp.get("q") || "").trim();

    const where: Prisma.FileRecordWhereInput = {};
    if (entityType && ENTITY_TYPES.includes(entityType as EntityType)) where.entityType = entityType;
    if (entityId) where.entityId = entityId;
    if (q) where.originalName = { contains: q };

    const [rows, total, stats] = await Promise.all([
      db.fileRecord.findMany({ where, orderBy: { createdAt: "desc" }, skip, take }),
      db.fileRecord.count({ where }),
      Promise.all([
        db.fileRecord.aggregate({ _sum: { size: true }, _count: true }),
        db.fileRecord.count({ where: { createdAt: { gte: new Date(Date.now() - 7 * 24 * 3600 * 1000) } } }),
        db.fileRecord.groupBy({ by: ["entityType"], _count: true }),
      ]),
    ]);

    const uploaderIds = [...new Set(rows.map((r) => r.uploaderId).filter((v): v is string => !!v))];
    const uploaders = uploaderIds.length
      ? await db.user.findMany({ where: { id: { in: uploaderIds } }, select: { id: true, name: true, avatarColor: true } })
      : [];
    const uploaderMap = new Map(uploaders.map((u) => [u.id, u]));
    const entityMap = await resolveEntityLabels(rows.map((r) => ({ entityType: r.entityType, entityId: r.entityId })));

    const [agg, recentCount, byType] = stats;
    return ok({
      files: rows.map((r) => serializeFile(r, r.uploaderId ? uploaderMap.get(r.uploaderId) ?? null : null, entityMap.get(r.entityId) ?? null)),
      pagination: { page, pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)) },
      stats: {
        totalCount: agg._count,
        totalBytes: agg._sum.size ?? 0,
        recentCount: recentCount,
        byType: byType.map((g) => ({ entityType: g.entityType, count: g._count })),
        viewerId: session.user.id,
      },
    });
  } catch (e) {
    return handleError(e);
  }
}

// ---- POST /api/files (multipart/form-data: file, entityType, entityId)
export async function POST(req: NextRequest) {
  try {
    const { session } = await requirePermission("files.upload");
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
    if (!ENTITY_TYPES.includes(entityTypeRaw as EntityType)) {
      throw new ApiError(400, "INVALID_ENTITY_TYPE", `entityType must be one of: ${ENTITY_TYPES.join(", ")}.`);
    }
    if (!entityId) throw new ApiError(400, "ENTITY_REQUIRED", "entityId is required.");
    await assertEntityExists(entityTypeRaw as EntityType, entityId);

    // Sanitized original name — keep it readable, strip path tricks.
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

    const uploader = await db.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, name: true, avatarColor: true },
    });

    await logAudit({
      actorId: session.user.id, actorName: session.user.name,
      action: "UPLOAD", entityType: "FILE", entityId: record.id,
      metadata: { originalName, size: file.size, attachedTo: `${entityTypeRaw}:${entityId}` },
      ip: clientIp(req),
    });
    await logActivity({
      actorId: session.user.id, actorName: session.user.name,
      type: "CREATED", entityType: entityTypeRaw, entityId,
      title: `File uploaded: ${originalName}`,
      description: `${Math.max(1, Math.round(file.size / 1024))} KB attachment added`,
    });

    return ok(serializeFile(record, uploader, null), 201);
  } catch (e) {
    return handleError(e);
  }
}
