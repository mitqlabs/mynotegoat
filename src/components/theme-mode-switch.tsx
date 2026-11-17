"use client";

import { useState } from "react";
import type { Mode } from "@/lib/brand";
import { savePersonTone } from "@/lib/cloud/brand-save";
import { usePersonTone } from "@/lib/theme";

type Status = { state: "idle" } | { state: "saving" } | { state: "saved" } | { state: "failed"; reason: string };

/**
 * Light or Dark for the signed-in person. Anyone can change their own.
 * Saved is shown only after the cloud row is read back.
 */
export function ThemeModeSwitch({ compact = false }: { compact?: boolean }) {
  const tone = usePersonTone();
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const [pending, setPending] = useState<Mode | null>(null);

  const choose = async (mode: Mode) => {
    if (mode === tone && status.state !== "failed") return;
    setPending(mode);
    setStatus({ state: "saving" });
    const result = await savePersonTone(mode);
    setStatus(result.ok ? { state: "saved" } : { state: "failed", reason: result.reason });
  };

  return (
    <div className="inline-flex flex-wrap items-center gap-2">
      <div role="radiogroup" aria-label="Your Mode" className="inline-flex rounded-full border border-[var(--line-soft)] bg-[var(--bg-panel)] p-0.5">
        {(["light", "dark"] as Mode[]).map((mode) => {
          const on = tone === mode;
          return (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={on}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                on ? "bg-[var(--brand-primary)] text-[var(--on-brand)]" : "text-[var(--text-muted)]"
              }`}
              onClick={() => void choose(mode)}
            >
              {mode === "light" ? "Light" : "Dark"}
            </button>
          );
        })}
      </div>
      {!compact && status.state === "saving" && <span className="text-xs text-[var(--text-muted)]">Saving…</span>}
      {!compact && status.state === "saved" && <span className="text-xs font-semibold text-[var(--status-active,#1f9d60)]">Saved</span>}
      {status.state === "failed" && (
        <button type="button" className="text-xs font-semibold text-[var(--status-alert,#c9423a)] underline" onClick={() => pending && void choose(pending)}>
          Retry
        </button>
      )}
      {status.state === "failed" && !compact && (
        <span className="text-xs text-[var(--status-alert,#c9423a)]">{status.reason}</span>
      )}
    </div>
  );
}
