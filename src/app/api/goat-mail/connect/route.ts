import { NextRequest, NextResponse } from "next/server";
import { adminClient, serverConfig, verifyStaff } from "@/lib/patient-forms-server";
import { authorizeUrl, goatMailEnv, goatMailRedirectUri, signMailState } from "@/lib/goat-mail-server";

/** Start the read-only Microsoft sign-in. Returns the authorize URL; the browser navigates there. */
export async function POST(request: NextRequest) {
  const env = goatMailEnv();
  if (!env.configured) return NextResponse.json({ error: "GOAT Mail is not configured yet." }, { status: 404 });
  const cfg = serverConfig();
  if (!cfg) return NextResponse.json({ error: "Server not configured." }, { status: 500 });
  const admin = adminClient(cfg);
  const caller = await verifyStaff(request, cfg, admin);
  if (!caller) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const signed = signMailState(caller.ownerId, env.clientSecret);
  const url = authorizeUrl({
    tenant: env.tenant,
    clientId: env.clientId,
    redirectUri: goatMailRedirectUri(request.nextUrl.origin),
    state: signed.state,
  });
  const res = NextResponse.json({ url });
  res.cookies.set("goat_mail_state", signed.cookie, { httpOnly: true, sameSite: "lax", secure: request.nextUrl.protocol === "https:", path: "/", maxAge: 600 });
  return res;
}
