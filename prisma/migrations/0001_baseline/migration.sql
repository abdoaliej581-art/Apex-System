-- APEX SYSTEM — Baseline Migration (PostgreSQL)
-- This migration captures the full schema as-is for production deployment.
-- Generated from prisma/schema.prisma (provider = postgresql)
-- Run: npx prisma migrate deploy  OR  npx prisma db push

-- ============ AUTH & TEAM ============

CREATE TABLE "User" (
    "id"                TEXT NOT NULL,
    "email"             TEXT NOT NULL,
    "name"              TEXT NOT NULL,
    "passwordHash"      TEXT NOT NULL,
    "title"             TEXT,
    "avatarColor"       TEXT NOT NULL DEFAULT '#22d3ee',
    "customPermissions" TEXT,
    "isActive"          BOOLEAN NOT NULL DEFAULT true,
    "skills"            TEXT,
    "clientId"          TEXT,
    "lastLoginAt"       TIMESTAMP(3),
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "User_clientId_idx" ON "User"("clientId");

CREATE TABLE "PasswordResetToken" (
    "id"        TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt"    TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");
CREATE INDEX "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");

CREATE TABLE "Role" (
    "id"          TEXT NOT NULL,
    "key"         TEXT NOT NULL,
    "label"       TEXT NOT NULL,
    "description" TEXT,
    "permissions" TEXT NOT NULL,
    "isSystem"    BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Role_key_key" ON "Role"("key");

-- User ↔ Role many-to-many join table
CREATE TABLE "_UserRoles" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

CREATE UNIQUE INDEX "_UserRoles_AB_unique" ON "_UserRoles"("A", "B");
CREATE INDEX "_UserRoles_B_index" ON "_UserRoles"("B");

-- ============ CRM ============

CREATE TABLE "Lead" (
    "id"                TEXT NOT NULL,
    "leadNumber"        TEXT NOT NULL,
    "companyName"       TEXT NOT NULL,
    "contactName"       TEXT NOT NULL,
    "phone"             TEXT NOT NULL,
    "email"             TEXT,
    "website"           TEXT,
    "instagram"         TEXT,
    "facebook"          TEXT,
    "linkedin"          TEXT,
    "industry"          TEXT,
    "location"          TEXT,
    "source"            TEXT NOT NULL DEFAULT 'OTHER',
    "serviceInterest"   TEXT,
    "estimatedBudget"   DOUBLE PRECISION,
    "priority"          TEXT NOT NULL DEFAULT 'MEDIUM',
    "status"            TEXT NOT NULL DEFAULT 'NEW',
    "notes"             TEXT,
    "nextFollowUpAt"    TIMESTAMP(3),
    "lostReason"        TEXT,
    "convertedClientId" TEXT,
    "assignedToId"      TEXT,
    "createdById"       TEXT,
    "deletedAt"         TIMESTAMP(3),
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Lead_leadNumber_key" ON "Lead"("leadNumber");
CREATE INDEX "Lead_status_idx" ON "Lead"("status");
CREATE INDEX "Lead_assignedToId_idx" ON "Lead"("assignedToId");
CREATE INDEX "Lead_createdAt_idx" ON "Lead"("createdAt");
CREATE INDEX "Lead_companyName_idx" ON "Lead"("companyName");

CREATE TABLE "FollowUp" (
    "id"           TEXT NOT NULL,
    "title"        TEXT NOT NULL,
    "leadId"       TEXT,
    "clientId"     TEXT,
    "assignedToId" TEXT,
    "dueAt"        TIMESTAMP(3) NOT NULL,
    "priority"     TEXT NOT NULL DEFAULT 'MEDIUM',
    "notes"        TEXT,
    "status"       TEXT NOT NULL DEFAULT 'PENDING',
    "completedAt"  TIMESTAMP(3),
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FollowUp_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FollowUp_dueAt_idx" ON "FollowUp"("dueAt");
CREATE INDEX "FollowUp_status_idx" ON "FollowUp"("status");
CREATE INDEX "FollowUp_assignedToId_idx" ON "FollowUp"("assignedToId");

CREATE TABLE "Client" (
    "id"                  TEXT NOT NULL,
    "clientNumber"        TEXT NOT NULL,
    "companyName"         TEXT NOT NULL,
    "industry"            TEXT,
    "location"            TEXT,
    "website"             TEXT,
    "email"               TEXT,
    "phone"               TEXT,
    "instagram"           TEXT,
    "facebook"            TEXT,
    "linkedin"            TEXT,
    "status"              TEXT NOT NULL DEFAULT 'ACTIVE',
    "notes"               TEXT,
    "convertedFromLeadId" TEXT,
    "createdById"         TEXT,
    "archivedAt"          TIMESTAMP(3),
    "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"           TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Client_clientNumber_key" ON "Client"("clientNumber");
CREATE INDEX "Client_status_idx" ON "Client"("status");
CREATE INDEX "Client_companyName_idx" ON "Client"("companyName");
CREATE INDEX "Client_createdAt_idx" ON "Client"("createdAt");

CREATE TABLE "Contact" (
    "id"              TEXT NOT NULL,
    "clientId"        TEXT NOT NULL,
    "name"            TEXT NOT NULL,
    "position"        TEXT,
    "email"           TEXT,
    "phone"           TEXT,
    "preferredMethod" TEXT,
    "isPrimary"       BOOLEAN NOT NULL DEFAULT false,
    "notes"           TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Contact_clientId_idx" ON "Contact"("clientId");

CREATE TABLE "Activity" (
    "id"          TEXT NOT NULL,
    "type"        TEXT NOT NULL,
    "actorId"     TEXT,
    "actorName"   TEXT,
    "entityType"  TEXT NOT NULL,
    "entityId"    TEXT NOT NULL,
    "title"       TEXT NOT NULL,
    "description" TEXT,
    "metadata"    TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Activity_entityType_entityId_idx" ON "Activity"("entityType", "entityId");
CREATE INDEX "Activity_createdAt_idx" ON "Activity"("createdAt");

-- ============ SALES ============

CREATE TABLE "Meeting" (
    "id"           TEXT NOT NULL,
    "title"        TEXT NOT NULL,
    "leadId"       TEXT,
    "clientId"     TEXT,
    "projectId"    TEXT,
    "date"         TIMESTAMP(3) NOT NULL,
    "startTime"    TEXT NOT NULL,
    "endTime"      TEXT NOT NULL,
    "location"     TEXT,
    "meetingLink"  TEXT,
    "notes"        TEXT,
    "outcome"      TEXT,
    "nextAction"   TEXT,
    "status"       TEXT NOT NULL DEFAULT 'SCHEDULED',
    "participants" TEXT,
    "createdById"  TEXT,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Meeting_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Meeting_date_idx" ON "Meeting"("date");
CREATE INDEX "Meeting_status_idx" ON "Meeting"("status");

CREATE TABLE "Proposal" (
    "id"               TEXT NOT NULL,
    "proposalNumber"   TEXT NOT NULL,
    "leadId"           TEXT,
    "clientId"         TEXT,
    "title"            TEXT NOT NULL,
    "problem"          TEXT,
    "solution"         TEXT,
    "scope"            TEXT,
    "timeline"         TEXT,
    "deliverables"     TEXT,
    "validUntil"       TIMESTAMP(3),
    "status"           TEXT NOT NULL DEFAULT 'DRAFT',
    "currency"         TEXT NOT NULL DEFAULT 'EGP',
    "subtotal"         DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discountAmount"   DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxPercent"       DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total"            DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paymentTerms"     TEXT,
    "revisionPolicy"   TEXT,
    "maintenanceTerms" TEXT,
    "terms"            TEXT,
    "notes"            TEXT,
    "sentAt"           TIMESTAMP(3),
    "respondedAt"      TIMESTAMP(3),
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Proposal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Proposal_proposalNumber_key" ON "Proposal"("proposalNumber");
CREATE INDEX "Proposal_status_idx" ON "Proposal"("status");
CREATE INDEX "Proposal_createdAt_idx" ON "Proposal"("createdAt");

CREATE TABLE "ProposalItem" (
    "id"          TEXT NOT NULL,
    "proposalId"  TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity"    DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unitPrice"   DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total"       DOUBLE PRECISION NOT NULL DEFAULT 0,
    "order"       INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ProposalItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProposalItem_proposalId_idx" ON "ProposalItem"("proposalId");

CREATE TABLE "Quotation" (
    "id"              TEXT NOT NULL,
    "quotationNumber" TEXT NOT NULL,
    "leadId"          TEXT,
    "clientId"        TEXT,
    "title"           TEXT NOT NULL,
    "currency"        TEXT NOT NULL DEFAULT 'EGP',
    "subtotal"        DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discountAmount"  DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxPercent"      DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total"           DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paymentTerms"    TEXT,
    "validUntil"      TIMESTAMP(3),
    "status"          TEXT NOT NULL DEFAULT 'DRAFT',
    "notes"           TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Quotation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Quotation_quotationNumber_key" ON "Quotation"("quotationNumber");
CREATE INDEX "Quotation_status_idx" ON "Quotation"("status");

CREATE TABLE "QuotationItem" (
    "id"          TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity"    DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unitPrice"   DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total"       DOUBLE PRECISION NOT NULL DEFAULT 0,
    "order"       INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "QuotationItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "QuotationItem_quotationId_idx" ON "QuotationItem"("quotationId");

CREATE TABLE "Contract" (
    "id"               TEXT NOT NULL,
    "contractNumber"   TEXT NOT NULL,
    "clientId"         TEXT NOT NULL,
    "projectId"        TEXT,
    "proposalId"       TEXT,
    "title"            TEXT NOT NULL,
    "scope"            TEXT,
    "deliverables"     TEXT,
    "timeline"         TEXT,
    "paymentTerms"     TEXT,
    "revisionTerms"    TEXT,
    "maintenanceTerms" TEXT,
    "startDate"        TIMESTAMP(3),
    "endDate"          TIMESTAMP(3),
    "status"           TEXT NOT NULL DEFAULT 'DRAFT',
    "signedDate"       TIMESTAMP(3),
    "documentUrl"      TEXT,
    "notes"            TEXT,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Contract_contractNumber_key" ON "Contract"("contractNumber");
CREATE INDEX "Contract_status_idx" ON "Contract"("status");
CREATE INDEX "Contract_clientId_idx" ON "Contract"("clientId");

-- ============ PROJECTS ============

CREATE TABLE "Project" (
    "id"                  TEXT NOT NULL,
    "projectNumber"       TEXT NOT NULL,
    "name"                TEXT NOT NULL,
    "clientId"            TEXT NOT NULL,
    "description"         TEXT,
    "type"                TEXT NOT NULL DEFAULT 'BUSINESS_WEBSITE',
    "managerId"           TEXT,
    "status"              TEXT NOT NULL DEFAULT 'PLANNING',
    "priority"            TEXT NOT NULL DEFAULT 'MEDIUM',
    "budget"              DOUBLE PRECISION,
    "progress"            INTEGER NOT NULL DEFAULT 0,
    "health"              TEXT NOT NULL DEFAULT 'ON_TRACK',
    "startDate"           TIMESTAMP(3),
    "deadline"            TIMESTAMP(3),
    "onboardingChecklist" TEXT,
    "completionChecklist" TEXT,
    "createdById"         TEXT,
    "archivedAt"          TIMESTAMP(3),
    "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"           TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Project_projectNumber_key" ON "Project"("projectNumber");
CREATE INDEX "Project_status_idx" ON "Project"("status");
CREATE INDEX "Project_clientId_idx" ON "Project"("clientId");
CREATE INDEX "Project_managerId_idx" ON "Project"("managerId");

CREATE TABLE "ProjectMember" (
    "id"        TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "role"      TEXT NOT NULL DEFAULT 'MEMBER',
    CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectMember_projectId_userId_key" ON "ProjectMember"("projectId", "userId");

CREATE TABLE "ProjectPhase" (
    "id"        TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name"      TEXT NOT NULL,
    "order"     INTEGER NOT NULL DEFAULT 0,
    "status"    TEXT NOT NULL DEFAULT 'PENDING',
    CONSTRAINT "ProjectPhase_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProjectPhase_projectId_idx" ON "ProjectPhase"("projectId");

CREATE TABLE "Task" (
    "id"             TEXT NOT NULL,
    "title"          TEXT NOT NULL,
    "description"    TEXT,
    "projectId"      TEXT,
    "phaseId"        TEXT,
    "assigneeId"     TEXT,
    "reporterId"     TEXT,
    "priority"       TEXT NOT NULL DEFAULT 'MEDIUM',
    "status"         TEXT NOT NULL DEFAULT 'BACKLOG',
    "dueDate"        TIMESTAMP(3),
    "estimatedHours" DOUBLE PRECISION,
    "actualHours"    DOUBLE PRECISION,
    "labels"         TEXT,
    "position"       INTEGER NOT NULL DEFAULT 0,
    "completedAt"    TIMESTAMP(3),
    "deletedAt"      TIMESTAMP(3),
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Task_status_idx" ON "Task"("status");
CREATE INDEX "Task_assigneeId_idx" ON "Task"("assigneeId");
CREATE INDEX "Task_projectId_idx" ON "Task"("projectId");
CREATE INDEX "Task_dueDate_idx" ON "Task"("dueDate");

CREATE TABLE "TaskComment" (
    "id"        TEXT NOT NULL,
    "taskId"    TEXT NOT NULL,
    "authorId"  TEXT,
    "body"      TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskComment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TaskComment_taskId_idx" ON "TaskComment"("taskId");

CREATE TABLE "TaskChecklistItem" (
    "id"     TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "text"   TEXT NOT NULL,
    "isDone" BOOLEAN NOT NULL DEFAULT false,
    "order"  INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "TaskChecklistItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TaskChecklistItem_taskId_idx" ON "TaskChecklistItem"("taskId");

-- ============ FILES ============

CREATE TABLE "FileRecord" (
    "id"           TEXT NOT NULL,
    "filename"     TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "size"         INTEGER NOT NULL DEFAULT 0,
    "mimeType"     TEXT,
    "entityType"   TEXT NOT NULL,
    "entityId"     TEXT NOT NULL,
    "version"      INTEGER NOT NULL DEFAULT 1,
    "storagePath"  TEXT,
    "uploaderId"   TEXT,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FileRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FileRecord_entityType_entityId_idx" ON "FileRecord"("entityType", "entityId");

-- ============ FINANCE ============

CREATE TABLE "Invoice" (
    "id"             TEXT NOT NULL,
    "invoiceNumber"  TEXT NOT NULL,
    "clientId"       TEXT NOT NULL,
    "projectId"      TEXT,
    "issueDate"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate"        TIMESTAMP(3),
    "status"         TEXT NOT NULL DEFAULT 'DRAFT',
    "currency"       TEXT NOT NULL DEFAULT 'EGP',
    "subtotal"       DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discountAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxPercent"     DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total"          DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paidAmount"     DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paymentTerms"   TEXT,
    "notes"          TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber");
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");
CREATE INDEX "Invoice_clientId_idx" ON "Invoice"("clientId");
CREATE INDEX "Invoice_dueDate_idx" ON "Invoice"("dueDate");

CREATE TABLE "InvoiceItem" (
    "id"          TEXT NOT NULL,
    "invoiceId"   TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity"    DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unitPrice"   DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total"       DOUBLE PRECISION NOT NULL DEFAULT 0,
    "order"       INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "InvoiceItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InvoiceItem_invoiceId_idx" ON "InvoiceItem"("invoiceId");

CREATE TABLE "Payment" (
    "id"           TEXT NOT NULL,
    "invoiceId"    TEXT,
    "clientId"     TEXT,
    "amount"       DOUBLE PRECISION NOT NULL,
    "date"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "method"       TEXT NOT NULL DEFAULT 'BANK_TRANSFER',
    "reference"    TEXT,
    "notes"        TEXT,
    "recordedById" TEXT,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Payment_date_idx" ON "Payment"("date");
CREATE INDEX "Payment_invoiceId_idx" ON "Payment"("invoiceId");

CREATE TABLE "Expense" (
    "id"            TEXT NOT NULL,
    "category"      TEXT NOT NULL DEFAULT 'OTHER',
    "description"   TEXT NOT NULL,
    "amount"        DOUBLE PRECISION NOT NULL,
    "date"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vendor"        TEXT,
    "projectId"     TEXT,
    "receiptFileId" TEXT,
    "createdById"   TEXT,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Expense_category_idx" ON "Expense"("category");
CREATE INDEX "Expense_date_idx" ON "Expense"("date");

-- ============ MARKETING ============

CREATE TABLE "Campaign" (
    "id"        TEXT NOT NULL,
    "name"      TEXT NOT NULL,
    "objective" TEXT,
    "audience"  TEXT,
    "platform"  TEXT,
    "startDate" TIMESTAMP(3),
    "endDate"   TIMESTAMP(3),
    "budget"    DOUBLE PRECISION,
    "status"    TEXT NOT NULL DEFAULT 'PLANNING',
    "notes"     TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Campaign_status_idx" ON "Campaign"("status");

CREATE TABLE "Content" (
    "id"          TEXT NOT NULL,
    "title"       TEXT NOT NULL,
    "platform"    TEXT NOT NULL DEFAULT 'INSTAGRAM',
    "contentType" TEXT NOT NULL DEFAULT 'POST',
    "caption"     TEXT,
    "cta"         TEXT,
    "hashtags"    TEXT,
    "mediaUrl"    TEXT,
    "publishDate" TIMESTAMP(3),
    "status"      TEXT NOT NULL DEFAULT 'IDEA',
    "authorId"    TEXT,
    "reviewerId"  TEXT,
    "campaignId"  TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Content_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Content_status_idx" ON "Content"("status");
CREATE INDEX "Content_publishDate_idx" ON "Content"("publishDate");
CREATE INDEX "Content_authorId_idx" ON "Content"("authorId");
CREATE INDEX "Content_campaignId_idx" ON "Content"("campaignId");

-- ============ SUPPORT ============

CREATE TABLE "Ticket" (
    "id"           TEXT NOT NULL,
    "ticketNumber" TEXT NOT NULL,
    "clientId"     TEXT NOT NULL,
    "projectId"    TEXT,
    "category"     TEXT NOT NULL DEFAULT 'OTHER',
    "priority"     TEXT NOT NULL DEFAULT 'MEDIUM',
    "subject"      TEXT NOT NULL,
    "description"  TEXT,
    "assignedToId" TEXT,
    "status"       TEXT NOT NULL DEFAULT 'OPEN',
    "closedAt"     TIMESTAMP(3),
    "deletedAt"    TIMESTAMP(3),
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Ticket_ticketNumber_key" ON "Ticket"("ticketNumber");
CREATE INDEX "Ticket_status_idx" ON "Ticket"("status");
CREATE INDEX "Ticket_clientId_idx" ON "Ticket"("clientId");
CREATE INDEX "Ticket_deletedAt_idx" ON "Ticket"("deletedAt");

CREATE TABLE "TicketMessage" (
    "id"         TEXT NOT NULL,
    "ticketId"   TEXT NOT NULL,
    "authorId"   TEXT,
    "authorName" TEXT,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "body"       TEXT NOT NULL,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TicketMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TicketMessage_ticketId_idx" ON "TicketMessage"("ticketId");

CREATE TABLE "MaintenancePlan" (
    "id"            TEXT NOT NULL,
    "clientId"      TEXT NOT NULL,
    "projectId"     TEXT,
    "plan"          TEXT NOT NULL DEFAULT 'STANDARD',
    "startDate"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate"       TIMESTAMP(3),
    "includedHours" DOUBLE PRECISION,
    "usedHours"     DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status"        TEXT NOT NULL DEFAULT 'ACTIVE',
    "notes"         TEXT,
    "deletedAt"     TIMESTAMP(3),
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MaintenancePlan_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MaintenancePlan_status_idx" ON "MaintenancePlan"("status");
CREATE INDEX "MaintenancePlan_clientId_idx" ON "MaintenancePlan"("clientId");
CREATE INDEX "MaintenancePlan_deletedAt_idx" ON "MaintenancePlan"("deletedAt");

CREATE TABLE "MaintenanceLog" (
    "id"           TEXT NOT NULL,
    "planId"       TEXT NOT NULL,
    "hours"        DOUBLE PRECISION NOT NULL,
    "note"         TEXT,
    "loggedById"   TEXT,
    "loggedByName" TEXT,
    "spentOn"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MaintenanceLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MaintenanceLog_planId_idx" ON "MaintenanceLog"("planId");

-- ============ PLATFORM ============

CREATE TABLE "Notification" (
    "id"         TEXT NOT NULL,
    "userId"     TEXT NOT NULL,
    "type"       TEXT NOT NULL,
    "title"      TEXT NOT NULL,
    "body"       TEXT,
    "entityType" TEXT,
    "entityId"   TEXT,
    "isRead"     BOOLEAN NOT NULL DEFAULT false,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Notification_userId_isRead_idx" ON "Notification"("userId", "isRead");
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

CREATE TABLE "KnowledgeArticle" (
    "id"         TEXT NOT NULL,
    "title"      TEXT NOT NULL,
    "category"   TEXT NOT NULL DEFAULT 'OPERATIONS',
    "content"    TEXT NOT NULL,
    "authorId"   TEXT,
    "version"    INTEGER NOT NULL DEFAULT 1,
    "visibility" TEXT NOT NULL DEFAULT 'INTERNAL',
    "deletedAt"  TIMESTAMP(3),
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"  TIMESTAMP(3) NOT NULL,
    CONSTRAINT "KnowledgeArticle_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "KnowledgeArticle_category_idx" ON "KnowledgeArticle"("category");
CREATE INDEX "KnowledgeArticle_deletedAt_idx" ON "KnowledgeArticle"("deletedAt");
CREATE INDEX "KnowledgeArticle_authorId_idx" ON "KnowledgeArticle"("authorId");

CREATE TABLE "Automation" (
    "id"          TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "description" TEXT,
    "trigger"     TEXT NOT NULL,
    "condition"   TEXT,
    "config"      TEXT,
    "actions"     TEXT,
    "isActive"    BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt"   TIMESTAMP(3),
    "runCount"    INTEGER NOT NULL DEFAULT 0,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Automation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Automation_trigger_isActive_idx" ON "Automation"("trigger", "isActive");

CREATE TABLE "AuditLog" (
    "id"         TEXT NOT NULL,
    "actorId"    TEXT,
    "actorName"  TEXT,
    "action"     TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId"   TEXT,
    "metadata"   TEXT,
    "ip"         TEXT,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

CREATE TABLE "Setting" (
    "key"       TEXT NOT NULL,
    "value"     TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- ============ FOREIGN KEYS ============

ALTER TABLE "User" ADD CONSTRAINT "User_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "_UserRoles" ADD CONSTRAINT "_UserRoles_A_fkey"
    FOREIGN KEY ("A") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_UserRoles" ADD CONSTRAINT "_UserRoles_B_fkey"
    FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Lead" ADD CONSTRAINT "Lead_assignedToId_fkey"
    FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_assignedToId_fkey"
    FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Contact" ADD CONSTRAINT "Contact_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Activity" ADD CONSTRAINT "Activity_actorId_fkey"
    FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProposalItem" ADD CONSTRAINT "ProposalItem_proposalId_fkey"
    FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "QuotationItem" ADD CONSTRAINT "QuotationItem_quotationId_fkey"
    FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Contract" ADD CONSTRAINT "Contract_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_proposalId_fkey"
    FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Project" ADD CONSTRAINT "Project_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Project" ADD CONSTRAINT "Project_managerId_fkey"
    FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectPhase" ADD CONSTRAINT "ProjectPhase_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Task" ADD CONSTRAINT "Task_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_phaseId_fkey"
    FOREIGN KEY ("phaseId") REFERENCES "ProjectPhase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_assigneeId_fkey"
    FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_reporterId_fkey"
    FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TaskChecklistItem" ADD CONSTRAINT "TaskChecklistItem_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_recordedById_fkey"
    FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Expense" ADD CONSTRAINT "Expense_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Content" ADD CONSTRAINT "Content_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Content" ADD CONSTRAINT "Content_reviewerId_fkey"
    FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Content" ADD CONSTRAINT "Content_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_assignedToId_fkey"
    FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TicketMessage" ADD CONSTRAINT "TicketMessage_ticketId_fkey"
    FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MaintenancePlan" ADD CONSTRAINT "MaintenancePlan_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MaintenancePlan" ADD CONSTRAINT "MaintenancePlan_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MaintenanceLog" ADD CONSTRAINT "MaintenanceLog_planId_fkey"
    FOREIGN KEY ("planId") REFERENCES "MaintenancePlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MaintenanceLog" ADD CONSTRAINT "MaintenanceLog_loggedById_fkey"
    FOREIGN KEY ("loggedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "KnowledgeArticle" ADD CONSTRAINT "KnowledgeArticle_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey"
    FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
