import type { DefaultSession, DefaultUser } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      permissions: string[];
      roleKeys: string[];
      avatarColor: string;
      title?: string;
      clientId?: string | null;
    } & DefaultSession["user"];
  }
  interface User extends DefaultUser {
    permissions?: string[];
    roleKeys?: string[];
    avatarColor?: string;
    title?: string;
    clientId?: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    permissions?: string[];
    roleKeys?: string[];
    avatarColor?: string;
    title?: string;
    clientId?: string | null;
  }
}
