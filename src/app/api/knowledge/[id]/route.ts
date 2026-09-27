import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, ok, parseBody, handleError, ApiError, logAudit, logActivity } from "@/lib/api-helpers";

const KB_CATEGORIES = ["SALES", "DEVELOPMENT", "DESIGN", "DEPLOYMENT", "MARKETING", "OPERATIONS", "SOP", "TROUBLESHOOTING", "TEMPLATES"];

const patchSchema = z.object({
  title: z.string().trim().min(3).max(200).optional(),
  category: z.enum(KB_CATEGORIES as [string, ...string[]]).optional(),
  content: z.string().trim().min(10).max(100_000).optional(),
  visibility: z.enum(["INTERNAL", "TEAM"]).optional(),
});

async function getArticle(id: string) {
  const article = await db.knowledgeArticle.findUnique({
    where: { id },
    include: { author: { select: { id: true, name: true, avatarColor: true } } },
  });
  if (!article || article.deletedAt) throw new ApiError(404, "NOT_FOUND", "Knowledge article not found.");
  return article;
}

/** GET /api/knowledge/[id] — full article (kb.view) */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission("kb.view");
    const { id } = await params;
    const article = await getArticle(id);
    return ok({ article });
  } catch (e) {
    return handleError(e);
  }
}

/** PATCH /api/knowledge/[id] — edit; bumps version on content change (kb.edit) */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session } = await requirePermission("kb.edit");
    const { id } = await params;
    const body = await parseBody(req, patchSchema);
    const article = await getArticle(id);

    const contentChanged = body.content !== undefined && body.content !== article.content;
    const updated = await db.knowledgeArticle.update({
      where: { id },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.category !== undefined ? { category: body.category } : {}),
        ...(body.content !== undefined ? { content: body.content } : {}),
        ...(body.visibility !== undefined ? { visibility: body.visibility } : {}),
        ...(contentChanged ? { version: { increment: 1 } } : {}),
      },
      include: { author: { select: { id: true, name: true, avatarColor: true } } },
    });

    await logAudit({
      actorId: session.user.id, actorName: session.user.name,
      action: "UPDATE", entityType: "KNOWLEDGE_ARTICLE", entityId: id,
      metadata: { title: updated.title, contentChanged, version: updated.version },
    });
    if (contentChanged) {
      await logActivity({
        actorId: session.user.id, actorName: session.user.name,
        type: "UPDATED", entityType: "KNOWLEDGE_ARTICLE", entityId: id,
        title: `Knowledge article updated: ${updated.title}`,
        description: `Now at version ${updated.version}`,
      });
    }

    return ok({ article: updated });
  } catch (e) {
    return handleError(e);
  }
}

/** DELETE /api/knowledge/[id] — soft archive (§64 archive-first) */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session } = await requirePermission("kb.delete");
    const { id } = await params;
    const article = await getArticle(id);

    await db.knowledgeArticle.update({ where: { id }, data: { deletedAt: new Date() } });
    await logAudit({
      actorId: session.user.id, actorName: session.user.name,
      action: "ARCHIVE", entityType: "KNOWLEDGE_ARTICLE", entityId: id,
      metadata: { title: article.title },
    });
    await logActivity({
      actorId: session.user.id, actorName: session.user.name,
      type: "UPDATED", entityType: "KNOWLEDGE_ARTICLE", entityId: id,
      title: `Knowledge article archived: ${article.title}`,
    });

    return ok({ archived: true });
  } catch (e) {
    return handleError(e);
  }
}
