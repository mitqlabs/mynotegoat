/**
 * Server-only Microsoft Graph Mail.Read. This file never sends, deletes,
 * or changes mail. The only writes are the OAuth token request and the
 * refresh-token row in goat_mail_connections.
 *
 * Stays off until the owner sets GOAT_MAIL_CLIENT_ID and GOAT_MAIL_CLIENT_SECRET.
 * Registration steps: GOAT_MAIL_SETUP_STEPS in src/lib/goat-mail.ts.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GoatMailMessage } from "@/lib/goat-mail";

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

export async function readMailbox(input: {
  tenant: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<{ email: string; refreshToken: string; messages: GoatMailMessage[] } | { error: string }> {
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
  const headers = {
    Authorization: `Bearer ${tokens.access_token}`,
    Prefer: 'outlook.body-content-type="text"',
  };
  const res = await fetch(
    "https://graph.microsoft.com/v1.0/me/messages?$top=25&$select=id,subject,from,receivedDateTime,bodyPreview,body&$orderby=receivedDateTime desc",
    { headers },
  );
  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    return { error: detail.error?.message || "Could not read the mailbox." };
  }
  const json = (await res.json().catch(() => ({}))) as {
    value?: Array<{
      id?: string;
      subject?: string;
      receivedDateTime?: string;
      bodyPreview?: string;
      body?: { content?: string };
      from?: { emailAddress?: { address?: string; name?: string } };
    }>;
  };
  const email = await mailboxAddress(tokens.access_token);
  const messages: GoatMailMessage[] = (json.value ?? [])
    .filter((row) => typeof row.id === "string")
    .map((row) => ({
      id: row.id as string,
      subject: row.subject || "",
      from: row.from?.emailAddress?.address || row.from?.emailAddress?.name || "",
      receivedAt: row.receivedDateTime || "",
      body: (row.body?.content || row.bodyPreview || "").slice(0, 6000),
    }));
  return { email, refreshToken: tokens.refresh_token || input.refreshToken, messages };
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
  if (error) return { error: /does not exist|schema cache/i.test(error.message) ? "Run the goat_mail_connections migration in Supabase, then connect again." : "Could not save the mailbox connection." };
  return { ok: true };
}

export async function deleteMailConnection(admin: SupabaseClient, workspaceId: string): Promise<void> {
  await admin.from(TABLE).delete().eq("workspace_id", workspaceId);
}
