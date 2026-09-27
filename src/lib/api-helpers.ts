import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { ZodSchema } from "zod";
import { db } from "@/lib/db";

// ---- Response envelope: { success, data } | { success, error: { code, message } }

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function ok<T>(data: T, init?: number) {
  return NextResponse.json({ success: true, data }, { status: init ?? 200 });
}

export function fail(status: number, code: string, message: string) {
  return NextResponse.json({ success: false, error: { code, message } }, { status });
}

/** Any uncaught error → clean 500 without leaking internals (§53, §72) */
export function handleError(e: unknown) {
  if (e instanceof ApiError) return fail(e.status, e.code, e.message);
  console.error("[api-error]", e instanceof Error ? e.message : e);
  return fail(500, "INTERNAL_ERROR", "Something went wrong. Please try again.");
}

export type AuthContext = {
  session: {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      permissions: string[];
      roleKeys: string[];
      clientId?: string | null;
    };
  };
};

/** Ensure authenticated session; throws 401 */
export async function requireAuth(): Promise<AuthContext> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) throw new ApiError(401, "UNAUTHORIZED", "Please sign in to continue.");
  // FIX (task 3-a): return the AuthContext shape { session } that requirePermission()
  // and every API route expect (`const { session } = await requirePermission(...)`).
  // Previously the raw session was returned, so ctx.session was undefined and every
  // authenticated request crashed with "Cannot read properties of undefined (reading 'user')".
  return { session } as AuthContext;
}

/** Ensure authenticated + specific permission; throws 401/403 */
export async function requirePermission(permission: string): Promise<AuthContext> {
  const ctx = await requireAuth();
  if (!ctx.session.user.permissions?.includes(permission)) {
    throw new ApiError(403, "FORBIDDEN", "You do not have permission to perform this action.");
  }
  return ctx;
}

/**
 * Client Portal guard (§72): the user must carry the CLIENT role and be linked
 * to a client company. Every /api/portal/* query is scoped to that company.
 */
export async function requirePortal(): Promise<AuthContext & { clientId: string }> {
  const ctx = await requireAuth();
  const isClientUser = ctx.session.user.roleKeys?.includes("CLIENT");
  if (!isClientUser) {
    throw new ApiError(403, "FORBIDDEN", "This area is reserved for client portal accounts.");
  }
  if (!ctx.session.user.clientId) {
    throw new ApiError(403, "NO_CLIENT_LINK", "Your account is not linked to a client company yet. Please contact the APEX team.");
  }
  return { ...ctx, clientId: ctx.session.user.clientId };
}

/** Validate JSON body with zod; throws 400 with readable message */
export async function parseBody<T>(req: NextRequest, schema: ZodSchema<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ApiError(400, "INVALID_JSON", "Invalid request body.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const field = first.path.join(".");
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      field ? `${field}: ${first.message}` : first.message
    );
  }
  return parsed.data;
}

export function paginationFrom(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, parseInt(sp.get("page") || "1") || 1);
  const pageSize = Math.min(100, Math.max(5, parseInt(sp.get("pageSize") || "25") || 25));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize, sp };
}

// ---- Cross-cutting helpers used by all modules

export async function logAudit(opts: {
  actorId?: string | null;
  actorName?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string;
}) {
  try {
    await db.auditLog.create({
      data: {
        actorId: opts.actorId ?? null,
        actorName: opts.actorName ?? null,
        action: opts.action,
        entityType: opts.entityType,
        entityId: opts.entityId ?? null,
        metadata: opts.metadata ? JSON.stringify(opts.metadata) : null,
        ip: opts.ip ?? null,
      },
    });
  } catch (e) {
    console.error("[audit-log-failed]", e);
  }
}

export async function logActivity(opts: {
  actorId?: string | null;
  actorName?: string | null;
  type: string;
  entityType: string;
  entityId: string;
  title: string;
  description?: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    await db.activity.create({
      data: {
        actorId: opts.actorId ?? null,
        actorName: opts.actorName ?? null,
        type: opts.type,
        entityType: opts.entityType,
        entityId: opts.entityId,
        title: opts.title,
        description: opts.description ?? null,
        metadata: opts.metadata ? JSON.stringify(opts.metadata) : null,
      },
    });
  } catch (e) {
    console.error("[activity-log-failed]", e);
  }
}

export async function createNotification(opts: {
  userId: string;
  type: string;
  title: string;
  body?: string;
  entityType?: string;
  entityId?: string;
}) {
  try {
    await db.notification.create({ data: opts });
  } catch (e) {
    console.error("[notification-failed]", e);
  }
}

export async function notifyRole(roleKey: string, opts: { type: string; title: string; body?: string; entityType?: string; entityId?: string }) {
  const users = await db.user.findMany({
    where: { isActive: true, roles: { some: { key: roleKey } } },
    select: { id: true },
  });
  await Promise.all(users.map((u) => createNotification({ userId: u.id, ...opts })));
}

export function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}
