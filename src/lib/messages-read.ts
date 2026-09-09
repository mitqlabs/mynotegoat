"use client";

/**
 * Per-viewer "last seen" bookkeeping for the Messages tab, so we can show
 * an unread counter on the nav (phone-style badge). This is a local
 * convenience — it lives in this browser only (localStorage), never synced.
 */

const KEY = "casemate.messages.last-seen.v1";
export const MESSAGES_SEEN_EVENT = "casemate:messages-seen";

export function getLastSeen(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

/** Mark messages read up to `iso` (default: now) and notify listeners. */
export function markMessagesSeen(iso?: string) {
  if (typeof window === "undefined") return;
  const value = iso && iso > getLastSeen() ? iso : new Date().toISOString();
  try {
    window.localStorage.setItem(KEY, value);
  } catch {
    // ignore
  }
  window.dispatchEvent(new CustomEvent(MESSAGES_SEEN_EVENT));
}
