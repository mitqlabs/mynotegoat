"use client";

import { useState } from "react";
import { useOfficeSettings } from "@/hooks/use-office-settings";
import {
  CASE_NUMBER_TOKENS,
  DEFAULT_CASE_NUMBER_FORMAT,
  checkCaseNumberFormat,
  exampleCaseNumber,
  normalizeCaseNumberFormat,
} from "@/lib/case-number";

/** Settings → Office → Office Information: how NEW patients' case numbers are built. */
export function CaseNumberFormatField() {
  const { officeSettings, updateOfficeSettings } = useOfficeSettings();
  const saved = normalizeCaseNumberFormat(officeSettings.caseNumberFormat);
  const [draft, setDraft] = useState(saved);
  // A reset or a change from another device replaces what's typed; our own typing doesn't (it already equals saved).
  const [seenSaved, setSeenSaved] = useState(saved);
  if (seenSaved !== saved) {
    setSeenSaved(saved);
    if (draft.trim() !== saved) setDraft(saved);
  }
  const check = checkCaseNumberFormat(draft);
  const example = check.ok ? exampleCaseNumber(draft) : "";
  const isDefault = saved === DEFAULT_CASE_NUMBER_FORMAT;

  const change = (next: string) => {
    setDraft(next);
    // Only a valid format is ever saved; while it's invalid the last good one stays in force.
    if (checkCaseNumberFormat(next).ok) updateOfficeSettings({ caseNumberFormat: next.trim() });
  };

  return (
    <div className="grid gap-2 rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-3 sm:col-span-2" data-case-number-format>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold text-[var(--text-main)]">Case number format</span>
        <button
          className="btn btn-secondary btn-sm"
          disabled={isDefault && draft === DEFAULT_CASE_NUMBER_FORMAT}
          onClick={() => change(DEFAULT_CASE_NUMBER_FORMAT)}
          type="button"
        >
          Reset to default
        </button>
      </div>
      <input
        aria-label="Case number format"
        className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 font-mono text-sm"
        onChange={(event) => change(event.target.value)}
        placeholder={DEFAULT_CASE_NUMBER_FORMAT}
        spellCheck={false}
        value={draft}
      />
      {check.ok ? (
        <p className="text-sm">
          Example (John Smith, injury 07/18/2026): <span className="font-mono font-semibold">{example}</span>
        </p>
      ) : (
        <p className="text-sm font-semibold text-[#c9423a]">{check.error}</p>
      )}
      <p className="text-xs text-[var(--text-muted)]">
        Applies to <strong>new</strong> cases only. Existing case numbers never change. The default
        ({DEFAULT_CASE_NUMBER_FORMAT}) is the original: injury date + first 2 letters of last name + first 2 of first name.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {CASE_NUMBER_TOKENS.map((t) => (
          <button
            className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-0.5 font-mono text-xs hover:bg-[var(--bg-soft)]"
            key={t.token}
            onClick={() => change(`${draft}${t.token}`)}
            title={t.meaning}
            type="button"
          >
            {t.token}
          </button>
        ))}
      </div>
      <p className="text-xs text-[var(--text-muted)]">
        Tap a token to add it. Between tokens you can use letters, numbers and - _ . # only. Counter ({"{N}"}) numbers new cases 1, 2, 3…
      </p>
    </div>
  );
}
