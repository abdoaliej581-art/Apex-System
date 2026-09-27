import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  requirePermission, ok, handleError, parseBody,
  logAudit, logActivity, ApiError, clientIp,
} from "@/lib/api-helpers";

const PREFERRED_METHODS = ["EMAIL", "PHONE", "WHATSAPP"] as const;

const optionalText = (max = 500) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().max(max).nullable().optional()
  );

const PatchSchema = z.object({
  name: z.string().trim().min(2, "Contact name must be at least 2 characters").optional(),
  position: optionalText(120),
  email: optionalText(200),
  phone: optionalText(50),
  preferredMethod: z.enum(PREFERRED_METHODS).optional().nullable(),
  isPrimary: z.boolean().optional(),
  notes: optionalText(1000),
});

async function getContactOr404(id: string) {
  const contact = await db.contact.findUnique({ where: { id } });
  if (!contact) throw new ApiError(404, "NOT_FOUND", "This contact no longer exists.");
  return contact;
}

// ---- PATCH /api/contacts/[id] ----
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session } = await requirePermission("contacts.edit");
    const { id } = await params;
    const body = await parseBody(req, PatchSchema);
    const current = await getContactOr404(id);

    const data: Record<string, unknown> = {};
    for (const key of ["name", "position", "email", "phone", "notes"] as const) {
      if (body[key] !== undefined) data[key] = body[key];
    }
    if (body.preferredMethod !== undefined) data.preferredMethod = body.preferredMethod;
    if (body.isPrimary !== undefined) data.isPrimary = body.isPrimary;

    const changedFields = Object.keys(data);
    if (changedFields.length === 0) return ok(current);

    const contact = await db.$transaction(async (tx) => {
      // Making this contact primary → unset the previous primary in the same transaction
      if (body.isPrimary === true && !current.isPrimary) {
        await tx.contact.updateMany({ where: { clientId: current.clientId, isPrimary: true }, data: { isPrimary: false } });
      }
      return tx.contact.update({
        where: { id },
        data: data as Parameters<typeof tx.contact.update>[0]["data"],
      });
    });

    await logActivity({
      actorId: session.user.id, actorName: session.user.name,
      type: "UPDATED", entityType: "CLIENT", entityId: current.clientId,
      title: `Contact updated: ${contact.name}`,
    });
    await logAudit({
      actorId: session.user.id, actorName: session.user.name, ip: clientIp(req),
      action: "UPDATE", entityType: "CONTACT", entityId: id,
      metadata: { fields: changedFields, clientId: current.clientId },
    });

    return ok(contact);
  } catch (e) {
    return handleError(e);
  }
}

// ---- DELETE /api/contacts/[id] ----
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session } = await requirePermission("contacts.delete");
    const { id } = await params;
    const contact = await getContactOr404(id);

    await db.contact.delete({ where: { id } });

    await logActivity({
      actorId: session.user.id, actorName: session.user.name,
      type: "UPDATED", entityType: "CLIENT", entityId: contact.clientId,
      title: `Contact removed: ${contact.name}`,
    });
    await logAudit({
      actorId: session.user.id, actorName: session.user.name, ip: clientIp(req),
      action: "DELETE", entityType: "CONTACT", entityId: id,
      metadata: { name: contact.name, clientId: contact.clientId },
    });

    return ok({ deleted: true });
  } catch (e) {
    return handleError(e);
  }
}
