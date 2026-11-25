import { NextRequest, NextResponse } from "next/server";
import { shortcutFileHeaders, shortcutForTicket } from "@/lib/shortcut-import";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ file: string }> };

function serverKeys(): { service: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  return url && anon && service ? { service } : null;
}

/** Same public file as /api/reminders/shortcut, on a URL that ends in .shortcut. */
export async function GET(request: NextRequest, context: Ctx) {
  const { file } = await context.params;
  if (!file.toLowerCase().endsWith(".shortcut")) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  const keys = serverKeys();
  if (!keys) return NextResponse.json({ error: "Server not configured." }, { status: 500 });
  const rule = request.nextUrl.searchParams.get("rule") ?? "";
  const ruleId = /^[A-Za-z0-9_-]{1,40}$/.test(rule.trim()) ? rule.trim() : "";
  const rawName = request.nextUrl.searchParams.get("name") ?? "";
  const name = rawName.replace(/[\r\n]/g, " ").trim().slice(0, 80);
  const shown = name.startsWith("NoteGoat") ? name : "NoteGoat";
  const download = shortcutForTicket({
    ticket: request.nextUrl.searchParams.get("t") ?? "",
    secret: keys.service,
    ruleId,
    name: shown,
    origin: request.nextUrl.origin,
  });
  if (!download.ok) return NextResponse.json({ error: download.error }, { status: download.status });
  return new NextResponse(new Uint8Array(download.body), { headers: shortcutFileHeaders(download.filename) });
}
