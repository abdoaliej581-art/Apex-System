/**
 * Post-build step.
 *
 * The original build script inlined `cp -r .next/static ...` which is a Unix-only
 * command and fails on Vercel's Linux builders in different ways, and on Windows
 * entirely. On Vercel the platform handles static assets and the server itself, so
 * this script does nothing there.
 *
 * For self-hosting (`output: "standalone"`), Next.js does NOT copy `.next/static`
 * or `public/` into the standalone bundle — they must be copied in, or the app
 * serves 404s for every asset. That copy is done here in portable Node.
 */
import { cp, access } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

const root = process.cwd();
const standalone = path.join(root, ".next", "standalone");

async function exists(p) {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (process.env.VERCEL) {
    console.log("[postbuild] Vercel detected — platform handles assets, nothing to copy.");
    return;
  }
  if (!(await exists(standalone))) {
    console.log("[postbuild] No standalone output — nothing to copy.");
    return;
  }

  const jobs = [
    [path.join(root, ".next", "static"), path.join(standalone, ".next", "static")],
    [path.join(root, "public"), path.join(standalone, "public")],
  ];

  for (const [from, to] of jobs) {
    if (!(await exists(from))) {
      console.log(`[postbuild] skip (missing): ${path.relative(root, from)}`);
      continue;
    }
    await cp(from, to, { recursive: true });
    console.log(`[postbuild] copied ${path.relative(root, from)}`);
  }
}

main().catch((e) => {
  console.error("[postbuild] failed:", e);
  process.exit(1);
});
