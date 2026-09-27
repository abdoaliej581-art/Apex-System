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

const ContactSchema = z.object({
  clientId: z.string().min(1, "Client is required"),
  name: z.string().trim().min(2, "Contact name must be at least 2 characters"),
  position: optionalText(120),
  email: optionalText(200),
  phone: optionalText(50),
  preferredMethod: z.enum(PREFERRED_METHODS).optional().nullable(),
  isPrimary: z.boolean().default(false),
  notes: optionalText(1000),
});

// ---- GET /api/contacts?clientId= ----
export async function GET(req: NextRequest) {
  try {
    await requirePermission("contacts.view");
    const clientId = req.nextUrl.searchParams.get("clientId") || "";
    if (!clientId) throw new ApiError(400, "MISSING_CLIENT", "A clientId query parameter is required.");

    const client = await db.client.findUnique({ where: { id: clientId }, select: { id: true } });
    if (!client) throw new ApiError(404, "NOT_FOUND", "This client no longer exists.");

    const items = await db.contact.findMany({
      where: { clientId },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    });
    return ok({ items });
  } catch (e) {
    return handleError(e);
  }
}

// ---- POST /api/contacts ----
export async function POST(req: NextRequest) {
  try {
    const { session } = await requirePermission("contacts.create");
    const body = await parseBody(req, ContactSchema);

    const client = await db.client.findUnique({ where: { id: body.clientId }, select: { id: true, companyName: true } });
    if (!client) throw new ApiError(400, "INVALID_CLIENT", "The selected client no longer exists.");

    const contact = await db.$transaction(async (tx) => {
      if (body.isPrimary) {
        await tx.contact.updateMany({ where: { clientId: body.clientId, isPrimary: true }, data: { isPrimary: false } });
      }
      return tx.contact.create({
        data: {
          clientId: body.clientId,
          name: body.name,
          position: body.position ?? null,
          email: body.email ?? null,
          phone: body.phone ?? null,
          preferredMethod: body.preferredMethod ?? null,
          isPrimary: body.isPrimary,
          notes: body.notes ?? null,
        },
      });
    });

    await logActivity({
      actorId: session.user.id, actorName: session.user.name,
      type: "UPDATED", entityType: "CLIENT", entityId: client.id,
      title: `Contact added: ${contact.name}${body.isPrimary ? " (primary)" : ""}`,
    });
    await logAudit({
      actorId: session.user.id, actorName: session.user.name, ip: clientIp(req),
      action: "CREATE", entityType: "CONTACT", entityId: contact.id,
      metadata: { name: contact.name, clientId: client.id },
    });

    return ok(contact, 201);
  } catch (e) {
    return handleError(e);
  }
}
