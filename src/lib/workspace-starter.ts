/**
 * Which starting defaults a workspace gets.
 *
 * Appointment types, hours, SOAP macros, charges, diagnosis lists, letter
 * templates, and the marketing rep are not saved until someone edits them.
 * Until then the app shows defaults that live in code.
 *
 *  - "legacy": the original defaults. Every office that already exists stays
 *    legacy forever. No marker is written for them, and a missing or unreadable
 *    marker means legacy, so nothing an existing office sees can change.
 *  - "blank":  a brand-new office. Recorded once, at creation, as the
 *    workspace_kv row "casemate.workspace-starter.v1" = { starter: "blank" }.
 *    The decision is that flag, never a date cutoff.
 *
 * The flag is set when the account is created (account_profiles.clean_start
 * from the signup trigger, and office_starter on the signup metadata so it
 * works before that migration is applied). It is written into the workspace
 * only while the office still has no saved settings.
 */

export const WORKSPACE_STARTER_KEY = "casemate.workspace-starter.v1";

/** Signup user_metadata key. Set only by the create-account form. */
export const OFFICE_STARTER_METADATA_KEY = "office_starter";
export const OFFICE_STARTER_METADATA_VALUE = "blank";

export type WorkspaceStarter = "legacy" | "blank";

export interface WorkspaceStarterMarker {
  starter: "blank";
  decidedAt: string;
  version: 1;
}

export function makeBlankStarterMarker(now = new Date()): WorkspaceStarterMarker {
  return { starter: "blank", decidedAt: now.toISOString(), version: 1 };
}

/** Anything that isn't exactly a blank marker is legacy. */
export function parseWorkspaceStarter(value: unknown): WorkspaceStarter {
  let v = value;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return "legacy";
    }
  }
  if (v && typeof v === "object" && (v as { starter?: unknown }).starter === "blank") return "blank";
  return "legacy";
}

let cachedRaw: string | null | undefined;
let cachedStarter: WorkspaceStarter = "legacy";

/** Synchronous check used by every default getter. Server / no window = legacy. */
export function getWorkspaceStarter(): WorkspaceStarter {
  if (typeof window === "undefined" || !window.localStorage) return "legacy";
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(WORKSPACE_STARTER_KEY);
  } catch {
    return "legacy";
  }
  if (raw === cachedRaw) return cachedStarter;
  cachedRaw = raw;
  cachedStarter = raw ? parseWorkspaceStarter(raw) : "legacy";
  return cachedStarter;
}

export function isBlankStarterWorkspace(): boolean {
  return getWorkspaceStarter() === "blank";
}

export function rememberBlankStarter(marker: WorkspaceStarterMarker) {
  if (typeof window === "undefined" || !window.localStorage) return;
  const raw = JSON.stringify(marker);
  window.localStorage.setItem(WORKSPACE_STARTER_KEY, raw);
  cachedRaw = raw;
  cachedStarter = "blank";
}

/** Signup metadata says this account was created as a clean office. */
export function creationFlagFromMetadata(meta: unknown): boolean {
  if (!meta || typeof meta !== "object") return false;
  return (meta as Record<string, unknown>)[OFFICE_STARTER_METADATA_KEY] === OFFICE_STARTER_METADATA_VALUE;
}

/**
 * profileCleanStart: true/false when the column was read, null when the
 * column isn't there yet or the read failed.
 * A stored false wins over signup metadata, so an existing office cannot
 * flip itself by editing metadata. Null falls through to the metadata flag
 * that signup writes at creation time.
 */
export function resolveCreationFlag(input: {
  metadataFlag: boolean;
  profileCleanStart: boolean | null;
}): boolean {
  if (input.profileCleanStart === true) return true;
  if (input.profileCleanStart === false) return false;
  return input.metadataFlag;
}

/** Keys that are not "this office already saved its own settings". */
const NOT_PRACTICE_DATA = new Set([
  WORKSPACE_STARTER_KEY,
  "casemate.setup-walkthrough.v1",
  "casemate.onboarding.v1",
  "casemate.demo-generation.v1",
]);

