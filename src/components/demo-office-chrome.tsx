"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { getCurrentMembershipSync } from "@/lib/workspace-membership";
import { demoOfficeActive, onDemoToast, showDemoToast } from "@/lib/demo-client";
import { DEMO_NOT_SENT } from "@/lib/demo-office";

export function DemoOfficeMarker({ compact = false }: { compact?: boolean }) {
  const [on, setOn] = useState(false);
  useEffect(() => setOn(demoOfficeActive()), []);
  if (!on) return null;
  return (
    <span className={compact ? "mt-2 inline-flex rounded-full border border-white/30 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/90" : "inline-flex items-center rounded-full border border-[var(--line-strong)] px-2.5 py-1 text-xs font-semibold text-[var(--text-main)]"}>
      Demo office
    </span>
  );
}

export function ResetDemoButton() {
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const member = getCurrentMembershipSync();
    setOn(demoOfficeActive() && !member?.isMember);
  }, []);
  if (!on) return null;
  return (
    <button
      type="button"
      disabled={busy}
      className="rounded-full border border-[var(--line-strong)] px-3 py-1 text-xs font-semibold text-[var(--text-main)] disabled:opacity-50"
      onClick={() => {
        void (async () => {
          const supabase = getSupabaseBrowserClient();
          const token = supabase ? (await supabase.auth.getSession()).data.session?.access_token : "";
          if (!token) return;
          setBusy(true);
          const response = await fetch("/api/demo/reset", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
          setBusy(false);
          if (!response.ok) {
            showDemoToast("Demo reset failed.");
            return;
          }
          window.location.reload();
        })();
      }}
    >
      {busy ? "Resetting…" : "Reset demo now"}
    </button>
  );
}

export function DemoToast() {
  const [message, setMessage] = useState("");
  useEffect(() => {
    return onDemoToast((next) => {
      setMessage(next || DEMO_NOT_SENT);
      window.setTimeout(() => setMessage(""), 2400);
    });
  }, []);
  if (!message) return null;
  return (
    <div className="fixed bottom-4 left-1/2 z-[80] -translate-x-1/2 rounded-full bg-[var(--text-main)] px-4 py-2 text-sm font-semibold text-white shadow-lg" role="status">
      {message}
    </div>
  );
}
