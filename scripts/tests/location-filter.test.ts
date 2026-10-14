import assert from "node:assert/strict";
import { hasNoOffice, matchesOfficeFilter, NO_OFFICE_LABEL } from "../../src/lib/location-filter";

const offices = ["loc-hulen", "loc-saginaw"];
assert.equal(matchesOfficeFilter("loc-hulen", "", offices), true, "All shows everyone");
assert.equal(matchesOfficeFilter("loc-hulen", "loc-hulen", offices), true);
assert.equal(matchesOfficeFilter("loc-saginaw", "loc-hulen", offices), false, "other office hidden");
assert.equal(matchesOfficeFilter(undefined, "loc-hulen", offices), true, "no office shows under every office");
assert.equal(matchesOfficeFilter("", "loc-saginaw", offices), true);
assert.equal(matchesOfficeFilter("loc-deleted", "loc-hulen", offices), true, "deleted office counts as no office");
assert.equal(hasNoOffice(null, offices), true);
assert.equal(hasNoOffice("loc-hulen", offices), false);
assert.equal(NO_OFFICE_LABEL, "No office set");

// Mock list: picking an office no longer empties a list of unassigned patients.
const mockPatients = [
  { id: "p1", locationId: undefined },
  { id: "p2", locationId: "loc-hulen" },
  { id: "p3", locationId: "loc-saginaw" },
];
const visible = mockPatients.filter((p) => matchesOfficeFilter(p.locationId, "loc-hulen", offices)).map((p) => p.id);
assert.deepEqual(visible, ["p1", "p2"]);
console.log("PASS location-filter (10 checks, mock data)");
