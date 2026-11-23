/**
 * The pretend office. One dedicated login, one workspace id, nothing else.
 *
 * The workspace id is always `<demo user uuid>:demo-office`. Real offices
 * stay on their own id (usually `:main-office`). Reset refuses every id
 * except the exact DEMO_WORKSPACE_ID from the server environment.
 */

export const DEMO_OFFICE_ID = "demo-office";
export const DEMO_GENERATION_KEY = "casemate.demo-generation.v1";
export const DEMO_NOT_SENT = "Demo: not sent";

/** Production NoteGoat project. Scripts refuse to write here unless explicitly overridden. */
export const PRODUCTION_SUPABASE_PROJECT_REF = "ywmxnyacponabxgxjzed";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type DemoPrincipal = {
  id?: string;
  app_metadata?: unknown;
  email?: string | null;
};

/** Set only by the service role (app_metadata). A person cannot flip this on themselves. */
export function isDemoPrincipal(user: DemoPrincipal | null | undefined): boolean {
  if (!user) return false;
  const meta = user.app_metadata;
  if (!meta || typeof meta !== "object") return false;
  return (meta as { demo_office?: unknown }).demo_office === true;
}

let rememberedDemoUserId = "";
let demoFolders = false;

export function rememberDemoPrincipal(user: DemoPrincipal | null | undefined) {
  if (user?.id && isDemoPrincipal(user)) rememberedDemoUserId = user.id;
  else if (!user?.id || rememberedDemoUserId === user.id) rememberedDemoUserId = "";
}

export function isRememberedDemoUser(userId: string): boolean {
  return Boolean(userId) && userId === rememberedDemoUserId;
}

/** Turn patient folders on for this tab after we know the login is the demo office. */
export function setDemoFoldersActive(on: boolean) {
  demoFolders = on;
}

export function demoFoldersActive(): boolean {
  return demoFolders;
}

export function isDemoWorkspaceId(workspaceId: string | null | undefined): boolean {
  if (!workspaceId) return false;
  const parts = workspaceId.split(":");
  if (parts.length !== 2) return false;
  return UUID.test(parts[0]) && parts[1] === DEMO_OFFICE_ID;
}

export function demoUserIdFromWorkspace(workspaceId: string): string {
  const [userId, office] = workspaceId.split(":");
  if (!userId || office !== DEMO_OFFICE_ID || !UUID.test(userId) || workspaceId.split(":").length !== 2) {
    throw new Error("Not a demo workspace id.");
  }
  return userId;
}

/**
 * The only id a reset is allowed to touch. `requested` must equal the
 * configured id, and that id must be exactly one uuid plus `:demo-office`.
 */
export function assertDemoResetTarget(requested: string, configured: string | undefined): string {
  const expected = (configured ?? "").trim();
  if (!expected) throw new Error("DEMO_WORKSPACE_ID is not set. Refusing to reset.");
  if (requested !== expected) throw new Error("Refusing to touch a workspace that is not the demo workspace.");
  if (expected.includes("%") || expected.includes("*") || expected.includes(" ") || expected.includes(",")) {
    throw new Error("Refusing an unsafe demo workspace id.");
  }
  demoUserIdFromWorkspace(expected);
  return expected;
}

export function isProductionSupabaseUrl(url: string | undefined): boolean {
  return Boolean(url && url.includes(PRODUCTION_SUPABASE_PROJECT_REF));
}

export function configuredDemoUserId(configuredWorkspaceId: string | undefined): string {
  return demoUserIdFromWorkspace((configuredWorkspaceId ?? "").trim());
}
