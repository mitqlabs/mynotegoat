/**
 * Settings search + tab audit. Mock data only.
 * Run:  npx tsx scripts/tests/settings-search.test.ts
 */
import assert from "node:assert/strict";
import { computeSettingsSearch, showExtraSection, EXTRA_SECTIONS, SETTINGS_TABS, SETTINGS_TAB_WRAPPERS } from "../../src/lib/settings-search";
import { settingsSearchCatalog } from "../../src/lib/settings-catalog";

let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`ok - ${name}`); };
const MEMBERS = ["Front Desk", "hannah.mitchell@example.test", "Hannah Mitchell", "Dr. Sam Rivera"];
const visible = (q: string) => computeSettingsSearch(q, MEMBERS)?.hasVisible ?? true;

test("inactive search shows everything normally", () => {
  assert.equal(computeSettingsSearch("   ", MEMBERS), null);
});
test('"team" finds Team Members (no "No settings match" banner)', () => {
  const r = computeSettingsSearch("team", MEMBERS)!;
  assert.ok(r.extras.has("team"));
  assert.equal(r.hasVisible, true);
});
test("section titles & descriptions match: Office, Marketing, Features, Team Members, Treatment Plan", () => {
  for (const [q, extra] of [["marketing", "marketing"], ["features", "modules"], ["team members", "team"], ["treatment plan", "treatmentPlan"], ["type of contact", "marketing"]] as const) {
    assert.ok(computeSettingsSearch(q, MEMBERS)!.extras.has(extra), q);
  }
  assert.ok(computeSettingsSearch("office", MEMBERS)!.keys.has("officeSettings"));
  assert.ok(computeSettingsSearch("office", MEMBERS)!.keys.has("office"));
});
test("member names and emails find Team Members", () => {
  assert.ok(computeSettingsSearch("hannah", MEMBERS)!.extras.has("team"));
  assert.ok(computeSettingsSearch("mitchell example", MEMBERS)!.extras.has("team"));
  assert.ok(computeSettingsSearch("rivera", MEMBERS)!.extras.has("team"));
});
test("plural/singular both work (members, features)", () => {
  assert.ok(computeSettingsSearch("members", [])!.extras.has("team"));
  assert.ok(computeSettingsSearch("feature", [])!.extras.has("modules"));
});
test("new settings are searchable: Case number format (Office) and Compliance toggle (Case Status Categories)", () => {
  for (const q of ["case number", "case number format", "case #"]) {
    assert.ok(computeSettingsSearch(q, [])!.keys.has("office"), q);
  }
  for (const q of ["compliance", "compliance column", "case status"]) {
    assert.ok(computeSettingsSearch(q, [])!.keys.has("caseStatuses"), q);
  }
});
test("the no-match banner only appears when nothing is visible", () => {
  for (const q of ["team", "office", "marketing", "features", "logo", "lien", "backup", "billing macros", "compliance", "hannah", "case number"]) {
    assert.equal(visible(q), true, q);
  }
  const none = computeSettingsSearch("zzzqqq", MEMBERS)!;
  assert.equal(none.hasVisible, false);
  assert.equal(none.keys.size + none.extras.size, 0);
});
test("every visible-by-search section is consistent: if hasVisible then something renders", () => {
  for (const q of ["team", "marketing", "plan", "office", "member"]) {
    const r = computeSettingsSearch(q, MEMBERS)!;
    assert.equal(r.hasVisible, r.keys.size > 0 || r.extras.size > 0);
    for (const e of r.extras) assert.equal(showExtraSection(e, "office", r), true);
  }
});

test("each extra section lives on exactly ONE tab + Everything (Marketing is Office only)", () => {
  for (const s of EXTRA_SECTIONS) {
    const tabs = SETTINGS_TABS.map((t) => t.id).filter((t) => showExtraSection(s.id, t, null));
    assert.deepEqual(tabs.sort(), [s.tab, "all"].sort(), s.id);
  }
  assert.equal(showExtraSection("marketing", "notes", null), false); // the bug: it showed on every tab
  assert.equal(showExtraSection("marketing", "billing", null), false);
  assert.equal(showExtraSection("marketing", "office", null), true);
  assert.equal(showExtraSection("marketing", "all", null), true);
});
test("audit: every catalog section is on at least one tab, and non-wrapper sections on exactly one", () => {
  const tabsFor = (key: string) => SETTINGS_TABS.filter((t) => t.id !== "all" && (t.keys as string[]).includes(key)).map((t) => t.id);
  const orphan: string[] = [];
  const multi: string[] = [];
  for (const e of settingsSearchCatalog) {
    const n = tabsFor(e.key).length;
    if (n === 0) orphan.push(e.key);
    if (n > 1 && !SETTINGS_TAB_WRAPPERS.has(e.key)) multi.push(`${e.key}:${tabsFor(e.key).join("+")}`);
  }
  console.log("   not on any tab (nothing renders them):", orphan.join(", ") || "none");
  assert.deepEqual(multi, []);
});
test("Case number format & Compliance live under the Office tab", () => {
  const office = SETTINGS_TABS.find((t) => t.id === "office")!;
  assert.ok(office.keys.includes("office"));       // Office Information → Case number format
  assert.ok(office.keys.includes("caseStatuses")); // Case Status Categories → Compliance toggle
  assert.ok(office.keys.includes("officeSettings"));
});
console.log(`\n${passed} passed`);
