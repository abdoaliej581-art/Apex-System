/**
 * APEX SYSTEM — Supabase clients
 *
 * Two clients:
 *  1. `supabaseAnon`  — uses the public anon key. Safe for signInWithPassword
 *     (credentials travel over HTTPS; the anon key only enables auth operations).
 *
 *  2. `supabaseAdmin` — uses the service-role key (bypasses Row Level Security).
 *     Only used server-side for admin tasks: creating/deleting auth users in seed
 *     scripts and the password-change API. NEVER import this in client components.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anon) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
    "Add them to .env and to Vercel environment variables."
  );
}

/** Public client — safe to use in authorize() for signInWithPassword */
export const supabaseAnon = createClient(url, anon, {
  auth: {
    // We manage sessions ourselves via NextAuth JWT; disable Supabase's own
    // persistent session so it doesn't touch localStorage/cookies.
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

/**
 * Admin client — only available server-side when SUPABASE_SERVICE_ROLE_KEY is set.
 * Returns null if the key is absent so build-time imports don't crash.
 */
export const supabaseAdmin = serviceRole
  ? createClient(url, serviceRole, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })
  : null;
