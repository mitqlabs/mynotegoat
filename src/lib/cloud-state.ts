"use client";

import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { clearAllWorkspaceCaches, clearForeignWorkspaceCaches } from "@/lib/workspace-storage";
import { notifyChange } from "@/lib/local-sync";

type LocalSnapshot = Record<string, string>;

const LOCAL_KEY_PREFIX = "casemate.";
const ACTIVE_WORKSPACE_KEY = "casemate.active-workspace-id.v1";
const LOCAL_SYNC_AT_PREFIX = "casemate.cloud-sync-at";
const DEFAULT_TABLE = "app_snapshots";
const DEFAULT_OFFICE_ID = "main-office";

function getConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const table =
    process.env.NEXT_PUBLIC_CASEMATE_SNAPSHOT_TABLE?.trim() || DEFAULT_TABLE;
  const officeId =
    process.env.NEXT_PUBLIC_CASEMATE_OFFICE_ID?.trim() ||
    process.env.NEXT_PUBLIC_CASEMATE_WORKSPACE_ID?.trim() ||
    DEFAULT_OFFICE_ID;

  if (!url || !anonKey) {
    return null;
  }

  return {
    url,
    anonKey,
    table,
    officeId,
  };
}

export function isCloudSyncEnabled() {
  return Boolean(getConfig());
}

export function buildWorkspaceIdForUser(userId: string) {
  const officeId =
    process.env.NEXT_PUBLIC_CASEMATE_OFFICE_ID?.trim() ||
    process.env.NEXT_PUBLIC_CASEMATE_WORKSPACE_ID?.trim() ||
    DEFAULT_OFFICE_ID;
  return `${userId}:${officeId}`;
}

function getSyncAtKey(workspaceId: string) {
  return `${LOCAL_SYNC_AT_PREFIX}.${workspaceId}`;
}

export function setActiveWorkspaceId(workspaceId: string) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(ACTIVE_WORKSPACE_KEY, workspaceId);
}

/**
 * Synchronously guarantee that localStorage belongs to `expectedWorkspaceId`.
 *
 * If the stored active-workspace pointer is missing OR points to a different
 * workspace, every casemate.* key is wiped before this function returns.
 * Always called from the portal layout BEFORE any hook reads localStorage,
 * so a fresh signup in an existing browser starts with a truly empty slate
 * instead of inheriting the previous session's patient data.
 *
 * The previous behavior — pre-setting active-workspace-id and then comparing
 * inside an async cloud bootstrap — caused the comparison to always pass and
 * the leftover data to be sync-pushed under the new user's id.
 */
/**
 * Called from the sign-out button. Wipes every casemate.* key AND the
 * active-workspace pointer so the next user to land in this browser
 * starts with a truly empty slate.
 */
export function wipeLocalWorkspaceForSignOut() {
  if (typeof window === "undefined") {
    return;
  }
  clearLocalWorkspaceData();
  // Phase-0 cloud-as-truth namespace lives outside the legacy casemate.*
  // wipe loop, so it has to be cleared explicitly. Belt-and-suspenders so
  // a friend signing into the same browser cannot inherit cached entity
  // data from the prior account.
  clearAllWorkspaceCaches();
  window.localStorage.removeItem(ACTIVE_WORKSPACE_KEY);
}

export function ensureWorkspaceForUser(expectedWorkspaceId: string) {
  if (typeof window === "undefined") {
    return;
  }
  const previous = window.localStorage.getItem(ACTIVE_WORKSPACE_KEY) ?? "";
  if (previous !== expectedWorkspaceId) {
    // Wipes every casemate.* key (preserves backup + sync-at + workspace-id).
    clearLocalWorkspaceData();
    // Also wipe any Phase-0+ workspace-namespaced cache that doesn't belong
    // to the new active workspace. clearAllWorkspaceCaches would also work,
    // but the foreign-only variant lets us keep the new workspace's own
    // entries if they were pre-bootstrapped (none today, but future-proof).
    clearForeignWorkspaceCaches(expectedWorkspaceId);
    window.localStorage.setItem(ACTIVE_WORKSPACE_KEY, expectedWorkspaceId);
  }
}

function getActiveWorkspaceId() {
  if (typeof window === "undefined") {
    return "";
  }
  return window.localStorage.getItem(ACTIVE_WORKSPACE_KEY) ?? "";
}

const BACKUP_KEY = "casemate.__safety-backup__.v1";

/** Hard cap on how big the safety-backup in localStorage can grow.
 *  localStorage has a 5 MB quota. We can't afford to use half of it on
 *  a snapshot the cloud already holds — the user reported a crashed
 *  browser at 4.70 MB local, and the backup was a big chunk of it.
 *  Above this cap we skip the backup entirely (cloud has it). */
const BACKUP_MAX_BYTES = 500_000; // ~500 KB

