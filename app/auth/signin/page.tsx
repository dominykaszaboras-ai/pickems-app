"use client";
import { useState } from "react";
import { signIn } from "next-auth/react";
import Link from "next/link";

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const res = await signIn("credentials", { email, password, redirect: false });
    setBusy(false);
    if (res?.error) setErr("Invalid credentials");
    else window.location.href = "/";
  }

  return (
    <main className="mx-auto mt-20 max-w-sm rounded-2xl border border-line bg-panel p-8">
      <h1 className="mb-6 text-xl font-semibold">Sign in</h1>
      <form className="flex flex-col gap-3" onSubmit={onSubmit}>
        <input
          className="rounded-lg border border-line bg-panel2 px-3 py-2"
          placeholder="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          className="rounded-lg border border-line bg-panel2 px-3 py-2"
          placeholder="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {err && <div className="text-sm text-loss">{err}</div>}
        <button
          className="rounded-lg bg-accent px-3 py-2 font-medium text-ink disabled:opacity-60"
          disabled={busy}
        >
          {busy ? "Signing in..." : "Sign in"}
        </button>
      </form>
      <p className="mt-4 text-sm text-muted">
        No account?{" "}
        <Link className="text-accent" href="/auth/signup">
          Create one
        </Link>
      </p>
    </main>
  );
}
