"use client";

/**
 * Shared cloud-auth helpers.
 *
 * Every *-cloud.ts module used to have its own copy of a
 * `resolveValidatedWorkspaceId()` function that called
 * `supabase.auth.getUser()` on every upsert/delete. When a user triggers
 * a lot of cloud writes in quick succession (Consolidate Attorneys, a
 * bulk patient edit, the schedule-settings bootstrap, etc.) those calls
 * fight for the `navigator.locks` auth lock that supabase-js holds for
 * `getUser()` and one of them eventually loses with
 *     AbortError: Lock broken by another request with the 'steal' option.
 *
 * This module centralizes two defenses so every cloud module gets them:
 *
 *   1. Cross-module in-flight Promise dedupe — concurrent callers (even
 *      from different *-cloud modules) share ONE round-trip to
 *      supabase.auth.getUser() instead of racing.
 *   2. Short-lived validation cache (5s) — subsequent writes inside a
 *      burst reuse the validated workspaceId without re-calling getUser().
 *   3. Lock-steal retry helper — the auth lock can still be contested
 *      across tabs; any op that hit the transient AbortError retries
 *      exactly once after invalidating the cache.
 */

import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { getActiveWorkspaceIdSync } from "@/lib/workspace-storage";

const WORKSPACE_VALIDATION_TTL_MS = 5000;

let cachedValidation: { workspaceId: string; expiresAt: number } | null = null;
let inFlightValidation: Promise<string> | null = null;

/** Drop the cached workspace validation. Called after a lock-steal retry
 *  and exported so auth state-change handlers can force a refresh on
 *  sign-out / account switch. */
export function invalidateCloudAuthCache() {
  cachedValidation = null;
  inFlightValidation = null;
}

function getActiveWorkspaceOrNull(): string | null {
  const id = getActiveWorkspaceIdSync();
  return id || null;
}

/**
 * Resolve + validate the workspace_id for the current auth session. Prefix
 * the error messages with a caller-specific tag (e.g. "[patients-cloud]")
 * so the error log still tells you WHICH table the write was against.
 */
export async function resolveValidatedWorkspaceId(
  logPrefix: string,
  source: string,
): Promise<string> {
  if (cachedValidation && cachedValidation.expiresAt > Date.now()) {
    return cachedValidation.workspaceId;
  }
  if (inFlightValidation) {
    return inFlightValidation;
  }

  inFlightValidation = (async () => {
    const workspaceId = getActiveWorkspaceOrNull();
    if (!workspaceId) {
      throw new Error(`${logPrefix} ${source}: no active workspace id in localStorage`);
    }
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      throw new Error(`${logPrefix} ${source}: supabase client not configured`);
    }
    // Use getSession() (reads the token from localStorage — NO network) rather
    // than getUser() (which hits the Supabase auth server on every single
    // write). getUser's network round-trip was the single point of failure
    // behind the "auth.getUser failed: Failed to fetch" sync errors: a blip
    // reaching the auth endpoint blocked EVERY save even when the database was
    // reachable. session.user.id is the same JWT subject RLS enforces, so this
    // keeps the workspace/user-prefix guard intact; a genuinely revoked or
    // expired token still gets rejected server-side by RLS on the real write.
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      throw new Error(`${logPrefix} ${source}: auth.getSession failed: ${error.message}`);
    }
    const userId = data.session?.user?.id;
    if (!userId) {
      throw new Error(`${logPrefix} ${source}: no authenticated user`);
    }
    const prefix = workspaceId.split(":")[0];
    if (prefix !== userId) {
      throw new Error(
        `${logPrefix} ${source}: workspace/user mismatch — ` +
          `workspace_id prefix="${prefix}" does not match auth.uid="${userId}". ` +
          `Refusing to write (would be silently rejected by RLS).`,
      );
    }
    cachedValidation = {
      workspaceId,
      expiresAt: Date.now() + WORKSPACE_VALIDATION_TTL_MS,
    };
    return workspaceId;
  })();

  try {
    return await inFlightValidation;
  } finally {
    inFlightValidation = null;
  }
}

