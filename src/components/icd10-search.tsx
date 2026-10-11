"use client";

import { Fragment, useDeferredValue, useMemo, useRef, useState } from "react";
import { DxSaveToListPanel, type DxSaveToListConfig } from "@/components/dx-save-to-list";
import {
  ICD10_VERSION,
  buildLocalIndex,
  icd10IfLoaded,
  loadIcd10,
  sameCode,
  searchCombined,
  type Icd10Code,
  type Icd10Index,
  type LocalCode,
} from "@/lib/icd10";

/**
 * One search bar for diagnosis codes: the office's own codes ("Your codes",
 * with their folder) first, then the built-in ICD-10-CM list (self-hosted,
 * loaded on first use, no outside calls). A code in the office's list shows
 * once, under Your codes. Used in the patient's Diagnosis Codes box, the
 * Diagnosis settings, and the bundle editor.
 */
export function Icd10Search({
  onPick,
  localCodes,
  existingCodes = [],
  actionLabel = "Add",
  addedLabel = "Added",
  placeholder = "Search your codes and ICD-10: code (M54.12) or words (lumbar stenosis)…",
  label = "Search codes",
  localLabel = "Your codes",
  maxResults = 30,
  ariaLabel,
  saveToList,
}: {
  /** Return false to signal the add didn't happen (e.g. duplicate). */
  onPick: (entry: Icd10Code, fromYourCodes: boolean) => boolean | void;
  /** The office's own codes, searched first and labeled with their folder. */
  localCodes?: LocalCode[];
  /** Codes already added (dots/case ignored) — shown as `addedLabel`. */
  existingCodes?: string[];
  actionLabel?: string;
  addedLabel?: string;
  placeholder?: string;
  label?: string | null;
  localLabel?: string;
  maxResults?: number;
  ariaLabel?: string;
  /**
   * Adds a "+ Dx Code" button to ICD-10 rows (codes not in Your codes) that
   * saves the code to the office's list via a small panel. Patient box only.
   */
  saveToList?: DxSaveToListConfig;
}) {
  const [savingCode, setSavingCode] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
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

  const localIndex = useMemo(() => (localCodes ? buildLocalIndex(localCodes) : null), [localCodes]);
  const results = useMemo(
    () => searchCombined(localIndex, index, deferred, { limit: maxResults }),
    [localIndex, index, deferred, maxResults],
  );
  const isAdded = (code: string) => existingCodes.some((c) => sameCode(c, code));
  const q = query.trim();
  const nothing = results.local.length === 0 && results.icd.length === 0;

  const pickFirst = () => {
    const firstLocal = results.local.find((hit) => !isAdded(hit.item.code));
    if (firstLocal) return onPick({ code: firstLocal.item.code, description: firstLocal.item.description }, true);
    const firstIcd = results.icd.find((e) => !isAdded(e.code));
    if (firstIcd) return onPick({ code: firstIcd.code, description: firstIcd.description }, false);
  };

  const row = (key: string, code: string, description: string, fromYourCodes: boolean, group?: string) => {
    const added = isAdded(code);
    const canSave = Boolean(saveToList) && !fromYourCodes;
    const saving = canSave && savingCode !== null && sameCode(savingCode, code);
    const addButton = (
      <button
        className={`shrink-0 whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-semibold ${
          added
            ? "cursor-default border border-[var(--line-soft)] text-[var(--text-muted)]"
            : "bg-[var(--brand-primary)] text-white transition-all active:scale-[0.97]"
        }`}
        disabled={added}
        onClick={() => onPick({ code, description }, fromYourCodes)}
        type="button"
      >
        {added ? addedLabel : actionLabel}
      </button>
    );
    const compactAdd = (
      <button
        className={`whitespace-nowrap rounded-lg px-2 py-0.5 text-[11px] font-semibold ${
          added
            ? "cursor-default border border-[var(--line-soft)] text-[var(--text-muted)]"
            : "border border-[var(--brand-primary)] bg-[var(--brand-primary)] text-white transition-all active:scale-[0.97]"
        }`}
        disabled={added}
        onClick={() => onPick({ code, description }, fromYourCodes)}
        type="button"
      >
        {added ? addedLabel : actionLabel}
      </button>
    );
    if (canSave && saveToList) {
      return (
        <Fragment key={key}>
          <div
            className={`flex items-start gap-2 px-3 py-1.5 hover:bg-[var(--bg-soft)] ${saving ? "bg-[var(--bg-soft)]" : "border-b border-[var(--line-soft)] last:border-b-0"}`}
          >
            <span className="w-[4.25rem] shrink-0 pt-0.5 font-mono text-sm font-semibold">{code}</span>
            <span className="min-w-0 flex-1 text-sm leading-snug">{description}</span>
            {/* Side by side when there's room; stacked in the narrow one-column box. */}
            <span className="flex shrink-0 flex-col items-stretch gap-1 @[34rem]:flex-row @[34rem]:items-start">
              <button
                aria-expanded={saving}
                aria-label={`Save ${code} to your diagnosis codes`}
                className={`whitespace-nowrap rounded-lg border px-2 py-0.5 text-[11px] font-semibold transition-all active:scale-[0.97] ${
                  saving
                    ? "border-[var(--brand-primary)] bg-[var(--brand-primary)]/10 text-[var(--brand-primary)]"
                    : "border-[var(--brand-primary)]/50 bg-white text-[var(--brand-primary)]"
                }`}
                onClick={() => setSavingCode(saving ? null : code)}
                title="Save to your diagnosis codes (doesn't add it to this patient)"
                type="button"
              >
                {saveToList.buttonLabel ?? "+ Dx Code"}
              </button>
              {compactAdd}
            </span>
          </div>
          {saving && (
            <div className="border-b border-[var(--line-soft)] bg-[var(--bg-soft)] last:border-b-0">
              <DxSaveToListPanel
                config={saveToList}
                entry={{ code, description }}
                onClose={(saved) => {
                  setSavingCode(null);
                  // The code now shows at the top, under Your codes.
                  if (saved) listRef.current?.scrollTo?.({ top: 0 });
                }}
              />
            </div>
          )}
        </Fragment>
      );
    }
    return (
      <div
        className="flex items-start gap-3 border-b border-[var(--line-soft)] px-3 py-1.5 last:border-b-0 hover:bg-[var(--bg-soft)]"
        key={key}
      >
        <span className="w-20 shrink-0 pt-0.5 font-mono text-sm font-semibold">{code}</span>
        <span className="min-w-0 flex-1 text-sm leading-snug">
          {description}
          {group && (
            <span className="ml-1.5 whitespace-nowrap rounded bg-[var(--bg-soft)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--text-muted)]">
              {group}
            </span>
          )}
        </span>
        {addButton}
      </div>
    );
  };
  const heading = (text: string, note?: string) => (
    <div className="sticky top-0 z-[1] flex items-baseline justify-between gap-2 border-b border-[var(--line-soft)] bg-[var(--bg-soft)] px-3 py-1">
      <span className="text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]">{text}</span>
      {note && <span className="text-[10px] text-[var(--text-muted)]">{note}</span>}
    </div>
  );

  return (
    <div className="grid gap-2">
      {label && (
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-sm font-semibold">{label}</p>
          <span className="text-[11px] text-[var(--text-muted)]">
            {localCodes ? "Your codes + " : ""}
            {ICD10_VERSION} ICD-10-CM{index ? ` · ${index.entries.length.toLocaleString()} codes` : ""} · built in
          </span>
        </div>
      )}
      <input
        aria-label={ariaLabel ?? (label ? `${label}` : "Search diagnosis codes")}
        className="w-full rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
        onChange={(event) => {
          ensureLoaded();
          setQuery(event.target.value);
          setSavingCode(null);
        }}
        onFocus={ensureLoaded}
        onKeyDown={(event) => {
          if (event.key === "Escape") setQuery("");
          if (event.key === "Enter") {
            event.preventDefault();
            pickFirst();
          }
        }}
        placeholder={placeholder}
        type="search"
        value={query}
      />
      {q && (
        <div ref={listRef} className="@container max-h-80 overflow-y-auto rounded-xl border border-[var(--line-soft)] bg-white">
          {localCodes && results.local.length > 0 && (
            <>
              {heading(localLabel, `${results.local.length} match${results.local.length === 1 ? "" : "es"}`)}
              {results.local.map(({ item, entry }) => row(`local-${entry.raw}`, item.code, item.description, true, item.group))}
            </>
          )}
          {(results.icd.length > 0 || (localCodes && results.local.length > 0)) && heading("ICD-10", localCodes ? "not in your codes" : undefined)}
          {status === "loading" && !index && <p className="px-3 py-2 text-sm text-[var(--text-muted)]">Loading the ICD-10 list…</p>}
          {status === "error" && (
            <p className="px-3 py-2 text-sm text-[#b43b34]">Couldn&apos;t load the ICD-10 list. Check the connection and try again.</p>
          )}
          {index && results.icd.length === 0 && !nothing && (
            <p className="px-3 py-2 text-xs text-[var(--text-muted)]">No other ICD-10 codes match.</p>
          )}
          {index && nothing && <p className="px-3 py-2 text-sm text-[var(--text-muted)]">No codes match &ldquo;{q}&rdquo;.</p>}
          {results.icd.map((entry) => row(entry.raw, entry.code, entry.description, false))}
          {index && results.icd.length === maxResults && (
            <p className="px-3 py-1.5 text-[11px] text-[var(--text-muted)]">Showing the first {maxResults}. Type more to narrow it down.</p>
          )}
        </div>
      )}
    </div>
  );
}
