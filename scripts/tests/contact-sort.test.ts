import assert from "node:assert/strict";
import { initialsFor, nextContactSort, parseContactSort, pastelFor, sortContacts } from "../../src/lib/contact-sort";

// Mock data only.
const list = [
  { name: "zeta Law", category: "Attorney" },
  { name: "Alpha Imaging", category: "Imaging" },
  { name: "beta Law", category: "Attorney" },
  { name: "Gamma Ortho", category: "Specialist" },
  { name: "Delta Imaging", category: "Imaging" },
];
const names = (l: typeof list) => l.map((c) => c.name);

assert.deepEqual(names(sortContacts(list, { key: "name", dir: "asc" })), ["Alpha Imaging", "beta Law", "Delta Imaging", "Gamma Ortho", "zeta Law"], "case-insensitive A-Z");
assert.deepEqual(names(sortContacts(list, { key: "name", dir: "desc" })), ["zeta Law", "Gamma Ortho", "Delta Imaging", "beta Law", "Alpha Imaging"]);
assert.deepEqual(names(sortContacts(list, { key: "category", dir: "asc" })), ["beta Law", "zeta Law", "Alpha Imaging", "Delta Imaging", "Gamma Ortho"], "grouped, names A-Z inside");
assert.deepEqual(names(sortContacts(list, { key: "category", dir: "desc" })), ["Gamma Ortho", "Alpha Imaging", "Delta Imaging", "beta Law", "zeta Law"], "categories Z-A, names still A-Z");
assert.equal(list[0].name, "zeta Law", "input not mutated");

assert.deepEqual(parseContactSort(null), { key: "name", dir: "asc" });
assert.deepEqual(parseContactSort("garbage"), { key: "name", dir: "asc" });
assert.deepEqual(parseContactSort('{"key":"category","dir":"desc"}'), { key: "category", dir: "desc" });
assert.deepEqual(nextContactSort({ key: "name", dir: "asc" }, "name"), { key: "name", dir: "desc" });
assert.deepEqual(nextContactSort({ key: "name", dir: "desc" }, "category"), { key: "category", dir: "asc" });

assert.deepEqual(pastelFor("Attorney"), pastelFor(" attorney "), "stable color per category");
assert.equal(initialsFor("Mock Law Group"), "ML");
assert.equal(initialsFor("Dr. Example Ortho"), "EO");
assert.equal(initialsFor("Sample & Partners"), "SP");
console.log("contact-sort: ok");
