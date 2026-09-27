// CRON-8 QA cleanup: remove duplicated test portal users created by the API test
// suite runs (portal<timestamp>@niledigital.eg + mona@niledigital.eg).
// KEEPS mona.hassan@niledigital.eg as the single realistic portal account
// (password Portal@2026). Audit/activity history is preserved (SetNull FKs).
import { db } from "../src/lib/db";

async function main() {
  const keep = "mona.hassan@niledigital.eg";
  const users = await db.user.findMany({
    where: { clientId: { not: null }, email: { not: keep } },
    select: { id: true, email: true },
  });
  console.log(`Removing ${users.length} test portal users (keeping ${keep})`);
  for (const u of users) {
    await db.user.delete({ where: { id: u.id } });
    console.log("  deleted:", u.email);
  }
  const left = await db.user.count({ where: { clientId: { not: null } } });
  console.log(`Remaining portal users: ${left}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => process.exit(0));
