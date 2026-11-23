import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isDemoPrincipal } from "@/lib/demo-office";
import { resetDemoWorkspace, type DemoResetDb } from "@/lib/demo-reset";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i += 1) mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return mismatch === 0;
}

function missingTable(message: string): boolean {
  return /does not exist|schema cache|could not find the table|relation/i.test(message);
}

function supabaseResetDb(client: SupabaseClient): DemoResetDb {
  return {
    async deleteEq(table, column, value) {
      const { error } = await client.from(table).delete().eq(column, value);
      if (error && !missingTable(error.message)) throw new Error(`${table}: ${error.message}`);
    },
    async upsert(table, rows, onConflict) {
      if (!rows.length) return;
      const { error } = await client.from(table).upsert(rows, { onConflict });
      if (error) throw new Error(`${table}: ${error.message}`);
    },
    async readLock() {
      const { data, error } = await client.from("demo_workspace_lock").select("workspace_id").eq("id", 1).maybeSingle();
      if (error) {
        if (missingTable(error.message)) return null;
        throw new Error(error.message);
      }
      return typeof data?.workspace_id === "string" ? data.workspace_id : null;
    },
    async writeLock(workspaceId) {
      const { error } = await client.from("demo_workspace_lock").upsert({ id: 1, workspace_id: workspaceId }, { onConflict: "id" });
      if (error && !missingTable(error.message)) throw new Error(error.message);
    },
    async removeStoragePrefix(bucket, userId) {
      const folder = userId;
      const { data, error } = await client.storage.from(bucket).list(folder, { limit: 1000 });
      if (error) {
        if (missingTable(error.message) || /not found|bucket/i.test(error.message)) return;
        return;
      }
      const paths = (data ?? []).map((entry) => `${folder}/${entry.name}`).filter((path) => path.startsWith(`${userId}/`));
      if (!paths.length) return;
      await client.storage.from(bucket).remove(paths);
    },
  };
}

async function callerIsDemoOwner(request: NextRequest, workspaceId: string): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (!url || !anon || !token) return false;
  const auth = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await auth.auth.getUser(token);
  if (error || !data.user || !isDemoPrincipal(data.user)) return false;
  return workspaceId.startsWith(`${data.user.id}:`);
}

/** Nightly cron (CRON_SECRET) or the demo office owner. Never any other workspace. */
export async function POST(request: NextRequest) {
  const configured = process.env.DEMO_WORKSPACE_ID?.trim() ?? "";
  const cron = process.env.CRON_SECRET?.trim() ?? "";
  const header = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  const cronOk = Boolean(cron) && timingSafeEqual(header, cron);
  if (!cronOk && !(await callerIsDemoOwner(request, configured))) {
    return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !service) return NextResponse.json({ error: "Server not configured." }, { status: 500 });
  try {
    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const result = await resetDemoWorkspace(supabaseResetDb(admin), configured, configured, new Date());
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Reset failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
