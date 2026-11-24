/**
 * Attorney dropdown: firms A–Z (leading "The " ignored), SELF pinned under
 * the placeholder, and "Self" / "pro se" select that option with no phone.
 * Run: npx tsx scripts/tests/attorney-picker.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AttorneyFirmSelect } from "../../src/components/attorney-firm-select";
import {
  ATTORNEY_CUSTOM_VALUE,
  SELF_ATTORNEY_LABEL,
  SELF_ATTORNEY_VALUE,
  attorneyFirmOptions,
  attorneySelectValue,
  compareAttorneyPickerNames,
  isSelfRepresentedAttorney,
  resolveAttorneyPick,
} from "../../src/lib/attorney-picker";

const messy = [
  { id: "trial", name: "Trial Lit Attorneys", phone: "101" },
  { id: "grig", name: "The Grigoryan Law Firm", phone: "202" },
  { id: "ympk", name: "YMPK", phone: "303" },
  { id: "secure", name: "Secure Synergy Law, P.C.", phone: "404" },
  { id: "ajk", name: "AJK Law Firm", phone: "505" },
  { id: "firmla", name: "The Firm LA", phone: "606" },
  { id: "self", name: "Self", phone: "999-000-0000" },
  { id: "prose", name: "pro se", phone: "888" },
  { id: "dup", name: "ympk", phone: "000" },
  { id: "theater", name: "Theater Law", phone: "707" },
  { id: "n2", name: "Office 2", phone: "" },
  { id: "n10", name: "Office 10", phone: "" },
];

const firms = attorneyFirmOptions(messy);
const names = firms.map((firm) => firm.name);

assert.deepEqual(
  names.filter((name) =>
    ["AJK Law Firm", "The Firm LA", "The Grigoryan Law Firm", "Office 2", "Office 10", "Secure Synergy Law, P.C.", "Theater Law", "Trial Lit Attorneys", "YMPK"].includes(name),
  ),
  [
    "AJK Law Firm",
    "The Firm LA",
    "The Grigoryan Law Firm",
    "Office 2",
    "Office 10",
    "Secure Synergy Law, P.C.",
    "Theater Law",
    "Trial Lit Attorneys",
    "YMPK",
  ],
);
assert.equal(names.includes("Self"), false);
assert.equal(names.includes("pro se"), false);
assert.equal(names.filter((name) => name.toLowerCase() === "ympk").length, 1);
assert.equal(firms.find((firm) => firm.name === "YMPK")?.phone, "303");
assert.equal(compareAttorneyPickerNames("ymPK", "YMPK"), 0);
assert.ok(compareAttorneyPickerNames("ymPK", "Yepremyan Law Firm") > 0);
assert.ok(compareAttorneyPickerNames("The Grigoryan Law Firm", "Galstian & Associates") > 0);
assert.ok(compareAttorneyPickerNames("The Grigoryan Law Firm", "Hartounian") < 0);
assert.ok(compareAttorneyPickerNames("the Firm LA", "G & I Law Group") < 0);

for (const value of ["Self", "self", "SELF", "pro se", "PRO SE", "pro-se", "pro se.", "self-represented", "Self Represented", "pro per"]) {
  assert.equal(isSelfRepresentedAttorney(value), true, value);
  assert.equal(attorneySelectValue(value, firms, false), SELF_ATTORNEY_VALUE, value);
}
assert.equal(isSelfRepresentedAttorney("Self & Associates"), false);
assert.equal(isSelfRepresentedAttorney("Theater Law"), false);
assert.equal(isSelfRepresentedAttorney(""), false);

assert.equal(attorneySelectValue("The Grigoryan Law Firm", firms, false), "The Grigoryan Law Firm");
assert.equal(attorneySelectValue("the grigoryan law firm", firms, false), "The Grigoryan Law Firm");
assert.equal(attorneySelectValue("", firms, false), "");
assert.equal(attorneySelectValue("Ward Custom Law", firms, false), "");
assert.equal(attorneySelectValue("Ward Custom Law", firms, true), ATTORNEY_CUSTOM_VALUE);

const selfPick = resolveAttorneyPick(SELF_ATTORNEY_VALUE, firms);
assert.deepEqual(selfPick, { type: "self" });
assert.equal("phone" in selfPick, false);
assert.deepEqual(resolveAttorneyPick("pro se", firms), { type: "self" });
assert.deepEqual(resolveAttorneyPick("", firms), { type: "empty" });
assert.deepEqual(resolveAttorneyPick(ATTORNEY_CUSTOM_VALUE, firms), { type: "custom" });
assert.deepEqual(resolveAttorneyPick("AJK Law Firm", firms), { type: "firm", name: "AJK Law Firm", phone: "505" });

function optionLabels(html: string): string[] {
  return [...html.matchAll(/<option\b[^>]*>([^<]*)<\/option>/g)].map((match) =>
    match[1].replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"'),
  );
}
function selectedLabel(html: string): string {
  const hit = [...html.matchAll(/<option\b([^>]*)>([^<]*)<\/option>/g)].find((match) => /selected(?:=|\s|\/)/.test(match[1]));
  assert.ok(hit, html);
  return hit[2];
}

const openProSe = renderToStaticMarkup(
  createElement(AttorneyFirmSelect, {
    attorneys: messy,
    attorney: "pro se",
    onSelect: () => {},
    onCustomName: () => {},
  }),
);
const labels = optionLabels(openProSe);
assert.equal(labels[0], "Select attorney…");
assert.equal(labels[1], SELF_ATTORNEY_LABEL);
assert.equal(labels.at(-1), "Type a new attorney…");
assert.deepEqual(
  labels.slice(2, -1).filter((label) =>
    ["AJK Law Firm", "The Firm LA", "The Grigoryan Law Firm", "Secure Synergy Law, P.C.", "Trial Lit Attorneys", "YMPK"].includes(label),
  ),
  ["AJK Law Firm", "The Firm LA", "The Grigoryan Law Firm", "Secure Synergy Law, P.C.", "Trial Lit Attorneys", "YMPK"],
);
assert.equal(labels.includes("Self"), false);
assert.equal(labels.includes("999-000-0000"), false);
assert.equal(selectedLabel(openProSe), SELF_ATTORNEY_LABEL);
assert.equal(openProSe.includes("Attorney name"), false);

const openCustom = renderToStaticMarkup(
  createElement(AttorneyFirmSelect, {
    attorneys: messy,
    attorney: "Ward Custom Law",
    onSelect: () => {},
    onCustomName: () => {},
  }),
);
assert.equal(selectedLabel(openCustom), "Type a new attorney…");
assert.match(openCustom, /value="Ward Custom Law"/);

const openFirm = renderToStaticMarkup(
  createElement(AttorneyFirmSelect, {
    attorneys: messy,
    attorney: "Self",
    onSelect: () => {},
    onCustomName: () => {},
  }),
);
assert.equal(selectedLabel(openFirm), SELF_ATTORNEY_LABEL);

const patientFile = readFileSync(new URL("../../src/components/patient-case-file.tsx", import.meta.url), "utf8");
const popupFile = readFileSync(new URL("../../src/components/new-patient-case-popup.tsx", import.meta.url), "utf8");
const patientsPage = readFileSync(new URL("../../src/app/(portal)/patients/page.tsx", import.meta.url), "utf8");
assert.match(patientFile, /AttorneyFirmSelect/);
assert.match(popupFile, /AttorneyFirmSelect/);
assert.match(patientFile, /if \(isSelfRepresentedAttorney\(attorney\)\) return null/);
assert.match(patientsPage, /isSelfRepresentedAttorney\(attorneyName\)/);
assert.equal(patientFile.includes('id="attorney-contacts"'), false);

console.log("attorney-picker ok");
