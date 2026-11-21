/**
 * With the patient-folder switch on, Case List is its own movable sidebar
 * page (id caseList, /cases) right after Patient List, with its own icon.
 * Run: npx tsx scripts/tests/sidebar-order-folders.test.ts
 */
import assert from "node:assert/strict";

process.env.NEXT_PUBLIC_PATIENT_FOLDERS = "on";

async function main() {
  const order = await import("../../src/lib/sidebar-order");
  const ids = order.defaultMovableIds();
  assert.equal(ids[0], "patients");
  assert.equal(ids[1], order.CASE_LIST_ID);
  const caseList = order.sidebarCatalog().find((page) => page.id === order.CASE_LIST_ID);
  assert.ok(caseList);
  assert.equal(caseList.href, "/cases");
  assert.equal(caseList.label, "Case List");
  const visible = order.visibleSidebarPages("complete", () => true);
  assert.ok(visible.some((page) => page.id === order.CASE_LIST_ID));
  const statistics = visible.find((page) => page.id === "statistics");
  assert.equal(statistics?.label, "Statistics");
  // A saved order from before the switch gets Case List beside Patient List.
  const saved = ["statistics", "patients", "contacts"];
  const placed = order.applySidebarOrder(visible, saved).map((page) => page.id);
  assert.equal(placed[placed.indexOf("patients") + 1], order.CASE_LIST_ID);
  assert.deepEqual(order.sidebarOrderFrom(["caseList", "patients"]), ["caseList", "patients"]);
  assert.equal(order.sidebarLandingHref("complete", () => true, ["caseList", "patients"]), "/cases");
  assert.equal(order.sidebarLandingHref("complete", () => true, null), "/patients");
  const mem = new Map<string, string>();
  const previous = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = {
    localStorage: { getItem: (key: string) => mem.get(key) ?? null },
  };
  try {
    mem.set(order.SIDEBAR_ORDER_KEY, JSON.stringify(["caseList", "patients"]));
    assert.deepEqual(order.readSidebarOrderFromStorage(), ["caseList", "patients"]);
    assert.equal(order.sidebarLandingHref("complete", () => true, order.readSidebarOrderFromStorage()), "/cases");
    // A null render snapshot must not override the stored Case List order.
    assert.notEqual(order.sidebarLandingHref("complete", () => true, null), "/cases");
  } finally {
    if (previous === undefined) delete (globalThis as { window?: unknown }).window;
    else (globalThis as { window?: unknown }).window = previous;
  }
  const home = await import("node:fs").then((fs) => fs.readFileSync("src/app/(portal)/page.tsx", "utf8"));
  assert.match(home, /readSidebarOrderFromStorage\(\)/);
  assert.match(home, /await syncUserPrefs\(\)/);
  console.log("ok - Case List is a movable sidebar page with the folder switch on");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
