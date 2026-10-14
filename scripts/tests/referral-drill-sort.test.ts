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