export function isPracticeDataKey(key: string): boolean {
  if (NOT_PRACTICE_DATA.has(key)) return false;
  if (key.startsWith("casemate.user-prefs.v1.u.")) return false;
  if (key.startsWith("casemate.referral-checked.v1") || key.startsWith("casemate.referral-checked.v2")) return false;
  return key.startsWith("casemate.") || key.startsWith("notegoat.");
}

export interface StarterDecisionInput {
  /** Signed-in user owns this workspace (not a team member). */
  isOwner: boolean;
  isDemo: boolean;
  /** True only when the account was flagged at creation. */
  creationFlag: boolean;
  /** Keys already in the cloud, or null when the cloud read failed. */
  cloudKeys: string[] | null;
  /** The marker value from this cloud read, if the row was downloaded. */
  cloudMarker: unknown;
  /** Marker already in this browser (a previous decision whose cloud write may have failed). */
  localMarker: unknown;
}

/**
 * Should this boot write the blank marker?
 * Only for the owner of a non-demo office that was flagged at creation,
 * whose cloud has no marker yet, and whose cloud has no saved settings
 * (or this browser already decided blank). Any doubt stays legacy.
 */
export function shouldMarkBlankStarter(input: StarterDecisionInput): boolean {
  if (input.isDemo || !input.isOwner) return false;
  if (parseWorkspaceStarter(input.cloudMarker) === "blank") return false;
  const cloudHasMarker = (input.cloudKeys ?? []).includes(WORKSPACE_STARTER_KEY);
  if (cloudHasMarker) return false;
  if (!input.creationFlag) return false;
  if (!input.cloudKeys) return false;
  const hasSavedData = input.cloudKeys.some(isPracticeDataKey);
  if (!hasSavedData) return true;
  return parseWorkspaceStarter(input.localMarker) === "blank";
}

async function readProfileCleanStart(userId: string): Promise<boolean | null> {
  try {
    const { getSupabaseBrowserClient } = await import("@/lib/supabase-browser");
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return null;
    const { data, error } = await supabase
      .from("account_profiles")
      .select("clean_start")
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !data || typeof data !== "object") return null;
    if (!("clean_start" in data)) return null;
    return (data as { clean_start?: unknown }).clean_start === true;
  } catch {
    return null;
  }
}

/**
 * Called once during cloud boot, before the app reads defaults.
 * Writes the blank marker for a new office. Never writes for an existing one.
 */
export async function settleWorkspaceStarter(input: {
  cloudKeys: string[] | null;
  cloudMarker: unknown;
}): Promise<void> {
  if (typeof window === "undefined") return;
  if (parseWorkspaceStarter(input.cloudMarker) === "blank") {
    rememberBlankStarter(
      input.cloudMarker && typeof input.cloudMarker === "object"
        ? (input.cloudMarker as WorkspaceStarterMarker)
        : makeBlankStarterMarker(),
    );
    return;
  }

  const { getSupabaseBrowserClient } = await import("@/lib/supabase-browser");
  const { isDemoPrincipal } = await import("@/lib/demo-office");
  const { getCurrentMembershipSync } = await import("@/lib/workspace-membership");
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return;
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;
  if (!user) return;
  const membership = getCurrentMembershipSync();
  const isOwner = Boolean(membership && membership.userId === user.id && !membership.isMember);
  const profileCleanStart = isOwner ? await readProfileCleanStart(user.id) : null;
  const creationFlag = resolveCreationFlag({
    metadataFlag: creationFlagFromMetadata(user.user_metadata),
    profileCleanStart,
  });
  let localMarker: unknown = null;
  try {
    const raw = window.localStorage.getItem(WORKSPACE_STARTER_KEY);
    localMarker = raw ? JSON.parse(raw) : null;
  } catch {
    localMarker = null;
  }
  if (
    !shouldMarkBlankStarter({
      isOwner,
      isDemo: isDemoPrincipal(user),
      creationFlag,
      cloudKeys: input.cloudKeys,
      cloudMarker: input.cloudMarker,
      localMarker,
    })
  ) {
    return;
  }
  const marker = makeBlankStarterMarker();
  rememberBlankStarter(marker);
  try {
    const { upsertKvValue } = await import("@/lib/kv-cloud");
    await upsertKvValue(WORKSPACE_STARTER_KEY, marker);
  } catch (err) {
    console.error("[workspace-starter] cloud write failed; this browser will retry:", err);
  }
}
