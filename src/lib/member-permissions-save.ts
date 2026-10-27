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
