/**
 * Sidebar order: Settings stays last, hidden pages stay hidden, and a page
 * missing from a saved order appears in its default spot.
 * Run: npx tsx scripts/tests/sidebar-order.test.ts
 */
import assert from "node:assert/strict";
import {
  SETTINGS_ID,
  applySidebarOrder,
  defaultMovableIds,
  moveSidebarId,
  reorderSidebarId,
  sidebarCatalog,
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

test("Sidebar is a Settings section on one tab and has no subtitle", () => {
  const entry = settingsSearchCatalog.find((item) => item.key === "sidebar");
  assert.equal(entry?.title, "Sidebar");
  assert.equal(entry?.description, undefined);
  const tabs = SETTINGS_TABS.filter((tab) => tab.id !== "all" && tab.keys.includes("sidebar")).map((tab) => tab.id);
  assert.deepEqual(tabs, ["office"]);
});

console.log(`\n${passed} passed`);
