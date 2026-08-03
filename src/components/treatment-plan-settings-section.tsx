"use client";

import { useMemo, useState } from "react";
import { useTreatmentPlanSettings } from "@/hooks/use-treatment-plan-settings";
import { useMacroTemplates } from "@/hooks/use-macro-templates";
import type { MacroTemplate } from "@/lib/macro-templates";

const UNGROUPED = "Ungrouped";

/**
 * Settings → Macros → Treatment Plan Settings.
 *
 * Pick which Plan-section SOAP macros are treatment "regions" (Cervical,
 * Lumbar, …) — a region IS its macro, so its name, treatments, and charges
 * all come from the macro. Grouped by folder so a whole folder can be
 * selected at once. Plus the behavior toggles for how plans interact with
 * salting.
 */
export function TreatmentPlanSettingsSection() {
  const { settings, toggleRegion, setRegionMembership, setToggle } = useTreatmentPlanSettings();
  const { macroLibrary } = useMacroTemplates();
  const [open, setOpen] = useState(false);
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());
  const toggleFolder = (folder: string) =>
    setOpenFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });

  const regionSet = useMemo(() => new Set(settings.regionMacroIds), [settings.regionMacroIds]);

  const folders = useMemo(() => {
    const planMacros = macroLibrary.templates.filter((t) => t.section === "plan" && t.active);
    const map = new Map<string, MacroTemplate[]>();
    for (const m of planMacros) {
      const f = (m.folder || "").trim() || UNGROUPED;
      if (!map.has(f)) map.set(f, []);
      map.get(f)!.push(m);
    }
    return [...map.entries()];
  }, [macroLibrary.templates]);

  const hasPlanMacros = folders.length > 0;

  return (
    <section className="panel-card p-4">
      <button
        aria-expanded={open}
        className="group flex w-full items-start justify-between gap-3 text-left"
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        <div>
          <h3 className="text-xl font-semibold">Treatment Plan Settings</h3>
          <p className="text-sm text-[var(--text-muted)]">
            Choose which Plan macros are treatment regions, and how plans interact with
            auto-salting.
          </p>
        </div>
        <span
          aria-hidden
          className={`mt-1 inline-flex h-6 w-6 items-center justify-center rounded-full border border-[var(--line-soft)] text-sm transition-transform ${
            open ? "rotate-180" : ""
          }`}
        >
          ⌄
        </span>
      </button>

      {open && (
        <div className="mt-3 space-y-5">
          <div>
            <h4 className="text-sm font-semibold text-[var(--text-muted)]">Regions</h4>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              Check the Plan-section macros that are treatment regions (Cervical, Lumbar, …).
              Each brings its own “Region: treatments” output and charge-linked treatments.
            </p>

            {!hasPlanMacros && (
              <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                No Plan-section macros found. Create your region macros in SOAP Macros (Plan
                section) first, then check them here.
              </p>
            )}

            <div className="mt-2 space-y-3">
              {folders.map(([folder, macros]) => {
                const ids = macros.map((m) => m.id);
                const allOn = ids.every((id) => regionSet.has(id));
                const someOn = !allOn && ids.some((id) => regionSet.has(id));
                const isOpen = openFolders.has(folder);
                return (
                  <div key={folder} className="rounded-lg border border-[var(--line-soft)] bg-white p-2">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <input
                        checked={allOn}
                        className="cursor-pointer"
                        ref={(el) => {
                          if (el) el.indeterminate = someOn;
                        }}
                        onChange={(e) => setRegionMembership(ids, e.target.checked)}
                        type="checkbox"
                      />
                      <button
                        className="flex flex-1 items-center gap-2 text-left"
                        onClick={() => toggleFolder(folder)}
                        type="button"
                      >
                        <span
                          aria-hidden
                          className={`inline-block text-xs text-[var(--text-muted)] transition-transform ${
                            isOpen ? "rotate-90" : ""
                          }`}
                        >
                          ▸
                        </span>
                        {folder}
                        <span className="text-xs font-normal text-[var(--text-muted)]">
                          ({ids.filter((id) => regionSet.has(id)).length}/{ids.length})
                        </span>
                      </button>
                    </div>
                    {isOpen && (
                      <div className="mt-1.5 grid gap-1 border-t border-[var(--line-soft)] pt-1.5">
                        {macros.map((m) => (
                          <label
                            key={m.id}
                            className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-[var(--bg-soft)]"
                          >
                            <input
                              checked={regionSet.has(m.id)}
                              onChange={(e) => toggleRegion(m.id, e.target.checked)}
                              type="checkbox"
                            />
                            {m.buttonName}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-[var(--text-muted)]">Behavior</h4>
            <div className="mt-2 space-y-2">
              <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-[var(--line-soft)] bg-white px-3 py-2 text-sm">
                <input
                  checked={settings.planOverridesSalt}
                  className="mt-0.5"
                  onChange={(e) => setToggle("planOverridesSalt", e.target.checked)}
                  type="checkbox"
                />
                <span>
                  <span className="font-semibold">Plan overrides auto-salt</span>
                  <span className="block text-xs text-[var(--text-muted)]">
                    When a patient has an active treatment plan, turn off the prior-encounter
                    auto-salt — the plan drives the Plan section.
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-[var(--line-soft)] bg-white px-3 py-2 text-sm">
                <input
                  checked={settings.saltConfirmsReplace}
                  className="mt-0.5"
                  onChange={(e) => setToggle("saltConfirmsReplace", e.target.checked)}
                  type="checkbox"
                />
                <span>
                  <span className="font-semibold">Confirm before replacing Plan text</span>
                  <span className="block text-xs text-[var(--text-muted)]">
                    When applying a plan (SALT) and the Plan section already has content, ask before
                    replacing it.
                  </span>
                </span>
              </label>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
