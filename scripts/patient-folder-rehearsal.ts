/**
 * Read-only dry run. Feed it a JSON array of case rows exported by SELECT
 * (never written back). Prints per-workspace dashboard numbers and folder
 * counts, and throws if grouping would change those numbers.
 *
 *   npx tsx scripts/patient-folder-rehearsal.ts /tmp/patient-folder-rows.json
 */
import { readFileSync } from "node:fs";
import { proveFolderNumbers, type FolderCaseInput } from "../src/lib/patient-folders";

type Row = FolderCaseInput & { workspaceId?: string; w?: string };

const file = process.argv[2];
if (!file) {
  console.error("Usage: npx tsx scripts/patient-folder-rehearsal.ts <rows.json>");
  process.exit(1);
}

const rows = JSON.parse(readFileSync(file, "utf8")) as Row[];
const offices = new Map<string, Row[]>();
for (const row of rows) {
  const id = row.workspaceId || row.w || "unknown";
  const list = offices.get(id);
  if (list) list.push(row);
  else offices.set(id, [row]);
}

for (const [office, cases] of offices) {
  const proof = proveFolderNumbers(cases);
  const multi = proof.grouping.folders.filter((folder) => folder.caseIds.length > 1);
  const extra = cases.length - proof.folders;
  console.log(
    JSON.stringify({
      office,
      cases: proof.before.cases,
      folders: proof.folders,
      collapsed: extra,
      multiCasePatients: proof.multiCasePatients,
      multiCaseSizes: multi.map((folder) => folder.caseIds.length).sort((a, b) => b - a),
      conflicts: proof.grouping.conflicts.length,
      closeMatches: proof.grouping.closeMatches.length,
      sharedPhones: proof.grouping.sharedPhones.length,
      autoGroupsWithWarnings: proof.grouping.folders.filter((folder) => folder.warnings.length > 0).length,
      byStatus: proof.before.byStatus,
      billed: proof.before.billed,
      paid: proof.before.paid,
      owed: proof.before.owed,
      casesWithBilled: proof.before.casesWithBilled,
      casesWithPaid: proof.before.casesWithPaid,
      xrayStudies: proof.before.xrayStudies,
      mriStudies: proof.before.mriStudies,
      numbersMatch: true,
    }),
  );
}
