"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { ICD10_VERSION, icd10IfLoaded, loadIcd10, searchIcd10, sameCode, type Icd10Code, type Icd10Index } from "@/lib/icd10";

/**
 * Search the built-in ICD-10-CM list (self-hosted, loaded on first use, no
 * outside calls) and add a code with one click. Used in the patient's
 * Diagnosis Codes box, the Diagnosis Code settings, and the bundle editor.
 */
export function Icd10Search({
  onPick,
  existingCodes = [],
  actionLabel = "Add",
  addedLabel = "Added",
  placeholder = "Search ICD-10 by code (M54.12) or words (lumbar stenosis)…",
  label = "Search ICD-10",
  maxResults = 30,
  ariaLabel,
}: {
  /** Return false to signal the add didn't happen (e.g. duplicate). */
  onPick: (entry: Icd10Code) => boolean | void;
  /** Codes already added (dots/case ignored) — shown as "Added". */
  existingCodes?: string[];
  actionLabel?: string;
  addedLabel?: string;
  placeholder?: string;
  label?: string | null;
  maxResults?: number;
  ariaLabel?: string;
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState<Icd10Index | null>(() => icd10IfLoaded());
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const deferred = useDeferredValue(query);

  const ensureLoaded = () => {
    if (index || status === "loading") return;
    setStatus("loading");
    loadIcd10().then(
      (loaded) => {
        setIndex(loaded);
        setStatus("idle");
      },
      (err: unknown) => {
        console.warn("[icd10] load failed:", err);
        setStatus("error");
      },
    );
  };

  const results = useMemo(() => searchIcd10(index, deferred, { limit: maxResults }), [index, deferred, maxResults]);
  const isAdded = (code: string) => existingCodes.some((c) => sameCode(c, code));
  const q = query.trim();

  return (
    <div className="grid gap-2">
      {label && (
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-sm font-semibold">{label}</p>
          <span className="text-[11px] text-[var(--text-muted)]">
            {ICD10_VERSION} ICD-10-CM{index ? ` · ${index.entries.length.toLocaleString()} codes` : ""} · built in
          </span>
        </div>
      )}
      <input
        aria-label={ariaLabel ?? label ?? "Search ICD-10"}
        className="w-full rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
        onChange={(event) => {
          ensureLoaded();
          setQuery(event.target.value);
        }}
        onFocus={ensureLoaded}
        onKeyDown={(event) => {
          if (event.key === "Escape") setQuery("");
          if (event.key === "Enter" && results[0] && !isAdded(results[0].code)) {
            event.preventDefault();
            onPick({ code: results[0].code, description: results[0].description });
          }
        }}
        placeholder={placeholder}
        type="search"
        value={query}
      />
      {q && (
        <div className="max-h-72 overflow-y-auto rounded-xl border border-[var(--line-soft)] bg-white">
          {status === "loading" && !index && <p className="px-3 py-2 text-sm text-[var(--text-muted)]">Loading the code list…</p>}
          {status === "error" && (
            <p className="px-3 py-2 text-sm text-[#b43b34]">
              Couldn&apos;t load the code list. Check the connection and try again.
            </p>
          )}
          {index && results.length === 0 && (
            <p className="px-3 py-2 text-sm text-[var(--text-muted)]">No billable codes match &ldquo;{q}&rdquo;.</p>
          )}
          {results.map((entry) => {
            const added = isAdded(entry.code);
            return (
              <div
                className="flex items-start gap-3 border-b border-[var(--line-soft)] px-3 py-1.5 last:border-b-0 hover:bg-[var(--bg-soft)]"
                key={entry.raw}
              >
                <span className="w-20 shrink-0 pt-0.5 font-mono text-sm font-semibold">{entry.code}</span>
                <span className="min-w-0 flex-1 text-sm leading-snug">{entry.description}</span>
                <button
                  className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold ${
                    added
                      ? "cursor-default border border-[var(--line-soft)] text-[var(--text-muted)]"
                      : "bg-[var(--brand-primary)] text-white transition-all active:scale-[0.97]"
                  }`}
                  disabled={added}
                  onClick={() => onPick({ code: entry.code, description: entry.description })}
                  type="button"
                >
                  {added ? addedLabel : actionLabel}
                </button>
              </div>
            );
          })}
          {index && results.length === maxResults && (
            <p className="px-3 py-1.5 text-[11px] text-[var(--text-muted)]">Showing the first {maxResults}. Type more to narrow it down.</p>
          )}
        </div>
      )}
    </div>
  );
}
