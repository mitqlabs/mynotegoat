import assert from "node:assert/strict";
import { demographicsLine } from "../../src/lib/age";
const T = "2026-10-15";
assert.equal(demographicsLine("Male", "Married", "1992-03-01", T), "Male · Married · 34");
assert.equal(demographicsLine("Male", "Married", "10/16/1992", T), "Male · Married · 33"); // birthday tomorrow
assert.equal(demographicsLine("Female", "", "10/15/1990", T), "Female · 36");
assert.equal(demographicsLine("", "Single", "", T), "Single");
assert.equal(demographicsLine("Male", "Married", "13/45/1990", T), "Male · Married");
assert.equal(demographicsLine("", "", "", T), "");
assert.equal(demographicsLine(undefined, undefined, "1990-01-01", T), "36");
console.log("header age OK");
