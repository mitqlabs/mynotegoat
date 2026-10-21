"use client";

import Link from "next/link";
import { GoatSettingsPanel } from "@/components/goat-settings-panel";
import { GoatAnswerPrefsPanel } from "@/components/goat-answer-prefs-panel";
import { NoteSignersPanel } from "@/components/note-signers-panel";
import { GoatLearnedPanel } from "@/components/goat-learned-panel";

export default function GoatSettingsPage() {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link className="text-sm font-semibold text-[var(--brand-primary)] hover:underline" href="/settings">
          ← Settings
        </Link>
      </div>
      <section className="panel-card p-4">
        <h3 className="text-xl font-semibold">G.O.A.T. answers</h3>
        <p className="text-sm text-[var(--text-muted)]">How G.O.A.T. writes recommendations, on screen and when you Copy. Shared by everyone in the office.</p>
        <div className="mt-3">
          <GoatAnswerPrefsPanel />
        </div>
      </section>
      <section className="panel-card p-4">
        <h3 className="text-xl font-semibold" id="goat-library">G.O.A.T. Library</h3>
        <p className="text-sm text-[var(--text-muted)]">How G.O.A.T. matches what you type to an action: what it learned in your office, and what comes built in.</p>
        <div className="mt-3">
          <GoatLearnedPanel />
        </div>
      </section>
      <section className="panel-card p-4">
        <h3 className="text-xl font-semibold">G.O.A.T. words &amp; abbreviations</h3>
        <p className="text-sm text-[var(--text-muted)]">
          Synonyms and abbreviations G.O.A.T. uses when you ask about a patient. Shared by everyone in the office.
        </p>
        <div className="mt-3">
          <GoatSettingsPanel />
        </div>
      </section>
      <section className="panel-card p-4">
        <h3 className="text-xl font-semibold">Note signatures</h3>
        <p className="text-sm text-[var(--text-muted)]">
          Notes added with G.O.A.T. end with the signer: doctors sign &quot;-Dr. Mike&quot;, everyone else their first name (&quot;-Hannah&quot;). Link a person to their login to sign automatically; otherwise the note card asks &quot;Signed as&quot;. Saved to your account.
        </p>
        <div className="mt-3">
          <NoteSignersPanel />
        </div>
      </section>
    </div>
  );
}
