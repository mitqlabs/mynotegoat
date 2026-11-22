/**
 * Each person's sidebar order. The list is saved on their cloud prefs
 * (casemate.sidebar-order.v1), never only in this browser.
 *
 * Settings is always last and is not part of the saved order. A page that
 * shows up later, and is missing from a saved order, is inserted where it
 * sits in the default list. Pages the office or the plan has hidden are
 * left out; they are not deleted from a saved order until the person saves
 * again.
 *
 * Plain code aside from the nav catalog, so the tests can run it.
 */

import {
  getDefaultPortalPath,
  getVisiblePortalNavItems,
  type PlanTier,
  type PortalFeature,
} from "@/lib/plan-access";

export const SIDEBAR_ORDER_KEY = "casemate.sidebar-order.v1";
export const SETTINGS_ID = "settings";
export const HANDBOOK_ID = "handbook";
export const GOAT_MAIL_ID = "goatMail";
export const GOAT_PAGE_ID = "goatPage";

export interface SidebarPage {
  id: string;
  href: string;
  label: string;
  feature?: PortalFeature;
  /** Handbook highlights only on its own path. The others highlight on sub-paths too. */
  active: "exact" | "prefix";
  kind: "link" | "goatPage";
}

/** Movable pages, in the order the sidebar uses when nobody has chosen. */
export const CASE_LIST_ID = "caseList";

/**
 * Nav pages with their sidebar ids. Uses the switch-aware list so Case List
 * (/cases, only with the patient-folder switch on) is its own movable page;
 * it shares the patients access feature but needs its own id.
 */
function navPages(): { id: string; href: string; label: string; feature: PortalFeature }[] {
  return getVisiblePortalNavItems("complete").map((item) => ({
    id: item.href === "/cases" ? CASE_LIST_ID : item.feature,
    href: item.href,
    label: item.label,
    feature: item.feature,
  }));
}

export function defaultMovableIds(): string[] {
  return [
    ...navPages().filter((item) => item.id !== SETTINGS_ID).map((item) => item.id),
    HANDBOOK_ID,
    GOAT_MAIL_ID,
    GOAT_PAGE_ID,
  ];
}

export function sidebarCatalog(): SidebarPage[] {
  const pages: SidebarPage[] = navPages()
    .filter((item) => item.id !== SETTINGS_ID)
    .map((item) => ({
      id: item.id,
      href: item.href,
      label: item.label,
      feature: item.feature,
      active: "prefix" as const,
      kind: "link" as const,
    }));
  pages.push(
    { id: HANDBOOK_ID, href: "/handbook", label: "Handbook", active: "exact", kind: "link" },
    { id: GOAT_MAIL_ID, href: "/goat-mail", label: "G.O.A.T. Mail", active: "prefix", kind: "link" },
    { id: GOAT_PAGE_ID, href: "/goat-page", label: "G.O.A.T.", active: "prefix", kind: "goatPage" },
  );
  const settings = navPages().find((item) => item.id === SETTINGS_ID);
  if (settings) {
    pages.push({
      id: SETTINGS_ID,
      href: settings.href,
      label: settings.label,
      feature: "settings",
      active: "prefix",
      kind: "link",
    });
  }
  return pages;
}

/** Pages this person can see: plan, then the office's module visibility and their access. */
export function visibleSidebarPages(
  planTier: PlanTier,
  canView: (feature: PortalFeature) => boolean,
): SidebarPage[] {
  const planHrefs = new Set(getVisiblePortalNavItems(planTier).map((item) => item.href));
  return sidebarCatalog().filter((page) => {
    if (page.id === HANDBOOK_ID || page.id === GOAT_MAIL_ID) return true;
    if (page.id === GOAT_PAGE_ID) return canView("patients");
    if (!page.feature || !planHrefs.has(page.href)) return false;
    return canView(page.feature);
  });
}

function knownIds(): Set<string> {
  return new Set(sidebarCatalog().map((page) => page.id));
}

