/**
 * OPTIONAL one-time backfill: save each existing workspace's CURRENT
 * effective in-code defaults into its own workspace_kv rows.
 *
 * NOT NEEDED for the blank-starter change to be safe: existing workspaces
 * have no "casemate.workspace-starter.v1" marker, so the app keeps showing
 * them the same legacy defaults (see src/lib/workspace-starter.ts and
 * scripts/tests/workspace-starter.test.ts). This is belt-and-braces only,
 * e.g. if the legacy defaults are ever deleted from the code.
 *
 * It never overwrites: every row is INSERT … ON CONFLICT DO NOTHING, and each
 * row it actually inserts is also recorded in workspace_kv_history
 * (op = 'backfill-insert') so it can be found and undone.
 *
 * This script never talks to the database. It reads a JSON list of
 * workspaces + the keys they already have (from a read-only query), prints a
 * dry-run report, and writes a SQL file for a human to review and run.
 *
 *   npx tsx scripts/backfill/legacy-defaults-backfill.ts <workspaces.json> [out.sql]
 *
 * workspaces.json: [{ "workspace_id": "<owner-uuid>:main-office", "keys": ["casemate.…", …] }, …]
 * Get it with (read-only):
 *   select u.id::text || ':main-office' as workspace_id,
 *          coalesce((select array_agg(k.key) from public.workspace_kv k
 *                    where k.workspace_id = u.id::text || ':main-office'), '{}') as keys
 *   from auth.users u
 *   where not exists (select 1 from public.workspace_members m where m.member_user_id = u.id);
 */
import { readFileSync, writeFileSync } from "node:fs";

/** Settings whose value comes from code until someone edits them. */
export const DEFAULT_BEARING_KEYS = [
  "casemate.schedule-appointment-types.v1",
  "casemate.schedule-settings.v1",
  "casemate.billing-macros.v1",
  "casemate.macro-library.v1",
  "casemate.soap-macros.v1",
  "casemate.document-templates.v1",
  "casemate.report-templates.v1",
] as const;

export interface WorkspaceKeys {
  workspace_id: string;
  keys: string[];
}

export function planBackfill(workspaces: WorkspaceKeys[]) {
  return workspaces.map((w) => ({
    workspace_id: w.workspace_id,
    missing: DEFAULT_BEARING_KEYS.filter((k) => !w.keys.includes(k)),
  }));
}

/** The legacy defaults exactly as an un-edited existing workspace sees them. */
export async function legacyDefaultValues(): Promise<Record<string, unknown>> {
  // No window → every getter takes the legacy path (no marker possible).
  const appt = await import("../../src/lib/schedule-appointment-types");
  const sched = await import("../../src/lib/schedule-settings");
  const billing = await import("../../src/lib/billing-macros");
  const macros = await import("../../src/lib/macro-templates");
  const soap = await import("../../src/lib/soap-macros");
  const docs = await import("../../src/lib/document-templates");
  const reports = await import("../../src/lib/report-templates");
  return {
    "casemate.schedule-appointment-types.v1": appt.getDefaultAppointmentTypes(),
    "casemate.schedule-settings.v1": sched.getDefaultScheduleSettings(),
    "casemate.billing-macros.v1": billing.getDefaultBillingMacroLibrary(),
    "casemate.macro-library.v1": macros.getDefaultMacroLibrary(),
    "casemate.soap-macros.v1": soap.getDefaultSoapMacros(),
    "casemate.document-templates.v1": docs.getDefaultDocumentTemplateLibrary(),
    "casemate.report-templates.v1": reports.getDefaultNarrativeReportLibrary(),
  };
}

function sqlLiteral(text: string) {
  return `'${text.replace(/'/g, "''")}'`;
}

export function buildBackfillSql(plan: ReturnType<typeof planBackfill>, values: Record<string, unknown>) {
  const lines = [
    "-- One-time legacy-defaults backfill. INSERT-only: never overwrites (ON CONFLICT DO NOTHING).",
    "-- Every row actually inserted is also written to workspace_kv_history (op 'backfill-insert').",
    "-- Undo: delete from public.workspace_kv k using public.workspace_kv_history h",
    "--        where h.op = 'backfill-insert' and h.workspace_id = k.workspace_id and h.key = k.key and k.value = h.value;",
    "begin;",
  ];
  for (const row of plan) {
    for (const key of row.missing) {
      lines.push(
        `with ins as (insert into public.workspace_kv (workspace_id, key, value) values (${sqlLiteral(row.workspace_id)}, ${sqlLiteral(key)}, ${sqlLiteral(JSON.stringify(values[key]))}::jsonb) on conflict (workspace_id, key) do nothing returning workspace_id, key, value)`,
        `insert into public.workspace_kv_history (workspace_id, key, value, op, changed_by) select workspace_id, key, value, 'backfill-insert', null from ins;`,
      );
    }
  }
  lines.push("commit;", "");
  return lines.join("\n");
}

async function main() {
  const [input, out] = process.argv.slice(2);
  if (!input) {
    console.error("usage: legacy-defaults-backfill.ts <workspaces.json> [out.sql]");
    process.exit(2);
  }
  const workspaces = JSON.parse(readFileSync(input, "utf8")) as WorkspaceKeys[];
  const plan = planBackfill(workspaces);
  console.log("DRY RUN — nothing is written to the database.\n");
  let total = 0;
  for (const row of plan) {
    total += row.missing.length;
    console.log(`${row.workspace_id}: ${row.missing.length ? row.missing.join(", ") : "(nothing missing)"}`);
  }
  console.log(`\n${total} row(s) would be inserted across ${plan.filter((p) => p.missing.length).length} workspace(s).`);
  if (out) {
    writeFileSync(out, buildBackfillSql(plan, await legacyDefaultValues()));
    console.log(`SQL for review written to ${out} (not run).`);
  }
}

if (process.argv[1] && /legacy-defaults-backfill\.ts$/.test(process.argv[1])) void main();
