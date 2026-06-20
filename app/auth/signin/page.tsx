// Steam-only sign-in page. Email/password was removed entirely — the only
// auth surface is the Steam OpenID redirect handled by /api/auth/steam.

export const metadata = {
  title: "Sign in",
};

export default function SignInPage() {
  return (
    <main className="mx-auto mt-20 max-w-sm rounded-2xl border border-line bg-panel p-8">
      <h1 className="mb-2 text-xl font-semibold">Sign in</h1>
      <p className="mb-6 text-sm text-muted">
        We use Steam OpenID — no email or password to remember.
      </p>
      <a
        href="/api/auth/steam"
        className="flex items-center justify-center gap-2 rounded-lg bg-[#171a21] px-3 py-2 font-medium text-white hover:bg-[#1f2530]"
      >
        <svg width="18" height="18" viewBox="0 0 256 259" aria-hidden="true">
          <path fill="#fff" d="M127.78 0C60.42 0 5.13 52.2.44 118.65l68.7 28.42a36.4 36.4 0 0 1 20.45-6.27c.65 0 1.3.02 1.93.05l30.56-44.27v-.62c0-26.66 21.69-48.35 48.36-48.35c26.66 0 48.35 21.69 48.35 48.35s-21.69 48.36-48.35 48.36c-.36 0-.72-.01-1.08-.02l-43.56 31.1c.02.54.04 1.09.04 1.64c0 20.16-16.4 36.55-36.56 36.55c-17.7 0-32.5-12.62-35.85-29.34L4.96 164.05c15.22 53.79 64.69 93.21 123.31 93.21c70.69 0 128.01-57.32 128.01-128.02C256.28 57.32 198.96 0 128.27 0h-.5z" />
        </svg>
        <span>Sign in with Steam</span>
      </a>
    </main>
  );
}
