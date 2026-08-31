const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization"
};
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { ...cors, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});

async function hashCode(code, pepper) {
  const bytes = new TextEncoder().encode(`${pepper}:${code}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, "0")).join("");
}


const ADMIN_FALLBACK_SHA256 = "9bf84a9825fcf66c467a2a73d1369ab3ba5f4d5a86c146046dfe46881eed0e49";

async function sha256Text(value) {
  const bytes = new TextEncoder().encode(String(value || ""));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, "0")).join("");
}

async function adminAuthorized(request, env) {
  const auth = request.headers.get("authorization") || "";
  const supplied = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!supplied) return false;
  if (env.ADMIN_SECRET && supplied === String(env.ADMIN_SECRET).trim()) return true;
  return (await sha256Text(supplied)) === ADMIN_FALLBACK_SHA256;
}

async function body(request) {
  try { return await request.json(); } catch { return {}; }
}

function normalizeCode(value) {
  return String(value || "").toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/[OI]/g, c => ({ O:"Q", I:"L" }[c]))
    .slice(0, 6);
}
function validCode(value) { return /^[A-HJ-NP-Z0-9]{6}$/.test(normalizeCode(value)); }
function validDevice(value) { return /^[a-zA-Z0-9-]{16,80}$/.test(String(value || "")); }

async function activate(request, env) {
  const data = await body(request);
  const code = normalizeCode(data.code);
  const deviceId = String(data.deviceId || "");
  const type = data.deviceType === "autoradio" ? "autoradio" : "phone";
  if (!validCode(code) || !validDevice(deviceId)) return json({ ok: false, error: "DONNEES_INVALIDES" }, 400);
  const codeHash = await hashCode(code, env.CODE_PEPPER);
  const row = await env.DB.prepare("SELECT * FROM subscriptions WHERE code_hash = ? AND active = 1").bind(codeHash).first();
  if (!row) return json({ ok: false, error: "CODE_INCORRECT" }, 403);
  if (!row.lifetime && (!row.expires_at || Date.parse(row.expires_at) <= Date.now())) return json({ ok: false, error: "ABONNEMENT_EXPIRE" }, 403);
  const column = type === "autoradio" ? "autoradio_device" : "phone_device";
  const registered = row[column];
  if (registered && registered !== deviceId) return json({ ok: false, error: "APPAREIL_DEJA_UTILISE" }, 409);
  if (!registered) await env.DB.prepare(`UPDATE subscriptions SET ${column} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(deviceId, row.id).run();
  return json({ ok: true, lifetime: !!row.lifetime, expiresAt: row.expires_at || null, deviceType: type });
}

async function subscriptionStatus(request, env) {
  const data = await body(request);
  const code = normalizeCode(data.code);
  const deviceId = String(data.deviceId || "");
  const type = data.deviceType === "autoradio" ? "autoradio" : "phone";
  if (!validCode(code) || !validDevice(deviceId)) return json({ ok: false, error: "DONNEES_INVALIDES" }, 400);
  const codeHash = await hashCode(code, env.CODE_PEPPER);
  const row = await env.DB.prepare("SELECT * FROM subscriptions WHERE code_hash = ? AND active = 1").bind(codeHash).first();
  if (!row) return json({ ok: false, error: "CODE_INCORRECT" }, 403);
  if (!row.lifetime && (!row.expires_at || Date.parse(row.expires_at) <= Date.now())) return json({ ok: false, error: "ABONNEMENT_EXPIRE" }, 403);
  const registered = type === "autoradio" ? row.autoradio_device : row.phone_device;
  if (registered !== deviceId) return json({ ok: false, error: "APPAREIL_REMPLACE" }, 409);
  return json({ ok: true, lifetime: !!row.lifetime, expiresAt: row.expires_at || null, deviceType: type });
}

async function createSubscription(request, env) {
  if (!(await adminAuthorized(request, env))) return json({ ok: false, error: "SECRET_INCORRECT" }, 401);
  const data = await body(request);
  const code = normalizeCode(data.code);
  if (!validCode(code)) return json({ ok: false, error: "CODE_6_CARACTERES_REQUIS" }, 400);
  const lifetime = data.lifetime === true;
  const days = Math.max(1, Math.min(3650, Number(data.days) || 365));
  const expires = lifetime ? null : new Date(Date.now() + days * 86400000).toISOString();
  const codeHash = await hashCode(code, env.CODE_PEPPER);
  const existing = await env.DB.prepare("SELECT * FROM subscriptions WHERE code_hash = ?").bind(codeHash).first();

  if (existing) {
    const stillReserved = !!existing.lifetime || (existing.expires_at && Date.parse(existing.expires_at) > Date.now());
    if (stillReserved) return json({ ok: false, error: "CODE_DEJA_UTILISE" }, 409);

    await env.DB.prepare(
      "UPDATE subscriptions SET expires_at=?, lifetime=?, active=1, updated_at=CURRENT_TIMESTAMP WHERE id=?"
    ).bind(expires, lifetime ? 1 : 0, existing.id).run();

    return json({ ok: true, code, lifetime, expiresAt: expires, renewed: true });
  }

  await env.DB.prepare("INSERT INTO subscriptions(code_hash, expires_at, lifetime, active) VALUES (?, ?, ?, 1)")
    .bind(codeHash, expires, lifetime ? 1 : 0).run();

  return json({ ok: true, code, lifetime, expiresAt: expires, renewed: false });
}

async function subscriptionAction(request, env) {
  if (!(await adminAuthorized(request, env))) return json({ ok: false, error: "SECRET_INCORRECT" }, 401);
  const data = await body(request);
  const code = normalizeCode(data.code);
  if (!validCode(code)) return json({ ok: false, error: "CODE_6_CARACTERES_REQUIS" }, 400);
  const codeHash = await hashCode(code, env.CODE_PEPPER);
  const row = await env.DB.prepare("SELECT id FROM subscriptions WHERE code_hash = ?").bind(codeHash).first();
  if (!row) return json({ ok: false, error: "CODE_INTROUVABLE" }, 404);
  if (data.action === "reset_devices") {
    await env.DB.prepare("UPDATE subscriptions SET autoradio_device = NULL, phone_device = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(row.id).run();
    return json({ ok: true, action: "reset_devices" });
  }
  return json({ ok: false, error: "ACTION_INCONNUE" }, 400);
}





async function ensureMailCounterTable(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS mail_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS mail_events_category ON mail_events(category)").run();
}

function normalizeMailCategory(value) {
  const key = String(value || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40);
  const allowed = new Set(["papiers_travail", "mypos_go2", "mypos_ultra", "mypos_flex", "autre"]);
  return allowed.has(key) ? key : "autre";
}

async function recordMailEvent(request, env) {
  if (!env.DB) return json({ ok: false, error: "DB_INDISPONIBLE" }, 503);
  await ensureMailCounterTable(env);
  const data = await body(request);
  const category = normalizeMailCategory(data.category);
  await env.DB.prepare("INSERT INTO mail_events(category) VALUES (?)").bind(category).run();
  return json({ ok: true, category });
}

async function adminMailCounters(request, env) {
  if (!(await adminAuthorized(request, env))) return json({ ok: false, error: "SECRET_INCORRECT" }, 401);
  if (!env.DB) return json({ ok: false, error: "DB_INDISPONIBLE" }, 503);
  await ensureMailCounterTable(env);
  const rows = await env.DB.prepare("SELECT category, COUNT(*) AS count FROM mail_events GROUP BY category").all();
  const counts = { papiers_travail: 0, mypos_go2: 0, mypos_ultra: 0, mypos_flex: 0, autre: 0 };
  let total = 0;
  for (const row of rows.results || []) {
    const n = Number(row.count || 0);
    counts[row.category] = n;
    total += n;
  }
  return json({ ok: true, total, counts });
}


async function ensureAdminPresenceTable(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS admin_presence (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    active INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
}

async function adminPresenceStatus(env) {
  if (!env.DB) return json({ ok: true, active: false });
  await ensureAdminPresenceTable(env);
  const row = await env.DB.prepare("SELECT active FROM admin_presence WHERE id = 1").first();
  return json({ ok: true, active: !!(row && Number(row.active) === 1) });
}

async function adminPresenceAction(request, env) {
  if (!(await adminAuthorized(request, env))) return json({ ok: false, error: "SECRET_INCORRECT" }, 401);
  if (!env.DB) return json({ ok: false, error: "DB_INDISPONIBLE" }, 503);
  await ensureAdminPresenceTable(env);
  const data = await body(request);
  const active = data.active === true ? 1 : 0;
  await env.DB.prepare(`INSERT INTO admin_presence(id, active, updated_at) VALUES(1, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET active=excluded.active, updated_at=CURRENT_TIMESTAMP`).bind(active).run();
  return json({ ok: true, active: !!active });
}

async function presence(request, env) {
  if (!env.DB) return json({ ok: false, error: "DB_INDISPONIBLE", count: 0 }, 503);
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS app_presence (
    device_id TEXT PRIMARY KEY,
    last_seen INTEGER NOT NULL
  )`).run();
  const now = Math.floor(Date.now() / 1000);
  if (request.method === "POST") {
    const data = await body(request);
    const deviceId = String(data.deviceId || "").slice(0, 100);
    if (!deviceId) return json({ ok: false, error: "APPAREIL_INVALIDE" }, 400);
    await env.DB.prepare("INSERT INTO app_presence(device_id,last_seen) VALUES(?,?) ON CONFLICT(device_id) DO UPDATE SET last_seen=excluded.last_seen")
      .bind(deviceId, now).run();
    await env.DB.prepare("DELETE FROM app_presence WHERE last_seen < ?").bind(now - 600).run();
  }
  const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM app_presence WHERE last_seen >= ?").bind(now - 120).first();
  return json({ ok: true, count: Number(row && row.count || 0) });
}


async function installedPresence(request, env) {
  if (!env.DB) return json({ ok: false, error: "DB_INDISPONIBLE", count: 0 }, 503);
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS app_installs (
    device_id TEXT PRIMARY KEY,
    last_seen INTEGER NOT NULL
  )`).run();
  const now = Math.floor(Date.now() / 1000);
  const activeSince = now - (30 * 24 * 60 * 60);
  if (request.method === "POST") {
    const data = await body(request);
    const deviceId = String(data.deviceId || "").slice(0, 100);
    if (!deviceId) return json({ ok: false, error: "APPAREIL_INVALIDE" }, 400);
    await env.DB.prepare("INSERT INTO app_installs(device_id,last_seen) VALUES(?,?) ON CONFLICT(device_id) DO UPDATE SET last_seen=excluded.last_seen")
      .bind(deviceId, now).run();
  }
  await env.DB.prepare("DELETE FROM app_installs WHERE last_seen < ?").bind(activeSince).run();
  const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM app_installs WHERE last_seen >= ?").bind(activeSince).first();
  return json({ ok: true, count: Number(row && row.count || 0), activeDays: 30 });
}

async function adminInstalledPresence(request, env) {
  if (!(await adminAuthorized(request, env))) return json({ ok: false, error: "SECRET_INCORRECT" }, 401);
  if (!env.DB) return json({ ok: false, error: "DB_INDISPONIBLE", count: 0 }, 503);
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS app_installs (
    device_id TEXT PRIMARY KEY,
    last_seen INTEGER NOT NULL
  )`).run();
  const now = Math.floor(Date.now() / 1000);
  const activeSince = now - (30 * 24 * 60 * 60);
  await env.DB.prepare("DELETE FROM app_installs WHERE last_seen < ?").bind(activeSince).run();
  const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM app_installs WHERE last_seen >= ?").bind(activeSince).first();
  return json({ ok: true, count: Number(row && row.count || 0), activeDays: 30 });
}

async function downloadAutoradioApk() {
  const source = "https://raw.githubusercontent.com/stevesuzon/Carlplay-apk/main/LATEST-APK.apk";
  try {
    const upstream = await fetch(source, { headers: { "accept": "application/vnd.android.package-archive,application/octet-stream" } });
    if (!upstream.ok) return new Response("APK indisponible", { status: 502 });
    const headers = new Headers();
    headers.set("content-type", "application/vnd.android.package-archive");
    headers.set("content-disposition", 'attachment; filename="CarPlay-V5-Autoradio.apk"');
    headers.set("cache-control", "no-store");
    headers.set("access-control-allow-origin", "*");
    return new Response(upstream.body, { status: 200, headers });
  } catch (e) {
    return new Response("Téléchargement APK indisponible", { status: 502 });
  }
}

async function downloadRne(url) {
  const siren = String(url.searchParams.get("siren") || "").replace(/\D/g, "");
  if (!/^\d{9}$/.test(siren)) return json({ ok: false, error: "SIREN_INVALIDE" }, 400);
  const source = `https://data.inpi.fr/export/companies?format=pdf&ids=${encodeURIComponent(JSON.stringify([siren]))}`;
  try {
    const upstream = await fetch(source, { headers: { "accept": "application/pdf" } });
    const type = upstream.headers.get("content-type") || "";
    if (!upstream.ok || !type.toLowerCase().includes("pdf")) return json({ ok: false, error: "DOCUMENT_INDISPONIBLE" }, 502);
    return new Response(upstream.body, { status: 200, headers: { ...cors, "content-type": "application/pdf", "content-disposition": `attachment; filename="extrait-rne-${siren}.pdf"`, "cache-control": "no-store" } });
  } catch {
    return json({ ok: false, error: "SERVICE_INPI_INDISPONIBLE" }, 502);
  }
}

async function ensureMarketTable(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS imported_markets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fingerprint TEXT NOT NULL UNIQUE,
    country TEXT NOT NULL,
    area TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'marche',
    name TEXT NOT NULL,
    city TEXT NOT NULL DEFAULT '',
    day TEXT NOT NULL,
    hours TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    merchants TEXT NOT NULL DEFAULT '',
    draw TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
}

function cleanMarket(value, max = 240) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, max);
}