function backupLocalWorkspaceData() {
  if (typeof window === "undefined") {
    return;
  }
  try {
    const snapshot = readLocalSnapshot();
    if (!hasMeaningfulLocalData(snapshot)) return;
    const payload = JSON.stringify({
      backedUpAt: new Date().toISOString(),
      snapshot,
    });
    // Skip the backup if it would balloon localStorage past safe
    // levels. The cloud is the authoritative backup anyway; this
    // local copy is a last-ditch recovery aid for users who wipe
    // their cloud row by mistake. Not worth risking a QuotaExceeded
    // mid-save.
    if (payload.length > BACKUP_MAX_BYTES) {
      console.warn(
        `[cloud-state] Skipping safety-backup — payload ${payload.length} bytes > ${BACKUP_MAX_BYTES} cap. Cloud is the source of truth.`,
      );
      // Also drop any existing oversized backup so it stops hogging quota.
      window.localStorage.removeItem(BACKUP_KEY);
      return;
    }
    window.localStorage.setItem(BACKUP_KEY, payload);
  } catch {
    // best-effort — if we can't write the backup, the cloud copy is fine
  }
}

function clearLocalWorkspaceData() {
  if (typeof window === "undefined") {
    return;
  }

  // Always create a safety backup before clearing
  backupLocalWorkspaceData();

  // CRITICAL: pause the storage-sync interceptor for the duration of the
  // wipe. Without this, every removeItem() below would schedule a cloud
  // push, and the resulting push could overwrite the cloud row with an
  // empty/near-empty snapshot. The 2026-04-08 incident was caused by
  // exactly this race condition.
  //
  // Imported lazily to avoid a circular dependency between cloud-state and
  // storage-sync-interceptor.
  let resume: (() => void) | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const interceptor = require("@/lib/storage-sync-interceptor") as {
      pauseSync?: () => void;
      resumeSync?: () => void;
    };
    if (typeof interceptor.pauseSync === "function") {
      interceptor.pauseSync();
      resume = () => interceptor.resumeSync?.();
    }
  } catch {
    // interceptor module not loaded yet — nothing to pause.
  }

  try {
    const keysToRemove: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key || !key.startsWith(LOCAL_KEY_PREFIX)) {
        continue;
      }
      if (
        key === ACTIVE_WORKSPACE_KEY ||
        key.startsWith(`${LOCAL_SYNC_AT_PREFIX}.`) ||
        key === BACKUP_KEY
      ) {
        continue;
      }
      keysToRemove.push(key);
    }

    keysToRemove.forEach((key) => {
      window.localStorage.removeItem(key);
    });
  } finally {
    if (resume) {
      resume();
    }
  }
}

function readLocalSnapshot(): LocalSnapshot {
  if (typeof window === "undefined") {
    return {};
  }

  const snapshot: LocalSnapshot = {};
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (
      !key ||
      !key.startsWith(LOCAL_KEY_PREFIX) ||
      key === ACTIVE_WORKSPACE_KEY ||
      key === BACKUP_KEY ||
      key.startsWith(`${LOCAL_SYNC_AT_PREFIX}.`)
    ) {
      // BACKUP_KEY is intentionally excluded from snapshots that get pushed
      // to the cloud. On 2026-04-08 a wipe loop left only the safety backup
      // in localStorage, and the next autosave pushed a snapshot containing
      // ONLY that key — wiping every patient/SOAP/macro/letter from the
      // cloud row. Never let the safety backup be the data.
      continue;
    }

    const value = window.localStorage.getItem(key);
    snapshot[key] = value ?? "";
  }
  return snapshot;
}

/**
 * Count the keys in a snapshot that represent real user data.
 * Used by the destructive-write guard.
 */
function countMeaningfulKeys(snapshot: Record<string, unknown>): number {
  let count = 0;
  for (const key of Object.keys(snapshot)) {
    if (!key.startsWith(LOCAL_KEY_PREFIX)) continue;
    if (key === BACKUP_KEY) continue;
    if (key === ACTIVE_WORKSPACE_KEY) continue;
    if (key.startsWith(`${LOCAL_SYNC_AT_PREFIX}.`)) continue;
    const value = snapshot[key];
    const str = typeof value === "string" ? value : JSON.stringify(value ?? "");
    const trimmed = str.trim();
    if (trimmed.length === 0 || trimmed === "{}" || trimmed === "[]") continue;
    count += 1;
  }
  return count;
}

function writeLocalSnapshot(snapshot: Record<string, unknown>) {
  if (typeof window === "undefined") {
    return;
  }

  for (const [key, value] of Object.entries(snapshot)) {
    if (!key.startsWith(LOCAL_KEY_PREFIX)) {
      continue;
    }
    try {
      if (typeof value === "string") {
        window.localStorage.setItem(key, value);
      } else {
        window.localStorage.setItem(key, JSON.stringify(value));
      }
    } catch (storageErr) {
      console.warn(`[Cloud Sync] Could not write "${key}" to localStorage (quota?):`, storageErr);
    }
  }
}

function hasMeaningfulLocalData(snapshot: LocalSnapshot) {
  const values = Object.values(snapshot);
  if (values.length === 0) {
    return false;
  }

  return values.some((value) => {
    const trimmed = value.trim();
    return trimmed.length > 0 && trimmed !== "{}" && trimmed !== "[]";
  });
}

