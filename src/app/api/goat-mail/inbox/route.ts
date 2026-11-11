import { NextRequest, NextResponse } from "next/server";
import { adminClient, serverConfig, verifyStaff } from "@/lib/patient-forms-server";
import { deleteMailConnection, goatMailEnv, goatMailWorkspaceId, loadMailConnection, loadMailFolderIds, loadMailSecretExpiresOn, readMailbox, saveMailConnection } from "@/lib/goat-mail-server";

/** Recent messages, read-only. The refresh token stays on the server. */
export async function GET(request: NextRequest) {
  const env = goatMailEnv();
  const cfg = serverConfig();
  if (!cfg) return NextResponse.json({ configured: env.configured, connected: false, messages: [], ...(env.configured ? { error: "Server not configured." } : {}) }, { status: env.configured ? 500 : 200 });
  const admin = adminClient(cfg);
  const caller = await verifyStaff(request, cfg, admin);
  if (!caller) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const workspaceId = goatMailWorkspaceId(caller.ownerId);
  const secretExpiresOn = (await loadMailSecretExpiresOn(admin, workspaceId)) ?? "";
  if (!env.configured) return NextResponse.json({ configured: false, connected: false, messages: [], secretExpiresOn });
  const row = await loadMailConnection(admin, workspaceId);
  if (row && "missingTable" in row) {
    return NextResponse.json({ configured: true, connected: false, needsMigration: true, messages: [], secretExpiresOn });
  }
  if (!row) return NextResponse.json({ configured: true, connected: false, messages: [], secretExpiresOn });
  const folderIds = await loadMailFolderIds(admin, workspaceId);
  const read = await readMailbox({ ...env, refreshToken: row.refreshToken, folderIds });
  if ("error" in read) {
    return NextResponse.json({
      configured: true,
      connected: true,
      account: row.email,
      error: read.error,
      secretExpired: read.secretExpired === true,
      messages: [],
      folders: [],
      selectedFolderIds: [],
      secretExpiresOn,
    });
  }
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
    secretExpiresOn,
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
