import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { db } from "@/lib/db";
import { resolvePermissions } from "@/lib/permissions";
import { supabaseAnon } from "@/lib/supabase";

export const SESSION_MAX_AGE = 60 * 60 * 8; // 8 hours

function resolveSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET?.trim();
  if (secret && secret.length >= 32) return secret;
  if (secret && secret.length > 0 && secret.length < 32) {
    throw new Error(
      `NEXTAUTH_SECRET is too short (${secret.length} chars). Generate one with: openssl rand -base64 32`
    );
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "NEXTAUTH_SECRET is required in production. Set it in Vercel → Settings → Environment Variables."
    );
  }
  return crypto.randomUUID() + crypto.randomUUID();
}

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE },
  secret: resolveSecret(),
  pages: { signIn: "/" },
  providers: [
    CredentialsProvider({
      name: "APEX Account",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        const email = credentials.email.toLowerCase().trim();

        // ── Step 1: Verify credentials with Supabase Auth ──────────────────────
        // signInWithPassword validates against Supabase's auth.users table.
        // We use the anon client with persistSession:false — no cookies are set,
        // we only care about the success/failure result.
        const { data: authData, error: authError } = await supabaseAnon.auth.signInWithPassword({
          email,
          password: credentials.password,
        });

        if (authError || !authData?.user) {
          // Wrong credentials or unconfirmed account
          return null;
        }

        // ── Step 2: Load the APEX User record from our DB ─────────────────────
        // The Supabase auth user is linked by email (and optionally supabaseId).
        const user = await db.user.findUnique({
          where: { email },
          include: { roles: true },
        });

        if (!user || !user.isActive) return null;

        // Sync supabaseId on first login if not yet stored
        if (!user.supabaseId && authData.user.id) {
          await db.user.update({
            where: { id: user.id },
            data: { supabaseId: authData.user.id },
          }).catch(() => undefined); // non-fatal
        }

        // ── Step 3: Update lastLoginAt + audit ───────────────────────────────
        await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
        await db.auditLog.create({
          data: {
            actorId: user.id,
            actorName: user.name,
            action: "LOGIN",
            entityType: "USER",
            entityId: user.id,
            metadata: JSON.stringify({ email, provider: "supabase" }),
          },
        }).catch(() => undefined);

        // ── Step 4: Resolve permissions and return NextAuth user object ────────
        const permissions = resolvePermissions(
          user.roles.map((r) => ({ permissions: r.permissions })),
          user.customPermissions
        );

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: null,
          permissions,
          roleKeys: user.roles.map((r) => r.key),
          avatarColor: user.avatarColor,
          title: user.title,
          clientId: user.clientId,
        } as unknown as import("next-auth").User;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        token.id = (user as unknown as { id: string }).id;
        token.permissions = (user as unknown as { permissions: string[] }).permissions;
        token.roleKeys = (user as unknown as { roleKeys: string[] }).roleKeys;
        token.avatarColor = (user as unknown as { avatarColor: string }).avatarColor;
        token.title = (user as unknown as { title?: string }).title;
        token.clientId = (user as unknown as { clientId?: string | null }).clientId ?? null;
      }
      if (trigger === "update") {
        const dbUser = await db.user.findUnique({
          where: { id: token.id as string },
          include: { roles: true },
        });
        if (dbUser) {
          token.permissions = resolvePermissions(
            dbUser.roles.map((r) => ({ permissions: r.permissions })),
            dbUser.customPermissions
          );
          token.clientId = dbUser.clientId;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.permissions = (token.permissions as string[]) || [];
        session.user.roleKeys = (token.roleKeys as string[]) || [];
        session.user.avatarColor = (token.avatarColor as string) || "#22d3ee";
        session.user.title = token.title as string | undefined;
        session.user.clientId = (token.clientId as string | null) ?? null;
      }
      return session;
    },
  },
};
