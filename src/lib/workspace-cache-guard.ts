/**
 * Workspace cache guard (incident 2026-10-26).
 *
 * This browser's local cache must be tagged with the workspace it came from.
 * Local data may only be pushed or merged into the cloud workspace it is
 * tagged with. A cache from another workspace (or an untagged one that can't
 * prove where it came from) is discarded, never uploaded — and an "empty"
 * cloud workspace is only ever seeded from a cache with an exact tag match.
 *
 * Pure functions only, so they can be tested without a browser.
 */

/** localStorage key holding the workspace id the cached casemate.* data belongs to. */
export const CACHE_OWNER_KEY = "casemate.local-cache-workspace.v1";

export type CacheTrustInput = {
  /** Value of CACHE_OWNER_KEY ("" when missing). */
  tag: string;
  /** Workspace the signed-in user is opening. */
  target: string;
  /** Active-workspace pointer from before this boot ("" when missing). */
  previousPointer: string;
  /** This browser has a cloud-sync timestamp recorded for `target`. */
  hasSyncAtForTarget: boolean;
};

/**
 * May this browser's local cache be treated as `target`'s data?
 * - Tagged: only an exact match.
 * - Untagged (caches written before the tag existed): only when the old
 *   pointer already named `target` AND this browser has synced with it.
 */
export function isLocalCacheTrusted(input: CacheTrustInput): boolean {
  const target = input.target.trim();
  if (!target) return false;
  const tag = input.tag.trim();
  if (tag) return tag === target;
  return input.previousPointer.trim() === target && input.hasSyncAtForTarget;
}

/** Seed an EMPTY cloud workspace from local only with an exact, explicit tag match. */
export function canSeedEmptyCloud(tag: string, target: string): boolean {
  const t = target.trim();
  return t.length > 0 && tag.trim() === t;
}

/** Any upload/merge of local data into `target` requires an exact tag match. */
export function canPushLocalToWorkspace(tag: string, target: string): boolean {
  return canSeedEmptyCloud(tag, target);
}

export type BootCacheDecision = "keep-local" | "discard-local" | "nothing-local";

/** What to do with the local cache before reading the cloud. */
export function decideBootCache(input: CacheTrustInput & { localHasData: boolean }): BootCacheDecision {
  if (!input.localHasData) return "nothing-local";
  return isLocalCacheTrusted(input) ? "keep-local" : "discard-local";
}
