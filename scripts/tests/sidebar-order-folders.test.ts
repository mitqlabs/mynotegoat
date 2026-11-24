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

  // Mirror still has the order and the same timestamp, but the live key was wiped.
  const { prefsToRestore } = await import("../../src/lib/user-prefs-cloud");
  const launch = await import("../../src/lib/sidebar-launch");
  const orderValue = JSON.stringify(["caseList", "patients"]);
  const mirror = { [order.SIDEBAR_ORDER_KEY]: { v: orderValue, at: 100 } };
  const wiped = new Map<string, string>();
  const restored = prefsToRestore((key) => wiped.get(key) ?? null, mirror, mirror);
  assert.deepEqual(restored, [{ key: order.SIDEBAR_ORDER_KEY, value: orderValue }]);
  for (const row of restored) wiped.set(row.key, row.value);
  const previousWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = {
    localStorage: { getItem: (key: string) => wiped.get(key) ?? null },
  };
  try {
    assert.equal(order.sidebarLandingHref("complete", () => true, order.readSidebarOrderFromStorage()), "/cases");
  } finally {
    if (previousWindow === undefined) delete (globalThis as { window?: unknown }).window;
    else (globalThis as { window?: unknown }).window = previousWindow;
  }

  const session = new Map<string, string>();
  const sessionStorage = {
    getItem: (key: string) => session.get(key) ?? null,
    setItem: (key: string, value: string) => {
      session.set(key, value);
    },
  };
  launch.resetSidebarLaunchClaim();
  const fresh = launch.claimFreshLaunch(sessionStorage);
  assert.equal(fresh, true);
  assert.equal(session.get(launch.SIDEBAR_LAUNCH_SEEN_KEY), "1");
  // Strict mode's second mount is still the same launch.
  assert.equal(launch.claimFreshLaunch(sessionStorage), true);
  assert.equal(
    launch.patientsLaunchRedirect({ fresh, pathname: "/patients", search: "", landingHref: "/cases" }),
    "/cases",
  );
  assert.equal(
    launch.patientsLaunchRedirect({ fresh, pathname: "/", search: "", landingHref: "/cases" }),
    null,
  );
  // A new document in the same tab (refresh) is not a launch.
  launch.resetSidebarLaunchClaim();
  assert.equal(launch.claimFreshLaunch(sessionStorage), false);
  assert.equal(
    launch.patientsLaunchRedirect({ fresh: false, pathname: "/patients", search: "", landingHref: "/cases" }),
    null,
  );
  // Deep links stay even on a fresh tab.
  assert.equal(
    launch.patientsLaunchRedirect({ fresh: true, pathname: "/patients/abc", search: "", landingHref: "/cases" }),
    null,
  );
  assert.equal(
    launch.patientsLaunchRedirect({ fresh: true, pathname: "/patients", search: "?view=toDo", landingHref: "/cases" }),
    null,
  );
  assert.equal(launch.isExactPatientsListEntry("/patients/", ""), true);
  assert.equal(
    launch.patientsLaunchRedirect({ fresh: true, pathname: "/patients", search: "", landingHref: "/patients" }),
    null,
  );
  console.log("ok - Case List is a movable sidebar page with the folder switch on");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