function parseTimestamp(value: string | null) {
  if (!value) {
    return Number.NaN;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NaN : parsed;
}

// IMPORTANT: do NOT cache the resolved auth config across calls. A previous
// version cached for 60 seconds, which meant a brand-new signup could resolve
// to the prior user's workspace_id and clobber data across accounts. getSession
// reads from the supabase client's in-memory + localStorage state, so it's
// already cheap — we re-resolve every time.
async function getAuthedConfig() {
  const config = getConfig();
  const supabase = getSupabaseBrowserClient();
  if (!config || !supabase) {
    return null;
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  const userId = session?.user?.id;
  if (!userId) {
    return null;
  }

  return {
    ...config,
    supabase,
    userId,
    workspaceId: `${userId}:${config.officeId}`,
  };
}

async function fetchRemoteSnapshot(workspaceId: string) {
  const authed = await getAuthedConfig();
  if (!authed) {
    return null;
  }

  const { data, error } = await authed.supabase
    .from(authed.table)
    .select("workspace_id,snapshot,updated_at")
    .eq("workspace_id", workspaceId)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function upsertRemoteSnapshot(workspaceId: string, snapshot: LocalSnapshot) {
  const authed = await getAuthedConfig();
  if (!authed || typeof window === "undefined") {
    return;
  }

  const nowIso = new Date().toISOString();
  const { error } = await authed.supabase.from(authed.table).upsert(
    {
      workspace_id: workspaceId,
      snapshot,
      updated_at: nowIso,
    },
    {
      onConflict: "workspace_id",
    },
  );

  if (error) {
    throw error;
  }

  window.localStorage.setItem(getSyncAtKey(workspaceId), nowIso);
}

export class CloudBootstrapError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "CloudBootstrapError";
  }
}

export async function prepareCloudStateBeforeMount() {
  if (typeof window === "undefined" || !isCloudSyncEnabled()) {
    return;
  }

  // Hard timeout: never let cloud sync block longer than 15 seconds.
  // (Bumped from 5s — we now BLOCK on success, so a slow network must
  // not silently fall through to an empty render.)
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const authed = await getAuthedConfig();
    if (!authed) {
      // Not signed in yet — nothing to bootstrap. Caller should redirect.
      return;
    }
    if (controller.signal.aborted) {
      throw new CloudBootstrapError("Cloud bootstrap timed out before auth");
    }

    const previousWorkspaceId = getActiveWorkspaceId();
    const workspaceSwitched =
      previousWorkspaceId && previousWorkspaceId !== authed.workspaceId;

    if (workspaceSwitched) {
      backupLocalWorkspaceData();
      clearLocalWorkspaceData();
      window.localStorage.removeItem(getSyncAtKey(previousWorkspaceId));
    }

    setActiveWorkspaceId(authed.workspaceId);

    if (controller.signal.aborted) {
      throw new CloudBootstrapError("Cloud bootstrap timed out");
    }

    const localSnapshot = readLocalSnapshot();
    const localHasData = hasMeaningfulLocalData(localSnapshot);

    let remote: Awaited<ReturnType<typeof fetchRemoteSnapshot>> = null;
    try {
      remote = await fetchRemoteSnapshot(authed.workspaceId);
    } catch (error) {
      // CRITICAL: do NOT silently fall through. If we can't talk to the
      // cloud we must refuse to mount the app — otherwise the user could
      // start editing on top of empty/stale localStorage and the next
      // autosave would push that empty state up.
      throw new CloudBootstrapError(
        "Could not reach the cloud. Refusing to load the app with potentially stale local data. Please check your internet connection and try again.",
        error,
      );
    }

    if (controller.signal.aborted) {
      throw new CloudBootstrapError("Cloud bootstrap timed out fetching remote");
    }

    const remoteHasData =
      remote &&
      remote.snapshot &&
      typeof remote.snapshot === "object" &&
      !Array.isArray(remote.snapshot) &&
      hasMeaningfulLocalData(
        Object.fromEntries(
          Object.entries(remote.snapshot as Record<string, unknown>).map(
            ([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)],
          ),
        ),
      );

    if (remoteHasData) {
      // ── TIMESTAMP COMPARISON: never overwrite newer local data with older remote ──
      const lastLocalPushIso = window.localStorage.getItem(getSyncAtKey(authed.workspaceId));
      const lastLocalPushMs = parseTimestamp(lastLocalPushIso);
      const remoteUpdatedMs = parseTimestamp(remote!.updated_at ?? null);

      // If we have local data AND our last push is same or newer than remote, keep local.
      // This means local already has the latest — no need to overwrite.
      if (localHasData && !Number.isNaN(lastLocalPushMs) && !Number.isNaN(remoteUpdatedMs)) {
        if (lastLocalPushMs >= remoteUpdatedMs) {
          console.info("[Cloud Sync] Local data is same age or newer than remote — keeping local.");
          return;
        }
      }

      // If local has NO sync timestamp (fresh browser / cleared cache), always accept remote.
      // If remote is genuinely newer, accept it but always backup first.
      if (localHasData) {
        backupLocalWorkspaceData();
        console.info("[Cloud Sync] Remote data is newer — pulling from cloud (local backed up).");
      }
      writeLocalSnapshot(remote!.snapshot as Record<string, unknown>);
      if (remote!.updated_at) {
        window.localStorage.setItem(
          getSyncAtKey(authed.workspaceId),
          remote!.updated_at,
        );
      }
      return;
    }

    // Remote is empty but local has data — push local to remote (first-time bootstrap)
    if (localHasData) {
      await upsertRemoteSnapshot(authed.workspaceId, localSnapshot);
    }

  } catch (error) {
    // Re-throw bootstrap errors so the layout can show a hard error screen.
    // Only swallow truly unexpected, non-fatal errors.
    if (error instanceof CloudBootstrapError) {
      throw error;
    }
    console.error("[Cloud Sync] Unexpected bootstrap error:", error);
    throw new CloudBootstrapError(
      "Unexpected error while syncing with the cloud. Refusing to load the app.",
      error,
    );
  } finally {
    clearTimeout(timeout);

    // Phase-1 cloud-as-truth pull for table-backed entities. MUST be in
    // finally so it runs regardless of which early-return path the legacy
    // blob bootstrap took (local-newer, remote-newer, first-time push).
    // Wrapped in try so a Phase-1 hiccup never blocks the legacy load.
    try {
      await bootstrapTableBackedEntities();
    } catch (entityErr) {
      console.error("[Cloud Sync] Phase-1 entity bootstrap failed:", entityErr);
    }
  }
}

