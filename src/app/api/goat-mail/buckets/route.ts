import { NextRequest, NextResponse } from "next/server";
import { adminClient, serverConfig, verifyStaff } from "@/lib/patient-forms-server";
import { normalizeMailBuckets } from "@/lib/goat-mail";
import { goatMailWorkspaceId, saveMailBuckets } from "@/lib/goat-mail-server";

/** Save mail buckets, or clear them back to the built-in list. This does not touch the mailbox. */
export async function POST(request: NextRequest) {
  const cfg = serverConfig();
  if (!cfg) return NextResponse.json({ error: "Server not configured." }, { status: 500 });
  const admin = adminClient(cfg);
  const caller = await verifyStaff(request, cfg, admin);
  if (!caller) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { reset?: boolean; buckets?: unknown } | null;
  if (body?.reset) {
    const saved = await saveMailBuckets(admin, goatMailWorkspaceId(caller.ownerId), null);
    if ("error" in saved) return NextResponse.json({ error: saved.error }, { status: 500 });
    return NextResponse.json({ buckets: null });
  }
  const clean = normalizeMailBuckets(body?.buckets);
  if (!clean) return NextResponse.json({ error: "Add at least one bucket with a name." }, { status: 400 });
  const saved = await saveMailBuckets(admin, goatMailWorkspaceId(caller.ownerId), clean);
  if ("error" in saved) return NextResponse.json({ error: saved.error }, { status: 500 });
  return NextResponse.json({ buckets: saved.buckets });
}
