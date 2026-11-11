import { NextRequest, NextResponse } from "next/server";
import { adminClient, serverConfig, verifyStaff } from "@/lib/patient-forms-server";
import { deleteMailConnection, goatMailEnv, goatMailWorkspaceId, loadMailConnection, loadMailFolderIds, readMailbox, saveMailConnection } from "@/lib/goat-mail-server";

/** Recent messages, read-only. The refresh token stays on the server. */
export async function GET(request: NextRequest) {
  const env = goatMailEnv();
  if (!env.configured) return NextResponse.json({ configured: false, connected: false, messages: [] });
  const cfg = serverConfig();
  if (!cfg) return NextResponse.json({ configured: true, connected: false, error: "Server not configured.", messages: [] }, { status: 500 });
  const admin = adminClient(cfg);
  const caller = await verifyStaff(request, cfg, admin);
  if (!caller) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const workspaceId = goatMailWorkspaceId(caller.ownerId);
  const row = await loadMailConnection(admin, workspaceId);
  if (row && "missingTable" in row) {
    return NextResponse.json({ configured: true, connected: false, needsMigration: true, messages: [] });
  }
  if (!row) return NextResponse.json({ configured: true, connected: false, messages: [] });
  const folderIds = await loadMailFolderIds(admin, workspaceId);
  const read = await readMailbox({ ...env, refreshToken: row.refreshToken, folderIds });
  if ("error" in read) return NextResponse.json({ configured: true, connected: true, account: row.email, error: read.error, messages: [], folders: [], selectedFolderIds: [] });
  if (read.refreshToken !== row.refreshToken) {
    await saveMailConnection(admin, { workspaceId, refreshToken: read.refreshToken, email: read.email || row.email });
  }
  return NextResponse.json({
    configured: true,
    connected: true,
    account: read.email || row.email,
    messages: read.messages,
    folders: read.folders,
    selectedFolderIds: read.selectedFolderIds,
  });
}

/** Forget the stored refresh token. This does not change the mailbox. */
export async function DELETE(request: NextRequest) {
  const env = goatMailEnv();
  if (!env.configured) return NextResponse.json({ error: "GOAT Mail is not configured yet." }, { status: 404 });
  const cfg = serverConfig();
  if (!cfg) return NextResponse.json({ error: "Server not configured." }, { status: 500 });
  const admin = adminClient(cfg);
  const caller = await verifyStaff(request, cfg, admin);
  if (!caller) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  await deleteMailConnection(admin, goatMailWorkspaceId(caller.ownerId));
  return NextResponse.json({ connected: false });
}
