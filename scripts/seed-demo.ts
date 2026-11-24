/**
 * Create the demo login (once) and fill its office.
 *
 * Refuses the production project unless ALLOW_DEMO_ON_PRODUCTION is exactly
 * "demo-workspace-only". This script never writes a workspace id other than
 * `<demo user uuid>:demo-office`.
 *
 * Run: npx tsx scripts/seed-demo.ts
 */
import { createClient } from "@supabase/supabase-js";
import { isProductionSupabaseUrl } from "../src/lib/demo-office";
import { resetDemoWorkspace, type DemoResetDb } from "../src/lib/demo-reset";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
const service = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
const email = process.env.DEMO_USER_EMAIL?.trim().toLowerCase() ?? "";
const password = process.env.DEMO_USER_PASSWORD ?? "";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

if (!url || !service || !email || !password) {
  fail("Set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DEMO_USER_EMAIL, and DEMO_USER_PASSWORD.");
}
if (isProductionSupabaseUrl(url) && process.env.ALLOW_DEMO_ON_PRODUCTION !== "demo-workspace-only") {
  fail("Refusing to write the production database. This script is for a local or test project.");
}
if (password.length < 8) fail("DEMO_USER_PASSWORD must be at least 8 characters.");

const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

async function findUserId(): Promise<string | null> {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) fail(error.message);
    const found = data.users.find((user) => user.email?.toLowerCase() === email);
    if (found) return found.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

const existing = await findUserId();
let userId = existing;
if (!userId) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { demo_office: true },
  });
  if (error || !data.user) fail(error?.message || "Could not create the demo user.");
  userId = data.user.id;
} else {
  const { error } = await admin.auth.admin.updateUserById(userId, {
    password,
    email_confirm: true,
    app_metadata: { demo_office: true },
  });
  if (error) fail(error.message);
}

const workspaceId = `${userId}:demo-office`;
const configured = process.env.DEMO_WORKSPACE_ID?.trim();
if (configured && configured !== workspaceId) {
  fail(`DEMO_WORKSPACE_ID is ${configured} but this login's office is ${workspaceId}. Refusing.`);
}

await admin.from("account_profiles").upsert(
  {
    user_id: userId,
    email,
    approval_status: "approved",
    is_admin: false,
    plan_tier: "complete",
    approved_at: new Date().toISOString(),
  },
  { onConflict: "user_id" },
);

const db: DemoResetDb = {
  async deleteEq(table, column, value) {
    if (value !== workspaceId && value !== userId) throw new Error(`Refusing delete on ${table}`);
    const { error } = await admin.from(table).delete().eq(column, value);
    if (error && !/does not exist|schema cache|could not find the table/i.test(error.message)) {
      throw new Error(`${table}: ${error.message}`);
    }
  },
  async upsert(table, rows, onConflict) {
    if (!rows.length) return;
    const { error } = await admin.from(table).upsert(rows, { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
  },
  async readLock() {
    const { data, error } = await admin.from("demo_workspace_lock").select("workspace_id").eq("id", 1).maybeSingle();
    if (error) return null;
    return typeof data?.workspace_id === "string" ? data.workspace_id : null;
  },
  async writeLock(id) {
    if (id !== workspaceId) throw new Error("Refusing to lock a different workspace.");
    const { error } = await admin.from("demo_workspace_lock").upsert({ id: 1, workspace_id: id }, { onConflict: "id" });
    if (error) console.warn(`Demo lock table not updated (${error.message}). Apply supabase/migrations/20261123120000_demo_office_guard.sql`);
  },
};

const result = await resetDemoWorkspace(db, workspaceId, workspaceId);
console.log(`Demo office ready: ${result.workspaceId}`);
console.log(`Patients ${result.patients}, visits ${result.appointments}, notes ${result.notes}`);
console.log("Set this environment variable for the nightly reset and the Reset demo now button:");
console.log(`DEMO_WORKSPACE_ID=${result.workspaceId}`);
