"use client";

/**
 * Draft Recovery
 *
 * Last-ditch data safety layer. Every contentEditable-backed field in
 * the app can register a `draftKey` that causes the editor to write
 * its raw current HTML to localStorage on EVERY input event — BEFORE
 * any React state update, BEFORE any cloud sync, BEFORE any
 * debouncing.
 *
 * The React component tree is the UI. The normal encounter-notes
 * storage key is the "committed" source of truth. Draft keys are the
 * last-known-keystroke safety net. Three layers:
 *
 *   Layer 1: React state        — what the user sees, can be lost on
 *                                 crash / tab close / browser OOM
 *   Layer 2: Encounter storage  — saveEncounterNoteRecords flushes
 *                                 after React state changes, normally
 *                                 within ~16ms of a keystroke
 *   Layer 3: Draft keys (this)  — written SYNCHRONOUSLY inside the
 *                                 editor's onInput handler, BEFORE
 *                                 React reconciles. Survives any
 *                                 crash that happens after the key-
 *                                 stroke fires and before the React
 *                                 flush completes.
 *
 * On app load, scanDrafts() returns every outstanding draft. If the
 * draft's content doesn't match the committed encounter storage, the
 * Draft Recovery banner prompts the user to restore.
 *
 * The draft key format is:
 *   casemate.draft.v1.<encounterId>.<section>
 *
 * where section is one of the SOAP section names. One key per
 * editable field so recoveries are granular — we never overwrite
 * uninvolved fields.
 */

const DRAFT_KEY_PREFIX = "casemate.draft.v1.";

/** Build a stable draft key for an encounter SOAP section. */
export function draftKeyFor(encounterId: string, section: string): string {
  // Sanitize to alphanumeric + dash/underscore so the key is
  // round-trippable. Anything else would technically be fine for
  // localStorage but makes the keys harder to grep in devtools.
  const safeId = encounterId.replace(/[^a-zA-Z0-9_-]/g, "");
  const safeSection = section.replace(/[^a-zA-Z0-9_-]/g, "");
  return `${DRAFT_KEY_PREFIX}${safeId}.${safeSection}`;
}

/**
 * Synchronously write the current editor HTML to the draft key.
 * Called inline from the editor's onInput handler. Cheap (localStorage
 * writes are ~50µs) and wrapped in try/catch so a quota error never
 * kills the input pipeline.
 */
export function writeDraft(draftKey: string, html: string): void {
  if (typeof window === "undefined") return;
  try {
    // Strip the "last-modified" + HTML into a single value. We store
    // both so on recovery we can show the user WHEN the draft was last
    // touched — handy for deciding whether to restore.
    const payload = JSON.stringify({ at: Date.now(), html });
    window.localStorage.setItem(draftKey, payload);
  } catch {
    // Quota exceeded or other storage failure. Silent — the user's
    // committed encounter storage still runs on the normal path, this
    // is the belt AND suspenders. Swallowing here keeps the input
    // handler fast-path pristine.
  }
}

/**
 * Clear a draft key. Called from the encounter-notes save path so a
 * successful commit removes its corresponding draft — no false
 * "recover unsaved work" prompts on the next page load.
 */
export function clearDraft(draftKey: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(draftKey);
  } catch {
    // Same rationale as writeDraft.
  }
}

/** Clear every draft key for a given encounter id (all sections). */
export function clearDraftsForEncounter(encounterId: string): void {
  if (typeof window === "undefined") return;
  const prefix = `${DRAFT_KEY_PREFIX}${encounterId.replace(/[^a-zA-Z0-9_-]/g, "")}.`;
  try {
    // Collect first, then delete — avoids mutating length while iterating.
    const toDelete: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith(prefix)) toDelete.push(key);
    }
    for (const key of toDelete) window.localStorage.removeItem(key);
  } catch {
    // Same rationale as writeDraft.
  }
}

export type DraftEntry = {
  key: string;
  encounterId: string;
  section: string;
  at: number;
  html: string;
};

/**
 * Return every live draft in localStorage. Called on app load by the
 * Draft Recovery prompt to figure out if there's unflushed work from
 * a prior session. Entries older than `maxAgeMs` (default 24 hours)
 * are ignored and garbage-collected.
 *
 * The age window was 7 days historically, but drafts are a crash-
 * recovery aid — nobody is going to meaningfully "recover" work from
 * a week ago, and keeping them that long let the HTML snapshots
 * accumulate into megabytes of localStorage quota during long-running
 * sessions. 24 hours is ample for next-morning recovery after a
 * crash the night before.
 */
export function scanDrafts(maxAgeMs: number = 24 * 60 * 60 * 1000): DraftEntry[] {
  if (typeof window === "undefined") return [];
  const now = Date.now();
  const entries: DraftEntry[] = [];
  const toDelete: string[] = [];
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key || !key.startsWith(DRAFT_KEY_PREFIX)) continue;
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      let parsed: { at?: unknown; html?: unknown };
      try {
        parsed = JSON.parse(raw);
      } catch {
        toDelete.push(key);
        continue;
      }
      if (typeof parsed.at !== "number" || typeof parsed.html !== "string") {
        toDelete.push(key);
        continue;
      }
      if (now - parsed.at > maxAgeMs) {
        toDelete.push(key);
        continue;
      }
      // Decompose the key back into encounterId + section.
      const rest = key.slice(DRAFT_KEY_PREFIX.length);
      const dotIdx = rest.indexOf(".");
      if (dotIdx < 0) {
        toDelete.push(key);
        continue;
      }
      entries.push({
        key,
        encounterId: rest.slice(0, dotIdx),
        section: rest.slice(dotIdx + 1),
        at: parsed.at,
        html: parsed.html,
      });
    }
    for (const key of toDelete) {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Ignore — scan is best-effort.
  }
  return entries;
}
