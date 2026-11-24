"use client";

/**
 * The viewer's currently-selected location ("current office view"), shared
 * across the Schedule and the Patients list. Per-viewer (localStorage),
 * defaults to the member's assigned main location at first load.
 *
 * "" means "All locations".
 */

const KEY = "casemate.location-view.v1";
export const LOCATION_VIEW_EVENT = "casemate:location-view-changed";

export function getSelectedLocationId(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function setSelectedLocationId(id: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, id);
  } catch {
    // ignore
  }
  window.dispatchEvent(new CustomEvent(LOCATION_VIEW_EVENT));
}

/** True once the viewer has an explicit stored choice (so we don't keep
 *  re-applying the login default over their manual switch). */
export function hasStoredLocationChoice(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(KEY) !== null;
  } catch {
    return false;
  }
}

const MAIN_APPLIED_KEY = "casemate.location-view-main-applied.v1";

/**
 * The location to switch to at login, or null to leave the viewer's view alone.
 * The member's main location is only a STARTING view (they can switch afterwards), applied:
 *   - when they have no stored choice on this device, or
 *   - when their main location is new or changed since it was last applied here
 *     (so an owner changing it actually reaches a device that already has a stored choice).
 * A main location that no longer exists is ignored.
 */
export function resolveLoginLocation(opts: {
  userId: string;
  main: string;
  locationIds: string[];
  stored: string | null;
  applied: string | null;
}): string | null {
  const { userId, main, locationIds, stored, applied } = opts;
  if (!main || !locationIds.includes(main)) return null;
  if (stored === null) return main;
  return applied === `${userId}:${main}` ? null : main;
}

export function getAppliedMain(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(MAIN_APPLIED_KEY);
  } catch {
    return null;
  }
}

export function markMainApplied(userId: string, main: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MAIN_APPLIED_KEY, `${userId}:${main}`);
  } catch {
    // ignore
  }
}
