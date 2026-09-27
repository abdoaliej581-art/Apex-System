import { NextRequest } from "next/server";
import { z } from "zod";
import { hash } from "bcryptjs";
import { db } from "@/lib/db";
import {
  requirePermission, ok, handleError, parseBody,
  logAudit, logActivity, clientIp, ApiError,
} from "@/lib/api-helpers";

const AVATAR_COLORS = ["#22d3ee", "#38bdf8", "#34d399", "#a78bfa", "#f472b6", "#fbbf24", "#fb7185", "#4ade80"];

// GET /api/clients/[id]/portal-users — list portal accounts linked to a client (§72)
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission("clients.view");
    const { id } = await params;

    const client = await db.client.findUnique({ where: { id }, select: { id: true, companyName: true } });
    if (!client) throw new ApiError(404, "NOT_FOUND", "This client no longer exists.");

    const users = await db.user.findMany({
      where: { clientId: id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, name: true, email: true, avatarColor: true, isActive: true,
        lastLoginAt: true, createdAt: true,
      },
    });

    return ok({ client, users });
  } catch (e) {
    return handleError(e);
  }
}

const CreateSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(120),
  email: z.string().trim().toLowerCase().email("A valid email is required").max(200),
  password: z.string().min(8, "Password must be at least 8 characters").max(100),
});

// POST /api/clients/[id]/portal-users — grant portal access to a client contact (§72)
// Creates a user with the CLIENT role, hard-linked to this client company.
// All portal scoping is then enforced server-side by requirePortal().
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session } = await requirePermission("clients.edit");
    const { id } = await params;
    const body = await parseBody(req, CreateSchema);

    const client = await db.client.findUnique({ where: { id }, select: { id: true, companyName: true, clientNumber: true } });
    if (!client) throw new ApiError(404, "NOT_FOUND", "This client no longer exists.");

    const existing = await db.user.findUnique({ where: { email: body.email } });
    if (existing) throw new ApiError(409, "EMAIL_TAKEN", "Another account already uses this email address.");

    const clientRole = await db.role.findUnique({ where: { key: "CLIENT" } });
    if (!clientRole) throw new ApiError(500, "ROLE_MISSING", "The CLIENT role is missing. Please re-seed system roles.");

    const avatarColor = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];

    const user = await db.user.create({
      data: {
        name: body.name,
        email: body.email,
        passwordHash: await hash(body.password, 10),
        avatarColor,
        title: `Client — ${client.companyName}`,
        clientId: client.id,
        roles: { connect: { id: clientRole.id } },
      },
      select: { id: true, name: true, email: true, avatarColor: true, isActive: true, createdAt: true },
    });

    await logActivity({
      actorId: session.user.id, actorName: session.user.name,
      type: "CRM", entityType: "CLIENT", entityId: client.id,
      title: `Portal access granted: ${client.companyName}`,
      description: `${body.email} can now sign in to the Client Portal for ${client.companyName}.`,
      metadata: { portalUserId: user.id, email: body.email },
    });
    await logAudit({
      actorId: session.user.id, actorName: session.user.name,
      action: "CREATE", entityType: "USER", entityId: user.id,
      metadata: { email: body.email, portalUser: true, clientNumber: client.clientNumber }, ip: clientIp(req),
    });

    return ok(user, 201);
  } catch (e) {
    return handleError(e);
  }
}
