"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";
import { resolveAuthAccessState } from "@/lib/auth-access";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

type LoginClientProps = {
  verifyNotice: boolean;
};

export default function LoginClient({ verifyNotice }: LoginClientProps) {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);

  const supabaseMissing = useMemo(() => !getSupabaseBrowserClient(), []);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setMessage("");

    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setError("Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
      return;
    }

    setLoading(true);

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (signInError) {
      setLoading(false);
      setError(signInError.message);
      return;
    }

    const access = await resolveAuthAccessState();
    setLoading(false);

    if (access.state === "access-granted" && access.isAdmin) {
      router.replace("/admin");
      return;
    }

    if (access.state === "access-granted") {
      router.replace("/patients");
      return;
    }

    if (access.state === "pending-approval") {
      router.replace("/auth/pending");
      return;
    }

    if (access.state === "email-unverified") {
      setMessage("Your email is not verified yet. Check your inbox and click the verification link first.");
      return;
    }

    setError(access.errorMessage || "We could not complete login. Please try again.");
  };

  const resendVerification = async () => {
    setError("");
    setMessage("");

    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setError("Supabase is not configured.");
      return;
    }

    if (!email.trim()) {
      setError("Enter your email first so we know where to send the verification link.");
      return;
    }

    const redirectTo = `${window.location.origin}/auth/login`;
    const { error: resendError } = await supabase.auth.resend({
      type: "signup",
      email: email.trim(),
      options: { emailRedirectTo: redirectTo },
    });

    if (resendError) {
      setError(resendError.message);
      return;
    }

    setMessage("Verification email sent. Open your inbox, verify, then log in.");
  };

  const forgotPassword = async () => {
    setError("");
    setMessage("");

    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setError("Supabase is not configured.");
      return;
    }

    if (!email.trim()) {
      setError("Enter your email first so we know where to send the reset link.");
      return;
    }

    setLoading(true);
    const redirectTo = `${window.location.origin}/auth/login`;
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email.trim(),
      { redirectTo },
    );
    setLoading(false);

    if (resetError) {
      setError(resetError.message);
      return;
    }

    setMessage("Password reset email sent. Check your inbox for the reset link.");
  };

  return (
    <div className="space-y-5">
      <div>
        <img src="/mynotegoatlogo.png" alt="My Note Goat" className="mx-auto mb-3 h-24 w-auto" />
        <h1 className="mt-2 text-3xl font-semibold text-[var(--text-main)]">Sign In</h1>
        <p className="mt-2 text-[15px] text-[var(--text-muted)]">
          Secure login for your private office workspace.
        </p>
      </div>

      {verifyNotice ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Verify your email first, then sign in.
        </div>
      ) : null}

      {supabaseMissing ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Supabase environment variables are missing in this deployment.
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {message ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {message}
        </div>
      ) : null}

      <form className="space-y-4" onSubmit={onSubmit}>
        <label className="block space-y-2">
          <span className="text-sm font-semibold text-[var(--text-main)]">Email</span>
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            type="email"
            required
            className="w-full rounded-[14px] border border-[var(--line-strong)] bg-white px-4 py-3 text-[17px] outline-none focus:border-[var(--brand-primary)]"
            placeholder="you@clinic.com"
          />
        </label>

        <label className="block space-y-2">
          <span className="text-sm font-semibold text-[var(--text-main)]">Password</span>
          <div className="relative">
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type={showPassword ? "text" : "password"}
              required
              className="w-full rounded-[14px] border border-[var(--line-strong)] bg-white px-4 py-3 pr-12 text-[17px] outline-none focus:border-[var(--brand-primary)]"
              placeholder="Your password"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute inset-y-0 right-0 flex items-center px-4 text-[var(--text-muted)] hover:text-[var(--text-main)]"
            >
              {showPassword ? (
                // eye-off
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              ) : (
                // eye
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>
        </label>

        <button
          type="submit"
          disabled={loading || supabaseMissing}
          className="w-full rounded-[14px] bg-[var(--brand-primary)] px-5 py-3 text-base font-semibold text-white disabled:opacity-50"
        >
          {loading ? "Signing in..." : "Sign In"}
        </button>
      </form>

      <div className="space-y-2 text-sm">
        <p className="text-[var(--text-muted)]">
          No account yet?{" "}
          <Link className="font-semibold text-[var(--brand-primary)]" href="/auth/signup">
            Create one
          </Link>
        </p>
        <p className="text-[var(--text-muted)]">
          <button
            type="button"
            onClick={() => setShowRecovery(!showRecovery)}
            className="font-semibold text-[var(--brand-primary)] hover:underline"
          >
            Password Recovery
          </button>
        </p>
      </div>

      {showRecovery && (
        <div className="rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-4 space-y-3">
          <p className="text-xs text-[var(--text-muted)]">
            Enter your email above, then choose an option below.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={forgotPassword}
              disabled={loading || supabaseMissing}
              className="rounded-[14px] border border-[var(--line-strong)] bg-white px-4 py-2.5 text-sm font-semibold text-[var(--text-main)] disabled:opacity-50"
            >
              Forgot Password
            </button>
            <button
              type="button"
              onClick={resendVerification}
              disabled={loading || supabaseMissing}
              className="rounded-[14px] border border-[var(--line-strong)] bg-white px-4 py-2.5 text-sm font-semibold text-[var(--text-main)] disabled:opacity-50"
            >
              Resend Verification
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
