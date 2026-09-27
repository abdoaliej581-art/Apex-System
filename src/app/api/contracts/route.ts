import { NextRequest } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requirePermission, ok, handleError, parseBody, paginationFrom, logAudit, logActivity, ApiError } from "@/lib/api-helpers";
import { nextNumber } from "@/lib/numbering";

/** GET /api/contracts?status=&clientId=&q=&page= — list contracts with client/project/proposal */
export async function GET(req: NextRequest) {
  try {
    await requirePermission("contracts.view");
    const { page, pageSize, skip, take, sp } = paginationFrom(req);

    const where: Prisma.ContractWhereInput = {};
    const status = sp.get("status");
    if (status) where.status = status;
    const clientId = sp.get("clientId");
    if (clientId) where.clientId = clientId;
    const q = sp.get("q");
    if (q) {
      where.OR = [{ contractNumber: { contains: q } }, { title: { contains: q } }];
    }

    const [items, total] = await Promise.all([
      db.contract.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip, take,
        include: {
          client: { select: { id: true, companyName: true } },
          project: { select: { id: true, name: true } },
          proposal: { select: { id: true, proposalNumber: true, title: true } },
        },
      }),
      db.contract.count({ where }),
    ]);

    return ok({ items, total, page, pageSize });
  } catch (e) {
    return handleError(e);
  }
}

const CreateSchema = z.object({
  clientId: z.string().min(1, "Client is required"),
  title: z.string().min(2, "Title is required"),
  projectId: z.string().optional().nullable(),
  proposalId: z.string().optional().nullable(),
  scope: z.string().optional().nullable(),
  deliverables: z.string().optional().nullable(),
  timeline: z.string().optional().nullable(),
  paymentTerms: z.string().optional().nullable(),
  revisionTerms: z.string().optional().nullable(),
  maintenanceTerms: z.string().optional().nullable(),
  startDate: z.coerce.date().optional().nullable(),
  endDate: z.coerce.date().optional().nullable(),
  documentUrl: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

/** POST /api/contracts — create a contract (contracts.create) */
export async function POST(req: NextRequest) {
  try {
    const { session } = await requirePermission("contracts.create");
    const body = await parseBody(req, CreateSchema);

    const client = await db.client.findUnique({ where: { id: body.clientId } });
    if (!client) throw new ApiError(400, "VALIDATION_ERROR", "clientId: The selected client no longer exists.");
    if (body.projectId && !(await db.project.findUnique({ where: { id: body.projectId } })))
      throw new ApiError(400, "VALIDATION_ERROR", "projectId: The selected project no longer exists.");
    if (body.proposalId && !(await db.proposal.findUnique({ where: { id: body.proposalId } })))
      throw new ApiError(400, "VALIDATION_ERROR", "proposalId: The selected proposal no longer exists.");
    if (body.startDate && body.endDate && body.endDate < body.startDate) {
      throw new ApiError(400, "VALIDATION_ERROR", "endDate: End date must be after start date.");
    }

    const contractNumber = await nextNumber("contract");
    const contract = await db.contract.create({
      data: {
        contractNumber,
        clientId: body.clientId,
        projectId: body.projectId || null,
        proposalId: body.proposalId || null,
        title: body.title,
        scope: body.scope || null,
        deliverables: body.deliverables || null,
        timeline: body.timeline || null,
        paymentTerms: body.paymentTerms || null,
        revisionTerms: body.revisionTerms || null,
        maintenanceTerms: body.maintenanceTerms || null,
        startDate: body.startDate ?? null,
        endDate: body.endDate ?? null,
        documentUrl: body.documentUrl || null,
        notes: body.notes || null,
        status: "DRAFT",
      },
      include: {
        client: { select: { id: true, companyName: true } },
        project: { select: { id: true, name: true } },
        proposal: { select: { id: true, proposalNumber: true, title: true } },
      },
    });

    await logAudit({
      actorId: session.user.id, actorName: session.user.name,
      action: "CREATE", entityType: "CONTRACT", entityId: contract.id,
      metadata: { contractNumber, client: client.companyName },
    });
    await logActivity({
      actorId: session.user.id, actorName: session.user.name, type: "CREATED",
      entityType: "CONTRACT", entityId: contract.id,
      title: `Contract ${contractNumber} created`,
    });
    await logActivity({
      actorId: session.user.id, actorName: session.user.name, type: "CONTRACT",
      entityType: "CLIENT", entityId: client.id,
      title: `Contract ${contractNumber} created`,
      description: contract.title,
      metadata: { contractId: contract.id },
    });

    return ok(contract, 201);
  } catch (e) {
    return handleError(e);
  }
}
