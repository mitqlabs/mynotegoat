import { NextRequest, NextResponse } from "next/server";
import { adminClient, serverConfig } from "@/lib/patient-forms-server";
import { exchangeMailCode, goatMailEnv, goatMailRedirectUri, goatMailWorkspaceId, readMailState, saveMailConnection } from "@/lib/goat-mail-server";

/** Microsoft returns here with a code. We store the refresh token and never touch the mailbox. */
export async function GET(request: NextRequest) {
  const env = goatMailEnv();
  const back = (query: string) => NextResponse.redirect(new URL(`/goat-mail?${query}`, request.nextUrl.origin));
  if (!env.configured) return back("error=not-configured");
  const cfg = serverConfig();
  if (!cfg) return back("error=server");
  const sent = request.nextUrl.searchParams.get("state") || "";
  const payload = readMailState(request.cookies.get("goat_mail_state")?.value, env.clientSecret);
  if (!payload || payload.state !== sent) return back("error=state");
  const code = request.nextUrl.searchParams.get("code") || "";
  if (!code) return back("error=denied");
  const exchanged = await exchangeMailCode({
    tenant: env.tenant,
    clientId: env.clientId,
    clientSecret: env.clientSecret,
    redirectUri: goatMailRedirectUri(request.nextUrl.origin),
    code,
  });
  if ("error" in exchanged) return back("error=connect");
  const saved = await saveMailConnection(adminClient(cfg), {
    workspaceId: goatMailWorkspaceId(payload.ownerId),
    refreshToken: exchanged.refreshToken,
    email: exchanged.email,
  });
  const res = "error" in saved ? back("error=connect") : back("connected=1");
  res.cookies.set("goat_mail_state", "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
