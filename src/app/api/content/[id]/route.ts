import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  requirePermission, ok, handleError, parseBody,
  logAudit, logActivity, clientIp, createNotification, ApiError,
} from "@/lib/api-helpers";

const optionalText = (max = 4000) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().max(max).nullable().optional()
  );

const STATUSES = ["IDEA", "DRAFT", "REVIEW", "APPROVED", "SCHEDULED", "PUBLISHED", "ARCHIVED"] as const;

const PatchSchema = z.object({
  title: z.string().trim().min(2).max(200).optional(),
  platform: z.enum(["INSTAGRAM", "FACEBOOK", "LINKEDIN", "YOUTUBE", "X_TWITTER", "TIKTOK", "OTHER"]).optional(),
  contentType: z.enum(["POST", "REEL", "STORY", "ARTICLE", "OFFER", "CASE_STUDY", "VIDEO"]).optional(),
  caption: optionalText(4000),
  cta: optionalText(200),
  hashtags: optionalText(500),
  mediaUrl: optionalText(500),
  publishDate: z.string().datetime().nullable().optional(),
  status: z.enum(STATUSES).optional(),
  campaignId: optionalText(40),
  authorId: optionalText(40),
  reviewerId: optionalText(40),
});

const contentInclude = {
  author: { select: { id: true, name: true, avatarColor: true } },
  reviewer: { select: { id: true, name: true, avatarColor: true } },
  campaign: { select: { id: true, name: true } },
};

// ---- GET /api/content/[id] ----
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission("content.view");
    const { id } = await params;

    const content = await db.content.findUnique({ where: { id }, include: contentInclude });
    if (!content) throw new ApiError(404, "NOT_FOUND", "This content no longer exists.");

    const activities = await db.activity.findMany({
      where: { entityType: "CONTENT", entityId: id },
      orderBy: { createdAt: "desc" },
      take: 30,
      include: { actor: { select: { name: true, avatarColor: true } } },
    });

    return ok({ content, activities });
  } catch (e) {
    return handleError(e);
  }
}

// ---- PATCH /api/content/[id] ----
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session } = await requirePermission("content.edit");
    const { id } = await params;
    const body = await parseBody(req, PatchSchema);

    const existing = await db.content.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, "NOT_FOUND", "This content no longer exists.");

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

    // SCHEDULED requires a publish date (calendar is meaningless otherwise)
    const nextStatus = body.status ?? existing.status;
    const nextPublishDate = body.publishDate === undefined ? existing.publishDate : (body.publishDate ? new Date(body.publishDate) : null);
    if (nextStatus === "SCHEDULED" && !nextPublishDate) {
      throw new ApiError(400, "PUBLISH_DATE_REQUIRED", "Set a publish date before marking content as scheduled.");
    }

    const content = await db.content.update({
      where: { id },
      data: {
        title: body.title,
        platform: body.platform,
        contentType: body.contentType,
        caption: body.caption,
        cta: body.cta,
        hashtags: body.hashtags,
        mediaUrl: body.mediaUrl,
        publishDate: body.publishDate === undefined ? undefined : (body.publishDate ? new Date(body.publishDate) : null),
        status: body.status,
        campaignId: body.campaignId,
        authorId: body.authorId,
        reviewerId: body.reviewerId,
      },
      include: contentInclude,
    });

    // Status transition → activity (+ notify new author if reassigned)
    const statusChanged = body.status && body.status !== existing.status;
    if (statusChanged) {
      await logActivity({
        actorId: session.user.id, actorName: session.user.name,
        type: "STATUS_CHANGE", entityType: "CONTENT", entityId: id,
        title: `Content moved to ${body.status}: ${content.title}`,
        description: `${existing.status} → ${body.status}${content.publishDate ? ` · publish ${content.publishDate.toLocaleDateString("en-GB")}` : ""}`,
        metadata: { from: existing.status, to: body.status },
      });
    }
    if (body.authorId && body.authorId !== existing.authorId && body.authorId !== session.user.id) {
      await createNotification({
        userId: body.authorId,
        type: "MARKETING",
        title: `Content assigned to you: ${content.title}`,
        body: `${session.user.name} assigned you as author.`,
        entityType: "CONTENT",
        entityId: id,
      });
    }
    await logAudit({
      actorId: session.user.id, actorName: session.user.name,
      action: statusChanged ? "STATUS_CHANGE" : "MARKETING_ACTION", entityType: "CONTENT", entityId: id,
      metadata: { changes: Object.keys(body), ...(statusChanged ? { from: existing.status, to: body.status } : {}) },
      ip: clientIp(req),
    });

    return ok(content);
  } catch (e) {
    return handleError(e);
  }
}

// ---- DELETE /api/content/[id] ----
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session } = await requirePermission("content.delete");
    const { id } = await params;
    const existing = await db.content.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, "NOT_FOUND", "This content no longer exists.");

    await db.content.delete({ where: { id } });
    await logActivity({
      actorId: session.user.id, actorName: session.user.name,
      type: "MARKETING", entityType: "CONTENT", entityId: id,
      title: `Content deleted: ${existing.title}`,
    });
    await logAudit({
      actorId: session.user.id, actorName: session.user.name,
      action: "DELETE", entityType: "CONTENT", entityId: id,
      metadata: { title: existing.title, status: existing.status }, ip: clientIp(req),
    });
    return ok({ deleted: true });
  } catch (e) {
    return handleError(e);
  }
}
