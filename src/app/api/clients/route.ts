import { NextRequest } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  requirePermission, ok, handleError, parseBody, paginationFrom,
  logAudit, logActivity, clientIp,
} from "@/lib/api-helpers";
import { nextNumber } from "@/lib/numbering";

const CLIENT_STATUSES = ["ACTIVE", "INACTIVE", "ARCHIVED"] as const;

const optionalText = (max = 500) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().max(max).nullable().optional()
  );

// ---- GET /api/clients?q=&status=&page= ----
export async function GET(req: NextRequest) {
  try {
    await requirePermission("clients.view");
    const { page, pageSize, skip, take, sp } = paginationFrom(req);

    const q = (sp.get("q") || "").trim();
    const status = sp.get("status") || "";

    const where: Prisma.ClientWhereInput = {};
    if (q) {
      where.OR = [
        { companyName: { contains: q } },
        { clientNumber: { contains: q } },
        { email: { contains: q } },
        { phone: { contains: q } },
        { industry: { contains: q } },
      ];
    }
    const statusList = status.split(",").map((s) => s.trim()).filter(Boolean) as string[];
    if (statusList.length > 0) where.status = { in: statusList };

    const [items, total] = await Promise.all([
      db.client.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        include: { _count: { select: { projects: true, invoices: true, tickets: true } } },
      }),
      db.client.count({ where }),
    ]);

    return ok({ items, total, page, pageSize });
  } catch (e) {
    return handleError(e);
  }
}

// ---- POST /api/clients ----
const CreateSchema = z.object({
  companyName: z.string().trim().min(2, "Company name must be at least 2 characters"),
  industry: optionalText(120),
  location: optionalText(200),
  website: optionalText(300),
  email: optionalText(200),
  phone: optionalText(50),
  instagram: optionalText(300),
  facebook: optionalText(300),
  linkedin: optionalText(300),
  notes: optionalText(4000),
});

export async function POST(req: NextRequest) {
  try {
    const { session } = await requirePermission("clients.create");
    const body = await parseBody(req, CreateSchema);

    const clientNumber = await nextNumber("client");
    const client = await db.client.create({
      data: {
        clientNumber,
        companyName: body.companyName,
        industry: body.industry ?? null,
        location: body.location ?? null,
        website: body.website ?? null,
        email: body.email ?? null,
        phone: body.phone ?? null,
        instagram: body.instagram ?? null,
        facebook: body.facebook ?? null,
        linkedin: body.linkedin ?? null,
        notes: body.notes ?? null,
        createdById: session.user.id,
      },
    });

    await logActivity({
      actorId: session.user.id, actorName: session.user.name,
      type: "CREATED", entityType: "CLIENT", entityId: client.id,
      title: "Client created",
      description: `${client.clientNumber} — ${client.companyName}`,
    });
    await logAudit({
      actorId: session.user.id, actorName: session.user.name, ip: clientIp(req),
      action: "CREATE", entityType: "CLIENT", entityId: client.id,
      metadata: { clientNumber: client.clientNumber, company: client.companyName },
    });

    return ok(client, 201);
  } catch (e) {
    return handleError(e);
  }
}
