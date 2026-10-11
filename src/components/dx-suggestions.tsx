"use client";

import { useState } from "react";
import type { DxSuggestion } from "@/lib/dx-suggest";

/**
 * G.O.A.T.'s "Suggested from MRI" list for the Diagnosis Codes box. Shows
 * each code with the MRI line it came from; nothing is added until the user
 * clicks Add.
 */
export function DxSuggestions({
  suggestions,
  hasMriText,
  unreadFiles = 0,
  onAdd,
}: {
  suggestions: DxSuggestion[];
  /** Whether there's any MRI/CT text to read at all (for the empty message). */
  hasMriText: boolean;
  /** Uploaded files G.O.A.T. hasn't read yet (their findings aren't included). */
  unreadFiles?: number;
  onAdd: (code: string, description: string) => void;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showAll, setShowAll] = useState(false);
  const SHOWN = 5;
  const visible = showAll ? suggestions : suggestions.slice(0, SHOWN);
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <p className="text-sm font-semibold">
          <span className="mr-1.5 rounded-md bg-[#72bdcf]/20 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-[#2f7f93]">
            G.O.A.T.
          </span>
          Suggested from MRI
        </p>
        <span className="text-[11px] text-[var(--text-muted)]">Check each one · nothing is added for you</span>
      </div>
      {suggestions.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[var(--line-soft)] bg-white px-3 py-2 text-sm text-[var(--text-muted)]">
          {hasMriText
            ? "No new codes to suggest. The MRI findings are covered by codes already on this patient, or they don't name a mapped finding."
            : "No MRI/CT findings yet. Add them in the Imaging panel or upload the MRI report to Patient Files."}
        </p>
      ) : (
        <ul className="grid gap-1.5">
          {visible.map((s) => {
            const open = expanded[s.code];
            const lines = open ? s.evidence : s.evidence.slice(0, 1);
            return (
              <li className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2" key={s.code}>
                <div className="flex items-start gap-3">
                  <span className="w-[4.5rem] shrink-0 pt-0.5 font-mono text-sm font-semibold">{s.code}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-snug">{s.description}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
                      <span className="rounded bg-[var(--bg-soft)] px-1.5 py-0.5 font-semibold">{s.segment}</span>
                      <span>{s.labels.join(" · ")}</span>
                      {s.inLibrary && (
                        <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-semibold text-emerald-700">In your list</span>
                      )}
                    </p>
                  </div>
                  <button
                    className="shrink-0 rounded-lg bg-[var(--brand-primary)] px-2.5 py-1 text-xs font-semibold text-white transition-all active:scale-[0.97]"
                    onClick={() => onAdd(s.code, s.description)}
                    type="button"
                  >
                    Add
                  </button>
                </div>
                <div className="mt-1.5 grid gap-1 border-t border-dashed border-[var(--line-soft)] pt-1.5 text-xs">
                  {lines.map((e) => (
                    <p className="leading-snug" key={`${e.source}-${e.text}`}>
                      <span className="text-[var(--text-muted)]">MRI: </span>
                      <span className="font-medium">&ldquo;{e.text}&rdquo;</span>
                      <span className="text-[var(--text-muted)]"> — {e.source}</span>
                    </p>
                  ))}
                  {s.evidence.length > 1 && (
                    <button
                      className="justify-self-start text-[11px] font-semibold text-[var(--brand-primary)]"
                      onClick={() => setExpanded((cur) => ({ ...cur, [s.code]: !open }))}
                      type="button"
                    >
                      {open ? "Show less" : `+${s.evidence.length - 1} more MRI line${s.evidence.length === 2 ? "" : "s"}`}
                    </button>
                  )}
                  {s.support && (
                    <p className="leading-snug">
                      <span className="text-[var(--text-muted)]">{s.support.kind === "claudication" ? "Claudication" : s.support.kind === "myelopathy" ? "Myelopathy" : "Radiculopathy"} in notes: </span>
                      <span className="font-medium">&ldquo;{s.support.text}&rdquo;</span>
                      <span className="text-[var(--text-muted)]"> — {s.support.source}</span>
                    </p>
                  )}
                  {s.others.length > 0 && (
                    <p className="flex flex-wrap items-center gap-1 text-[11px] text-[var(--text-muted)]">
                      Other options:
                      {s.others.map((o) => (
                        <button
                          className="rounded border border-[var(--line-soft)] px-1.5 py-0.5 font-mono font-semibold text-[var(--text-main,#1f2937)] hover:bg-[var(--bg-soft)]"
                          key={o.code}
                          onClick={() => onAdd(o.code, o.description)}
                          title={`Add ${o.code} — ${o.description}`}
                          type="button"
                        >
                          + {o.code}
                        </button>
                      ))}
                    </p>
                  )}
                  {s.note && <p className="text-[11px] text-[var(--text-muted)]">{s.note}</p>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {suggestions.length > SHOWN && (
        <button
          className="justify-self-start text-xs font-semibold text-[var(--brand-primary)]"
          onClick={() => setShowAll((v) => !v)}
          type="button"
        >
          {showAll ? "Show fewer" : `Show all ${suggestions.length} suggestions`}
        </button>
      )}
      {unreadFiles > 0 && (
        <p className="text-[11px] text-[var(--text-muted)]">
          {unreadFiles} uploaded file{unreadFiles === 1 ? " isn't" : "s aren't"} read yet, so {unreadFiles === 1 ? "it isn't" : "they aren't"} included. Use &ldquo;Read files&rdquo; in G.O.A.T.
        </p>
      )}
    </div>
  );
}
