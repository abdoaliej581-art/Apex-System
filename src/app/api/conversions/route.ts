import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, ok, handleError, parseBody, logAudit, logActivity, createNotification, ApiError } from "@/lib/api-helpers";
import { nextNumber } from "@/lib/numbering";

/**
 * Smart conversion workflow (§62) — shared by CRM (lead → WON) and Sales (proposal → ACCEPTED).
 * Creates Client (+ primary contact) and optionally a Project with the onboarding checklist.
 */
const BodySchema = z.object({
  leadId: z.string().optional(),
  proposalId: z.string().optional(),
  options: z.object({
    createClient: z.boolean().default(true),
    client: z.object({
      companyName: z.string().min(2, "Company name is required"),
      industry: z.string().optional(),
      location: z.string().optional(),
      website: z.string().optional(),
      email: z.string().optional(),
      phone: z.string().optional(),
    }).optional(),
    contact: z.object({
      name: z.string().min(2, "Contact name is required"),
      position: z.string().optional(),
      email: z.string().optional(),
      phone: z.string().optional(),
    }).optional(),
    createProject: z.boolean().default(false),
    project: z.object({
      name: z.string().min(2, "Project name is required"),
      type: z.string().default("BUSINESS_WEBSITE"),
      managerId: z.string().optional(),
      deadline: z.string().optional(),
      budget: z.number().optional(),
    }).optional(),
    notifyProjectManager: z.boolean().default(true),
  }),
});

