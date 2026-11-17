/**
 * Sidebar icons follow the theme color and keep the approved shapes.
 * Run: npx tsx scripts/tests/sidebar-icons.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  sidebarIconFor,
  sidebarIconsByFeature,
  sidebarIconsByHref,
} from "../../src/components/sidebar-icons";

const src = readFileSync("src/components/sidebar-icons.tsx", "utf8");

let passed = 0;
const test = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`ok - ${name}`);
};

test("brand hex is gone; duotone and badge colors are theme-aware", () => {
  assert.equal(/#0d79bf/i.test(src), false);
  assert.equal(/#d3e7f3/i.test(src), false);
  assert.equal(/#ffffff/i.test(src), false);
  assert.ok(src.includes('fill="currentColor"'));
  assert.ok(src.includes('stroke: "currentColor"'));
  assert.ok(src.includes('fill="var(--bg-sidebar)"'));
  assert.equal((src.match(/fillOpacity="0\.18"/g) ?? []).length >= 12, true);
});

test("feature keys cover the sidebar, including Case List for the folder preview", () => {
  for (const key of ["patients", "caseList", "statistics", "contacts", "appointments", "encounters", "keyDates", "myFiles", "billing", "timers", "marketing", "messages", "settings", "handbook", "goatMail"]) {
    assert.equal(typeof sidebarIconsByFeature[key], "function", key);
  }
  assert.equal(sidebarIconsByHref["/patients"], sidebarIconsByFeature.patients);
  assert.equal(sidebarIconsByHref["/cases"], sidebarIconsByFeature.caseList);
  assert.notEqual(sidebarIconFor({ href: "/cases", id: "patients", feature: "patients" }), sidebarIconsByFeature.patients);
  assert.equal(sidebarIconFor({ href: "/goat-page", id: "goatPage" }), null);
});

console.log(`\n${passed} passed`);