/**
 * Phase-1 bootstrap for table-backed entities.
 *
 * When the `patients` feature flag is on (via localStorage override or
 * compile-time default), this fetches the authoritative patient list from
 * the `patients` table and replaces the in-memory + legacy-blob cache.
 *
 * First-run migration: if the table is empty for this workspace but the
 * legacy blob has patients, every patient is pushed up to the table in one
 * bulk upsert. Subsequent boots simply pull from the table.
 */
async function bootstrapTableBackedEntities() {
  if (typeof window === "undefined") return;

  // Lazy imports to avoid pulling Supabase tables into the cold-path and
  // to prevent circular imports (mock-data ↔ patients-cloud ↔ cloud-state).
  const { isCloudEntityEnabled } = await import("@/lib/feature-flags");
  if (!isCloudEntityEnabled("patients")) return;

  const { fetchAllPatientsFromTable, isPatientsTableReady, bulkUpsertPatientsToTable } =
    await import("@/lib/patients-cloud");
  const { patients, replacePatientsFromCloud } = await import("@/lib/mock-data");
  const { pauseSync, resumeSync } = await import("@/lib/storage-sync-interceptor");

  const ready = await isPatientsTableReady();
  if (!ready) {
    console.warn(
      "[Cloud Sync] patients flag is on but the table isn't ready. " +
      "Run supabase/patients_table.sql in the SQL editor and refresh.",
    );
    return;
  }

  const tableRows = await fetchAllPatientsFromTable();
  if (tableRows === null) {
    // Couldn't reach the table — leave legacy cache in place.
    return;
  }

  if (tableRows.length === 0 && patients.length > 0) {
    // First-run migration: table empty but legacy blob has patients.
    // Push every existing patient to the table. Runs ONLY when the table
    // is truly empty for this workspace so a flag re-flip never re-uploads.
    console.info(
      `[Cloud Sync] Migrating ${patients.length} patient(s) from legacy blob to table...`,
    );
    const result = await bulkUpsertPatientsToTable([...patients]);
    if (!result.ok) {
      console.error("[Cloud Sync] Patient migration failed:", result.error);
    } else {
      console.info(`[Cloud Sync] Migrated ${result.count} patient(s).`);
    }
    return;
  }

  if (tableRows.length === 0) {
    // Table empty AND legacy blob empty — nothing to do.
    return;
  }

  // Table is the source of truth. Replace the legacy cache from the table
  // BEFORE the patients page mounts. Pause the storage-sync interceptor so
  // the localStorage write doesn't trigger a push to the legacy blob row.
  pauseSync();
  try {
    replacePatientsFromCloud(tableRows);
  } finally {
    resumeSync();
  }
  console.info(`[Cloud Sync] Loaded ${tableRows.length} patient(s) from table.`);

  // ── Phase 2: schedule appointments ──
  if (isCloudEntityEnabled("scheduleAppointments")) {
    const {
      fetchAllAppointmentsFromTable,
      isAppointmentsTableReady,
      bulkUpsertAppointmentsToTable,
    } = await import("@/lib/appointments-cloud");
    const {
      loadScheduleAppointments,
      replaceAppointmentsFromCloud,
    } = await import("@/lib/schedule-appointments");

    const apptsReady = await isAppointmentsTableReady();
    if (!apptsReady) {
      console.warn(
        "[Cloud Sync] scheduleAppointments flag is on but table isn't ready. " +
        "Run supabase/schedule_appointments_table.sql in the SQL editor.",
      );
    } else {
      const apptsRows = await fetchAllAppointmentsFromTable();
      if (apptsRows !== null) {
        const localAppts = loadScheduleAppointments();
        if (apptsRows.length === 0 && localAppts.length > 0) {
          console.info(
            `[Cloud Sync] Migrating ${localAppts.length} appointment(s) to table...`,
          );
          const result = await bulkUpsertAppointmentsToTable(localAppts);
          if (result.ok) {
            console.info(`[Cloud Sync] Migrated ${result.count} appointment(s).`);
          } else {
            console.error("[Cloud Sync] Appointment migration failed:", result.error);
          }
        } else if (apptsRows.length > 0) {
          // SAFETY: Before clobbering local appointments with cloud data,
          // sanity-check the counts and the per-id status diff. If local
          // has MORE appointments than cloud, treat that as "cloud is
          // stale" (a dual-write may have failed, or another session
          // wrote earlier). Don't wipe; preserve local and warn loudly.
          //
          // This is the same defensive pattern we added for
          // patient-follow-up-overrides after the data-loss report.
          // Without it, the user toggling check-in / cancel / reschedule
          // and then refreshing-with-stale-cloud silently snaps every
          // appointment back to whatever the cloud had — which feels
          // exactly like "the schedule is doing random shit by itself".
          const cloudById = new Map(apptsRows.map((a) => [a.id, a]));
          const statusDiffs = localAppts
            .filter((local) => {
              const cloud = cloudById.get(local.id);
              return cloud && cloud.status !== local.status;
            })
            .map((local) => {
              const cloud = cloudById.get(local.id);
              return `${local.id} local="${local.status}" cloud="${cloud?.status ?? "?"}"`;
            });
          if (statusDiffs.length > 0 || localAppts.length !== apptsRows.length) {
            console.warn(
              `[Cloud Sync] Appointment cloud/local diff — local=${localAppts.length} cloud=${apptsRows.length}` +
                (statusDiffs.length > 0
                  ? `, ${statusDiffs.length} status mismatch(es): ${statusDiffs.slice(0, 5).join("; ")}` +
                    (statusDiffs.length > 5 ? `; ...and ${statusDiffs.length - 5} more` : "")
                  : ""),
            );
          }
          if (localAppts.length > apptsRows.length) {
            console.warn(
              `[Cloud Sync] SKIPPING appointment overwrite — local has ${localAppts.length}, ` +
                `cloud has only ${apptsRows.length}. Cloud may be stale (failed dual-write?). ` +
                `Keeping local. Will re-sync on next save.`,
            );
          } else {
            pauseSync();
            try {
              replaceAppointmentsFromCloud(apptsRows);
            } finally {
              resumeSync();
            }
            console.info(`[Cloud Sync] Loaded ${apptsRows.length} appointment(s) from table.`);
          }
        }
      }
    }
  }

  // ── Phases 4-8: workspace_kv for all remaining entities ──
  const anyKvFlagOn =
    isCloudEntityEnabled("billing") ||
    isCloudEntityEnabled("macros") ||
    isCloudEntityEnabled("schedulingSettings") ||
    isCloudEntityEnabled("contacts") ||
    isCloudEntityEnabled("tasks");

  if (anyKvFlagOn) {
    const { isKvTableReady, fetchAllKvValues, bulkUpsertKvValues } =
      await import("@/lib/kv-cloud");

    const kvReady = await isKvTableReady();
    if (!kvReady) {
      console.warn(
        "[Cloud Sync] KV flags are on but workspace_kv table isn't ready. " +
        "Run supabase/workspace_kv_table.sql in the SQL editor.",
      );
    } else {
      // All KV storage keys that should be migrated, grouped by flag.
      const kvKeysByFlag: Record<string, string[]> = {
        billing: [
          "casemate.patient-billing.v1",
          "casemate.patient-diagnoses.v1",
          "casemate.patient-follow-up-overrides.v1",
        ],
        macros: [
          "casemate.soap-macros.v1",
          "casemate.macro-library.v1",
          "casemate.report-templates.v1",
          "casemate.document-templates.v1",
          "casemate.billing-macros.v1",
        ],
        schedulingSettings: [
          "casemate.schedule-settings.v1",
          "casemate.schedule-rooms.v1",
          "casemate.schedule-appointment-types.v1",
          "casemate.room-timer-presets.v1",
        ],
        contacts: [
          "casemate.contact-directory.v1",
          "casemate.contact-categories.v1",
          // Marketing / BD outreach touches, keyed by attorney contact id.
          // Dual-written to the "contacts" namespace, so it hydrates here.
          "casemate.marketing.v1",
          "casemate.marketing-settings.v1",
        ],
        tasks: [
          "casemate.tasks.v1",
          "casemate.dashboard-workspace-settings.v1",
          "casemate.quick-stats-settings.v1",
          "casemate.office-settings.v1",
          "casemate.email-settings.v1",
          "casemate.case-statuses.v1",
          "casemate.key-dates.v1",
          "casemate.dashboard-priority-rules.v1",
          "casemate.files.v1",
          "casemate.patient-page-prefs.v1",
          // SMS templates were dual-written to workspace_kv (namespace
          // "tasks") on save but never listed here, so they were never
          // pulled BACK from the cloud on boot. A local reset (or the
          // legacy app_snapshots pull) could wipe a created template with
          // no way to restore it, even though the cloud backup still had
          // it. Listing the key makes SMS templates cloud-as-truth like
          // every other synced key.
          "casemate.sms-templates.v1",
        ],
      };

      // Collect all enabled keys.
      const enabledKeys: string[] = [];
      for (const [flag, keys] of Object.entries(kvKeysByFlag)) {
        if (isCloudEntityEnabled(flag as import("@/lib/feature-flags").CloudEntityFlag)) {
          enabledKeys.push(...keys);
        }
      }

      // Fetch all kv values in one query.
      const remoteKv = await fetchAllKvValues();
      if (remoteKv !== null) {
        if (remoteKv.size === 0) {
          // First-run migration: push all enabled localStorage keys to the table.
          const entries: Array<{ key: string; value: unknown }> = [];
          for (const key of enabledKeys) {
            const raw = window.localStorage.getItem(key);
            if (raw) {
              try {
                entries.push({ key, value: JSON.parse(raw) });
              } catch {
                // skip unparseable
              }
            }
          }
          if (entries.length > 0) {
            console.info(
              `[Cloud Sync] Migrating ${entries.length} kv key(s) to workspace_kv table...`,
            );
            const result = await bulkUpsertKvValues(entries);
            if (result.ok) {
              console.info(`[Cloud Sync] Migrated ${result.count} kv key(s).`);
            } else {
              console.error("[Cloud Sync] KV migration failed:", result.error);
            }
          }
        } else {
          // Table has data — replace localStorage from the table for enabled keys.
          //
          // SAFETY: Before clobbering local with cloud, count what each side
          // has. If local has MORE entries than cloud for a record-shaped key
          // (object map of patientId → record, or array), we treat that as a
          // "cloud is older / our last save didn't land" signal and SKIP the
          // overwrite, keeping local. Otherwise an offline session, a failed
          // dual-write, or just a quick refresh-after-toggle would silently
          // wipe everything the user just did. This was the failure mode for
          // the "I marked 15 patients refused and went back to Case Flow and
          // they were all there" data-loss report.
          // These keys store a single wrapper object (e.g.
          // { templates: [...] }), so a top-level key count is a constant
          // (1–2) regardless of how much text lives inside a template body.
          // The entry-count guard below is blind to them, so cloud always
          // wins and freshly typed template text vanishes on reload. For
          // these keys, compare serialized SIZE instead (see below).
          const CONTENT_SIZED_LIBRARY_KEYS = new Set([
            "casemate.report-templates.v1",
            "casemate.document-templates.v1",
          ]);
          let replacedCount = 0;
          let skippedLocalIsBigger = 0;
          pauseSync();
          try {
            for (const key of enabledKeys) {
              const value = remoteKv.get(key);
              if (value === undefined) continue;
              const localRaw = window.localStorage.getItem(key);
              if (localRaw) {
                let localCount = -1;
                let cloudCount = -1;
                try {
                  if (CONTENT_SIZED_LIBRARY_KEYS.has(key)) {
                    // Wrapper-object libraries: compare serialized SIZE, not
                    // entry count. When local holds more text than cloud (the
                    // user just typed into a template body), treat cloud as
                    // stale — a fire-and-forget dual-write that didn't land —
                    // and keep local instead of wiping the fresh edit.
                    localCount = localRaw.length;
                    cloudCount = JSON.stringify(value).length;
                  } else {
                    const localParsed = JSON.parse(localRaw);
                    if (localParsed && typeof localParsed === "object") {
                      localCount = Array.isArray(localParsed)
                        ? localParsed.length
                        : Object.keys(localParsed).length;
                    }
                    if (value && typeof value === "object") {
                      cloudCount = Array.isArray(value)
                        ? (value as unknown[]).length
                        : Object.keys(value as object).length;
                    }
                  }
                } catch {
                  // Unparseable local — fall through and overwrite.
                }
                if (localCount > 0 && cloudCount >= 0 && localCount > cloudCount) {
                  console.warn(
                    `[Cloud Sync] SKIPPING overwrite of "${key}" — local has ${localCount} entries, ` +
                    `cloud has only ${cloudCount}. Cloud may be stale (failed dual-write?). ` +
                    `Keeping local. Will re-sync on next save.`,
                  );
                  skippedLocalIsBigger += 1;
                  continue;
                }
              }
              try {
                window.localStorage.setItem(key, JSON.stringify(value));
                replacedCount += 1;
                // Fire the same in-tab notification that an explicit save
                // does, so any hook listening on this storage key
                // (use-patient-follow-up-overrides, use-key-dates,
                // use-office-settings, etc.) re-reads localStorage and
                // React state catches up to the cloud-loaded data. Without
                // this, hooks that initialized synchronously on mount —
                // BEFORE the async bootstrap finished — never see the
                // updated value. User-visible symptom: a checkbox/toggle
                // was set on another device (or earlier session), the
                // override IS in cloud and IS now in localStorage, but the
                // current page renders unchecked until a hard refresh.
                // Same exact bug pattern that was just fixed for the
                // appointments bootstrap.
                notifyChange(key);
              } catch (storageErr) {
                // localStorage quota exceeded — skip this key but don't crash bootstrap
                console.warn(`[Cloud Sync] Could not write "${key}" to localStorage (quota?):`, storageErr);
              }
            }
          } finally {
            resumeSync();
          }
          if (replacedCount > 0) {
            console.info(`[Cloud Sync] Loaded ${replacedCount} kv key(s) from workspace_kv table.`);
          }
          if (skippedLocalIsBigger > 0) {
            console.warn(
              `[Cloud Sync] Preserved ${skippedLocalIsBigger} local key(s) that had more entries than cloud.`,
            );
          }
        }
      }
    }
  }

  // ── Phase 3: encounter notes ──
  if (isCloudEntityEnabled("encounterNotes")) {
    const {
      fetchAllEncounterNotesFromTable,
      isEncounterNotesTableReady,
      bulkUpsertEncounterNotesToTable,
    } = await import("@/lib/encounter-notes-cloud");
    const {
      loadEncounterNoteRecords,
      replaceEncounterNotesFromCloud,
    } = await import("@/lib/encounter-notes");

    const notesReady = await isEncounterNotesTableReady();
    if (!notesReady) {
      console.warn(
        "[Cloud Sync] encounterNotes flag is on but table isn't ready. " +
        "Run supabase/encounter_notes_table.sql in the SQL editor.",
      );
    } else {
      const notesRows = await fetchAllEncounterNotesFromTable();
      if (notesRows !== null) {
        const localNotes = loadEncounterNoteRecords();
        if (notesRows.length === 0 && localNotes.length > 0) {
          console.info(
            `[Cloud Sync] Migrating ${localNotes.length} encounter note(s) to table...`,
          );
          const result = await bulkUpsertEncounterNotesToTable(localNotes);
          if (result.ok) {
            console.info(`[Cloud Sync] Migrated ${result.count} encounter note(s).`);
          } else {
            console.error("[Cloud Sync] Encounter notes migration failed:", result.error);
          }
        } else if (notesRows.length > 0) {
          pauseSync();
          try {
            replaceEncounterNotesFromCloud(notesRows);
          } finally {
            resumeSync();
          }
          console.info(`[Cloud Sync] Loaded ${notesRows.length} encounter note(s) from table.`);
        }
      }
    }
  }
}

