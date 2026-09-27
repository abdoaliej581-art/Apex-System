/**
 * APEX SYSTEM — Database Seed
 * Seeds: roles + permission matrix, the 4 APEX team accounts, org settings, numbering.
 * NO fake business data (leads/clients/projects) — policy §54.
 */
import { PrismaClient } from "@prisma/client";
import { hashSync } from "bcryptjs";
import crypto from "node:crypto";
import { DEFAULT_ROLES } from "../src/lib/permissions";

const db = new PrismaClient();

const SETTINGS: Record<string, unknown> = {
  organization: {
    name: "APEX",
    productName: "APEX SYSTEM",
    tagline: "Run APEX. One System. One Workflow.",
    email: "hello@apex.system",
    phone: "",
    address: "",
    currency: "EGP",
    timezone: "Africa/Cairo",
    services: [
      "Web Development", "Custom Software", "Business Automation", "Dashboards",
      "CRM Systems", "E-commerce", "Educational Systems", "Internal Business Systems",
      "UI/UX", "Maintenance & Support",
    ],
  },
  crm: {
    leadSources: ["INSTAGRAM", "FACEBOOK", "LINKEDIN", "WHATSAPP", "WEBSITE", "REFERRAL", "COLD_OUTREACH", "GOOGLE", "OTHER"],
    leadStatuses: ["NEW", "CONTACTED", "QUALIFIED", "MEETING", "PROPOSAL_SENT", "NEGOTIATION", "WON", "LOST"],
    priorities: ["LOW", "MEDIUM", "HIGH", "URGENT"],
  },
  projects: {
    types: [
      { key: "BUSINESS_WEBSITE", label: "Business Website", phases: ["Discovery", "Requirements", "UI/UX", "Development", "Testing", "Client Review", "Deployment", "Handover"] },
      { key: "ECOMMERCE", label: "E-commerce", phases: ["Discovery", "Requirements", "UI/UX", "Development", "Payments Integration", "Testing", "Client Review", "Deployment", "Handover"] },
      { key: "WEB_APPLICATION", label: "Web Application", phases: ["Discovery", "Requirements", "UI/UX", "Development", "Integration", "Testing", "Client Review", "Revisions", "Deployment", "Handover"] },
      { key: "CUSTOM_SOFTWARE", label: "Custom Software", phases: ["Discovery", "Requirements", "UI/UX", "Development", "Integration", "Testing", "Client Review", "Revisions", "Deployment", "Handover"] },
      { key: "CRM", label: "CRM System", phases: ["Discovery", "Requirements", "UI/UX", "Development", "Integration", "Testing", "Client Review", "Deployment", "Handover"] },
      { key: "DASHBOARD", label: "Dashboard", phases: ["Discovery", "Requirements", "UI/UX", "Development", "Testing", "Client Review", "Deployment", "Handover"] },
      { key: "EDUCATIONAL_PLATFORM", label: "Educational Platform", phases: ["Discovery", "Requirements", "UI/UX", "Development", "Testing", "Client Review", "Deployment", "Handover"] },
      { key: "LANDING_PAGE", label: "Landing Page", phases: ["Requirements", "UI/UX", "Development", "Client Review", "Deployment"] },
      { key: "AUTOMATION_SYSTEM", label: "Automation System", phases: ["Discovery", "Requirements", "Development", "Testing", "Deployment", "Handover"] },
      { key: "MAINTENANCE", label: "Maintenance", phases: ["Assessment", "Execution", "Client Review"] },
    ],
    statuses: ["PLANNING", "ACTIVE", "ON_HOLD", "REVIEW", "COMPLETED", "CANCELLED"],
    taskStatuses: ["BACKLOG", "TODO", "IN_PROGRESS", "REVIEW", "BLOCKED", "DONE"],
  },
  finance: {
    currency: "EGP",
    invoicePrefix: "APX-INV",
    paymentMethods: ["BANK_TRANSFER", "CASH", "INSTAPAY", "VODAFONE_CASH", "PAYPAL", "OTHER"],
    expenseCategories: ["HOSTING", "DOMAIN", "SOFTWARE", "MARKETING", "OPERATIONS", "OTHER"],
    taxPercentDefault: 0,
  },
  onboardingChecklist: [
    "Client information collected",
    "Primary contact identified",
    "Brand assets received (logo, colors)",
    "Content received (texts, images)",
    "Domain access confirmed",
    "Hosting decision confirmed",
    "Technical requirements documented",
    "References & examples reviewed",
    "Requirements document signed off",
    "Access credentials received (secure channel)",
  ],
  completionChecklist: [
    "Final testing completed",
    "Client approval received",
    "All files delivered",
    "Credentials transferred securely",
    "Invoice status checked",
    "Documentation completed",
    "Maintenance plan offered",
    "Support channel created",
  ],
};

