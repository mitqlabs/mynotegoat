/**
 * A fresh app launch is the first navigation of a browser tab. sessionStorage
 * dies with the tab, so a bookmark, Dock icon, or restored tab that opens
 * exactly on Patient List can be sent to the person's first sidebar page.
 * A click to Patient List later in that same tab is not a launch.
 */

export const SIDEBAR_LAUNCH_SEEN_KEY = "casemate.sidebar-launch.v1";

/** Same document (including React strict-mode's second mount) shares one answer. */
let launchClaim: boolean | null = null;

export function resetSidebarLaunchClaim(): void {
  launchClaim = null;
}

/** True only the first time this tab asks. Marks the tab so later loads are not launches. */
export function claimFreshLaunch(session: Pick<Storage, "getItem" | "setItem">): boolean {
  if (launchClaim !== null) return launchClaim;
  try {
    const seen = session.getItem(SIDEBAR_LAUNCH_SEEN_KEY) === "1";
    if (!seen) session.setItem(SIDEBAR_LAUNCH_SEEN_KEY, "1");
    launchClaim = !seen;
  } catch {
    launchClaim = false;
  }
  return launchClaim;
}

/** The Patient List itself. A case file (/patients/<id>) or a query (?view=toDo) stays put. */
export function isExactPatientsListEntry(pathname: string, search = ""): boolean {
  const path = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  return path === "/patients" && search === "";
}

/**
 * Where a fresh launch that opened exactly on Patient List should go.
 * Null means stay: not a launch, not exactly /patients, or Patient List is already first.
 */
export function patientsLaunchRedirect(input: {
  fresh: boolean;
  pathname: string;
  search: string;
  landingHref: string | null | undefined;
}): string | null {
  if (!input.fresh || !isExactPatientsListEntry(input.pathname, input.search)) return null;
  const href = input.landingHref ?? "";
  if (!href || href === "/patients") return null;
  return href;
}
