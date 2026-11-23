/**
 * In-memory Supabase stand-in for local demo screenshots and checks.
 * It is not the production database. Nothing here is a real office.
 *
 * Run: npx tsx scripts/demo-mock-server.ts
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { appointmentSeedRows, buildDemoSeed, kvSeedRows, noteSeedRows, patientSeedRows } from "../src/lib/demo-seed";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE = `${USER_ID}:demo-office`;
const EMAIL = (process.env.DEMO_USER_EMAIL ?? "demo@example.com").toLowerCase();
const PASSWORD = process.env.DEMO_USER_PASSWORD ?? "demodemo12";
const PORT = Number(process.env.DEMO_MOCK_PORT ?? 54321);

const seed = buildDemoSeed(new Date());
const tables = new Map<string, Record<string, unknown>[]>();
tables.set("patients", patientSeedRows(seed.patients, WORKSPACE));
tables.set("schedule_appointments", appointmentSeedRows(seed.appointments, WORKSPACE));
tables.set("encounter_notes", noteSeedRows(seed.notes, WORKSPACE));
tables.set("workspace_kv", kvSeedRows(seed.kv, WORKSPACE));
tables.set("app_snapshots", [{ workspace_id: WORKSPACE, snapshot: {}, updated_at: new Date().toISOString() }]);
tables.set("account_profiles", [{
  user_id: USER_ID,
  email: EMAIL,
  approval_status: "approved",
  is_admin: false,
  plan_tier: "complete",
  approved_at: new Date().toISOString(),
}]);
tables.set("workspace_members", []);
tables.set("demo_workspace_lock", [{ id: 1, workspace_id: WORKSPACE }]);

const user = {
  id: USER_ID,
  aud: "authenticated",
  role: "authenticated",
  email: EMAIL,
  email_confirmed_at: "2026-01-01T00:00:00.000Z",
  app_metadata: { demo_office: true, provider: "email" },
  user_metadata: {},
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: new Date().toISOString(),
};

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: Record<string, unknown>) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}.demo-signature`;
}

function accessToken(): string {
  return jwt({
    sub: USER_ID,
    email: EMAIL,
    role: "authenticated",
    aud: "authenticated",
    exp: Math.floor(Date.now() / 1000) + 60 * 60,
    app_metadata: { demo_office: true, provider: "email" },
    user_metadata: {},
  });
}

function send(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}) {
  const payload = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,HEAD,OPTIONS",
    "access-control-expose-headers": "content-range, x-total-count",
    ...extra,
  });
  res.end(payload);
}

function tableOf(pathname: string): string {
  const parts = pathname.split("/").filter(Boolean);
  return decodeURIComponent(parts[2] ?? "");
}

function matchFilter(row: Record<string, unknown>, key: string, raw: string): boolean {
  if (raw.startsWith("eq.")) return String(row[key] ?? "") === raw.slice(3);
  if (raw.startsWith("neq.")) return String(row[key] ?? "") !== raw.slice(4);
  if (raw.startsWith("gte.")) return String(row[key] ?? "") >= raw.slice(4);
  if (raw.startsWith("gt.")) return String(row[key] ?? "") > raw.slice(3);
  if (raw.startsWith("lte.")) return String(row[key] ?? "") <= raw.slice(4);
  if (raw.startsWith("lt.")) return String(row[key] ?? "") < raw.slice(3);
  if (raw.startsWith("is.")) return raw.slice(3) === "null" ? row[key] == null : row[key] != null;
  if (raw.startsWith("in.(") && raw.endsWith(")")) {
    const values = raw.slice(4, -1).split(",").map((value) => value.replace(/^"|"$/g, ""));
    return values.includes(String(row[key] ?? ""));
  }
  if (raw.startsWith("not.is.")) return raw.includes("null") ? row[key] != null : true;
  return true;
}

function project(row: Record<string, unknown>, select: string): Record<string, unknown> {
  if (!select || select === "*" || select.includes("(")) return row;
  const keys = select.split(",").map((key) => key.trim()).filter(Boolean);
  const out: Record<string, unknown> = {};
  for (const key of keys) out[key] = row[key];
  return out;
}

function queryRows(table: string, url: URL): Record<string, unknown>[] {
  let rows = [...(tables.get(table) ?? [])];
  for (const [key, value] of url.searchParams) {
    if (key === "select" || key === "limit" || key === "order" || key === "offset" || key === "on_conflict") continue;
    rows = rows.filter((row) => matchFilter(row, key, value));
  }
  const order = url.searchParams.get("order");
  if (order) {
    const [column, direction] = order.split(".");
    rows.sort((left, right) => String(left[column] ?? "").localeCompare(String(right[column] ?? "")));
    if (direction === "desc") rows.reverse();
  }
  const limitRaw = url.searchParams.get("limit");
  if (limitRaw != null) {
    const limit = Number(limitRaw);
    if (Number.isFinite(limit) && limit >= 0) rows = rows.slice(0, limit);
  }
  return rows;
}

function upsertRows(table: string, incoming: Record<string, unknown>[], conflict: string) {
  const keys = conflict.split(",").map((key) => key.trim()).filter(Boolean);
  const current = tables.get(table) ?? [];
  for (const row of incoming) {
    const index = current.findIndex((existing) => keys.every((key) => String(existing[key] ?? "") === String(row[key] ?? "")));
    if (index >= 0) current[index] = { ...current[index], ...row, updated_at: new Date().toISOString() };
    else current.push({ ...row, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  }
  tables.set(table, current);
}

const server = createServer(async (req, res) => {
  if (!req.url || !req.method) return send(res, 400, { message: "Bad request" });
  if (req.method === "OPTIONS") return send(res, 204, "");
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const path = url.pathname;

  if (path === "/auth/v1/token" && req.method === "POST") {
    const body = JSON.parse((await readBody(req)) || "{}") as { email?: string; password?: string };
    if (body.email?.toLowerCase() !== EMAIL || body.password !== PASSWORD) {
      return send(res, 400, { error: "invalid_grant", error_description: "Invalid login credentials", msg: "Invalid login credentials" });
    }
    return send(res, 200, {
      access_token: accessToken(),
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: "demo-refresh-token",
      user,
    });
  }
  if (path === "/auth/v1/user" && req.method === "GET") return send(res, 200, user);
  if (path.startsWith("/auth/v1/")) return send(res, 200, { user });

  if (path.startsWith("/storage/v1/object/")) {
    return send(res, 200, { Key: path.replace("/storage/v1/object/", ""), Id: "demo-file" });
  }

  if (!path.startsWith("/rest/v1/")) return send(res, 404, { message: "Not found", path });
  const table = tableOf(path);
  if (!tables.has(table)) tables.set(table, []);
  const wantsObject = (req.headers.accept ?? "").includes("vnd.pgrst.object");
  const method = req.method.toUpperCase();

  if (method === "GET" || method === "HEAD") {
    const rows = queryRows(table, url).map((row) => project(row, url.searchParams.get("select") ?? "*"));
    const range = `0-${Math.max(rows.length - 1, 0)}/${rows.length}`;
    if (method === "HEAD") return send(res, 200, "", { "content-range": range });
    if (wantsObject) {
      if (rows.length !== 1) {
        return send(res, 406, { code: "PGRST116", details: "The result contains 0 rows", message: "JSON object requested, multiple (or no) rows returned" });
      }
      return send(res, 200, rows[0], { "content-range": range });
    }
    return send(res, 200, rows, { "content-range": range });
  }

  const raw = await readBody(req);
  const parsed = raw ? JSON.parse(raw) : {};
  const incoming = Array.isArray(parsed) ? parsed as Record<string, unknown>[] : [parsed as Record<string, unknown>];

  if (method === "POST" || method === "PUT") {
    const conflict = url.searchParams.get("on_conflict") || "";
    if (conflict) upsertRows(table, incoming, conflict);
    else tables.set(table, [...(tables.get(table) ?? []), ...incoming]);
    const prefer = String(req.headers.prefer ?? "");
    return send(res, 201, prefer.includes("return=representation") ? incoming : null);
  }
  if (method === "PATCH") {
    const rows = tables.get(table) ?? [];
    const next = rows.map((row) => (queryRows(table, url).includes(row) ? { ...row, ...incoming[0] } : row));
    // queryRows returns copies, so match by JSON instead.
    const matched = new Set(queryRows(table, url).map((row) => JSON.stringify(row)));
    tables.set(table, rows.map((row) => (matched.has(JSON.stringify(row)) ? { ...row, ...incoming[0] } : row)));
    void next;
    return send(res, 200, incoming);
  }
  if (method === "DELETE") {
    const matched = new Set(queryRows(table, url).map((row) => JSON.stringify(row)));
    tables.set(table, (tables.get(table) ?? []).filter((row) => !matched.has(JSON.stringify(row))));
    return send(res, 200, []);
  }
  return send(res, 405, { message: "Method not allowed" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Demo mock listening on http://127.0.0.1:${PORT} workspace ${WORKSPACE} patients ${seed.patients.length}`);
});