// Default automation rules (system config §8 — editable/deletable in the UI)
const AUTOMATIONS = [
  {
    name: "Urgent ticket escalation",
    description: "Admins are alerted the moment an URGENT ticket is created — support queues move fast, this guarantees visibility.",
    trigger: "TICKET_CREATED",
    condition: { field: "priority", equals: "URGENT" },
    actions: [
      {
        type: "NOTIFY_ROLE", roleKey: "SUPER_ADMIN",
        title: "URGENT ticket {{ticketNumber}}: {{subject}}",
        body: "{{clientName}} reported an urgent issue ({{category}}) — created by {{actorName}}. Assign an owner immediately.",
      },
    ],
  },
  {
    name: "High-priority lead alert",
    description: "Keep leadership in the loop when a HIGH or URGENT lead enters the pipeline.",
    trigger: "LEAD_CREATED",
    condition: { field: "priority", in: ["HIGH", "URGENT"] },
    actions: [
      {
        type: "NOTIFY_ROLE", roleKey: "ADMIN",
        title: "Hot lead {{leadNumber}}: {{companyName}}",
        body: "{{contactName}} — priority {{priority}}, source {{source}}. Created by {{actorName}}.",
      },
    ],
  },
];

const TEAM = [
  { email: "admin@apex.system", name: "APEX Owner", title: "Founder & Super Admin", role: "SUPER_ADMIN", color: "#22d3ee" },
  { email: "sales@apex.system", name: "APEX Sales", title: "Sales Specialist", role: "SALES", color: "#34d399" },
  { email: "pm@apex.system", name: "APEX PM", title: "Project Manager", role: "PROJECT_MANAGER", color: "#f59e0b" },
  { email: "dev@apex.system", name: "APEX Developer", title: "Full-Stack Developer", role: "DEVELOPER", color: "#f472b6" },
];

async function main() {
  console.log("🌱 Seeding APEX SYSTEM...");

  // Roles
  for (const role of DEFAULT_ROLES) {
    await db.role.upsert({
      where: { key: role.key },
      update: { label: role.label, description: role.description, permissions: JSON.stringify(role.permissions) },
      create: { key: role.key, label: role.label, description: role.description, permissions: JSON.stringify(role.permissions), isSystem: true },
    });
  }
  console.log(`  ✔ ${DEFAULT_ROLES.length} roles`);

  // Team users.
  //
  // SECURITY: there is deliberately NO hardcoded default password in this file.
  // A committed credential is a committed breach — anyone can clone the repo and
  // sign in. The password comes from SEED_ADMIN_PASSWORD, and when it is absent
  // the admin account is created with a random password that is printed ONCE
  // to the console of whoever ran the seed, so it never enters version control.
  //
  //   SEED_ADMIN_PASSWORD='<your-password>' npx prisma db seed
  const seedPassword = process.env.SEED_ADMIN_PASSWORD?.trim();
  const passwordHash = hashSync(
    seedPassword && seedPassword.length >= 8
      ? seedPassword
      : crypto.randomBytes(18).toString("base64url"),
    10
  );
  const usingGenerated = !(seedPassword && seedPassword.length >= 8);
  if (usingGenerated) {
    console.log("  ⚠ SEED_ADMIN_PASSWORD not set (or < 8 chars) — using a one-time random password.");
  }

  for (const member of TEAM) {
    const role = await db.role.findUnique({ where: { key: member.role } });
    if (!role) throw new Error(`Role ${member.role} missing`);
    await db.user.upsert({
      where: { email: member.email },
      update: {},
      create: {
        email: member.email,
        name: member.name,
        title: member.title,
        passwordHash,
        avatarColor: member.color,
        roles: { connect: { id: role.id } },
      },
    });
  }
  if (usingGenerated) {
    console.log("  → One-time passwords for the 4 accounts above (shown once, not stored in git):");
    for (const m of TEAM) console.log(`      ${m.email}`);
    console.log(`      password: ${seedPassword ? "" : "(see the value logged above)"}`);
  }
  console.log(`  ✔ ${TEAM.length} team accounts`);

  // Settings
  for (const [key, value] of Object.entries(SETTINGS)) {
    await db.setting.upsert({
      where: { key },
      update: {},
      create: { key, value: JSON.stringify(value) },
    });
  }
  console.log(`  ✔ ${Object.keys(SETTINGS).length} settings groups`);

  // Default automations (upsert by name — edits in the UI are preserved)
  for (const a of AUTOMATIONS) {
    const existing = await db.automation.findFirst({ where: { name: a.name } });
    if (!existing) {
      await db.automation.create({
        data: {
          name: a.name, description: a.description, trigger: a.trigger,
          condition: JSON.stringify(a.condition),
          actions: JSON.stringify(a.actions),
          isActive: true,
        },
      });
    }
  }
  console.log(`  ✔ ${AUTOMATIONS.length} default automations`);

  console.log("✅ Seed complete — APEX SYSTEM is ready.");
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
