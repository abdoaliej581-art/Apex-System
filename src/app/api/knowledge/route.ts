import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, ok, parseBody, handleError, paginationFrom, logAudit, logActivity } from "@/lib/api-helpers";

const KB_CATEGORIES = ["SALES", "DEVELOPMENT", "DESIGN", "DEPLOYMENT", "MARKETING", "OPERATIONS", "SOP", "TROUBLESHOOTING", "TEMPLATES"];

const createSchema = z.object({
  title: z.string().trim().min(3, "Title must be at least 3 characters").max(200),
  category: z.enum(KB_CATEGORIES as [string, ...string[]]).default("OPERATIONS"),
  content: z.string().trim().min(10, "Content must be at least 10 characters").max(100_000),
  visibility: z.enum(["INTERNAL", "TEAM"]).default("INTERNAL"),
});

/** GET /api/knowledge — searchable internal knowledge base (§42) */
export async function GET(req: NextRequest) {
  try {
    await requirePermission("kb.view");
    const { page, pageSize, skip, take, sp } = paginationFrom(req);
    const q = sp.get("q")?.trim();
    const category = sp.get("category");
    const authorId = sp.get("authorId");

    const where = {
      deletedAt: null,
      ...(q ? { OR: [{ title: { contains: q } }, { content: { contains: q } }] } : {}),
      ...(category && category !== "ALL" ? { category } : {}),
      ...(authorId ? { authorId } : {}),
    };

    const [items, total, byCategoryRaw, authors] = await Promise.all([
      db.knowledgeArticle.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip, take,
        include: { author: { select: { id: true, name: true, avatarColor: true } } },
      }),
      db.knowledgeArticle.count({ where }),
      db.knowledgeArticle.groupBy({ by: ["category"], where: { deletedAt: null }, _count: { _all: true } }),
      db.user.findMany({
        where: { knowledgeArticles: { some: {} } },
        select: { id: true, name: true, avatarColor: true },
      }),
    ]);

    return ok({
      items,
      total,
      page,
      pageSize,
      summary: {
        totalArticles: total,
        categories: byCategoryRaw.map((c) => ({ category: c.category, count: c._count._all })).sort((a, b) => b.count - a.count),
        contributors: authors,
      },
    });
  } catch (e) {
    return handleError(e);
  }
}

/** POST /api/knowledge — create an article (kb.create) */
export async function POST(req: NextRequest) {
  try {
    const { session } = await requirePermission("kb.create");
    const body = await parseBody(req, createSchema);

    const article = await db.knowledgeArticle.create({
      data: {
        title: body.title,
        category: body.category,
        content: body.content,
        visibility: body.visibility,
        authorId: session.user.id,
        version: 1,
      },
      include: { author: { select: { id: true, name: true, avatarColor: true } } },
    });

    await logAudit({
      actorId: session.user.id, actorName: session.user.name,
      action: "CREATE", entityType: "KNOWLEDGE_ARTICLE", entityId: article.id,
      metadata: { title: body.title, category: body.category },
    });
    await logActivity({
      actorId: session.user.id, actorName: session.user.name,
      type: "CREATED", entityType: "KNOWLEDGE_ARTICLE", entityId: article.id,
      title: `Knowledge article published: ${body.title}`,
      description: `Category ${body.category}`,
    });

    return ok({ article }, 201);
  } catch (e) {
    return handleError(e);
  }
}
