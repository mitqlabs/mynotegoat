/**
 * Macro-run chips must match the note. A run is shown only when its id is in
 * that section's HTML. Cut/paste of a pill can hide the id for a moment, so a
 * run that was already on the note is kept briefly. A run that never appeared
 * in the HTML is dropped immediately — that is the doubled-chip bug, where an
 * extra run was recorded without a second copy of the text.
 */

export const MACRO_RUN_PRUNE_GRACE_MS = 5000;

export type MacroRunPresence = {
  /** `${encounterId}:${runId}` once that id has been seen in the section HTML. */
  seen: Set<string>;
  /** First time a previously-seen id went missing, for the cut/paste grace window. */
  missingSince: Map<string, number>;
};

export function macroRunPresenceKey(encounterId: string, runId: string): string {
  return `${encounterId}:${runId}`;
}

export function macroRunIdInHtml(html: string, runId: string): boolean {
  if (!runId) return false;
  return html.includes(`data-macro-run-id="${runId}"`) || html.includes(`data-macro-run-id='${runId}'`);
}

export function markMacroRunSeen(presence: MacroRunPresence, encounterId: string, runId: string): void {
  const key = macroRunPresenceKey(encounterId, runId);
  presence.seen.add(key);
  presence.missingSince.delete(key);
}

/**
 * If the whole section HTML is the same macro markup twice in a row, keep one
 * copy. Two real inserts get different run ids, so their HTML is not equal.
 */
export function collapseMirroredHtml(html: string): string {
  const trimmed = html.trim();
  if (trimmed.length < 40 || !trimmed.includes("data-macro-run-id")) return html;
  const mid = Math.floor(trimmed.length / 2);
  for (let gap = 0; gap <= 8; gap++) {
    const leftLen = mid - Math.floor(gap / 2);
    if (leftLen < 20) continue;
    const left = trimmed.slice(0, leftLen);
    const right = trimmed.slice(leftLen + gap);
    if (left === right) return left;
  }
  return html;
}

type RunLike = { id: string; section: string };

/**
 * Keep one run per id. For the section being edited, drop ids that are not in
 * the HTML. A previously-seen id gets a short grace period (cut, then paste).
 * An id that was never in the HTML is removed on this pass.
 */
export function reconcileMacroRuns<T extends RunLike>(args: {
  runs: readonly T[];
  encounterId: string;
  section: string;
  sectionHtml: string;
  presence: MacroRunPresence;
  now: number;
  graceMs?: number;
}): { runs: T[]; anyMissing: boolean } {
  const graceMs = args.graceMs ?? MACRO_RUN_PRUNE_GRACE_MS;
  const seenIds = new Set<string>();
  const next: T[] = [];
  let anyMissing = false;

  for (const run of args.runs) {
    if (!run.id || seenIds.has(run.id)) continue;
    if (run.section !== args.section) {
      seenIds.add(run.id);
      next.push(run);
      continue;
    }
    const key = macroRunPresenceKey(args.encounterId, run.id);
    if (macroRunIdInHtml(args.sectionHtml, run.id)) {
      markMacroRunSeen(args.presence, args.encounterId, run.id);
      seenIds.add(run.id);
      next.push(run);
      continue;
    }
    if (!args.presence.seen.has(key)) continue;
    const firstMissingAt = args.presence.missingSince.get(key);
    if (firstMissingAt === undefined) {
      args.presence.missingSince.set(key, args.now);
      anyMissing = true;
      seenIds.add(run.id);
      next.push(run);
      continue;
    }
    if (args.now - firstMissingAt < graceMs) {
      anyMissing = true;
      seenIds.add(run.id);
      next.push(run);
      continue;
    }
    args.presence.missingSince.delete(key);
    args.presence.seen.delete(key);
  }

  return { runs: next, anyMissing };
}
