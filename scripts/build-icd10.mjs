#!/usr/bin/env node
/**
 * Build the built-in ICD-10-CM code list (public/icd10/icd10cm-<year>.json).
 *
 * Source: the official ICD-10-CM "Code Descriptions in Tabular Order" file
 * that CMS publishes every year (public domain, U.S. government work; the
 * same list the CDC/NCHS posts at ftp.cdc.gov). Only billable codes are kept,
 * each with its long description.
 *
 * This runs at dev time only (once a year, when the new code set comes out
 * on October 1). The generated JSON is committed and served by NoteGoat
 * itself, so the app never calls an outside service at runtime.
 *
 *   node scripts/build-icd10.mjs                 # FY2026 from cms.gov
 *   node scripts/build-icd10.mjs --year 2027     # next year's file
 *   node scripts/build-icd10.mjs --zip ./2027-code-descriptions-tabular-order.zip
 *
 * After a new year: update ICD10_ASSET in src/lib/icd10.ts and the README.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";
import { createHash } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const year = arg("year") ?? "2026";
const zipPath = arg("zip");
const url = arg("url") ?? `https://www.cms.gov/files/zip/${year}-code-descriptions-tabular-order.zip`;

/** Minimal ZIP reader (central directory → one entry), no dependencies. */
function readZipEntry(buf, matcher) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a zip file (no end-of-central-directory record).");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const names = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("Bad central directory entry.");
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    names.push(name);
    if (matcher(name)) {
      const lNameLen = buf.readUInt16LE(localOffset + 26);
      const lExtraLen = buf.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + lNameLen + lExtraLen;
      const data = buf.subarray(start, start + compSize);
      if (method === 0) return { name, data: Buffer.from(data) };
      if (method === 8) return { name, data: inflateRawSync(data) };
      throw new Error(`Unsupported zip compression method ${method} for ${name}.`);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`No order file found in the zip. Entries: ${names.join(", ")}`);
}

async function main() {
  let zip;
  if (zipPath) {
    zip = readFileSync(zipPath);
    console.log(`Read ${zipPath} (${zip.length} bytes)`);
  } else {
    console.log(`Downloading ${url}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
    zip = Buffer.from(await res.arrayBuffer());
    console.log(`Downloaded ${zip.length} bytes`);
  }
  const sha256 = createHash("sha256").update(zip).digest("hex");
  // icd10cm_order_2026.txt (not the *_addenda_* file)
  const entry = readZipEntry(zip, (name) => /icd10cm[-_]order[-_]\d{4}\.txt$/i.test(name.split("/").pop() ?? ""));
  const text = entry.data.toString("latin1");

  // Fixed-width layout (see icd10OrderFiles.pdf in the zip):
  // 1-5 order number, 7-13 code, 15 billable flag (1 = valid for HIPAA), 17-76 short, 78- long.
  const codes = [];
  for (const raw of text.split(/\r?\n/)) {
    if (raw.length < 16) continue;
    const code = raw.slice(6, 13).trim();
    const billable = raw.charAt(14) === "1";
    const long = raw.slice(77).trim();
    if (!billable || !/^[A-Z][0-9A-Z][0-9A-Z]{1,5}$/.test(code) || !long) continue;
    codes.push([code, long]);
  }
  if (codes.length < 60000) throw new Error(`Only ${codes.length} billable codes parsed; the file layout may have changed.`);

  const out = {
    version: `FY${year}`,
    source: zipPath ? `CMS ICD-10-CM ${year} Code Descriptions in Tabular Order (${entry.name})` : url,
    file: entry.name,
    sha256,
    license: "Public domain (U.S. government work: CMS / CDC NCHS ICD-10-CM).",
    generated: new Date().toISOString().slice(0, 10),
    count: codes.length,
    // [code without the dot, long description]
    codes,
  };
  const target = join(ROOT, "public", "icd10", `icd10cm-${year}.json`);
  mkdirSync(dirname(target), { recursive: true });
  const json = JSON.stringify(out);
  writeFileSync(target, json);
  console.log(`Wrote ${target}: ${codes.length} billable codes, ${(json.length / 1024 / 1024).toFixed(2)} MB`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