/**
 * Restore data from the safety backup (if one exists).
 * Returns true if data was restored.
 */
export function restoreFromSafetyBackup(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    const raw = window.localStorage.getItem(BACKUP_KEY);
    if (!raw) {
      return false;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.snapshot || typeof parsed.snapshot !== "object") {
      return false;
    }
    writeLocalSnapshot(parsed.snapshot);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a safety backup exists with data.
 */
export function hasSafetyBackup(): { exists: boolean; backedUpAt: string } {
  if (typeof window === "undefined") {
    return { exists: false, backedUpAt: "" };
  }
  try {
    const raw = window.localStorage.getItem(BACKUP_KEY);
    if (!raw) {
      return { exists: false, backedUpAt: "" };
    }
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.snapshot || typeof parsed.snapshot !== "object") {
      return { exists: false, backedUpAt: "" };
    }
    return { exists: true, backedUpAt: parsed.backedUpAt ?? "" };
  } catch {
    return { exists: false, backedUpAt: "" };
  }
}

/**
 * Attempt to recover data from the remote Supabase snapshot.
 * Returns true if remote data was found and written to localStorage.
 */
export async function recoverFromRemote(): Promise<boolean> {
  if (typeof window === "undefined" || !isCloudSyncEnabled()) {
    return false;
  }
  try {
    const authed = await getAuthedConfig();
    if (!authed) {
      return false;
    }
    const remote = await fetchRemoteSnapshot(authed.workspaceId);
    if (!remote || !remote.snapshot || typeof remote.snapshot !== "object") {
      return false;
    }
    const remoteSnapshot = Object.fromEntries(
      Object.entries(remote.snapshot as Record<string, unknown>).map(
        ([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)],
      ),
    );
    if (!hasMeaningfulLocalData(remoteSnapshot)) {
      return false;
    }
    writeLocalSnapshot(remote.snapshot as Record<string, unknown>);
    if (remote.updated_at) {
      window.localStorage.setItem(getSyncAtKey(authed.workspaceId), remote.updated_at);
    }
    return true;
  } catch {
    return false;
  }
}

