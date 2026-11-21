/**
 * Sidebar order: Settings stays last, hidden pages stay hidden, and a page
 * missing from a saved order appears in its default spot.
 * Run: npx tsx scripts/tests/sidebar-order.test.ts
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  SETTINGS_ID,
  applySidebarOrder,
  defaultMovableIds,
  moveSidebarId,
  reorderSidebarId,
  sidebarCatalog,
  SIDEBAR_ORDER_KEY,
  readSidebarOrderFromStorage,
  sidebarLandingHref,
  sidebarOrderFrom,
  sidebarOrderValue,
  visibleSidebarPages,
  type SidebarPage,
} from "../../src/lib/sidebar-order";
import { toneReadbackOk } from "../../src/lib/brand";
import { settingsSearchCatalog } from "../../src/lib/settings-catalog";
import { SETTINGS_TABS } from "../../src/lib/settings-search";

const byId = new Map(sidebarCatalog().map((page) => [page.id, page]));
const pages = (ids: string[]): SidebarPage[] => ids.map((id) => byId.get(id)!);
const ids = (list: SidebarPage[]) => list.map((page) => page.id);
const seeAll = () => true;

let passed = 0;
const test = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`ok - ${name}`);
};

test("no saved order is the default, with Settings last", () => {
  const visible = visibleSidebarPages("complete", seeAll);
  const ordered = ids(applySidebarOrder(visible, null));
  assert.deepEqual(ordered.slice(0, -1), defaultMovableIds());
  assert.equal(ordered.at(-1), SETTINGS_ID);
});

test("Settings is not movable, even if a saved order puts it first", () => {
  const visible = visibleSidebarPages("complete", seeAll);
  const ordered = ids(applySidebarOrder(visible, [SETTINGS_ID, "messages", "patients"]));
  assert.equal(ordered.at(-1), SETTINGS_ID);
  assert.equal(ordered.filter((id) => id === SETTINGS_ID).length, 1);
  assert.equal(ordered[0], "messages");
  assert.ok(ordered.indexOf("patients") < ordered.indexOf("contacts"));
});

test("hidden pages stay hidden and a missing page returns to its default spot", () => {
  const hidden = new Set(["billing", "marketing"]);
  const visible = visibleSidebarPages("complete", (feature) => !hidden.has(feature));
  assert.equal(visible.some((page) => page.id === "billing"), false);
  const saved = defaultMovableIds().filter((id) => id !== "encounters");
  const ordered = ids(applySidebarOrder(visible, saved));
  assert.equal(ordered.includes("billing"), false);
  assert.equal(ordered.includes("marketing"), false);
  const at = ordered.indexOf("encounters");
  assert.equal(ordered[at - 1], "appointments");
  assert.equal(ordered[at + 1], "keyDates");
  assert.equal(ordered.at(-1), SETTINGS_ID);
});

test("a later page that the saved order has never seen keeps its default neighbors", () => {
  const visible = pages(["patients", "contacts", "appointments", "encounters", SETTINGS_ID]);
  const ordered = ids(applySidebarOrder(visible, ["appointments", "patients"]));
  assert.deepEqual(ordered, ["appointments", "encounters", "patients", "contacts", SETTINGS_ID]);
});

test("bad saved data falls back, and the stored value round-trips", () => {
  assert.equal(sidebarOrderFrom(null), null);
  assert.equal(sidebarOrderFrom("nope"), null);
  assert.equal(sidebarOrderFrom("[]"), null);
  assert.deepEqual(sidebarOrderFrom(["nope", "patients", "patients", SETTINGS_ID, "contacts"]), ["patients", "contacts"]);
  const value = sidebarOrderValue(["contacts", "patients"]);
  assert.equal(value, '["contacts","patients"]');
  assert.deepEqual(sidebarOrderFrom(value), ["contacts", "patients"]);
  const row = { "casemate.sidebar-order.v1": { v: value, at: 1 } };
  assert.equal(toneReadbackOk(row, value, "casemate.sidebar-order.v1"), true);
  assert.equal(toneReadbackOk(row, '["patients"]', "casemate.sidebar-order.v1"), false);
});

test("up, down, and drag stay inside the list", () => {
  const start = ["patients", "contacts", "appointments"];
  assert.deepEqual(moveSidebarId(start, "patients", -1), start);
  assert.deepEqual(moveSidebarId(start, "contacts", -1), ["contacts", "patients", "appointments"]);
  assert.deepEqual(moveSidebarId(start, "appointments", 1), start);
  assert.deepEqual(reorderSidebarId(start, "appointments", "patients"), ["appointments", "patients", "contacts"]);
});

test("dragging down lands on the target index, including the next row", () => {
  const start = ["patients", "contacts", "appointments", "encounters"];
  const downOne = reorderSidebarId(start, "patients", "contacts");
  assert.deepEqual(downOne, ["contacts", "patients", "appointments", "encounters"]);
  assert.equal(downOne.indexOf("patients"), start.indexOf("contacts"));
  const downFurther = reorderSidebarId(start, "patients", "encounters");
  assert.deepEqual(downFurther, ["contacts", "appointments", "encounters", "patients"]);
  assert.equal(downFurther.indexOf("patients"), start.indexOf("encounters"));
  const downLast = reorderSidebarId(start, "appointments", "encounters");
  assert.deepEqual(downLast, ["patients", "contacts", "encounters", "appointments"]);
  assert.equal(downLast.indexOf("appointments"), start.indexOf("encounters"));
});

test("dragging up lands on the target index", () => {
  const start = ["patients", "contacts", "appointments", "encounters"];
  const upOne = reorderSidebarId(start, "contacts", "patients");
  assert.deepEqual(upOne, ["contacts", "patients", "appointments", "encounters"]);
  assert.equal(upOne.indexOf("contacts"), start.indexOf("patients"));
  const upFurther = reorderSidebarId(start, "encounters", "contacts");
  assert.deepEqual(upFurther, ["patients", "encounters", "contacts", "appointments"]);
  assert.equal(upFurther.indexOf("encounters"), start.indexOf("contacts"));
  assert.deepEqual(reorderSidebarId(start, "patients", "patients"), [...start]);
  assert.deepEqual(reorderSidebarId(start, "missing", "contacts"), [...start]);
  assert.deepEqual(reorderSidebarId(start, "patients", "missing"), [...start]);
  assert.deepEqual(start, ["patients", "contacts", "appointments", "encounters"]);
});

test("opening the app lands on the first visible sidebar page", () => {
  assert.equal(sidebarLandingHref("complete", seeAll, null), "/patients");
  assert.equal(sidebarLandingHref("complete", seeAll, []), "/patients");
  assert.equal(sidebarLandingHref("complete", seeAll, "nope"), "/patients");
  assert.equal(sidebarLandingHref("complete", seeAll, ["contacts", "patients"]), "/contacts");
  assert.equal(sidebarLandingHref("complete", seeAll, ["statistics", "patients"]), "/dashboard");
  assert.equal(sidebarLandingHref("complete", seeAll, ["handbook", "patients"]), "/handbook");
  assert.equal(sidebarLandingHref("complete", seeAll, ["goatMail", "patients"]), "/goat-mail");
  assert.equal(sidebarLandingHref("complete", seeAll, ["goatPage", "patients"]), "/goat-page");
  assert.equal(sidebarLandingHref("complete", seeAll, [SETTINGS_ID, "messages", "patients"]), "/messages");
});

test("a hidden first page is skipped, and a fully blocked order uses the default", () => {
  const hideBilling = (feature: string) => feature !== "billing";
  assert.equal(sidebarLandingHref("complete", hideBilling, ["billing", "appointments", "patients"]), "/appointments");
  assert.equal(sidebarLandingHref("complete", () => false, null), "/handbook");
  assert.equal(sidebarLandingHref("complete", () => false, ["patients", "billing"]), "/handbook");
  assert.equal(sidebarLandingHref("complete", (feature) => feature !== "patients", null), "/dashboard");
});

test("a null snapshot is not a saved order; storage is", () => {
  const mem = new Map<string, string>();
  const previous = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = {
    localStorage: { getItem: (key: string) => mem.get(key) ?? null },
  };
  try {
    assert.equal(readSidebarOrderFromStorage(), null);
    assert.equal(sidebarLandingHref("complete", seeAll, readSidebarOrderFromStorage()), "/patients");
    mem.set(SIDEBAR_ORDER_KEY, '["contacts","patients"]');
    assert.deepEqual(readSidebarOrderFromStorage(), ["contacts", "patients"]);
    assert.equal(sidebarLandingHref("complete", seeAll, null), "/patients");
    assert.equal(sidebarLandingHref("complete", seeAll, readSidebarOrderFromStorage()), "/contacts");
  } finally {
    if (previous === undefined) delete (globalThis as { window?: unknown }).window;
    else (globalThis as { window?: unknown }).window = previous;
  }
});

test("root, sign-in, and approval open the sidebar landing page behind the check-in screen", () => {
  assert.equal(existsSync("src/app/page.tsx"), false);
  const home = readFileSync("src/app/(portal)/page.tsx", "utf8");
  const login = readFileSync("src/app/auth/login/login-client.tsx", "utf8");
  const pending = readFileSync("src/app/auth/pending/page.tsx", "utf8");
  const layout = readFileSync("src/app/(portal)/layout.tsx", "utf8");
  // The redirect must follow the key sync just wrote. The hook's first
  // value is the server snapshot (always null) and used to open Patient List.
  assert.doesNotMatch(home, /useSidebarOrder\(/);
  assert.match(home, /await syncUserPrefs\(\)/);
  assert.match(home, /sidebarLandingHref\(planRef\.current, canViewRef\.current, readSidebarOrderFromStorage\(\)\)/);
  assert.match(home, /router\.replace\(href\)/);
  assert.match(login, /router\.replace\(next \?\? "\/"\)/);
  assert.match(pending, /router\.replace\("\/"\)/);
  assert.match(layout, /pathname === "\/"/);
  assert.match(layout, /window\.location\.pathname/);
  assert.match(layout, /syncUserPrefs\(\)/);
  assert.match(layout, /<PortalBootScreen/);
  assert.match(layout, /<GoatCheckIn \/>/);
});

test("Sidebar is a Settings section on one tab and has no subtitle", () => {
  const entry = settingsSearchCatalog.find((item) => item.key === "sidebar");
  assert.equal(entry?.title, "Sidebar");
  assert.equal(entry?.description, undefined);
  const tabs = SETTINGS_TABS.filter((tab) => tab.id !== "all" && tab.keys.includes("sidebar")).map((tab) => tab.id);
  assert.deepEqual(tabs, ["office"]);
});

console.log(`\n${passed} passed`);
