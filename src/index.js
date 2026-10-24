// Broad geographic bounds covering mainland PNG and its major islands.
import locations from "../public/locations.json" assert { type: "json" };

const PAPUA_NEW_GUINEA = { minLat: -11.7, maxLat: -0.5, minLng: 140.8, maxLng: 156.3 };
const MAX_LOCATION_FIELD = 100;
const MAX_BODY_BYTES = 8_000;
const RESTORE_RADIUS_METERS = 5_000;
const MAX_REPORT_ACCURACY_METERS = 5_000;
const IMPACTS = ["My street", "Multiple streets", "Whole area", "Not sure"];
const DURATIONS = ["Just happened", "Over an hour", "Several hours", "Since yesterday"];
const PROFANITY = /\b(fuck|shit|cunt|bitch|bastard|asshole|motherfucker)\b/i;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
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
  const latitude = input.latitude == null || input.latitude === "" ? null : Number(input.latitude);
  const longitude = input.longitude == null || input.longitude === "" ? null : Number(input.longitude);
  const accuracy = input.accuracy == null || input.accuracy === "" ? null : Number(input.accuracy);
  if (!validCoordinate(latitude, PAPUA_NEW_GUINEA.minLat, PAPUA_NEW_GUINEA.maxLat) || !validCoordinate(longitude, PAPUA_NEW_GUINEA.minLng, PAPUA_NEW_GUINEA.maxLng)) return { error: "A valid GPS location within Papua New Guinea is required." };
  if (!Number.isFinite(accuracy) || accuracy <= 0 || accuracy > MAX_REPORT_ACCURACY_METERS) return { error: "Your GPS reading is too inaccurate. Please retry from a location with a clearer signal." };
  const city = input.city == null ? "" : String(input.city).trim();
  const suburb = input.suburb == null ? "" : String(input.suburb).trim();
  const locality = input.locality == null ? "" : String(input.locality).trim();
  const impact = input.impact == null || input.impact === "" ? null : String(input.impact).trim();
  const duration = input.duration == null || input.duration === "" ? null : String(input.duration).trim();
  if ([city, suburb, locality].some((value) => value.length > MAX_LOCATION_FIELD || CONTROL_CHARS.test(value))) return { error: "Location fields are invalid or too long." };
  if (!locations.cities.includes(city)) return { error: "Please choose a valid city." };
  if (city === "Other" && (suburb || locality)) return { error: "Suburb and locality must be empty when city is Other." };
  if (city === "Port Moresby") {
    if (!Object.prototype.hasOwnProperty.call(locations.suburbs[city], suburb)) return { error: "Please choose a valid Port Moresby suburb." };
    const knownLocalities = locations.suburbs[city][suburb];
    if (locality && !knownLocalities.includes(locality)) return { error: "Please choose a valid locality for the selected suburb." };
    if (locality === "Other / Not listed" && !knownLocalities.includes(locality)) return { error: "Please choose a valid locality for the selected suburb." };
  }
  if (impact && !IMPACTS.includes(impact)) return { error: "Please choose a valid impact." };
  if (duration && !DURATIONS.includes(duration)) return { error: "Please choose a valid duration." };
  if (input.website) return { error: "Spam check failed." };
  return { value: { latitude, longitude, accuracy, city, suburb: suburb || null, locality: locality || null, impact, duration, description: null } };
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
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) return null;
  try { return await request.json(); } catch { return null; }
}

async function listOutages(env, url) {
  const includeRestored = url.searchParams.get("include") === "all";
  const query = includeRestored
    ? "SELECT * FROM outages ORDER BY COALESCE(restored_at, '9999') DESC, started_at DESC LIMIT 200"
    : "SELECT * FROM outages WHERE restored_at IS NULL ORDER BY started_at DESC LIMIT 200";
  const result = await env.DB.prepare(query).all();
  return json({ outages: (result.results || []).map(outage), updatedAt: new Date().toISOString() }, 200, {
    "cache-control": "public, max-age=5, s-maxage=10, stale-while-revalidate=30"
  });
}

async function createOutage(request, env) {
  if (!isPapuaNewGuinea(request)) return json({ error: "Reports are currently limited to Papua New Guinea connections." }, 403);
  const body = await readJson(request);
  if (body === null) return json({ error: "Request body is missing, invalid, or too large." }, 400);
  const checked = validateReport(body);
  if (checked.error) return json({ error: checked.error }, 400);
  if (isRateLimited(request, "report")) return json({ error: "Please try again later." }, 429);
  const now = new Date().toISOString();
  const result = await env.DB.prepare("INSERT INTO outages (latitude, longitude, city, suburb, locality, impact, duration, started_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(checked.value.latitude, checked.value.longitude, checked.value.city, checked.value.suburb, checked.value.locality, checked.value.impact, checked.value.duration, now, now).run();
  return json({ outage: outage({ id: result.meta.last_row_id, ...checked.value, started_at: now, restored_at: null, created_at: now, report_count: 1, source: "community" }) }, 201);
}

async function restoreOutage(request, env, id) {
  if (!isPapuaNewGuinea(request)) return json({ error: "Restoration updates are currently limited to Papua New Guinea connections." }, 403);
  if (isRateLimited(request, "restore")) return json({ error: "Please try again later." }, 429);
  const body = await readJson(request);
  const latitude = Number(body?.latitude);
  const longitude = Number(body?.longitude);
  if (!validCoordinate(latitude, PAPUA_NEW_GUINEA.minLat, PAPUA_NEW_GUINEA.maxLat) || !validCoordinate(longitude, PAPUA_NEW_GUINEA.minLng, PAPUA_NEW_GUINEA.maxLng)) return json({ error: "Location permission is required to restore an outage." }, 400);
  const existing = await env.DB.prepare("SELECT latitude, longitude FROM outages WHERE id = ? AND restored_at IS NULL").bind(id).first();
  if (!existing) return json({ error: "Active outage not found." }, 404);
  if (!Number.isFinite(existing.latitude) || !Number.isFinite(existing.longitude)) return json({ error: "This report has no precise location for nearby restoration." }, 409);
  const distance = distanceMeters(latitude, longitude, existing.latitude, existing.longitude);
  if (distance > RESTORE_RADIUS_METERS) return json({ error: "You must be near the reported outage to mark it restored." }, 403);
  const now = new Date().toISOString();
  const result = await env.DB.prepare("UPDATE outages SET restored_at = ? WHERE id = ? AND restored_at IS NULL").bind(now, id).run();
  if (!result.meta.changes) return json({ error: "Active outage not found." }, 404);
  const row = await env.DB.prepare("SELECT * FROM outages WHERE id = ?").bind(id).first();
  return json({ outage: outage(row) });
}

function distanceMeters(lat1, lon1, lat2, lon2) {
  const radius = 6371000;
  const radians = Math.PI / 180;
  const dLat = (lat2 - lat1) * radians;
  const dLon = (lon2 - lon1) * radians;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * radians) * Math.cos(lat2 * radians) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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
  },

  async scheduled(_event, env) {
    await env.DB.prepare("DELETE FROM outages WHERE restored_at IS NOT NULL AND restored_at < datetime('now', '-30 days')").run();
  }
};
