const PORT_MORESBY = { minLat: -9.75, maxLat: -9.25, minLng: 146.90, maxLng: 147.40 };
const MAX_DESCRIPTION = 500;
const RATE_WINDOW_MS = 10 * 60_000;
const RATE_LIMIT = 1;
const recentRequests = new Map();
const CORS_HEADERS = {
  "access-control-allow-origin": "https://shipitandrei.github.io",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type"
};

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...CORS_HEADERS, ...extraHeaders }
  });
}

function validCoordinate(value, min, max) {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

export function validateReport(input) {
  if (!input || typeof input !== "object") return { error: "A JSON object is required." };
  const latitude = Number(input.latitude);
  const longitude = Number(input.longitude);
  if (!validCoordinate(latitude, PORT_MORESBY.minLat, PORT_MORESBY.maxLat) || !validCoordinate(longitude, PORT_MORESBY.minLng, PORT_MORESBY.maxLng)) {
    return { error: "Please choose a location within Port Moresby." };
  }
  const description = input.description == null ? null : String(input.description).trim();
  if (description && description.length > MAX_DESCRIPTION) return { error: `Description must be ${MAX_DESCRIPTION} characters or fewer.` };
  if (input.website) return { error: "Spam check failed." };
  return { value: { latitude, longitude, description: description || null } };
}

function isRateLimited(request, action = "report") {
  const cloudflareIp = request.headers.get("cf-connecting-ip");
  const forwardedIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const clientIp = cloudflareIp || forwardedIp || "unknown";
  const rateKey = `${action}:${clientIp}`;
  const now = Date.now();
  const entries = (recentRequests.get(rateKey) || []).filter((time) => now - time < RATE_WINDOW_MS);
  if (entries.length >= RATE_LIMIT) { recentRequests.set(rateKey, entries); return true; }
  entries.push(now); recentRequests.set(rateKey, entries); return false;
}

function isPapuaNewGuinea(request) {
  return request.cf?.country === "PG";
}

function outage(row) {
  const restored = row.restored_at ? new Date(row.restored_at) : null;
  const started = new Date(row.started_at);
  const end = restored || new Date();
  return { ...row, active: !restored, durationMinutes: Math.max(0, Math.round((end - started) / 60000)) };
}

async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

async function listOutages(env, url) {
  const includeRestored = url.searchParams.get("include") === "all";
  const query = includeRestored
    ? "SELECT * FROM outages ORDER BY COALESCE(restored_at, '9999') DESC, started_at DESC LIMIT 200"
    : "SELECT * FROM outages WHERE restored_at IS NULL ORDER BY started_at DESC LIMIT 200";
  const result = await env.DB.prepare(query).all();
  return json({ outages: (result.results || []).map(outage), updatedAt: new Date().toISOString() });
}

async function createOutage(request, env) {
  if (!isPapuaNewGuinea(request)) return json({ error: "Reports are currently limited to Papua New Guinea connections." }, 403);
  if (isRateLimited(request, "report")) return json({ error: "You can submit one report every 10 minutes." }, 429);
  const body = await readJson(request);
  const checked = validateReport(body);
  if (checked.error) return json({ error: checked.error }, 400);
  const now = new Date().toISOString();
  const result = await env.DB.prepare("INSERT INTO outages (latitude, longitude, description, started_at, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(checked.value.latitude, checked.value.longitude, checked.value.description, now, now).run();
  return json({ outage: outage({ id: result.meta.last_row_id, ...checked.value, started_at: now, restored_at: null, created_at: now, report_count: 1, source: "community" }) }, 201);
}

async function restoreOutage(request, env, id) {
  if (!isPapuaNewGuinea(request)) return json({ error: "Restoration updates are currently limited to Papua New Guinea connections." }, 403);
  if (isRateLimited(request, "restore")) return json({ error: "You can mark one outage restored every 10 minutes." }, 429);
  const now = new Date().toISOString();
  const result = await env.DB.prepare("UPDATE outages SET restored_at = ? WHERE id = ? AND restored_at IS NULL").bind(now, id).run();
  if (!result.meta.changes) return json({ error: "Active outage not found." }, 404);
  const row = await env.DB.prepare("SELECT * FROM outages WHERE id = ?").bind(id).first();
  return json({ outage: outage(row) });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) return new Response(null, { status: 204, headers: CORS_HEADERS });
    if (request.method === "GET" && url.pathname === "/api/outages") return listOutages(env, url);
    if (request.method === "POST" && url.pathname === "/api/outages") return createOutage(request, env);
    const restore = url.pathname.match(/^\/api\/outages\/(\d+)\/restore$/);
    if (request.method === "POST" && restore) return restoreOutage(request, env, Number(restore[1]));
    if (url.pathname.startsWith("/api/")) return json({ error: "Not found." }, 404);
    return env.ASSETS.fetch(request);
  }
};
