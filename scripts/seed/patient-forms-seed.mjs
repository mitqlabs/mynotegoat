#!/usr/bin/env node
/**
 * One-time, per-workspace seed of the owner's "New Patient Questionnaire"
 * as a SAVED CLOUD FORM (workspace_kv key casemate.patient-forms.v1).
 *
 * No form ships with the app any more: new practices start with zero forms.
 * This only gives the named, already-existing workspaces the questionnaire
 * they asked for. It prints SQL; it never connects to a database itself.
 *
 *   node scripts/seed/patient-forms-seed.mjs --mode dry-run --workspace <uid:office> [--workspace ...]
 *   node scripts/seed/patient-forms-seed.mjs --mode apply   --workspace <uid:office> [--workspace ...]
 *
 * Merge-safe, missing-only:
 *   - key missing            -> INSERT [form] (ON CONFLICT DO NOTHING), logged to
 *                               workspace_kv_history with op 'seed-insert'.
 *   - key present, no form   -> APPEND the form to the array (nothing else changes);
 *     with this id              the history trigger saves the previous value.
 *   - form id already there  -> nothing (even if it was deleted: a tombstone is respected).
 *   - value isn't an array   -> nothing (reported by the dry run).
 *
 * Undo (insert):  delete from public.workspace_kv k using public.workspace_kv_history h
 *                 where h.op = 'seed-insert' and h.key = k.key and h.workspace_id = k.workspace_id and k.value = h.value;
 * Undo (append):  restore the previous value from workspace_kv_history (op 'update').
 *
 * No patient data here: only section names (the practice's Objective macro
 * button names) and generic wording.
 */

export const KEY = "casemate.patient-forms.v1";
export const FORM_ID = "form-new-patient-questionnaire";
const AT = "2026-10-19T00:00:00.000Z";

const s = (id, macroName, title, titleEs, extra = {}) => ({ id, kind: "macro", macroName, title, titleEs, enabled: true, includeWhen: "always", ...extra });

export const OWNER_QUESTIONNAIRE = {
  id: FORM_ID,
  name: "New Patient Questionnaire",
  intro: "Please answer a few questions before your first visit. It takes about 5 minutes. Your answers save as you go.",
  introEs: "Por favor conteste unas preguntas antes de su primera visita. Toma unos 5 minutos. Sus respuestas se guardan mientras avanza.",
  createdAt: AT,
  updatedAt: AT,
  sections: [
    s("mvc-hx", "MVC HX", "About the accident", "Sobre el accidente"),
    // Spinal decompression cases only; questions it shares with MVC HX are asked once.
    s("mvc-hx-sd", "MVC HX SD", "Care after the accident", "Atención después del accidente", { includeWhen: "decompression" }),
    // Blood pressure / heart rate are taken in the office.
    s("vitals", "Vitals", "Height and weight", "Estatura y peso", { onlyQuestions: ["height", "weight"] }),
    s("medical-family-hx", "Medical & Family HX", "Your health history", "Su historial médico"),
    s("functional-limitation", "Functional Limitation", "Daily activities", "Actividades diarias"),
    s("chief-complaints", "Chief Complaints", "Where it hurts", "Dónde le duele"),
  ],
};

const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;
const WS = /^[0-9a-f-]{36}(:[a-z0-9-]+)?$/i;

export function dryRunSql(workspaces) {
  const rows = workspaces.map((w) => `(${lit(w)})`).join(", ");
  return `-- DRY RUN (read-only). What the seed WOULD do per workspace.
with ws(workspace_id) as (values ${rows})
select ws.workspace_id,
       (k.key is not null) as key_exists,
       case when k.value is null then null else jsonb_typeof(k.value) end as value_type,
       case when jsonb_typeof(k.value) = 'array' then jsonb_array_length(k.value) end as forms_now,
       coalesce((select bool_or(e->>'id' = ${lit(FORM_ID)}) from jsonb_array_elements(case when jsonb_typeof(k.value) = 'array' then k.value else '[]'::jsonb end) e), false) as already_has_it,
       case
         when k.key is null then 'INSERT new key with 1 form'
         when jsonb_typeof(k.value) <> 'array' then 'SKIP (value is not a list)'
         when exists (select 1 from jsonb_array_elements(k.value) e where e->>'id' = ${lit(FORM_ID)}) then 'SKIP (already there or deleted by the office)'
         else 'APPEND 1 form, keep the others'
       end as action,
       (select string_agg(e->>'buttonName', ' | ') from public.workspace_kv m, jsonb_array_elements(coalesce(m.value->'templates', '[]'::jsonb)) e
         where m.workspace_id = ws.workspace_id and m.key = 'casemate.macro-library.v1' and e->>'section' = 'objective'
           and e->>'buttonName' in ('MVC HX','MVC HX SD','Vitals','Medical & Family HX','Functional Limitation','Functional Limitations','Chief Complaints')) as saved_macros_found
from ws left join public.workspace_kv k on k.workspace_id = ws.workspace_id and k.key = ${lit(KEY)}
order by ws.workspace_id;`;
}

export function applySql(workspaces) {
  const form = lit(JSON.stringify(OWNER_QUESTIONNAIRE));
  const parts = ["-- APPLY: missing-only, merge-safe. Review the dry run first.", "begin;"];
  for (const w of workspaces) {
    parts.push(
      `-- ${w}`,
      `with ins as (insert into public.workspace_kv (workspace_id, key, value) values (${lit(w)}, ${lit(KEY)}, jsonb_build_array(${form}::jsonb)) on conflict (workspace_id, key) do nothing returning workspace_id, key, value)
insert into public.workspace_kv_history (workspace_id, key, value, op, changed_by) select workspace_id, key, value, 'seed-insert', null from ins;`,
      `update public.workspace_kv set value = value || jsonb_build_array(${form}::jsonb), updated_at = now()
 where workspace_id = ${lit(w)} and key = ${lit(KEY)} and jsonb_typeof(value) = 'array'
   and not exists (select 1 from jsonb_array_elements(value) e where e->>'id' = ${lit(FORM_ID)});`,
    );
  }
  parts.push("commit;");
  return parts.join("\n");
}

function main(argv) {
  const workspaces = [];
  let mode = "dry-run";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--workspace") workspaces.push(argv[++i]);
    else if (argv[i] === "--mode") mode = argv[++i];
  }
  if (!workspaces.length || workspaces.some((w) => !WS.test(w ?? ""))) {
    console.error("Pass one or more --workspace <owner-uuid:office-id>.");
    process.exit(2);
  }
  if (mode === "dry-run") console.log(dryRunSql(workspaces));
  else if (mode === "apply") console.log(applySql(workspaces));
  else {
    console.error("--mode must be dry-run or apply");
    process.exit(2);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
