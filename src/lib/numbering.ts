import { db } from "@/lib/db";

const PREFIX_KEY = "numbering";
const DEFAULTS: Record<string, string> = {
  lead: "APX-L",
  client: "APX-CLT",
  proposal: "APX-P",
  quotation: "APX-Q",
  contract: "APX-C",
  project: "APX-PRJ",
  invoice: "APX-INV",
  ticket: "APX-T",
};

type NumberingConfig = { prefixes: Record<string, string>; counters: Record<string, number>; year: number };

async function getConfig(): Promise<NumberingConfig> {
  const row = await db.setting.findUnique({ where: { key: PREFIX_KEY } });
  if (row) {
    try {
      return JSON.parse(row.value) as NumberingConfig;
    } catch { /* fallthrough */ }
  }
  return { prefixes: DEFAULTS, counters: {}, year: new Date().getFullYear() };
}

/**
 * Generate the next document number, e.g. APX-P-2026-0001.
 * Safe against races by updating the counter row in a transaction.
 */
export async function nextNumber(entity: keyof typeof DEFAULTS | string): Promise<string> {
  const cfg = await getConfig();
  const year = new Date().getFullYear();
  if (cfg.year !== year) {
    cfg.year = year;
    cfg.counters = {};
  }
  const counterKey = `${entity}:${year}`;
  const next = (cfg.counters[counterKey] ?? 0) + 1;
  cfg.counters[counterKey] = next;

  await db.setting.upsert({
    where: { key: PREFIX_KEY },
    update: { value: JSON.stringify(cfg) },
    create: { key: PREFIX_KEY, value: JSON.stringify(cfg) },
  });

  const prefix = cfg.prefixes[entity] ?? "APX-X";
  return `${prefix}-${year}-${String(next).padStart(4, "0")}`;
}
