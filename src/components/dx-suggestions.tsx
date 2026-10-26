"use client";

import { useState } from "react";
import type { DxHeldBack, DxSuggestion } from "@/lib/dx-suggest";

export const DX_DISCLAIMER = "Suggestions only. Confirm against the MRI and documentation before billing.";
const disclaimer = (kind: "MRI" | "X-ray") => (kind === "MRI" ? DX_DISCLAIMER : "Suggestions only. Confirm against the X-ray and documentation before billing.");

/** The MRI line, cut to a short quote (the full line is in the tooltip and under "Why?"). */
function shortQuote(text: string, max = 70): string {
  return text.length > max ? `${text.slice(0, max - 1).replace(/[\s.,;:]+$/, "")}…` : text;
}

/**
 * G.O.A.T.'s "Suggested from MRI" list for the Diagnosis Codes box. Shows
 * each code with the MRI line it came from; nothing is added until the user
 * clicks Add.
 */
export function DxSuggestions({
  suggestions,
  heldBack = [],
  hasMriText,
  unreadFiles = 0,
  onAdd,
  kind = "MRI",
}: {
  /** Which report the list reads: the MRI/CT list or the X-ray list. */
  kind?: "MRI" | "X-ray";
  suggestions: Array<Omit<DxSuggestion, "segment"> & { segment: string }>;
  /** Codes found but held back (ICD-10-CM Excludes1 with a code on the patient / another suggestion). */
  heldBack?: DxHeldBack[];
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
    <div className="grid min-w-0 grid-cols-1 gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <p className="text-sm font-semibold">
          <span className="mr-1.5 rounded-md bg-[#72bdcf]/20 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-[#2f7f93]">
            G.O.A.T.
          </span>
          Suggested from {kind}
        </p>
        <span className="text-[11px] text-[var(--text-muted)]">Nothing is added for you</span>
      </div>
      <p className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-900" role="note">
        {disclaimer(kind)}
      </p>
      {suggestions.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[var(--line-soft)] bg-white px-3 py-2 text-sm text-[var(--text-muted)]">
          {kind === "X-ray"
            ? hasMriText
              ? "No new codes to suggest. The X-ray findings are covered by codes already on this patient, or they don't name a mapped finding."
              : "No X-ray findings yet. Add them in the Imaging panel or upload the X-ray report to Patient Files."
            : hasMriText
              ? "No new codes to suggest. The MRI findings are covered by codes already on this patient, or they don't name a mapped finding."
              : "No MRI/CT findings yet. Add them in the Imaging panel or upload the MRI report to Patient Files."}
        </p>
      ) : (
        <ul className="grid min-w-0 grid-cols-1 gap-1.5">
          {visible.map((s) => {
            const open = Boolean(expanded[s.code]);
            const first = s.evidence[0];
            return (
              <li className="min-w-0 rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2" key={s.code}>
                <div className="flex items-start gap-3">
                  <span className="w-[4.5rem] shrink-0 pt-0.5 font-mono text-sm font-semibold">{s.code}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-snug">{s.description}</p>
                    <span className="mt-0.5 inline-block rounded bg-[var(--bg-soft)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--text-muted)]">
                      {s.segment}
                    </span>
                  </div>
                  <button
                    className="btn btn-primary btn-sm shrink-0"
                    onClick={() => onAdd(s.code, s.description)}
                    type="button"
                  >
                    Add
                  </button>
                </div>
                {first && (
                  <p className="mt-1.5 line-clamp-2 text-xs leading-snug" title={`${first.text} — ${first.source}`}>
                    <span className="font-medium">&ldquo;{shortQuote(first.text)}&rdquo;</span>
                    <span className="text-[var(--text-muted)]"> — {first.source}</span>
                  </p>
                )}
                {s.others.length > 0 && (
                  <p className="mt-1 flex items-center gap-1 overflow-x-auto whitespace-nowrap text-[11px] text-[var(--text-muted)]">
                    Other options:
                    {s.others.map((o) => (
                      <button
                        className="rounded border border-[var(--line-soft)] px-1 font-mono font-semibold text-[var(--text-main,#1f2937)] hover:bg-[var(--bg-soft)]"
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
                <button
                  aria-expanded={open}
                  className="mt-1 text-[11px] font-semibold text-[var(--brand-primary)]"
                  onClick={() => setExpanded((cur) => ({ ...cur, [s.code]: !open }))}
                  type="button"
                >
                  {open ? "Hide why" : "Why?"}
                </button>
                {open && (
                  <div className="mt-1 grid gap-1 rounded-lg bg-[var(--bg-soft)] px-2 py-1.5 text-[11px] leading-snug text-[var(--text-muted)]">
                    <p>
                      <span className="font-semibold">{s.labels.join(" · ")}</span>
                      {s.inLibrary && <span className="ml-1.5 font-semibold text-emerald-700">· In your list</span>}
                    </p>
                    <p>{s.why}</p>
                    {s.support && (
                      <p>
                        {s.support.kind === "claudication" ? "Claudication" : s.support.kind === "myelopathy" ? "Myelopathy" : "Radiculopathy"} in notes:{" "}
                        &ldquo;{s.support.text}&rdquo; — {s.support.source}
                      </p>
                    )}
                    {s.evidence.map((e) => (
                      <p key={`${e.source}-${e.text}`}>
                        {kind}: &ldquo;{e.text}&rdquo; — {e.source}
                      </p>
                    ))}
                    {s.note && <p>{s.note}</p>}
                  </div>
                )}
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
      {heldBack.length > 0 && (
        <details className="rounded-lg border border-[var(--line-soft)] bg-white px-2.5 py-1.5 text-xs">
          <summary className="cursor-pointer font-semibold text-[var(--text-muted)]">
            Not suggested ({heldBack.length}){kind === "MRI" ? " · ICD-10-CM Excludes1" : ""}
          </summary>
          <ul className="mt-1 grid gap-1">
            {heldBack.map((h) => (
              <li key={h.code}>
                <span className="font-mono font-semibold">{h.code}</span> {h.description}
                <span className="block text-[var(--text-muted)]">{h.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {unreadFiles > 0 && (
        <p className="text-[11px] text-[var(--text-muted)]">
          {unreadFiles} uploaded file{unreadFiles === 1 ? " isn't" : "s aren't"} read yet, so {unreadFiles === 1 ? "it isn't" : "they aren't"} included. Use &ldquo;Read files&rdquo; in G.O.A.T.
        </p>
      )}
    </div>
  );
}
