import { db } from "@/lib/db";
import { ApiError } from "@/lib/api-helpers";

// ============ Portal file access helpers (§72) ============
// Portal users may only attach files to THEIR OWN tickets and projects.
// Every access path re-verifies entity ownership against the caller's clientId.

export const PORTAL_FILE_ENTITY_TYPES = ["TICKET", "PROJECT"] as const;
export type PortalEntityType = (typeof PORTAL_FILE_ENTITY_TYPES)[number];

/** Verify the referenced ticket/project belongs to this portal client; else 404. */
export async function assertPortalEntity(
  entityType: PortalEntityType,
  entityId: string,
  clientId: string
): Promise<void> {
  if (entityType === "TICKET") {
    const t = await db.ticket.findFirst({ where: { id: entityId, clientId }, select: { id: true } });
    if (!t) throw new ApiError(404, "NOT_FOUND", "Ticket not found among your company's tickets.");
  } else {
    const p = await db.project.findFirst({ where: { id: entityId, clientId, archivedAt: null }, select: { id: true } });
    if (!p) throw new ApiError(404, "NOT_FOUND", "Project not found among your company's projects.");
  }
}

/**
 * Verify a FileRecord is portal-accessible: it must hang off a TICKET or PROJECT
 * owned by this client. Returns nothing; throws 404 on any mismatch (no leaks).
 */
export async function assertPortalFileAccess(
  record: { entityType: string; entityId: string },
  clientId: string
): Promise<void> {
  if (record.entityType === "TICKET") {
    const t = await db.ticket.findFirst({ where: { id: record.entityId, clientId }, select: { id: true } });
    if (!t) throw new ApiError(404, "NOT_FOUND", "File not found among your company's files.");
  } else if (record.entityType === "PROJECT") {
    const p = await db.project.findFirst({ where: { id: record.entityId, clientId }, select: { id: true } });
    if (!p) throw new ApiError(404, "NOT_FOUND", "File not found among your company's files.");
  } else {
    // Internal-only entity types (leads, contracts, invoices' internal files, …)
    throw new ApiError(404, "NOT_FOUND", "File not found among your company's files.");
  }
}
