/**
 * Server-only Microsoft Graph Mail.Read. This file never sends, deletes,
 * or changes mail. The only writes are the OAuth token request and the
 * refresh-token row in goat_mail_connections.
 *
 * Stays off until the owner sets GOAT_MAIL_CLIENT_ID and GOAT_MAIL_CLIENT_SECRET.
 * Registration steps for the owner: docs/goat-mail-setup.md. The app never shows those steps.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { GOAT_MAIL_FOLDERS_KEY, chosenFolderIds, isSafeFolderId, mergeMailMessages, type GoatMailMessage, type MailFolderChoice } from "@/lib/goat-mail";

const TABLE = "goat_mail_connections";
const SCOPE = "offline_access Mail.Read User.Read";

export function goatMailEnv(): { clientId: string; clientSecret: string; tenant: string; configured: boolean } {
  const clientId = process.env.GOAT_MAIL_CLIENT_ID?.trim() || "";
  const clientSecret = process.env.GOAT_MAIL_CLIENT_SECRET?.trim() || "";
  const tenant = process.env.GOAT_MAIL_TENANT_ID?.trim() || "common";
  return { clientId, clientSecret, tenant, configured: Boolean(clientId && clientSecret) };
}

export function goatMailWorkspaceId(ownerId: string): string {
  const officeId =
    process.env.NEXT_PUBLIC_CASEMATE_OFFICE_ID?.trim() ||
    process.env.NEXT_PUBLIC_CASEMATE_WORKSPACE_ID?.trim() ||
    "main-office";
  return `${ownerId}:${officeId}`;
}

export function goatMailRedirectUri(origin: string): string {
  return `${origin.replace(/\/$/, "")}/api/goat-mail/callback`;
}

type StatePayload = { state: string; ownerId: string; exp: number };

export function signMailState(ownerId: string, secret: string): { cookie: string; state: string } {
  const state = randomBytes(16).toString("base64url");
  const payload: StatePayload = { state, ownerId, exp: Date.now() + 10 * 60 * 1000 };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return { cookie: `${body}.${sig}`, state };
}

export function readMailState(cookie: string | undefined, secret: string): StatePayload | null {
  if (!cookie || !secret) return null;
  const [body, sig] = cookie.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as StatePayload;
    if (!payload.state || !payload.ownerId || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function authorizeUrl(input: { tenant: string; clientId: string; redirectUri: string; state: string }): string {
  const url = new URL(`https://login.microsoftonline.com/${encodeURIComponent(input.tenant)}/oauth2/v2.0/authorize`);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("state", input.state);
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

async function tokenRequest(tenant: string, body: URLSearchParams): Promise<{ access_token?: string; refresh_token?: string; error?: string }> {
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; error?: string; error_description?: string };
  if (!res.ok) return { error: json.error_description || json.error || "Microsoft did not sign in." };
  return json;
}

export async function exchangeMailCode(input: {
  tenant: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
}): Promise<{ refreshToken: string; email: string } | { error: string }> {
  const tokens = await tokenRequest(
    input.tenant,
    new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
      scope: SCOPE,
    }),
  );
  if (!tokens.access_token || !tokens.refresh_token) return { error: tokens.error || "Microsoft did not return a refresh token. Mail.Read and offline access have to stay on the app." };
  const email = await mailboxAddress(tokens.access_token);
  return { refreshToken: tokens.refresh_token, email };
}

async function mailboxAddress(accessToken: string): Promise<string> {
  const res = await fetch("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return "";
  const json = (await res.json().catch(() => ({}))) as { mail?: string; userPrincipalName?: string };
  return (json.mail || json.userPrincipalName || "").trim();
}

type GraphFolder = {
  id?: string;
  displayName?: string;
  childFolderCount?: number;
  wellKnownName?: string;
};

const FOLDER_SELECT = "id,displayName,childFolderCount,wellKnownName";

function graphHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    Prefer: 'outlook.body-content-type="text"',
  };
}

async function graphJson(accessToken: string, pathOrUrl: string): Promise<{ value?: unknown[]; "@odata.nextLink"?: string } | { error: string }> {
  const url = pathOrUrl.startsWith("https://") ? pathOrUrl : `https://graph.microsoft.com/v1.0${pathOrUrl}`;
  const res = await fetch(url, { headers: graphHeaders(accessToken) });
  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    return { error: detail.error?.message || "Could not read the mailbox." };
  }
  return (await res.json().catch(() => ({}))) as { value?: unknown[]; "@odata.nextLink"?: string };
}

async function graphPages(accessToken: string, path: string): Promise<GraphFolder[]> {
  const out: GraphFolder[] = [];
  let next: string | undefined = path;
  for (let page = 0; page < 6 && next; page += 1) {
    const json = await graphJson(accessToken, next);
    if ("error" in json) break;
    out.push(...((json.value ?? []) as GraphFolder[]));
    next = json["@odata.nextLink"];
  }
  return out;
}

/** Every mailbox folder, including nested ones. Read-only. */
export async function listMailFolders(accessToken: string): Promise<MailFolderChoice[]> {
  const roots = await graphPages(accessToken, `/me/mailFolders?$top=50&$select=${FOLDER_SELECT}`);
  const out: MailFolderChoice[] = [];
  const seen = new Set<string>();
  const walk = async (folder: GraphFolder, parentPath: string, depth: number) => {
    if (!folder.id || !isSafeFolderId(folder.id) || seen.has(folder.id) || out.length >= 150) return;
    seen.add(folder.id);
    const name = folder.displayName || "Folder";
    const pathName = parentPath ? `${parentPath} / ${name}` : name;
    out.push({
      id: folder.id,
      name,
      path: pathName,
      ...(folder.wellKnownName ? { wellKnownName: folder.wellKnownName } : {}),
    });
    if ((folder.childFolderCount ?? 0) > 0 && depth < 4) {
      const children = await graphPages(accessToken, `/me/mailFolders/${encodeURIComponent(folder.id)}/childFolders?$top=50&$select=${FOLDER_SELECT}`);
      for (const child of children) await walk(child, pathName, depth + 1);
    }
  };
  for (const root of roots) await walk(root, "", 0);
  return out;
}

