/**
 * 12-hour time display + smart AM/PM from office hours. Storage stays 24h.
 * Mock data only.  Run:  npx tsx scripts/tests/time-12h.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { compose24h, inferMeridiem, parseTyped, split24h, to12hLabel } from "../../src/lib/time-12h";
import { getDefaultScheduleSettings, getOfficeHoursLabel, type DailyOfficeHours } from "../../src/lib/schedule-settings";

let passed = 0;
const test = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`ok - ${name}`);
};

const hours: DailyOfficeHours[] = [0, 1, 2, 3, 4, 5, 6].map((d) => ({
  dayOfWeek: d,
  enabled: d >= 1 && d <= 5,
  start: "09:00",
  end: "18:00",
}));
const sat: DailyOfficeHours[] = hours.map((h) => (h.dayOfWeek === 6 ? { ...h, enabled: true, start: "08:00", end: "12:00" } : h));

test("labels", () => {
  assert.equal(to12hLabel("00:05"), "12:05 AM");
  assert.equal(to12hLabel("12:00"), "12:00 PM");
  assert.equal(to12hLabel("15:30"), "3:30 PM");
  assert.equal(to12hLabel("bad"), "bad");
});
test("round trip keeps 24h storage", () => {
  for (let h = 0; h < 24; h++) {
    const v = `${String(h).padStart(2, "0")}:15`;
    const s = split24h(v);
    assert.equal(compose24h(s.display, s.meridiem), v);
  }
});
test("typing", () => {
  assert.deepEqual(parseTyped("930"), { display: "9:30", meridiem: undefined });
  assert.deepEqual(parseTyped("1230"), { display: "12:30", meridiem: undefined });
  assert.deepEqual(parseTyped("330p"), { display: "3:30", meridiem: "PM" });
  assert.deepEqual(parseTyped("9:00 am"), { display: "9:00", meridiem: "AM" });
  assert.deepEqual(parseTyped("1530"), { display: "3:30", meridiem: "PM" });
});
test("smart AM/PM from office hours", () => {
  assert.equal(inferMeridiem("3:30", hours), "PM");
  assert.equal(inferMeridiem("9:00", hours), "AM");
  assert.equal(inferMeridiem("12:00", hours), "PM");
  assert.equal(inferMeridiem("8:00", hours), null); // neither fits -> keep user's choice
  assert.equal(inferMeridiem("3:30", [], undefined), null);
  // Saturday 8-12 only: 9:00 on a Saturday is AM, 3:30 neither
  assert.equal(inferMeridiem("3:30", sat, "2026-10-17"), null);
  assert.equal(inferMeridiem("3:30", sat, "2026-10-16"), "PM");
  assert.equal(inferMeridiem("7:30", [{ dayOfWeek: 1, enabled: true, start: "06:00", end: "21:00" }]), null);
});
test("office hours label is 12h", () => {
  const s = getDefaultScheduleSettings();
  s.officeHours = sat;
  assert.equal(getOfficeHoursLabel(s, "2026-10-17"), "8:00 AM - 12:00 PM");
});
test("no native time inputs left", () => {
  const walk = (d: string): string[] =>
    readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
  for (const f of walk("src").filter((f) => f.endsWith(".tsx"))) {
    assert.ok(!/type="time"\s*$/m.test(readFileSync(f, "utf8")), f);
  }
});
console.log(`${passed} passed`);