function normalizeMarket(input) {
  const country = cleanMarket(input.country || input.pays, 2).toUpperCase() === "BE" ? "BE" : "FR";
  const area = cleanMarket(input.area || input.department || input.departement || input.province, 80).toUpperCase();
  const kind = /brocante/i.test(cleanMarket(input.kind || input.type)) ? "brocante" : "marche";
  const name = cleanMarket(input.name || input.nom);
  const city = cleanMarket(input.city || input.ville || input.commune, 120);
  const day = cleanMarket(input.day || input.jour, 30).toLowerCase();
  const hours = cleanMarket(input.hours || input.horaires, 80);
  const address = cleanMarket(input.address || input.adresse, 240);
  const merchants = cleanMarket(input.merchants || input.commercants || input.nombre_commercants, 40);
  const draw = cleanMarket(input.draw || input.tirage || input.tirage_au_sort, 30);
  const note = cleanMarket(input.note || input.remarques, 500);
  if (!area || !name || !day) return null;
  const fingerprint = [country, area, kind, name, city, day].join("|").toLowerCase();
  return { fingerprint, country, area, kind, name, city, day, hours, address, merchants, draw, note };
}

const MARKET_FREE_UNTIL = Date.parse("2026-11-25T23:59:59+01:00");

async function marketAccessAllowed(request, env, data) {
  const deviceId = String(data.deviceId || "");
  if (!validDevice(deviceId)) return false;
  if (Date.now() <= MARKET_FREE_UNTIL && !data.code) return true;
  const code = normalizeCode(data.code);
  if (!validCode(code)) return false;
  const codeHash = await hashCode(code, env.CODE_PEPPER);
  const row = await env.DB.prepare("SELECT * FROM subscriptions WHERE code_hash = ? AND active = 1").bind(codeHash).first();
  if (!row) return false;
  if (!row.lifetime && (!row.expires_at || Date.parse(row.expires_at) <= Date.now())) return false;
  return row.phone_device === deviceId;
}

