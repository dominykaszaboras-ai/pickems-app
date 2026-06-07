// NextAuth v5 (Auth.js) configuration.
// Exposes: auth, handlers, signIn, signOut.

import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import GitHub from "next-auth/providers/github";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { prisma } from "./db";
import { fetchSteamProfile, verifySignedSteamId } from "./steam";

// Explicit type annotation prevents TS from narrowing the array to
// `CredentialsConfig[]` (which then rejects pushing the OAuth GitHub provider).
const providers: NextAuthConfig["providers"] = [
  Credentials({
    name: "Email & password",
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
    },
    async authorize(creds) {
      const email = String(creds?.email ?? "").toLowerCase().trim();
      const password = String(creds?.password ?? "");
      if (!email || !password) return null;
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user?.passwordHash) return null;
      const ok = await bcrypt.compare(password, user.passwordHash);
      if (!ok) return null;
      return { id: user.id, name: user.name, email: user.email, image: user.image };
    },
  }),
  // Steam — invoked only by /api/auth/steam/callback after Steam OpenID
  // verification succeeds. The `token` field is an HMAC of the SteamID with
  // AUTH_SECRET, so only requests originating from our own callback can
  // pass `authorize`. Direct browser POSTs without a valid HMAC are rejected.
  Credentials({
    id: "steam",
    name: "Steam",
    credentials: { token: { label: "Steam token", type: "text" } },
    async authorize(creds) {
      const token = String(creds?.token ?? "");
      const steamId = verifySignedSteamId(token);
      if (!steamId) return null;
      const profile = await fetchSteamProfile(steamId);
      // Upsert by steamId. We refresh name + image on every login so users
      // who previously got the "Steam XXXX" placeholder (back when we had
      // no profile fetch) update to their real persona on next sign-in.
      const user = await prisma.user.upsert({
        where: { steamId },
        update: {
          name: profile.name ?? undefined,
          image: profile.avatar ?? undefined,
        },
        create: {
          steamId,
          name: profile.name ?? `Steam ${steamId.slice(-4)}`,
          image: profile.avatar ?? null,
        },
      });
      return { id: user.id, name: user.name, email: user.email, image: user.image };
    },
  }),
];

if (process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET) {
  providers.push(
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID,
      clientSecret: process.env.AUTH_GITHUB_SECRET,
    }),
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  providers,
  pages: { signIn: "/auth/signin" },
  callbacks: {
    async session({ session, token }) {
      if (session.user && token.sub) {
        (session.user as any).id = token.sub;
      }
      return session;
    },
  },
});
