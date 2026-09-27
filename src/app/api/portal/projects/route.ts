import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requirePortal, ok, handleError, paginationFrom } from "@/lib/api-helpers";

// GET /api/portal/projects — projects of the signed-in client company ONLY (§72)
export async function GET(req: NextRequest) {
  try {
    const { clientId } = await requirePortal();
    const { page, pageSize, skip, take, sp } = paginationFrom(req);
    const status = (sp.get("status") || "").trim();
    const q = (sp.get("q") || "").trim();

    const where: Prisma.ProjectWhereInput = {
      clientId, // hard scope — portal users can never see other companies' work
      archivedAt: null,
    };
    if (status) where.status = status;
    if (q) where.OR = [{ name: { contains: q } }, { projectNumber: { contains: q } }];

    const [rows, total, byStatus] = await Promise.all([
      db.project.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }],
        skip, take,
        select: {
          id: true, projectNumber: true, name: true, description: true, type: true,
          status: true, priority: true, progress: true, health: true,
          startDate: true, deadline: true, updatedAt: true,
          manager: { select: { name: true, avatarColor: true } },
          _count: { select: { tasks: true } },
        },
      }),
      db.project.count({ where }),
      db.project.groupBy({ by: ["status"], _count: { _all: true }, where: { clientId, archivedAt: null } }),
    ]);

    return ok({
      items: rows,
      total, page, pageSize,
      summary: byStatus.map((s) => ({ status: s.status, count: s._count._all })),
    });
  } catch (e) {
    return handleError(e);
  }
}
