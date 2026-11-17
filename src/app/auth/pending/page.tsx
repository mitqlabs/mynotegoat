"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { resolveAuthAccessState } from "@/lib/auth-access";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

export default function PendingApprovalPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [approvalStatus, setApprovalStatus] = useState("pending");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refreshStatus = async () => {
    setLoading(true);
    setError("");

    const access = await resolveAuthAccessState();

    if (access.state === "signed-out") {
      router.replace("/auth/login");
      return;
    }

    if (access.state === "access-granted") {
      router.replace("/");
      return;
    }

    if (access.state === "email-unverified") {
      router.replace("/auth/login?verify=1");
      return;
    }

    if (access.state === "pending-approval") {
      setEmail(access.email ?? "");
      setApprovalStatus(access.approvalStatus ?? "pending");
      setLoading(false);
      return;
    }

    setError(access.errorMessage || "Could not read your approval status.");
    setLoading(false);
  };

  useEffect(() => {
    void refreshStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signOut = async () => {
    const supabase = getSupabaseBrowserClient();
    if (supabase) {
      await supabase.auth.signOut();
    }
    router.replace("/auth/login");
  };

  return (
    <div className="space-y-5">
      <div>
        <img src="/mynotegoatlogo.png" alt="My Note Goat" className="mx-auto mb-3 h-24 w-auto" />
        <h1 className="mt-2 text-3xl font-semibold text-[var(--text-main)]">Pending Approval</h1>
        <p className="mt-2 text-[15px] text-[var(--text-muted)]">
          Your email is verified. Your account still needs admin approval before workspace access.
        </p>
      </div>

      <div className="rounded-xl border border-[var(--line-strong)] bg-[var(--bg-soft)] px-4 py-3">
        <div className="text-sm text-[var(--text-muted)]">Account</div>
        <div className="text-base font-semibold text-[var(--text-main)]">{email || "Loading..."}</div>
        <div className="mt-1 text-sm text-[var(--text-muted)]">
          Status: <span className="font-semibold text-[var(--text-main)]">{approvalStatus}</span>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={refreshStatus}
          disabled={loading}
          className="rounded-[14px] bg-[var(--brand-primary)] px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {loading ? "Checking..." : "Refresh Status"}
        </button>

        <button
          type="button"
          onClick={signOut}
          className="rounded-[14px] border border-[var(--line-strong)] bg-white px-5 py-3 text-sm font-semibold text-[var(--text-main)]"
        >
          Sign Out
        </button>
      </div>
    </div>
  );
}
