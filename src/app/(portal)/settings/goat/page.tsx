"use client";

import { useEffect } from "react";
import Link from "next/link";
import { GoatAnswerPrefsPanel } from "@/components/goat-answer-prefs-panel";
import { GoatLearnedPanel } from "@/components/goat-learned-panel";
import { GoatMailSettingsPanel } from "@/components/goat-mail-settings";
import { GoatPageSettings } from "@/components/goat-page-settings";
import { GoatSettingsPanel } from "@/components/goat-settings-panel";
import { NoteSignersPanel } from "@/components/note-signers-panel";
import { useWorkspaceAccess } from "@/lib/workspace-access-context";

export default function GoatSettingsPage() {
  const { canEdit } = useWorkspaceAccess();
  useEffect(() => {
    const id = window.location.hash.replace(/^#/, "");
    if (!id) return;
    document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, []);
  return (
    <div className="space-y-5" data-goat-settings-page>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link className="text-sm font-semibold text-[var(--brand-primary)] hover:underline" href="/settings">
          ← Settings
        </Link>
      </div>
      <h1 className="text-2xl font-semibold">G.O.A.T.</h1>
      <section className="panel-card p-4" id="goat-page">
        <h2 className="text-xl font-semibold">G.O.A.T. Page</h2>
        <p className="text-sm text-[var(--text-muted)]">Which boxes are on the board, and what each box shows.</p>
        <div className="mt-3">
          <GoatPageSettings canSetOfficeDefault={canEdit("settings")} />
        </div>
      </section>
      <section className="panel-card space-y-5 p-4" id="chat">
        <div>
          <h2 className="text-xl font-semibold">G.O.A.T. chat</h2>
          <p className="text-sm text-[var(--text-muted)]">How the chat reads what you type, the words it knows, and who signs a note.</p>
        </div>
        <div>
          <h3 className="text-lg font-semibold">G.O.A.T. answers</h3>
          <p className="text-sm text-[var(--text-muted)]">How G.O.A.T. writes recommendations, on screen and when you Copy. Shared by everyone in the office.</p>
          <div className="mt-3">
            <GoatAnswerPrefsPanel />
          </div>
        </div>
        <div>
          <h3 className="text-lg font-semibold" id="goat-library">G.O.A.T. Library</h3>
          <p className="text-sm text-[var(--text-muted)]">How G.O.A.T. matches what you type to an action: what it learned in your office, and what comes built in.</p>
          <div className="mt-3">
            <GoatLearnedPanel />
          </div>
        </div>
        <div>
          <h3 className="text-lg font-semibold">G.O.A.T. words &amp; abbreviations</h3>
          <p className="text-sm text-[var(--text-muted)]">Synonyms and abbreviations G.O.A.T. uses when you ask about a patient. Shared by everyone in the office.</p>
          <div className="mt-3">
            <GoatSettingsPanel />
          </div>
        </div>
        <div>
          <h3 className="text-lg font-semibold">Note signatures</h3>
          <p className="text-sm text-[var(--text-muted)]">
            Notes added with G.O.A.T. end with the signer: doctors sign &quot;-Dr. Mike&quot;, everyone else their first name (&quot;-Hannah&quot;). Link a person to their login to sign automatically; otherwise the note card asks &quot;Signed as&quot;. Saved to your account.
          </p>
          <div className="mt-3">
            <NoteSignersPanel />
          </div>
        </div>
      </section>
      <section className="panel-card p-4" id="goat-mail">
        <h2 className="text-xl font-semibold">G.O.A.T. Mail</h2>
        <p className="text-sm text-[var(--text-muted)]">The office mailbox, the folders G.O.A.T. reads, and how messages are sorted. Read-only: G.O.A.T. never sends or changes email.</p>
        <div className="mt-3">
          <GoatMailSettingsPanel />
        </div>
      </section>
    </div>
  );
}