export async function POST(req: NextRequest) {
  try {
    const { session } = await requirePermission("clients.create");
    const body = await parseBody(req, BodySchema);
    const actor = { actorId: session.user.id, actorName: session.user.name };

    if (!body.leadId && !body.proposalId) {
      throw new ApiError(400, "MISSING_SOURCE", "Provide a leadId or proposalId to convert from.");
    }

    const lead = body.leadId ? await db.lead.findUnique({ where: { id: body.leadId } }) : null;
    if (body.leadId && !lead) throw new ApiError(404, "NOT_FOUND", "The lead you are converting no longer exists.");
    if (lead?.convertedClientId) throw new ApiError(409, "ALREADY_CONVERTED", "This lead has already been converted to a client.");

    const proposal = body.proposalId ? await db.proposal.findUnique({ where: { id: body.proposalId }, include: { items: true } }) : null;
    if (body.proposalId && !proposal) throw new ApiError(404, "NOT_FOUND", "The proposal no longer exists.");
    if (body.proposalId && proposal!.status === "ACCEPTED") throw new ApiError(409, "ALREADY_CONVERTED", "This proposal is already accepted.");

    const opts = body.options;
    if (opts.createClient && !opts.client) throw new ApiError(400, "VALIDATION_ERROR", "client: Client information is required to create a client.");
    if (opts.createProject && !opts.project) throw new ApiError(400, "VALIDATION_ERROR", "project: Project information is required to create a project.");
    if (opts.createProject && !opts.createClient) throw new ApiError(400, "VALIDATION_ERROR", "A project requires creating (or linking) a client.");

    // FIX (task 3-a): document numbers are pre-computed OUTSIDE the transaction.
    // nextNumber() writes the counter via the global Prisma client — calling it inside an
    // interactive transaction self-deadlocks on SQLite (single-writer lock + 5s engine
    // socket timeout → "Socket timeout" / "Transaction already closed" on every conversion).
    const clientNumber = opts.createClient && opts.client ? await nextNumber("client") : null;
    const projectNumber = opts.createProject && opts.project && opts.createClient ? await nextNumber("project") : null;

    const result = await db.$transaction(async (tx) => {
      // 1. Client
      let client = null as null | { id: string; clientNumber: string };
      if (opts.createClient && opts.client) {
        client = await tx.client.create({
          data: {
            clientNumber: clientNumber!,
            companyName: opts.client.companyName,
            industry: opts.client.industry ?? lead?.industry ?? null,
            location: opts.client.location ?? lead?.location ?? null,
            website: opts.client.website ?? lead?.website ?? null,
            email: opts.client.email ?? lead?.email ?? null,
            phone: opts.client.phone ?? lead?.phone ?? null,
            instagram: lead?.instagram ?? null,
            facebook: lead?.facebook ?? null,
            linkedin: lead?.linkedin ?? null,
            convertedFromLeadId: lead?.id ?? null,
            createdById: session.user.id,
          },
        });
        await tx.activity.create({
          data: { type: "CREATED", actorId: session.user.id, actorName: session.user.name, entityType: "CLIENT", entityId: client.id, title: `Client created from conversion` },
        });
      }

      // 2. Primary contact
      if (client && opts.contact) {
        await tx.contact.create({
          data: { clientId: client.id, name: opts.contact.name, position: opts.contact.position, email: opts.contact.email, phone: opts.contact.phone, isPrimary: true },
        });
      }

      // 3. Project + onboarding checklist + type phases
      let project = null as null | { id: string; projectNumber: string };
      if (client && opts.createProject && opts.project) {
        const settingsRow = await tx.setting.findUnique({ where: { key: "onboardingChecklist" } });
        let checklist: { text: string; isDone: boolean }[] = [];
        try { checklist = JSON.parse(settingsRow?.value || "[]"); } catch { /* ignore */ }

        // Resolve type phases from settings (fallback default list)
        let phaseNames: string[] = ["Discovery", "Requirements", "UI/UX", "Development", "Testing", "Client Review", "Deployment", "Handover"];
        const projectsSetting = await tx.setting.findUnique({ where: { key: "projects" } });
        if (projectsSetting) {
          try {
            const types = (JSON.parse(projectsSetting.value) as { types?: { key: string; phases: string[] }[] }).types;
            const match = types?.find((t) => t.key === opts.project!.type);
            if (match?.phases?.length) phaseNames = match.phases;
          } catch { /* ignore */ }
        }

        project = await tx.project.create({
          data: {
            projectNumber: projectNumber!,
            name: opts.project.name,
            clientId: client!.id,
            type: opts.project.type,
            managerId: opts.project.managerId ?? null,
            budget: opts.project.budget ?? null,
            deadline: opts.project.deadline ? new Date(opts.project.deadline) : null,
            createdById: session.user.id,
            onboardingChecklist: JSON.stringify(checklist.map((c) => ({ ...c, isDone: false }))),
            phases: {
              create: phaseNames.map((name, i) => ({ name, order: i, status: "PENDING" })),
            },
          },
        });
        await tx.activity.create({
          data: { type: "PROJECT", actorId: session.user.id, actorName: session.user.name, entityType: "PROJECT", entityId: project.id, title: `Project created from conversion` },
        });
      }

      // 4. Update source records
      if (lead) {
        await tx.lead.update({
          where: { id: lead.id },
          data: { status: "WON", convertedClientId: client?.id ?? null },
        });
        await tx.activity.create({
          data: {
            type: "STATUS_CHANGED", actorId: session.user.id, actorName: session.user.name,
            entityType: "LEAD", entityId: lead.id,
            title: `Lead won and converted${client ? ` to ${client.clientNumber}` : ""}`,
          },
        });
      }
      if (proposal) {
        await tx.proposal.update({
          where: { id: proposal.id },
          data: { status: "ACCEPTED", respondedAt: new Date(), clientId: proposal.clientId ?? client?.id ?? null },
        });
        await tx.activity.create({
          data: {
            type: "STATUS_CHANGED", actorId: session.user.id, actorName: session.user.name,
            entityType: "PROPOSAL", entityId: proposal.id,
            title: `Proposal ${proposal.proposalNumber} accepted`,
          },
        });
      }

      return { client, project };
    }, { timeout: 30000, maxWait: 10000 });

    // 5. Notifications + audit (outside tx, non-critical)
    if (opts.notifyProjectManager && result.project) {
      const pmId = opts.project?.managerId;
      const title = `New project assigned: ${result.project.projectNumber}`;
      const bodyText = `${opts.project?.name} — created from conversion by ${session.user.name}.`;
      if (pmId) await createNotification({ userId: pmId, type: "PROJECT_CREATED", title, body: bodyText, entityType: "PROJECT", entityId: result.project.id });
      else await db.user.findMany({ where: { isActive: true, roles: { some: { key: { in: ["SUPER_ADMIN", "ADMIN", "PROJECT_MANAGER"] } } } }, select: { id: true } })
        .then((us) => Promise.all(us.map((u) => createNotification({ userId: u.id, type: "PROJECT_CREATED", title, body: bodyText, entityType: "PROJECT", entityId: result.project!.id }))));
    }

    await logAudit({
      ...actor, action: "CONVERT", entityType: lead ? "LEAD" : "PROPOSAL",
      entityId: lead?.id ?? proposal?.id,
      metadata: { clientId: result.client?.id, projectId: result.project?.id },
    });
    if (result.client) {
      await logActivity({ ...actor, type: "STATUS_CHANGED", entityType: "LEAD", entityId: lead?.id ?? "", title: `Converted to client ${result.client.clientNumber}` });
    }

    return ok({
      clientId: result.client?.id ?? null,
      clientNumber: result.client?.clientNumber ?? null,
      projectId: result.project?.id ?? null,
      projectNumber: result.project?.projectNumber ?? null,
    });
  } catch (e) {
    return handleError(e);
  }
}