async function marketRateAllowed(request, env, deviceId) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS market_access_rate (
    bucket TEXT PRIMARY KEY,
    hits INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  )`).run();
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const hour = Math.floor(Date.now() / 3600000);
  const raw = `${ip}|${deviceId}|${hour}`;
  const bucket = await sha256Text(raw);
  await env.DB.prepare(`INSERT INTO market_access_rate(bucket,hits,updated_at) VALUES(?,1,?)
    ON CONFLICT(bucket) DO UPDATE SET hits=hits+1, updated_at=excluded.updated_at`).bind(bucket, Math.floor(Date.now()/1000)).run();
  const row = await env.DB.prepare("SELECT hits FROM market_access_rate WHERE bucket=?").bind(bucket).first();
  return Number(row && row.hits || 0) <= 120;
}

async function queryMarkets(request, env) {
  if (!env.DB) return json({ ok:false, error:"DB_INDISPONIBLE" },503);
  const data = await body(request);
  const country = cleanMarket(data.country,2).toUpperCase() === "BE" ? "BE" : "FR";
  const area = cleanMarket(data.area,80);
  const day = cleanMarket(data.day,30).toLowerCase();
  const deviceId = String(data.deviceId || "");
  if (!area || !["lundi","mardi","mercredi","jeudi","vendredi","samedi","dimanche"].includes(day)) return json({ok:false,error:"REQUETE_INVALIDE"},400);
  if (!(await marketAccessAllowed(request,env,data))) return json({ok:false,error:"ACCES_MARCHES_REFUSE"},403);
  if (!(await marketRateAllowed(request,env,deviceId))) return json({ok:false,error:"TROP_DE_REQUETES"},429);
  await ensureMarketTable(env);
  const result = await env.DB.prepare(`SELECT country,area,kind,name,city,day,hours,merchants,draw,note
    FROM imported_markets WHERE country=? AND area=? AND day=? ORDER BY city,name LIMIT 400`).bind(country,area,day).all();
  const markets=(result.results||[]).map(m=>({...m,typeLabel:m.kind==="brocante"?"Brocante":"Marché"}));
  return json({ok:true,markets});
}

async function listMarkets(request, env) {
  if (!(await adminAuthorized(request, env))) return json({ ok:false,error:"SECRET_INCORRECT" },401);
  await ensureMarketTable(env);
  const result = await env.DB.prepare("SELECT country,area,kind,name,city,day,hours,address,merchants,draw,note FROM imported_markets ORDER BY country,area,day,city,name").all();
  return json({ ok: true, markets: result.results || [] });
}

async function categoryMarkets(request, env) {
  if (!env.DB) return json({ ok:false, error:"DB_INDISPONIBLE" },503);
  const data = await body(request);
  const kind = cleanMarket(data.kind,20).toLowerCase();
  const deviceId = String(data.deviceId || "");
  if (!["noel","brocante"].includes(kind)) return json({ok:false,error:"REQUETE_INVALIDE"},400);
  if (!(await marketAccessAllowed(request,env,data))) return json({ok:false,error:"ACCES_MARCHES_REFUSE"},403);
  if (!(await marketRateAllowed(request,env,deviceId))) return json({ok:false,error:"TROP_DE_REQUETES"},429);
  await ensureMarketTable(env);
  const result = await env.DB.prepare(`SELECT country,area,kind,name,city,day,hours,address,merchants,draw,note
    FROM imported_markets WHERE country='BE' AND kind=? ORDER BY area,city,name,day LIMIT 1200`).bind(kind).all();
  return json({ok:true,markets:result.results||[]});
}

async function importMarkets(request, env) {
  if (!(await adminAuthorized(request, env))) return json({ ok: false, error: "SECRET_INCORRECT" }, 401);
  await ensureMarketTable(env);
  const payload = await body(request);
  const source = Array.isArray(payload) ? payload : payload.markets;
  if (!Array.isArray(source) || !source.length) return json({ ok: false, error: "AUCUN_MARCHE" }, 400);
  let added = 0, duplicates = 0, invalid = 0;
  const valid = [];
  for (const raw of source.slice(0, 5000)) {
    const m = normalizeMarket(raw);
    if (!m) { invalid++; continue; }
    valid.push(m);
  }
  for (let start = 0; start < valid.length; start += 100) {
    const statements = valid.slice(start, start + 100).map(m => env.DB.prepare(`INSERT OR IGNORE INTO imported_markets
      (fingerprint,country,area,kind,name,city,day,hours,address,merchants,draw,note)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(m.fingerprint,m.country,m.area,m.kind,m.name,m.city,m.day,m.hours,m.address,m.merchants,m.draw,m.note));
    const results = await env.DB.batch(statements);
    for (const item of results) {
      if (item.meta && item.meta.changes) added++; else duplicates++;
    }
  }
  return json({ ok: true, added, duplicates, invalid, total: source.length });
}

