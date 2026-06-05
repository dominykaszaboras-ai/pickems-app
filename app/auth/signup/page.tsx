"use client";
import { useState } from "react";
import { signIn } from "next-auth/react";
import Link from "next/link";

export default function SignUpPage() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, name, password }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setErr(data.error ?? "Sign-up failed");
      setBusy(false);
      return;
    }
    await signIn("credentials", { email, password, redirect: false });
    window.location.href = "/";
  }

  return (
    <main className="mx-auto mt-20 max-w-sm rounded-2xl border border-line bg-panel p-8">
      <h1 className="mb-6 text-xl font-semibold">Create account</h1>
      <form className="flex flex-col gap-3" onSubmit={onSubmit}>
        <input className="rounded-lg border border-line bg-panel2 px-3 py-2" placeholder="Display name" value={name} onChange={(e) => setName(e.target.value)} required />
        <input className="rounded-lg border border-line bg-panel2 px-3 py-2" placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input className="rounded-lg border border-line bg-panel2 px-3 py-2" placeholder="Password (8+ chars)" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {err && <div className="text-sm text-loss">{err}</div>}
        <button className="rounded-lg bg-accent px-3 py-2 font-medium text-ink disabled:opacity-60" disabled={busy}>
          {busy ? "Creating..." : "Sign up"}
        </button>
      </form>
      <p className="mt-4 text-sm text-muted">
        Already have one? <Link className="text-accent" href="/auth/signin">Sign in</Link>
      </p>
    </main>
  );
}
