import { NextRequest } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  requirePermission, ok, handleError, parseBody, paginationFrom,
  logAudit, logActivity, clientIp, createNotification, ApiError,
} from "@/lib/api-helpers";

const optionalText = (max = 2000) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().max(max).nullable().optional()
  );

const PLATFORMS = ["INSTAGRAM", "FACEBOOK", "LINKEDIN", "YOUTUBE", "X_TWITTER", "TIKTOK", "OTHER"] as const;
const CONTENT_TYPES = ["POST", "REEL", "STORY", "ARTICLE", "OFFER", "CASE_STUDY", "VIDEO"] as const;
const STATUSES = ["IDEA", "DRAFT", "REVIEW", "APPROVED", "SCHEDULED", "PUBLISHED", "ARCHIVED"] as const;

const CreateSchema = z.object({
  title: z.string().trim().min(2, "Title is required").max(200),
  platform: z.enum(PLATFORMS).default("INSTAGRAM"),
  contentType: z.enum(CONTENT_TYPES).default("POST"),
  caption: optionalText(4000),
  cta: optionalText(200),
  hashtags: optionalText(500),
  mediaUrl: optionalText(500),
  publishDate: z.string().datetime().nullable().optional(),
  status: z.enum(STATUSES).default("IDEA"),
  campaignId: optionalText(40),
  authorId: optionalText(40),
  reviewerId: optionalText(40),
});

const serializeContent = (c: {
  id: string; title: string; platform: string; contentType: string; caption: string | null;
  cta: string | null; hashtags: string | null; mediaUrl: string | null; publishDate: Date | null;
  status: string; campaignId: string | null; createdAt: Date; updatedAt: Date;
  author?: { id: string; name: string; avatarColor: string } | null;
  reviewer?: { id: string; name: string; avatarColor: string } | null;
  campaign?: { id: string; name: string } | null;
}) => ({
  id: c.id, title: c.title, platform: c.platform, contentType: c.contentType,
  caption: c.caption, cta: c.cta, hashtags: c.hashtags, mediaUrl: c.mediaUrl,
  publishDate: c.publishDate, status: c.status, campaignId: c.campaignId,
  createdAt: c.createdAt, updatedAt: c.updatedAt,
  author: c.author ?? null, reviewer: c.reviewer ?? null, campaign: c.campaign ?? null,
});

const contentInclude = {
  author: { select: { id: true, name: true, avatarColor: true } },
  reviewer: { select: { id: true, name: true, avatarColor: true } },
  campaign: { select: { id: true, name: true } },
} satisfies Prisma.ContentInclude;

// ---- GET /api/content?status=&platform=&contentType=&campaignId=&authorId=&from=&to=&q=&page= ----
export async function GET(req: NextRequest) {
  try {
    await requirePermission("content.view");
    const { page, pageSize, skip, take, sp } = paginationFrom(req);

    const q = (sp.get("q") || "").trim();
    const status = (sp.get("status") || "").trim();
    const platform = (sp.get("platform") || "").trim();
    const contentType = (sp.get("contentType") || "").trim();
    const campaignId = (sp.get("campaignId") || "").trim();
    const authorId = (sp.get("authorId") || "").trim();
    const from = sp.get("from");
    const to = sp.get("to");

    const where: Prisma.ContentWhereInput = {};
    if (status) where.status = status;
    if (platform) where.platform = platform;
    if (contentType) where.contentType = contentType;
    if (campaignId) where.campaignId = campaignId;
    if (authorId) where.authorId = authorId;
    if (from || to) {
      // Tolerant date parsing: accept both YYYY-MM-DD (append end-of-day for `to`)
      // and full ISO timestamps (used by the publishing calendar).
      const startOf = (v: string) => new Date(v.includes("T") ? v : `${v}T00:00:00.000Z`);
      const endOf = (v: string) => new Date(v.includes("T") ? v : `${v}T23:59:59.999Z`);
      where.publishDate = {
        ...(from ? { gte: startOf(from) } : {}),
        ...(to ? { lte: endOf(to) } : {}),
      };
    }
    if (q) {
      where.OR = [
        { title: { contains: q } },
        { caption: { contains: q } },
        { hashtags: { contains: q } },
      ];
    }

    const [rows, total, byStatus, upcoming, publishedThisMonth] = await Promise.all([
      db.content.findMany({
        where,
        orderBy: [{ publishDate: "asc" }, { createdAt: "desc" }],
        skip, take,
        include: contentInclude,
      }),
      db.content.count({ where }),
      db.content.groupBy({ by: ["status"], _count: { _all: true } }),
      db.content.count({ where: { status: "SCHEDULED", publishDate: { gte: new Date() } } }),
      db.content.count({
        where: {
          status: "PUBLISHED",
          publishDate: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
        },
      }),
    ]);

    return ok({
      items: rows.map(serializeContent),
      total, page, pageSize,
      summary: {
        byStatus: byStatus.map((s) => ({ status: s.status, count: s._count._all })),
        upcomingScheduled: upcoming,
        publishedThisMonth,
      },
    });
  } catch (e) {
    return handleError(e);
  }
}

// ---- POST /api/content ----
export async function POST(req: NextRequest) {
  try {
    const { session } = await requirePermission("content.create");
    const body = await parseBody(req, CreateSchema);

    if (body.campaignId) {
      const campaign = await db.campaign.findUnique({ where: { id: body.campaignId } });
      if (!campaign) throw new ApiError(400, "INVALID_CAMPAIGN", "The selected campaign no longer exists.");
    }
    for (const [label, uid] of [["Author", body.authorId], ["Reviewer", body.reviewerId]] as const) {
      if (uid) {
        const user = await db.user.findUnique({ where: { id: uid } });
        if (!user || !user.isActive) throw new ApiError(400, "INVALID_USER", `${label} must be an active team member.`);
      }
    }

    const content = await db.content.create({
      data: {
        title: body.title,
        platform: body.platform,
        contentType: body.contentType,
        caption: body.caption ?? null,
        cta: body.cta ?? null,
        hashtags: body.hashtags ?? null,
        mediaUrl: body.mediaUrl ?? null,
        publishDate: body.publishDate ? new Date(body.publishDate) : null,
        status: body.status,
        campaignId: body.campaignId ?? null,
        authorId: body.authorId ?? null,
        reviewerId: body.reviewerId ?? null,
      },
      include: contentInclude,
    });

    await logActivity({
      actorId: session.user.id, actorName: session.user.name,
      type: "MARKETING", entityType: "CONTENT", entityId: content.id,
      title: `Content created: ${content.title}`,
      description: `${content.platform.replace(/_/g, " ")} ${content.contentType.toLowerCase()} — status ${content.status}.`,
      metadata: { platform: content.platform, contentType: content.contentType },
    });
    await logAudit({
      actorId: session.user.id, actorName: session.user.name,
      action: "CREATE", entityType: "CONTENT", entityId: content.id,
      metadata: { title: content.title, platform: content.platform }, ip: clientIp(req),
    });
    // Notify the assigned author when someone else assigns them
    if (body.authorId && body.authorId !== session.user.id) {
      await createNotification({
        userId: body.authorId,
        type: "MARKETING",
        title: `New content assigned to you: ${content.title}`,
        body: `${session.user.name} assigned you as author (${content.platform.replace(/_/g, " ")} ${content.contentType.toLowerCase()}).`,
        entityType: "CONTENT",
        entityId: content.id,
      });
    }

    return ok(serializeContent(content), 201);
  } catch (e) {
    return handleError(e);
  }
}
