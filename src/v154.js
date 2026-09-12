import baseWorker from "./index.js";

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization"
};

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { ...cors, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});

async function body(request) {
  try { return await request.json(); } catch (_) { return {}; }
}

function normalizeCode(value) {
  return String(value || "").toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/[OI]/g, c => ({ O: "Q", I: "L" }[c]))
    .slice(0, 6);
}
function validCode(value) { return /^[A-HJ-NP-Z0-9]{6}$/.test(normalizeCode(value)); }
function validDevice(value) { return /^[a-zA-Z0-9._:-]{8,128}$/.test(String(value || "").trim()); }
function normalizeEmail(value) { return String(value || "").trim().toLowerCase().slice(0, 254); }
function validEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value); }

async function sha256Text(value) {
  const bytes = new TextEncoder().encode(String(value || ""));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, "0")).join("");
}

async function hashCode(code, pepper) {
  const bytes = new TextEncoder().encode(`${pepper}:${code}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, "0")).join("");
}

async function ensureSubscriptionEmailColumns(env) {
  try { await env.DB.prepare("ALTER TABLE subscriptions ADD COLUMN recovery_email_hash TEXT").run(); } catch (_) {}
  try { await env.DB.prepare("ALTER TABLE subscriptions ADD COLUMN recovery_email_mask TEXT").run(); } catch (_) {}
  try { await env.DB.prepare("ALTER TABLE subscriptions ADD COLUMN recovery_code_box TEXT").run(); } catch (_) {}
  try { await env.DB.prepare("ALTER TABLE subscriptions ADD COLUMN last_recovery_sent_at INTEGER").run(); } catch (_) {}
}

async function activeEmailOwner(env, emailHash, exceptId) {
  const rows = await env.DB.prepare("SELECT id,lifetime,expires_at,active FROM subscriptions WHERE recovery_email_hash=? AND id<>? AND active=1")
    .bind(emailHash, exceptId || -1).all();
  const now = Date.now();
  return (rows.results || []).find(r => !!r.lifetime || (r.expires_at && Date.parse(r.expires_at) > now)) || null;
}

async function updateSubscriptionEmailV154(request, env) {
  if (!env.DB) return json({ ok: false, error: "DB_INDISPONIBLE" }, 503);
  await ensureSubscriptionEmailColumns(env);
  const data = await body(request);
  const email = normalizeEmail(data.email);
  const deviceId = String(data.deviceId || "").trim();
  const code = normalizeCode(data.code);

  if (!validEmail(email)) return json({ ok: false, error: "EMAIL_OBLIGATOIRE" }, 400);
  if (!validDevice(deviceId)) return json({ ok: false, error: "DONNEES_INVALIDES" }, 400);

  let row = await env.DB.prepare("SELECT * FROM subscriptions WHERE active=1 AND (phone_device=? OR autoradio_device=?) LIMIT 1")
    .bind(deviceId, deviceId).first();

  if (!row && validCode(code)) {
    const codeHash = await hashCode(code, env.CODE_PEPPER);
    const byCode = await env.DB.prepare("SELECT * FROM subscriptions WHERE active=1 AND code_hash=? LIMIT 1")
      .bind(codeHash).first();
    if (byCode) {
      if (!byCode.lifetime && (!byCode.expires_at || Date.parse(byCode.expires_at) <= Date.now())) {
        return json({ ok: false, error: "ABONNEMENT_EXPIRE" }, 403);
      }
      if (byCode.phone_device && byCode.phone_device !== deviceId && byCode.autoradio_device !== deviceId) {
        return json({ ok: false, error: "APPAREIL_REMPLACE" }, 409);
      }
      if (!byCode.phone_device) {
        await env.DB.prepare("UPDATE subscriptions SET phone_device=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
          .bind(deviceId, byCode.id).run();
      }
      row = byCode;
    }
  }

  if (!row) return json({ ok: false, error: "COMPTE_ABONNEMENT_INTROUVABLE" }, 403);
  if (!row.lifetime && (!row.expires_at || Date.parse(row.expires_at) <= Date.now())) {
    return json({ ok: false, error: "ABONNEMENT_EXPIRE" }, 403);
  }

  const emailHash = await sha256Text(email);
  const owner = await activeEmailOwner(env, emailHash, row.id);
  if (owner) return json({ ok: false, error: "EMAIL_DEJA_UTILISEE" }, 409);

  await env.DB.prepare("UPDATE subscriptions SET recovery_email_hash=?,recovery_email_mask=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
    .bind(emailHash, email, row.id).run();

  return json({ ok: true, email, subscriptionId: row.id });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/subscription-email" && request.method === "POST") {
      return updateSubscriptionEmailV154(request, env);
    }
    return baseWorker.fetch(request, env, ctx);
  }
};
