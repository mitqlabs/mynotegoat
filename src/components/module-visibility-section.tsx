"use client";

import { useState } from "react";
import { useModuleVisibility } from "@/hooks/use-module-visibility";
import { HIDEABLE_FEATURES } from "@/lib/module-visibility";

/**
 * Settings → Features. The owner turns features on/off. A hidden feature
 * disappears from the sidebar and its entry points across the app; its
 * background behavior (e.g. Key Dates auto-populated by scheduling) keeps
 * running. Self-contained (own open-state) so it drops into the Settings
 * page without touching that page's section-key machinery.
 */
export function ModuleVisibilitySection() {
  const { isFeatureEnabled, setFeatureEnabled } = useModuleVisibility();
  const [open, setOpen] = useState(false);

  const hiddenCount = HIDEABLE_FEATURES.filter((f) => !isFeatureEnabled(f.feature)).length;

  return (
    <section className="panel-card p-4">
      <button
        aria-expanded={open}
        className="group flex w-full items-start justify-between gap-3 text-left"
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        <div>
          <h3 className="text-xl font-semibold">Features</h3>
          <p className="text-sm text-[var(--text-muted)]">
            Turn off features your office doesn&apos;t use — they disappear from the menu and
            everywhere they appear.{hiddenCount > 0 ? ` ${hiddenCount} hidden.` : ""}
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
        <div className="mt-3">
          <p className="mb-2 text-xs text-[var(--text-muted)]">
            Patients and Settings are always available.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {HIDEABLE_FEATURES.map(({ feature, label }) => {
              const enabled = isFeatureEnabled(feature);
              return (
                <label
                  key={feature}
                  className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                >
                  <span className="text-sm font-medium">{label}</span>
                  <button
                    aria-label={`${enabled ? "Disable" : "Enable"} ${label}`}
                    aria-pressed={enabled}
                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                      enabled ? "bg-[var(--brand-primary)]" : "bg-[var(--line-strong)]"
                    }`}
                    onClick={(e) => {
                      e.preventDefault();
                      setFeatureEnabled(feature, !enabled);
                    }}
                    type="button"
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                        enabled ? "translate-x-5" : "translate-x-0.5"
                      }`}
                    />
                  </button>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
