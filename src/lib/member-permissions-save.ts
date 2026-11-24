/**
 * Saving a team member's access (workspace_members.permissions) — role, main location, hidden
 * sections, deactivate. RLS only lets the OWNER account update these rows, and when it refuses,
 * Supabase returns NO error and zero rows. Asking for the updated row back is the only way to tell,
 * so a refused save is never shown as saved.
 */
export interface MemberPermsClient {
  from: (table: string) => {
    update: (values: Record<string, unknown>) => {
      eq: (column: string, value: string) => {
        select: (columns: string) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
      };
    };
  };
}

export async function persistMemberPermissions(
  supabase: MemberPermsClient,
  memberUserId: string,
  permissions: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from("workspace_members")
    .update({ ...extra, permissions, updated_at: new Date().toISOString() })
    .eq("member_user_id", memberUserId)
    .select("member_user_id");
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) {
    return { ok: false, error: "Not saved — only the office owner account can change a team member's access. Sign in as the owner and try again." };
  }
  return { ok: true };
}

/** The slice of the Supabase client used to call the main-location function. */
export interface MemberRpcClient {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
}

const rpcMissing = (e: { message: string; code?: string }) =>
  e.code === "PGRST202" || e.code === "42883" || /could not find the function|does not exist/i.test(e.message);

/**
 * Save a member's Main location. Goes through the narrow `set_member_main_location` database function so an
 * office Admin (not only the owner) can do it. If that function isn't installed yet, the owner falls back to
 * the direct update (which only the owner is allowed anyway); an Admin gets a clear message instead of a fake
 * "saved". A refused save is never reported as saved.
 */
export async function persistMemberMainLocation(
  supabase: MemberPermsClient & MemberRpcClient,
  memberUserId: string,
  locationId: string,
  nextPermissions: Record<string, unknown>,
  isOwner: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.rpc("set_member_main_location", {
    target_member: memberUserId,
    location_id: locationId || null,
  });
  if (!error) return { ok: true };
  if (rpcMissing(error)) {
    if (isOwner) return persistMemberPermissions(supabase, memberUserId, nextPermissions);
    return { ok: false, error: "Not saved — the database update for Admin main-location changes hasn't been installed yet. Ask the owner." };
  }
  if (error.code === "42501" || /only the owner or an admin/i.test(error.message)) {
    return { ok: false, error: "Not saved — only the owner or an Admin can change a main location." };
  }
  return { ok: false, error: error.message };
}
