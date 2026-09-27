/**
 * APEX SYSTEM — Supabase Auth Seed
 *
 * Creates / syncs all APEX team accounts in Supabase auth.users,
 * then links the Supabase UUID back into the DB User.supabaseId column.
 *
 * Run:
 *   SUPABASE_SERVICE_ROLE_KEY=<key> npx tsx prisma/seed-supabase.ts
 *
 * Or add SUPABASE_SERVICE_ROLE_KEY to .env and just run:
 *   npm run seed:supabase
 *
 * Safe to re-run — uses upsert logic (no duplicates).
 */
import { createClient } from "@supabase/supabase-js";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

// ── Config ────────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PASSWORD = process.env.SEED_ADMIN_PASSWORD || "Apex@2026";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "❌  Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n" +
    "    Add SUPABASE_SERVICE_ROLE_KEY to .env (Supabase → Settings → API → service_role)."
  );
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ── Users to create ───────────────────────────────────────────────────────────
// These must match the emails seeded in prisma/seed.ts
const USERS = [
  { email: "admin@apex.system",   name: "APEX Owner" },
  { email: "sales@apex.system",   name: "APEX Sales" },
  { email: "pm@apex.system",      name: "APEX PM" },
  { email: "dev@apex.system",     name: "APEX Developer" },
  // Portal client user (optional — only if mona.hassan is seeded in DB)
  { email: "mona.hassan@niledigital.eg", name: "Mona Hassan" },
];

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🔐 APEX — Seeding Supabase Auth users (${SUPABASE_URL})\n`);

  for (const u of USERS) {
    // 1. Check if already exists in Supabase Auth
    const { data: list } = await admin.auth.admin.listUsers();
    const existing = list?.users?.find((x) => x.email === u.email);

    let supabaseId: string;

    if (existing) {
      supabaseId = existing.id;
      // Update password so it stays in sync with SEED_ADMIN_PASSWORD
      const { error } = await admin.auth.admin.updateUserById(supabaseId, {
        password: PASSWORD,
        email_confirm: true,
      });
      if (error) {
        console.error(`  ✗ ${u.email} — update failed:`, error.message);
        continue;
      }
      console.log(`  ↻ ${u.email} — updated (id: ${supabaseId.slice(0, 8)}…)`);
    } else {
      // Create new Supabase Auth user
      const { data, error } = await admin.auth.admin.createUser({
        email: u.email,
        password: PASSWORD,
        email_confirm: true, // skip confirmation email for internal accounts
        user_metadata: { name: u.name },
      });
      if (error || !data?.user) {
        console.error(`  ✗ ${u.email} — create failed:`, error?.message);
        continue;
      }
      supabaseId = data.user.id;
      console.log(`  ✔ ${u.email} — created (id: ${supabaseId.slice(0, 8)}…)`);
    }

    // 2. Link supabaseId back to our DB User record
    const dbUser = await db.user.findUnique({ where: { email: u.email } });
    if (!dbUser) {
      console.log(`  ⚠ ${u.email} — no matching DB User (run npm run db:seed first)`);
      continue;
    }
    if (dbUser.supabaseId !== supabaseId) {
      await db.user.update({
        where: { email: u.email },
        data: { supabaseId },
      });
      console.log(`     └─ linked supabaseId → DB User ${dbUser.id.slice(0, 8)}…`);
    } else {
      console.log(`     └─ already linked ✓`);
    }
  }

  console.log("\n✅  Supabase Auth seed complete.\n");
  console.log("  Login credentials:");
  for (const u of USERS) {
    console.log(`    ${u.email.padEnd(36)} password: ${PASSWORD}`);
  }
  console.log("\n  ⚠  Change passwords immediately after first login!\n");
}

main()
  .catch((e) => { console.error("Seed failed:", e); process.exit(1); })
  .finally(() => db.$disconnect());
