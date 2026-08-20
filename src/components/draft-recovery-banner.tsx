"use client";

/**
 * Draft Recovery Banner
 *
 * On app load, scans localStorage for per-encounter-section draft keys
 * that the crash-safe editor layer (`src/lib/draft-recovery.ts`) writes
 * on EVERY keystroke. If any draft doesn't match the committed
 * encounter content, we surface a recovery prompt at the top of the
 * screen so the user can:
 *   - Restore the draft into the encounter (takes them straight to
 *     the affected SOAP section with the draft HTML pre-filled), OR
 *   - Dismiss if they already did the recovery elsewhere / don't want
 *     the draft
 *
 * The banner is deliberately persistent (can't be closed by clicking
 * outside) to prevent a panicking user from accidentally losing the
 * only remaining copy of their work.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  loadEncounterNoteRecords,
  saveEncounterNoteRecords,
} from "@/lib/encounter-notes";
import { clearDraft, scanDrafts, type DraftEntry } from "@/lib/draft-recovery";

function formatAge(at: number): string {
  const diff = Date.now() - at;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

type PendingDraft = DraftEntry & {
  encounterLabel: string | null;
  committedHtml: string;
};

/**
 * Parse the create-time timestamp out of an encounter id shaped like
 * `enc-1776737838030-u31ywj` → Date. Returns null if the id isn't in
 * that format. Used as a last-resort label when the encounter was
 * pruned from the local cache so we can at least show the user when
 * the draft originated instead of raw gibberish.
 */
