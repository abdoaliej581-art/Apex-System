import { NextRequest } from "next/server";
import { z } from "zod";
import { hash } from "bcryptjs";
import { db } from "@/lib/db";
import { requirePermission, ok, parseBody, handleError, ApiError, logAudit } from "@/lib/api-helpers";
import { sendMail, welcomeEmail } from "@/lib/mailer";

const AVATAR_COLORS = ["#22d3ee", "#34d399", "#f59e0b", "#f472b6", "#a78bfa", "#f87171", "#60a5fa"];

const createSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(80),
  email: z.string().trim().toLowerCase().email("Valid email is required"),
  password: z.string().min(8, "Password must be at least 8 characters").max(72),
  title: z.string().trim().max(120).optional().or(z.literal("")),
  roleKeys: z.array(z.string().trim().min(1)).min(1, "Assign at least one role"),
  avatarColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Invalid color").optional(),
});

/** GET /api/users — full team incl. inactive (team.manage, Settings → Team) */
export async function GET(_req: NextRequest) {
  try {
    await requirePermission("team.manage");
    const users = await db.user.findMany({
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      select: {
        id: true, name: true, email: true, title: true, avatarColor: true,
        isActive: true, customPermissions: true, lastLoginAt: true, createdAt: true,
        roles: { select: { id: true, key: true, label: true } },
      },
    });
    const roles = await db.role.findMany({ orderBy: { label: "asc" }, select: { id: true, key: true, label: true, isSystem: true } });
    return ok({ users, roles, avatarColors: AVATAR_COLORS });
  } catch (e) {
    return handleError(e);
  }
}

/** POST /api/users — invite a team member (team.manage) */
export async function POST(req: NextRequest) {
  try {
    const { session } = await requirePermission("team.manage");
    const body = await parseBody(req, createSchema);

    const existing = await db.user.findUnique({ where: { email: body.email } });
    if (existing) throw new ApiError(409, "EMAIL_TAKEN", "A user with this email already exists.");

    const roles = await db.role.findMany({ where: { key: { in: body.roleKeys } } });
    if (roles.length === 0) throw new ApiError(400, "INVALID_ROLES", "No valid roles were provided.");

    const user = await db.user.create({
      data: {
        name: body.name,
        email: body.email,
        title: body.title || null,
        passwordHash: await hash(body.password, 10),
        avatarColor: body.avatarColor || AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
        roles: { connect: roles.map((r) => ({ id: r.id })) },
      },
      select: { id: true, name: true, email: true, title: true, avatarColor: true, isActive: true, roles: { select: { key: true, label: true } } },
    });

    await logAudit({
      actorId: session.user.id, actorName: session.user.name,
      action: "CREATE", entityType: "USER", entityId: user.id,
      metadata: { email: body.email, roleKeys: roles.map((r) => r.key) },
    });
    await logAudit({
      actorId: session.user.id, actorName: session.user.name,
      action: "PERMISSION_CHANGE", entityType: "USER", entityId: user.id,
      metadata: { email: body.email, granted: roles.map((r) => r.key) },
    });

    // Welcome email with the temporary password (fire-and-forget)
    const welcome = welcomeEmail({ name: user.name, email: user.email, password: body.password });
    sendMail({ to: user.email, subject: welcome.subject, html: welcome.html }).catch(() => undefined);

    return ok({ user }, 201);
  } catch (e) {
    return handleError(e);
  }
}
