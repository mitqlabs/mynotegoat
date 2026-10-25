"use client";

import { useEffect, useRef, useState } from "react";
import type { Icd10Code } from "@/lib/icd10";

export type DxSaveToListConfig = {
  /** The office's diagnosis folders (Diagnosis Macro Settings). */
  folders: Array<{ id: string; name: string }>;
  /** Bundles the code can also be put in. */
  bundles: Array<{ id: string; name: string }>;
  /** Folder to preselect (region guess, else General). */
  guessFolderId: (entry: Icd10Code) => string;
  /** Save to the list. Return an error message to keep the panel open. */
  onSave: (entry: Icd10Code, folderId: string, bundleIds: string[]) => string | null;
  /** Button text (default "+Dx"). */
  buttonLabel?: string;
};

/**
 * The small "+ Dx Code" panel under an ICD-10 search row: pick a folder (and
 * optionally bundles) and save the code to the office's diagnosis list —
 * same data as Settings → Diagnosis "Add a code". It does NOT add the code to
 * the patient; that's the row's Add button.
 */
export function DxSaveToListPanel({
  entry,
  config,
  onClose,
}: {
  entry: Icd10Code;
  config: DxSaveToListConfig;
  onClose: (saved: boolean) => void;
}) {
  const [folderId, setFolderId] = useState(() => config.guessFolderId(entry) || config.folders[0]?.id || "");
  const [bundleIds, setBundleIds] = useState<string[]>([]);
  const [error, setError] = useState("");
  const selectRef = useRef<HTMLSelectElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    selectRef.current?.focus({ preventScroll: true });
    panelRef.current?.scrollIntoView?.({ block: "nearest" });
  }, []);

  const save = () => {
    const err = config.onSave(entry, folderId, bundleIds);
    if (err) setError(err);
    else onClose(true);
  };

  return (
    <div
      aria-label={`Save ${entry.code} to your diagnosis codes`}
      className="mx-2 mb-2 mt-0.5 grid gap-2 rounded-lg border border-[var(--brand-primary)]/40 bg-white p-2.5 text-sm shadow-md"
      ref={panelRef}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose(false);
        }
      }}
      role="dialog"
    >
      <p className="text-xs leading-snug text-[var(--text-muted)]">
        Save <span className="font-mono font-semibold text-[var(--text-main,#1f2937)]">{entry.code}</span> to your diagnosis
        codes. It won&apos;t be added to this patient unless you click Add.
      </p>
      <label className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Folder</span>
        <select
          aria-label={`Folder for ${entry.code}`}
          className="min-w-0 flex-1 rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-sm"
          onChange={(event) => setFolderId(event.target.value)}
          ref={selectRef}
          value={folderId}
        >
          {config.folders.map((folder) => (
            <option key={folder.id} value={folder.id}>
              {folder.name}
            </option>
          ))}
        </select>
      </label>
      {config.bundles.length > 0 && (
        <fieldset className="min-w-0">
          <legend className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Also add to bundles <span className="font-normal normal-case">(optional)</span>
          </legend>
          <div className="mt-1 flex max-h-28 flex-wrap gap-x-3 gap-y-1 overflow-y-auto">
            {config.bundles.map((bundle) => (
              <label className="flex items-center gap-1.5 text-xs" key={bundle.id}>
                <input
                  checked={bundleIds.includes(bundle.id)}
                  onChange={(event) =>
                    setBundleIds((cur) => (event.target.checked ? [...cur, bundle.id] : cur.filter((id) => id !== bundle.id)))
                  }
                  type="checkbox"
                />
                {bundle.name}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {error && <p className="text-xs font-semibold text-[#b43b34]">{error}</p>}
      <div className="flex justify-end gap-2">
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => onClose(false)}
          type="button"
        >
          Cancel
        </button>
        <button
          className="btn btn-primary btn-sm"
          onClick={save}
          type="button"
        >
          Save to my codes
        </button>
      </div>
    </div>
  );
}
