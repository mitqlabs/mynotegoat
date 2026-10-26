"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { resolveAuthAccessState } from "@/lib/auth-access";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

export default function AdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [email, setEmail] = useState("");
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      const access = await resolveAuthAccessState();
      if (!active) return;

      if (access.state !== "access-granted" || !access.isAdmin) {
        router.replace("/auth/login");
        return;
      }

      setEmail(access.email ?? "");
      setMounted(true);
    }

    void bootstrap();
    return () => {
      active = false;
    };
  }, [router]);

  const handleSignOut = async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      window.location.href = "/auth/login";
      return;
    }
    setSigningOut(true);
    await supabase.auth.signOut();
    window.location.href = "/auth/login";
  };

  if (!mounted) {
    return (
      <div className="min-h-screen px-4 py-6 text-sm text-[var(--text-muted)] lg:px-8">
        Checking admin access...
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-[1200px] px-3 py-3 lg:px-5 lg:py-5">
        <div className="overflow-hidden rounded-[30px] border border-white/70 bg-white/60 shadow-[0_18px_50px_rgba(16,38,58,0.1)] backdrop-blur-sm">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line-soft)] bg-white/70 px-4 py-4 lg:px-7 lg:py-5">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-muted)]">
                Note Goat
              </div>
              <h1 className="text-2xl font-semibold text-[var(--text-main)]">
                Administration
              </h1>
            </div>
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center rounded-full bg-[var(--bg-soft)] px-4 py-2 text-sm font-semibold text-[var(--text-main)]">
                {email}
              </span>
              <button
                type="button"
                onClick={handleSignOut}
                disabled={signingOut}
                className="btn btn-secondary disabled:opacity-50"
              >
                {signingOut ? "Signing out..." : "Sign Out"}
              </button>
            </div>
          </header>

          <main className="p-4 lg:p-7">{children}</main>
        </div>
      </div>
    </div>
  );
}