function toMessages(value: unknown[] | undefined): GoatMailMessage[] {
  return (value ?? [])
    .filter((row): row is { id: string; subject?: string; receivedDateTime?: string; bodyPreview?: string; body?: { content?: string }; from?: { emailAddress?: { address?: string; name?: string } } } => {
      return !!row && typeof row === "object" && typeof (row as { id?: string }).id === "string";
    })
    .map((row) => ({
      id: row.id,
      subject: row.subject || "",
      from: row.from?.emailAddress?.address || row.from?.emailAddress?.name || "",
      receivedAt: row.receivedDateTime || "",
      body: (row.body?.content || row.bodyPreview || "").slice(0, 6000),
    }));
}

async function readFolderMessages(accessToken: string, folderId: string): Promise<GoatMailMessage[] | { error: string }> {
  if (!isSafeFolderId(folderId)) return [];
  const json = await graphJson(
    accessToken,
    `/me/mailFolders/${encodeURIComponent(folderId)}/messages?$top=25&$select=id,subject,from,receivedDateTime,bodyPreview,body&$orderby=receivedDateTime desc`,
  );
  if ("error" in json) return { error: json.error };
  return toMessages(json.value);
}

export async function readMailbox(input: {
  tenant: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  folderIds: string[] | null;
}): Promise<{ email: string; refreshToken: string; messages: GoatMailMessage[]; folders: MailFolderChoice[]; selectedFolderIds: string[] } | { error: string }> {
  const tokens = await tokenRequest(
    input.tenant,
    new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      grant_type: "refresh_token",
      refresh_token: input.refreshToken,
      scope: SCOPE,
    }),
  );
  if (!tokens.access_token) return { error: tokens.error || "The mailbox connection expired. Connect it again." };
  const folders = await listMailFolders(tokens.access_token);
  const selectedFolderIds = chosenFolderIds(folders, input.folderIds);
  const ids = selectedFolderIds.length ? selectedFolderIds : ["inbox"];
  const groups: GoatMailMessage[][] = [];
  let error = "";
  for (const id of ids) {
    const got = await readFolderMessages(tokens.access_token, id);
    if (!Array.isArray(got)) error = got.error;
    else groups.push(got);
  }
  if (!groups.length && error) return { error };
  const email = await mailboxAddress(tokens.access_token);
  return {
    email,
    refreshToken: tokens.refresh_token || input.refreshToken,
    messages: mergeMailMessages(groups),
    folders,
    selectedFolderIds,
  };
}

export async function loadMailFolderIds(admin: SupabaseClient, workspaceId: string): Promise<string[] | null> {
  const { data, error } = await admin.from("workspace_kv").select("value").eq("workspace_id", workspaceId).eq("key", GOAT_MAIL_FOLDERS_KEY).maybeSingle();
  if (error || !data) return null;
  const value = data.value as { folderIds?: unknown };
  if (!value || !Array.isArray(value.folderIds)) return null;
  const ids = value.folderIds.filter((id): id is string => typeof id === "string" && isSafeFolderId(id));
  return ids.length ? ids : null;
}

export async function saveMailFolderIds(admin: SupabaseClient, workspaceId: string, folderIds: string[]): Promise<{ ok: true } | { error: string }> {
  const ids = folderIds.filter((id) => isSafeFolderId(id));
  if (!ids.length) return { error: "Pick at least one folder." };
  const { error } = await admin.from("workspace_kv").upsert(
    {
      workspace_id: workspaceId,
      key: GOAT_MAIL_FOLDERS_KEY,
      value: { folderIds: ids },
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id,key" },
  );
  if (error) return { error: "Could not save the folder choice." };
  return { ok: true };
}

export async function loadMailConnection(admin: SupabaseClient, workspaceId: string): Promise<{ refreshToken: string; email: string } | null | { missingTable: true }> {
  const { data, error } = await admin.from(TABLE).select("refresh_token, account_email").eq("workspace_id", workspaceId).maybeSingle();
  if (error) {
    if (/goat_mail_connections|schema cache|does not exist/i.test(error.message)) return { missingTable: true };
    return null;
  }
  if (!data?.refresh_token) return null;
  return { refreshToken: String(data.refresh_token), email: String(data.account_email || "") };
}

export async function saveMailConnection(admin: SupabaseClient, row: { workspaceId: string; refreshToken: string; email: string }): Promise<{ ok: true } | { error: string }> {
  const { error } = await admin.from(TABLE).upsert({
    workspace_id: row.workspaceId,
    refresh_token: row.refreshToken,
    account_email: row.email,
    updated_at: new Date().toISOString(),
  });
  if (error) return { error: "Could not save the mailbox connection." };
  return { ok: true };
}

export async function deleteMailConnection(admin: SupabaseClient, workspaceId: string): Promise<void> {
  await admin.from(TABLE).delete().eq("workspace_id", workspaceId);
  await admin.from("workspace_kv").delete().eq("workspace_id", workspaceId).eq("key", GOAT_MAIL_FOLDERS_KEY);
}
