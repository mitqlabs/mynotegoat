/**
 * Wipe and reseed exactly one workspace: the demo office.
 * Every delete uses an equality filter on that id (or its user id). Nothing else.
 */
import {
  assertDemoResetTarget,
  demoUserIdFromWorkspace,
  isDemoWorkspaceId,
} from "@/lib/demo-office";
import {
  appointmentSeedRows,
  buildDemoSeed,
  demoSeedProblems,
  kvSeedRows,
  noteSeedRows,
  patientSeedRows,
} from "@/lib/demo-seed";

/** Tables cleared with workspace_id = the demo workspace. Order respects foreign keys. */
export const DEMO_WORKSPACE_TABLES = [
  "reminder_broadcast_recipients",
  "reminder_broadcasts",
  "reminder_claims",
  "reminder_devices",
  "reminder_log",
  "reminder_opt_outs",
  "birthday_text_log",
  "goat_mail_connections",
  "patient_form_requests",
  "patient_files",
  "workspace_messages",
  "activity_log",
  "audit_log",
  "room_timers",
  "patients",
  "schedule_appointments",
  "encounter_notes",
  "workspace_kv",
  "workspace_kv_history",
  "app_snapshots",
  "app_snapshots_history",
] as const;

export interface DemoResetDb {
  /** Equality delete. `value` is checked again before this is called. */
  deleteEq(table: string, column: "workspace_id" | "workspace_owner_id" | "member_user_id", value: string): Promise<void>;
  upsert(table: string, rows: Record<string, unknown>[], onConflict: string): Promise<void>;
  readLock?(): Promise<string | null>;
  writeLock?(workspaceId: string): Promise<void>;
  /** Remove stored files whose path starts with this user id. The id is checked first. */
  removeStoragePrefix?(bucket: string, userId: string): Promise<void>;
}

export interface DemoResetResult {
  workspaceId: string;
  patients: number;
  appointments: number;
  notes: number;
}

function guardValue(value: string, allowed: Set<string>) {
  if (!allowed.has(value)) throw new Error("Reset tried to touch a value that is not the demo workspace.");
  if (!isDemoWorkspaceId(value) && !allowed.has(value)) throw new Error("Reset tried to touch a non-demo id.");
}

export async function resetDemoWorkspace(db: DemoResetDb, requested: string, configured: string | undefined, now: Date = new Date()): Promise<DemoResetResult> {
  const workspaceId = assertDemoResetTarget(requested, configured);
  const userId = demoUserIdFromWorkspace(workspaceId);
  if (db.readLock) {
    const locked = (await db.readLock())?.trim() ?? "";
    if (locked && locked !== workspaceId) throw new Error("Demo lock points at a different workspace. Refusing.");
  }
  const allowed = new Set([workspaceId, userId]);
  const seed = buildDemoSeed(now);
  const problems = demoSeedProblems(seed);
  if (problems.length) throw new Error(`Demo seed failed validation: ${problems.join(" ")}`);

  for (const table of DEMO_WORKSPACE_TABLES) {
    guardValue(workspaceId, allowed);
    await db.deleteEq(table, "workspace_id", workspaceId);
  }
  guardValue(userId, allowed);
  await db.deleteEq("workspace_members", "workspace_owner_id", userId);
  await db.deleteEq("workspace_members", "member_user_id", userId);
  if (db.removeStoragePrefix) {
    guardValue(userId, allowed);
    await db.removeStoragePrefix("user-files", userId);
    await db.removeStoragePrefix("patient-photos", userId);
  }

  await db.upsert("patients", patientSeedRows(seed.patients, workspaceId), "workspace_id,id");
  await db.upsert("schedule_appointments", appointmentSeedRows(seed.appointments, workspaceId), "workspace_id,id");
  await db.upsert("encounter_notes", noteSeedRows(seed.notes, workspaceId), "workspace_id,id");
  await db.upsert("workspace_kv", kvSeedRows(seed.kv, workspaceId), "workspace_id,key");
  await db.upsert("app_snapshots", [{ workspace_id: workspaceId, snapshot: {}, updated_at: now.toISOString() }], "workspace_id");
  if (db.writeLock) await db.writeLock(workspaceId);

  return {
    workspaceId,
    patients: seed.patients.length,
    appointments: seed.appointments.length,
    notes: seed.notes.length,
  };
}
