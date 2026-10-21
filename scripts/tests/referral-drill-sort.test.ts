import assert from "node:assert/strict";
import { nextDrillSort, parseDrillSort, sortDrillPatients } from "../../src/lib/referral-drill-sort";

// Mock data only.
const rows = [
  { name: "doe, Jane", sentDate: "10/01/2026" },
  { name: "Adams, Zed", sentDate: "" },
  { name: "Baker, Amy", sentDate: "2026-10-05" },
  { name: "adams, Amy", sentDate: "09/30/2026" },
];
const n = (r: typeof rows) => r.map((x) => x.name);
assert.deepEqual(parseDrillSort(null), { key: "name", dir: "asc" }, "default Patient A-Z");
assert.deepEqual(n(sortDrillPatients(rows, { key: "name", dir: "asc" })), ["adams, Amy", "Adams, Zed", "Baker, Amy", "doe, Jane"]);
assert.deepEqual(n(sortDrillPatients(rows, { key: "sent", dir: "desc" })), ["Baker, Amy", "doe, Jane", "adams, Amy", "Adams, Zed"], "newest first, undated last");
assert.deepEqual(nextDrillSort({ key: "name", dir: "asc" }, "sent"), { key: "sent", dir: "desc" });
assert.deepEqual(nextDrillSort({ key: "name", dir: "asc" }, "name"), { key: "name", dir: "desc" });
console.log("referral-drill-sort: ok");

// Attorney + Date of Loss columns (mock data only).
{
  const s2 = sortDrillPatients, n2 = nextDrillSort, p2 = parseDrillSort;
  const rows = [
    { name: "Bravo, Ann", sentDate: "", attorney: "Zed Law", dateOfLoss: "03/02/2024" },
    { name: "Alpha, Bo", sentDate: "", attorney: "", dateOfLoss: "" },
    { name: "Charlie, Cy", sentDate: "", attorney: "abc Injury Lawyers", dateOfLoss: "12/20/2025" },
  ];
  const nm = (r: typeof rows) => r.map((x) => x.name);
  assert.deepEqual(nm(s2(rows, { key: "attorney", dir: "asc" })), ["Charlie, Cy", "Bravo, Ann", "Alpha, Bo"], "attorney A–Z, blank last");
  assert.deepEqual(nm(s2(rows, { key: "attorney", dir: "desc" })), ["Bravo, Ann", "Charlie, Cy", "Alpha, Bo"], "blank still last");
  assert.deepEqual(nm(s2(rows, { key: "dol", dir: "desc" })), ["Charlie, Cy", "Bravo, Ann", "Alpha, Bo"], "DOL newest first, blank last");
  assert.deepEqual(n2({ key: "name", dir: "asc" }, "dol"), { key: "dol", dir: "desc" });
  assert.deepEqual(n2({ key: "name", dir: "asc" }, "attorney"), { key: "attorney", dir: "asc" });
  assert.deepEqual(p2(JSON.stringify({ key: "dol", dir: "asc" })), { key: "dol", dir: "asc" });
  console.log("referral-drill-sort attorney/dol ok");
}