/**
 * Run `tasks` with bounded concurrency. Supabase's REST endpoints happily
 * accept parallel writes, but firing 20+ at once when the network is
 * already flaky gives every single one a chance to hit the same packet
 * loss and fail together. Running a max of N at a time means early
 * failures retry while later ops are still queued — less thundering herd.
 *
 * Returns PromiseSettledResult[] in the same order as the input tasks so
 * callers can preserve their existing "X of Y failed" aggregate logic.
 */
export async function runBatched<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number = 4,
): Promise<PromiseSettledResult<T>[]> {
  if (tasks.length === 0) return [];
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= tasks.length) return;
      try {
        const value = await tasks[index]();
        results[index] = { status: "fulfilled", value };
      } catch (err) {
        results[index] = { status: "rejected", reason: err };
      }
    }
  });

  await Promise.all(workers);
  return results;
}

function isLockStealError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  // Older supabase-js / older Web Locks polyfill variant.
  if (message.includes("Lock broken by another request with the 'steal' option")) {
    return true;
  }
  // Newer supabase-js phrasing seen in the wild — same root cause
  // (auth-token lock contested across concurrent requests / tabs),
  // different error string. Without this branch the retry path
  // didn't fire and the user got a "Cloud sync failed" toast on
  // bursts like the 1067-op schedule-appointments hydrate.
  if (
    message.includes("was released because another request stole it") ||
    message.includes("was released because another request stole") ||
    (message.includes("Lock") && message.includes("stole"))
  ) {
    return true;
  }
  // Generic AbortError with "Lock" in the message — catch-all for
  // future supabase-js wording shifts.
  if (err instanceof Error && err.name === "AbortError" && message.includes("Lock")) {
    return true;
  }
  return false;
}

function isTransientNetworkError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  // "Failed to fetch" is what every Chromium/WebKit browser throws for a
  // network abort / no-response scenario. "TypeError: NetworkError..." is
  // Firefox's equivalent. "Load failed" is Safari. All three are transient
  // and safe to retry once — the supabase-js upsert/delete is idempotent
  // on (workspace_id, id) so a duplicate retry is harmless.
  return (
    message.includes("Failed to fetch") ||
    message.includes("NetworkError") ||
    message.includes("Load failed")
  );
}

/**
 * Wrap a Supabase operation so that transient lock-steal or network
 * errors trigger a short retry loop. Any non-transient error propagates
 * on the first hit.
 *
 * Retry policy:
 *  - Lock-steal (navigator.locks contention): 1 retry, no backoff.
 *    The contesting lock holder releases the moment its op finishes,
 *    so an immediate retry almost always wins.
 *  - Network errors ("Failed to fetch", "NetworkError", "Load failed"):
 *    up to 3 retries with exponential backoff (500ms → 1000ms → 2000ms).
 *    WiFi blips and Supabase transient 502s / cold edge starts are
 *    usually <2s, so three tries covers the vast majority without
 *    dragging out the user's perceived wait. supabase-js upsert on
 *    (workspace_id, id) is idempotent, so duplicate retries are safe.
 *
 * If every retry fails, the last error is re-thrown so the caller's
 * error-report pipeline still runs.
 */
export async function withLockStealRetry<T>(op: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  const networkBackoffs = [500, 1000, 2000]; // up to 3 retries for network

  try {
    return await op();
  } catch (err) {
    lastError = err;
    if (isLockStealError(err)) {
      invalidateCloudAuthCache();
      try {
        return await op();
      } catch (retryErr) {
        lastError = retryErr;
        // Fall through to the network-retry loop on EITHER a network
        // blip OR another lock-steal. Bursts like the 1067-op
        // schedule-appointments hydrate can re-contest the auth lock
        // back-to-back; throwing on the second contest left the user
        // staring at a red toast even though the next backoff would
        // have succeeded.
        if (!isTransientNetworkError(retryErr) && !isLockStealError(retryErr)) {
          throw retryErr;
        }
      }
    } else if (!isTransientNetworkError(err)) {
      throw err;
    }

    // Network retry loop — retries 1 through 3 with exponential backoff.
    for (let attempt = 0; attempt < networkBackoffs.length; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, networkBackoffs[attempt]));
      invalidateCloudAuthCache();
      try {
        return await op();
      } catch (retryErr) {
        lastError = retryErr;
        if (!isTransientNetworkError(retryErr) && !isLockStealError(retryErr)) {
          throw retryErr;
        }
        // Keep retrying on transient errors until we exhaust the loop.
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(String(lastError));
  }
}
