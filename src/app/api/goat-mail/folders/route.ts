import { NextRequest, NextResponse } from "next/server";
import { adminClient, serverConfig, verifyStaff } from "@/lib/patient-forms-server";
import { isSafeFolderId } from "@/lib/goat-mail";
import { goatMailEnv, goatMailWorkspaceId, loadMailConnection, readMailbox, saveMailConnection, saveMailFolderIds } from "@/lib/goat-mail-server";

/** Save which folders GOAT reads. This does not change the mailbox. */
export async function POST(request: NextRequest) {
  const env = goatMailEnv();
  if (!env.configured) return NextResponse.json({ error: "GOAT Mail is not configured yet." }, { status: 404 });
  const cfg = serverConfig();
  if (!cfg) return NextResponse.json({ error: "Server not configured." }, { status: 500 });
  const admin = adminClient(cfg);
  const caller = await verifyStaff(request, cfg, admin);
  if (!caller) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const workspaceId = goatMailWorkspaceId(caller.ownerId);
  const row = await loadMailConnection(admin, workspaceId);
  if (!row || "missingTable" in row) return NextResponse.json({ error: "Connect Outlook first." }, { status: 400 });
  const body = (await request.json().catch(() => null)) as { folderIds?: unknown } | null;
  const asked = Array.isArray(body?.folderIds) ? body.folderIds.filter((id): id is string => typeof id === "string" && isSafeFolderId(id)) : [];
  if (!asked.length) return NextResponse.json({ error: "Pick at least one folder." }, { status: 400 });
  const read = await readMailbox({ ...env, refreshToken: row.refreshToken, folderIds: null });
  if ("error" in read) return NextResponse.json({ error: read.error }, { status: 502 });
  if (!read.folders.length) return NextResponse.json({ error: "Could not list the mailbox folders." }, { status: 502 });
  const known = new Set(read.folders.map((folder) => folder.id));
  const selected = asked.filter((id) => known.has(id));
  if (!selected.length) return NextResponse.json({ error: "Those folders are not in this mailbox." }, { status: 400 });
  const saved = await saveMailFolderIds(admin, workspaceId, selected);
  if ("error" in saved) return NextResponse.json({ error: saved.error }, { status: 500 });
  if (read.refreshToken !== row.refreshToken) {
    await saveMailConnection(admin, { workspaceId, refreshToken: read.refreshToken, email: read.email || row.email });
  }
  return NextResponse.json({ selectedFolderIds: selected });
}