async function vigilanceForPlace(url) {
  const lat = Number(url.searchParams.get("lat")), lon = Number(url.searchParams.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return json({ ok: false, error: "POSITION_INVALIDE" }, 400);
  try {
    const geo = await fetch(`https://geo.api.gouv.fr/communes?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&fields=codeDepartement,departement&format=json`, { headers: { accept: "application/json", "user-agent": "CarPlay-Weather/1.0" } });
    const communes = geo.ok ? await geo.json() : [];
    const commune = Array.isArray(communes) && communes[0];
    const department = commune && commune.departement && commune.departement.nom || "";
    const code = commune && commune.codeDepartement || "";
    if (!department) return json({ ok: true, department: "", code: "", orangeThunderstorm: false });
    const feed = await fetch("https://feeds.meteoalarm.org/api/v1/warnings/feeds-france", { headers: { accept: "application/json", "user-agent": "CarPlay-Weather/1.0" }, cf: { cacheTtl: 300, cacheEverything: true } });
    if (!feed.ok) throw new Error("feed");
    const warnings = await feed.json();
    const fold = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const dep = fold(department);
    let yellowThunderstorm = false, orangeThunderstorm = false, redThunderstorm = false, floodRisk = false, floodLevel = "";
    for (const warning of warnings.warnings || []) for (const info of warning.alert && warning.alert.info || []) {
      if (!(info.area || []).some(area => fold(area.areaDesc) === dep)) continue;
      if (info.expires && Date.parse(info.expires) <= Date.now()) continue;
      const title = fold([info.event, info.headline, ...(info.parameter || []).map(p => p.value)].join(" "));
      if ((title.includes("orage") || title.includes("thunderstorm")) && title.includes("orange")) orangeThunderstorm = true;
      if ((title.includes("orage") || title.includes("thunderstorm")) && title.includes("red")) redThunderstorm = true;
      if ((title.includes("orage") || title.includes("thunderstorm")) && title.includes("yellow")) yellowThunderstorm = true;
      if (title.includes("inondation") || title.includes("crue") || title.includes("flood")) {
        floodRisk = true;
        if (title.includes("red") || title.includes("rouge")) floodLevel = "rouge";
        else if (!floodLevel || floodLevel === "jaune") floodLevel = title.includes("orange") ? "orange" : "jaune";
      }
    }
    return json({ ok: true, department, code, yellowThunderstorm, orangeThunderstorm: orangeThunderstorm || redThunderstorm, redThunderstorm, floodRisk, floodLevel }, 200);
  } catch (error) {
    return json({ ok: false, error: "VIGILANCE_INDISPONIBLE", detail: String(error && error.message || error).slice(0, 160) }, 502);
  }
}

class InjectAppFiles {
  element(element) {
    element.append('<link rel="manifest" href="/manifest.webmanifest"><link rel="stylesheet" href="/mobile-overrides.css?v=62"><link rel="stylesheet" href="/subscription-locks.css?v=62"><link rel="stylesheet" href="/home-work.css?v=62"><script src="/weather-all-pages.js?v=62" defer></script><script src="/subscription-web.js?v=62" defer></script><script src="/home-work.js?v=72" defer></script>', { html: true });
  }
}

class FixAndroidLinks {
  element(element) {
    const href = element.getAttribute("href") || "";
    const prefix = "file:///android_asset/";
    if (href.startsWith(prefix)) element.setAttribute("href", "/" + href.slice(prefix.length));
  }
}


export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (url.pathname === "/api/activate" && request.method === "POST") return activate(request, env);
    if (url.pathname === "/api/status" && request.method === "POST") return subscriptionStatus(request, env);
    if (url.pathname === "/api/presence" && (request.method === "GET" || request.method === "POST")) return presence(request, env);
    if (url.pathname === "/api/installed-presence" && request.method === "POST") return installedPresence(request, env);
    if (url.pathname === "/api/admin/installed-presence" && request.method === "GET") return adminInstalledPresence(request, env);
    if (url.pathname === "/api/admin/presence" && request.method === "GET") return adminPresenceStatus(env);
    if (url.pathname === "/api/admin/presence" && request.method === "POST") return adminPresenceAction(request, env);
    if (url.pathname === "/api/admin/subscriptions" && request.method === "POST") return createSubscription(request, env);
    if (url.pathname === "/api/admin/subscriptions/action" && request.method === "POST") return subscriptionAction(request, env);
    if (url.pathname === "/api/mail-event" && request.method === "POST") return recordMailEvent(request, env);
    if (url.pathname === "/api/admin/mail-counters" && request.method === "GET") return adminMailCounters(request, env);
    if (url.pathname === "/download-autoradio.apk" && request.method === "GET") return downloadAutoradioApk();
    if (url.pathname === "/api/rne-pdf" && request.method === "GET") return downloadRne(url);
    if (url.pathname === "/api/markets" && request.method === "GET") return listMarkets(request, env);
    if (url.pathname === "/api/markets/query" && request.method === "POST") return queryMarkets(request, env);
    if (url.pathname === "/api/markets/category" && request.method === "POST") return categoryMarkets(request, env);
    if (url.pathname === "/api/admin/markets/import" && request.method === "POST") return importMarkets(request, env);
    if (url.pathname === "/api/vigilance" && request.method === "GET") return vigilanceForPlace(url);
    // Laisser Cloudflare Static Assets résoudre "/" vers index.html.
    // Ne pas réécrire "/" en "/index.html" ici : avec html_handling automatique,
    // cela peut créer une boucle / <-> /index.html.
    let response = await env.ASSETS.fetch(request);
    if (url.pathname === "/sw.js" || url.pathname === "/app-version.json" || url.pathname === "/import-marches.html") {
      const h = new Headers(response.headers);
      h.set("cache-control", "no-store, no-cache, must-revalidate, max-age=0");
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers: h });
    }
    const type = response.headers.get("content-type") || "";
    if (type.includes("text/html") && url.pathname !== "/admin.html" && url.pathname !== "/admin" && url.pathname !== "/import-marches.html") {
      const transformed = new HTMLRewriter().on("head", new InjectAppFiles()).on("a", new FixAndroidLinks()).transform(response);
      const headers = new Headers(transformed.headers);
      headers.set("cache-control", "no-store, no-cache, must-revalidate");
      return new Response(transformed.body, { status: transformed.status, statusText: transformed.statusText, headers });
    }
    return response;
  }
};