/** A saved order, or null when there is nothing usable (use the default). */
export function sidebarOrderFrom(value: unknown): string[] | null {
  let raw: unknown = value;
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return null;
    try {
      raw = JSON.parse(text);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(raw)) return null;
  const known = knownIds();
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of raw) {
    if (typeof id !== "string" || id === SETTINGS_ID || !known.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out.length > 0 ? out : null;
}

export function sidebarOrderValue(ids: readonly string[]): string {
  return JSON.stringify(sidebarOrderFrom(ids) ?? []);
}

/**
 * The order currently stored in this browser. Cloud prefs write this key
 * before the app chooses a landing page. Returns null when nothing usable
 * is stored (use the default first page).
 */
export function readSidebarOrderFromStorage(): string[] | null {
  if (typeof window === "undefined") return null;
  try {
    return sidebarOrderFrom(window.localStorage.getItem(SIDEBAR_ORDER_KEY));
  } catch {
    return null;
  }
}

/**
 * Visible pages in this person's order. Settings is always last.
 * A visible page that the saved order does not mention is inserted beside
 * the default neighbor that is already placed.
 */
export function applySidebarOrder(visible: readonly SidebarPage[], saved: readonly string[] | null | undefined): SidebarPage[] {
  const byId = new Map(visible.map((page) => [page.id, page]));
  const defaults = defaultMovableIds().filter((id) => byId.has(id) && id !== SETTINGS_ID);
  const known = new Set(defaultMovableIds());
  const result: string[] = [];
  const seen = new Set<string>();
  for (const id of saved ?? []) {
    if (id === SETTINGS_ID || !known.has(id) || !byId.has(id) || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  for (const id of defaults) {
    if (seen.has(id)) continue;
    let insertAt = result.length;
    const defIndex = defaults.indexOf(id);
    for (const earlier of defaults.slice(0, defIndex)) {
      const at = result.indexOf(earlier);
      if (at >= 0) insertAt = at + 1;
    }
    result.splice(insertAt, 0, id);
    seen.add(id);
  }
  const pages = result.map((id) => byId.get(id)!);
  const settings = byId.get(SETTINGS_ID);
  if (settings) pages.push(settings);
  return pages;
}

export function moveSidebarId(ids: readonly string[], id: string, delta: -1 | 1): string[] {
  const index = ids.indexOf(id);
  const nextIndex = index + delta;
  if (index < 0 || nextIndex < 0 || nextIndex >= ids.length) return [...ids];
  const next = [...ids];
  const [item] = next.splice(index, 1);
  next.splice(nextIndex, 0, item);
  return next;
}

/** Lands `fromId` on `toId`'s index: after that row when dragging down, before it when dragging up. */
export function reorderSidebarId(ids: readonly string[], fromId: string, toId: string): string[] {
  const from = ids.indexOf(fromId);
  const to = ids.indexOf(toId);
  if (from < 0 || to < 0 || from === to) return [...ids];
  const next = [...ids];
  const [item] = next.splice(from, 1);
  // `to` is the target's original index. After a downward removal the target
  // shifts left, so inserting there sits just after it. Inserting before the
  // target puts a downward move onto the next row back where it started.
  next.splice(to, 0, item);
  return next;
}

export function sameSidebarOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/**
 * Where the app opens: the page at the top of this person's sidebar.
 *
 * Saved order is applied first, then anything the plan or their access
 * hides is left out, so a hidden first page is skipped and the next
 * visible one opens. No saved order keeps today's default (Patient List).
 * If that default is hidden too, or nothing they saved can be opened,
 * the first page they can see is used so a blocked page never flashes.
 */
export function sidebarLandingHref(
  planTier: PlanTier,
  canView: (feature: PortalFeature) => boolean,
  saved: unknown,
): string {
  const fallback = getDefaultPortalPath(planTier);
  const visible = visibleSidebarPages(planTier, canView);
  const order = sidebarOrderFrom(saved);
  const top = applySidebarOrder(visible, order)[0];
  const fallbackOpen = visible.some((page) => page.href === fallback);
  if (!order) return fallbackOpen ? fallback : (top?.href ?? fallback);
  const savedStillVisible = order.some((id) => visible.some((page) => page.id === id));
  if (!savedStillVisible) return fallbackOpen ? fallback : (top?.href ?? fallback);
  return top?.href ?? fallback;
}