export async function pushLocalStateToCloud() {
  if (typeof window === "undefined" || !isCloudSyncEnabled()) {
    return;
  }

  try {
    const authed = await getAuthedConfig();
    if (!authed) {
      return;
    }

    // Refuse to push under the wrong workspace_id. The previous behavior
    // would silently set the active id and push, which is exactly how data
    // could leak across accounts. If the active pointer doesn't match the
    // signed-in user, abort the push entirely — the bootstrap will correct
    // the pointer on next mount.
    const activeWorkspaceId = getActiveWorkspaceId();
    if (activeWorkspaceId && activeWorkspaceId !== authed.workspaceId) {
      console.warn(
        "[Cloud Sync] Refusing push: active workspace pointer does not match signed-in user.",
      );
      return;
    }

    const localSnapshot = readLocalSnapshot();
    if (!hasMeaningfulLocalData(localSnapshot)) {
      return;
    }

    // ── DESTRUCTIVE-WRITE GUARD (client-side, defense in depth) ──
    // Before pushing, fetch the current remote snapshot. If the remote
    // already contains substantially MORE data than what we're about to
    // push, refuse the push. This prevents wipe-loops, race conditions,
    // and bootstrap failures from destroying the cloud copy.
    //
    // The database trigger (app_snapshots_protect) is the real bedrock —
    // even if this client check is bypassed, Postgres will reject the
    // write. This is just the polite first line of defense so we don't
    // round-trip a guaranteed-to-fail upsert.
    // Exclude encounter notes from the size comparison — they are
    // intentionally pruned from localStorage (only recent 90 days
    // cached) and dual-written to their own cloud table separately.
    const ENCOUNTER_KEY = "casemate.encounter-notes.v1";
    const localForGuard = { ...localSnapshot };
    delete localForGuard[ENCOUNTER_KEY];
    const localKeyCount = countMeaningfulKeys(localForGuard);
    const localSize = JSON.stringify(localForGuard).length;

    let remote: Awaited<ReturnType<typeof fetchRemoteSnapshot>> = null;
    try {
      remote = await fetchRemoteSnapshot(authed.workspaceId);
    } catch {
      // The pre-flight fetch commonly fails during visibilitychange/beforeunload
      // because browsers restrict async network during page-hide lifecycle events.
      // This is harmless — the database trigger (protect_app_snapshots) is the
      // real safety net and will reject any destructive writes regardless.
      // Skip silently instead of logging a scary red error every page transition.
      return;
    }

    if (remote && remote.snapshot && typeof remote.snapshot === "object") {
      const remoteSnapshot = { ...(remote.snapshot as Record<string, unknown>) };
      delete remoteSnapshot[ENCOUNTER_KEY];
      const remoteSize = JSON.stringify(remoteSnapshot).length;
      const remoteKeyCount = countMeaningfulKeys(remoteSnapshot);

      if (
        remoteSize > 10_000 &&
        (localSize < remoteSize / 2 ||
          (remoteKeyCount > 5 && localKeyCount < (remoteKeyCount * 7) / 10))
      ) {
        console.error(
          `[Cloud Sync] REFUSED destructive write. local_size=${localSize} local_keys=${localKeyCount} remote_size=${remoteSize} remote_keys=${remoteKeyCount}. The cloud has more data than the local copy — refusing to overwrite. Reload the page to pull cloud data.`,
        );
        // Notify any listener (e.g. the sync status UI) so the user sees
        // a hard error instead of a silent loss.
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("casemate:cloud-sync-blocked", {
              detail: { localSize, remoteSize, localKeyCount, remoteKeyCount },
            }),
          );
        }
        return;
      }

      // ── FRESHNESS GUARD (cloud-as-truth, multi-device) ──
      // If the cloud's updated_at is newer than this device's last successful
      // sync, another device has written data we haven't pulled yet. We must
      // refuse the push — otherwise a stale tab on (e.g.) the tablet would
      // overwrite the desktop's just-edited names. The bootstrap will pull
      // the newer remote on the next page load and this device will then
      // hold fresh data and be allowed to push again.
      //
      // Tolerance: 2 seconds for clock skew between devices.
      const lastLocalPushIso = window.localStorage.getItem(
        getSyncAtKey(authed.workspaceId),
      );
      const lastLocalPushMs = parseTimestamp(lastLocalPushIso);
      const remoteUpdatedMs = parseTimestamp(remote.updated_at ?? null);
      if (
        !Number.isNaN(lastLocalPushMs) &&
        !Number.isNaN(remoteUpdatedMs) &&
        remoteUpdatedMs > lastLocalPushMs + 2000
      ) {
        // Cross-device conflicts are rare in single-user deployments, but if
        // we don't advance the local sync-at we dead-lock: every subsequent
        // push sees the same remote-ahead condition and refuses, burning CPU
        // on per-keystroke pre-flight fetches forever until the page is
        // reloaded. That was the "data doesn't save + fans spinning" symptom.
        //
        // Self-heal: advance the local sync-at pointer to match the remote's
        // updated_at so the next push attempt starts fresh. The destructive-
        // write guard above (and the DB trigger app_snapshots_protect) still
        // refuse any push that would shrink the cloud copy, so this is safe.
        // Bootstrap pulls the cloud on every page load, so by the next
        // session the local state is reconciled with the newer remote.
        console.warn(
          `[Cloud Sync] Freshness guard tripped (remote_updated_at=${remote.updated_at}, local_last_sync=${lastLocalPushIso}). Advancing local sync pointer and letting this push proceed — destructive-write guard and DB trigger remain in effect.`,
        );
        if (typeof window !== "undefined" && remote.updated_at) {
          try {
            window.localStorage.setItem(
              getSyncAtKey(authed.workspaceId),
              remote.updated_at,
            );
          } catch {
            // ignore — best-effort; next successful upsert will set it
          }
        }
        // Intentionally do NOT `return` here. Fall through to the upsert so
        // the user's in-flight edits reach the cloud. If the remote really is
        // ahead in a way that would shrink or destroy it, the destructive-
        // write guard above has already refused.
      }
    }

    await upsertRemoteSnapshot(authed.workspaceId, localSnapshot);
  } catch (error) {
    console.warn("[Cloud Sync] Autosave failed:", error);
  }
}
