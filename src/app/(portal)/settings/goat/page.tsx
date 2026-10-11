"use client";

import Link from "next/link";
import { GoatSettingsPanel } from "@/components/goat-settings-panel";
import { GoatAnswerPrefsPanel } from "@/components/goat-answer-prefs-panel";
import { GoatSmartSettings } from "@/components/goat-smart-settings";
import { GOAT_SMART_AVAILABLE } from "@/lib/goat-ai/flag";

export default function GoatSettingsPage() {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link className="text-sm font-semibold text-[var(--brand-primary)] hover:underline" href="/settings">
          ← Settings
        </Link>
      </div>
      <section className="panel-card p-4">
        <h3 className="text-xl font-semibold">G.O.A.T. words &amp; abbreviations</h3>
        <p className="text-sm text-[var(--text-muted)]">
          Synonyms and abbreviations G.O.A.T. uses when you ask about a patient. Shared by everyone in the office.
        </p>
        <div className="mt-3">
          <GoatSettingsPanel />
        </div>
      </section>
      {GOAT_SMART_AVAILABLE && (
        <section className="panel-card p-4">
          <h3 className="text-xl font-semibold">G.O.A.T.+ (beta)</h3>
          <p className="text-sm text-[var(--text-muted)]">Turned on per computer: the model is downloaded to, and runs on, this computer only.</p>
          <div className="mt-3">
            <GoatSmartSettings />
          </div>
        </section>
      )}
      {GOAT_SMART_AVAILABLE && (
        <section className="panel-card p-4">
          <h3 className="text-xl font-semibold">G.O.A.T.+ answers (beta)</h3>
          <p className="text-sm text-[var(--text-muted)]">
            How G.O.A.T.+ writes answers. Shared by everyone in the office. Regular G.O.A.T. isn&apos;t affected.
          </p>
          <div className="mt-3">
            <GoatAnswerPrefsPanel />
          </div>
        </section>
      )}
    </div>
  );
}