function parseEncounterIdTimestamp(id: string): Date | null {
  const match = id.match(/^enc-(\d+)-/);
  if (!match) return null;
  const ms = Number(match[1]);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function formatIdFallbackLabel(id: string): string {
  const timestamp = parseEncounterIdTimestamp(id);
  if (!timestamp) return `Encounter ${id}`;
  return `Encounter from ${timestamp.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;
}

export function DraftRecoveryBanner() {
  const router = useRouter();
  const [pending, setPending] = useState<PendingDraft[]>([]);
  const [dismissed, setDismissed] = useState(false);

  // Scan for ORPHAN drafts — drafts whose parent encounter is no longer
  // present in the local cache. The banner is strictly for this case: the
  // encounter went missing and the typed text is the only copy left. Normal
  // uncommitted drafts (encounter present) are the editor's own crash-recovery
  // layer and must never bug the user here.
  //
  // CRITICAL timing: on a fresh page load the cloud hasn't hydrated the
  // encounter cache yet, so an encounter that's merely still-downloading looks
  // "missing" and its draft is falsely flagged as orphaned — the scary
  // "unsaved work recovered / Restored 0 drafts" false alarm. So we evaluate
  // once, and if there are any candidate orphans we WAIT a grace period for the
  // cloud to catch up and re-evaluate, surfacing only drafts that are STILL
  // orphaned. A draft whose encounter has since loaded is dropped (and cleared
  // if its content already matches the now-present encounter).
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const evaluateOrphans = (): PendingDraft[] => {
      const drafts = scanDrafts();
      if (drafts.length === 0) return [];
      const encounters = loadEncounterNoteRecords();
      const byId = new Map(encounters.map((e) => [e.id, e]));
      const orphans: PendingDraft[] = [];
      for (const draft of drafts) {
        if (byId.has(draft.encounterId)) continue; // encounter present — not orphan
        if (!draft.html.trim()) {
          clearDraft(draft.key); // empty body — nothing to recover, GC it
          continue;
        }
        orphans.push({
          ...draft,
          encounterLabel: formatIdFallbackLabel(draft.encounterId),
          committedHtml: "",
        });
      }
      return orphans;
    };

    // First pass. No candidates → nothing to do, and no false alarm.
    if (evaluateOrphans().length === 0) return;

    // Candidates exist — give the cloud time to hydrate, then re-check. Only
    // drafts still orphaned after the grace window reach the banner.
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      setPending(evaluateOrphans());
    }, 6000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const visibleDrafts = useMemo(() => pending.slice(0, 5), [pending]);

  if (dismissed || pending.length === 0) return null;

  const handleRestoreAll = () => {
    // For each pending draft, overwrite the committed encounter with
    // the draft content. We go through loadEncounterNoteRecords →
    // saveEncounterNoteRecords so the cloud dual-write fires too.
    const encounters = loadEncounterNoteRecords();
    const byId = new Map(encounters.map((e) => [e.id, { ...e, soap: { ...e.soap } }]));
    // Track which drafts had a home — only those get cleared after
    // restore. Orphan drafts (no matching encounter) stay in place so
    // a later page load (e.g. after cloud sync catches up) can still
    // recover them. Silently clearing them used to lose the user's
    // typed text the moment they clicked Restore on a stale banner.
    const restoredDrafts: typeof pending = [];
    const orphanDrafts: typeof pending = [];
    for (const draft of pending) {
      const target = byId.get(draft.encounterId);
      if (!target) {
        orphanDrafts.push(draft);
        continue;
      }
      (target.soap as Record<string, string>)[draft.section] = draft.html;
      target.updatedAt = new Date().toISOString();
      restoredDrafts.push(draft);
    }
    const next = Array.from(byId.values());
    saveEncounterNoteRecords(next);
    // Drafts that matched a real encounter get cleared. Orphans stay.
    for (const draft of restoredDrafts) clearDraft(draft.key);
    if (orphanDrafts.length > 0) {
      window.alert(
        `Restored ${restoredDrafts.length} draft${restoredDrafts.length === 1 ? "" : "s"}.\n\n` +
          `${orphanDrafts.length} draft${orphanDrafts.length === 1 ? "" : "s"} could not be restored ` +
          "because the encounter they belong to wasn't in the local cache " +
          "(it may still be loading from the cloud). These drafts are kept " +
          "in place — open the encounter or reload the page to try again. " +
          "Use Delete all drafts only when you're sure you don't need them.",
      );
    }
    setDismissed(true);
    // Reload so every open React tree picks up the restored state.
    router.refresh();
  };

  const handleDismissAll = () => {
    // Count orphans separately so the warning is sharper — the user
    // can decide whether to throw away typed text that has nowhere
    // to land (vs. drafts that were just stale duplicates of saved
    // content).
    const encounters = loadEncounterNoteRecords();
    const byId = new Map(encounters.map((e) => [e.id, e]));
    const orphanCount = pending.filter((d) => !byId.has(d.encounterId)).length;
    const extra =
      orphanCount > 0
        ? `\n\nWARNING: ${orphanCount} of these draft${orphanCount === 1 ? "" : "s"} ` +
          "had no matching encounter on this device — their text exists ONLY in the draft. " +
          "Deleting will lose that text permanently."
        : "";
    const confirmed = window.confirm(
      `You have ${pending.length} unsaved draft(s) from a prior session.\n\n` +
        "Dismissing will PERMANENTLY delete these drafts without restoring them." +
        extra +
        "\n\nAre you absolutely sure?",
    );
    if (!confirmed) return;
    for (const draft of pending) clearDraft(draft.key);
    setDismissed(true);
  };

  return (
    <div className="fixed inset-x-0 top-0 z-[70] bg-amber-500 px-4 py-3 text-sm font-semibold text-amber-950 shadow-lg">
      <div className="mx-auto flex max-w-4xl flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>
            ⚠ Unsaved work recovered — {pending.length} draft{pending.length === 1 ? "" : "s"} from
            a previous session
          </span>
          <div className="flex items-center gap-2">
            <button
              className="rounded-md bg-amber-950 px-3 py-1 text-xs font-semibold text-amber-50 hover:bg-amber-900"
              onClick={handleRestoreAll}
              type="button"
            >
              Restore all
            </button>
            <button
              className="rounded-md border border-amber-950/40 bg-amber-400/40 px-3 py-1 text-xs font-semibold text-amber-950 hover:bg-amber-400/60"
              onClick={handleDismissAll}
              type="button"
            >
              Delete all drafts
            </button>
          </div>
        </div>
        <ul className="max-h-48 overflow-y-auto space-y-1 border-t border-amber-950/30 pt-2 text-xs font-normal">
          {visibleDrafts.map((draft) => (
            <li key={draft.key} className="flex items-center justify-between gap-2">
              <span className="min-w-0 flex-1 truncate">
                <span className="font-semibold">
                  {draft.encounterLabel ?? `Encounter ${draft.encounterId}`}
                </span>
                <span className="ml-1 rounded bg-amber-950/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                  {draft.section}
                </span>
                <span className="ml-2 text-amber-950/70">{formatAge(draft.at)}</span>
              </span>
            </li>
          ))}
          {pending.length > visibleDrafts.length && (
            <li className="text-[10px] italic text-amber-950/70">
              …and {pending.length - visibleDrafts.length} more
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
