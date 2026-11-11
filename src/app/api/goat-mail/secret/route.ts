import { NextRequest, NextResponse } from "next/server";
import { adminClient, serverConfig, verifyStaff } from "@/lib/patient-forms-server";
import { normalizeSecretExpiresOn } from "@/lib/goat-mail";
import { goatMailWorkspaceId, saveMailSecretExpiresOn } from "@/lib/goat-mail-server";

/** Save the optional Microsoft secret expiry. This does not call Microsoft. */
export async function POST(request: NextRequest) {
  const cfg = serverConfig();
  if (!cfg) return NextResponse.json({ error: "Server not configured." }, { status: 500 });
  const admin = adminClient(cfg);
  const caller = await verifyStaff(request, cfg, admin);
  if (!caller) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { expiresOn?: unknown } | null;
  const raw = typeof body?.expiresOn === "string" ? body.expiresOn.trim() : "";
  if (raw && !normalizeSecretExpiresOn(raw)) return NextResponse.json({ error: "Enter a real date." }, { status: 400 });
  const saved = await saveMailSecretExpiresOn(admin, goatMailWorkspaceId(caller.ownerId), raw);
  if ("error" in saved) return NextResponse.json({ error: saved.error }, { status: 500 });
  return NextResponse.json({ expiresOn: saved.expiresOn });
}
