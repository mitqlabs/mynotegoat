"use client";

import { useState } from "react";
import { useTreatmentPlanSettings } from "@/hooks/use-treatment-plan-settings";
import { useMacroTemplates } from "@/hooks/use-macro-templates";

/**
 * Settings → Macros → Treatment Plan Settings.
 *
 * Define the body Regions available when building a patient's treatment
 * plan (each region points at a Plan-section macro), plus the behavior
 * toggles for how plans interact with salting. Self-contained (own
 * open-state) so it drops into the Settings page without touching that
 * page's section-key machinery.
 */
export function TreatmentPlanSettingsSection() {
  const { settings, addRegion, updateRegion, removeRegion, moveRegion, setToggle } =
    useTreatmentPlanSettings();
  const { macroLibrary } = useMacroTemplates();
  const [open, setOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [macroDraft, setMacroDraft] = useState("");

  const planMacros = macroLibrary.templates.filter(
    (t) => t.section === "plan" && t.active,
  );

  const macroName = (macroId: string) =>
    planMacros.find((m) => m.id === macroId)?.buttonName ?? "(pick a Plan macro)";

  const add = () => {
    const name = nameDraft.trim();
    if (!name || !macroDraft) return;
    addRegion(name, macroDraft);
    setNameDraft("");
    setMacroDraft("");
  };

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
            Regions used to build a patient&apos;s treatment plan, and how plans interact with
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
              Each region points at a Plan-section SOAP macro, which supplies its
              “Region: treatments” output and the charge-linked treatments.
            </p>

            {planMacros.length === 0 && (
              <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                No Plan-section macros found. Create your region macros (Cervical, Lumbar, …) in
                SOAP Macros first, then add them here.
              </p>
            )}

            <div className="mt-2 space-y-2">
              {settings.regions.map((region, index) => (
                <div
                  key={region.id}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--line-soft)] bg-white p-2"
                >
                  <div className="flex flex-col">
                    <button
                      aria-label="Move up"
                      className="px-1 text-xs leading-none text-[var(--text-muted)] hover:text-[var(--brand-primary)] disabled:opacity-30"
                      disabled={index === 0}
                      onClick={() => moveRegion(index, index - 1)}
                      type="button"
                    >
                      ▲
                    </button>
                    <button
                      aria-label="Move down"
                      className="px-1 text-xs leading-none text-[var(--text-muted)] hover:text-[var(--brand-primary)] disabled:opacity-30"
                      disabled={index === settings.regions.length - 1}
                      onClick={() => moveRegion(index, index + 1)}
                      type="button"
                    >
                      ▼
                    </button>
                  </div>
                  <input
                    className="w-40 rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1.5 text-sm"
                    onChange={(e) => updateRegion(region.id, { name: e.target.value })}
                    placeholder="Region name"
                    value={region.name}
                  />
                  <select
                    className="min-w-[160px] flex-1 rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1.5 text-sm"
                    onChange={(e) => updateRegion(region.id, { macroId: e.target.value })}
                    value={region.macroId}
                  >
                    <option value="">{macroName(region.macroId)}</option>
                    {planMacros.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.buttonName}
                      </option>
                    ))}
                  </select>
                  <button
                    className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-700"
                    onClick={() => {
                      if (window.confirm(`Delete the “${region.name}” region?`)) {
                        removeRegion(region.id);
                      }
                    }}
                    type="button"
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                className="w-40 rounded-lg border border-[var(--line-soft)] bg-white px-2 py-2 text-sm"
                onChange={(e) => setNameDraft(e.target.value)}
                placeholder="e.g. Cervical"
                value={nameDraft}
              />
              <select
                className="min-w-[160px] flex-1 rounded-lg border border-[var(--line-soft)] bg-white px-2 py-2 text-sm"
                onChange={(e) => setMacroDraft(e.target.value)}
                value={macroDraft}
              >
                <option value="">Pick its Plan macro…</option>
                {planMacros.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.buttonName}
                  </option>
                ))}
              </select>
              <button
                className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-white transition-all active:scale-[0.97] disabled:opacity-40"
                disabled={!nameDraft.trim() || !macroDraft}
                onClick={add}
                type="button"
              >
                Add Region
              </button>
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
