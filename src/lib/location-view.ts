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
