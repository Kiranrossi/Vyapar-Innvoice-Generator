import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { one, run } from './db.js';

// One PIN for the business. Entering it once marks the device as unlocked for a
// long time (signed cookie), so day to day there is no login screen.
// Changing the PIN rotates the secret, which locks every other device.
//
// A 4-digit PIN has only 10,000 values, so no hash makes a leaked copy hard to
// crack; the real protection is the attempt limit below. A salted SHA-256 is
// used because the free Workers plan allows very little CPU per request.

const COOKIE = 'invoice_session';
const MAX_AGE_DAYS = 400;
const DEFAULT_PIN = '2000';

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const randomHex = (bytes) => hex(crypto.getRandomValues(new Uint8Array(bytes)));
const sha256 = async (text) => hex(await crypto.subtle.digest('SHA-256', enc.encode(text)));

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(value)));
}

// Compare without leaking how many characters matched.
function sameText(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const authRow = (db) => one(db, 'SELECT pin_hash, auth_secret FROM business WHERE id = 1');

async function hashPin(pin) {
  const salt = randomHex(16);
  return `${salt}:${await sha256(`${salt}:${pin}`)}`;
}

async function pinMatches(pin, stored) {
  const [salt, hash] = (stored || '').split(':');
  if (!salt || !hash) return false;
  return sameText(await sha256(`${salt}:${pin}`), hash);
}

export async function setPin(db, pin) {
  await run(db, 'UPDATE business SET pin_hash = ?, auth_secret = ? WHERE id = 1', await hashPin(pin), randomHex(32));
}

let pinReady = false;
async function ensurePin(db) {
  if (pinReady) return;
  const row = await authRow(db);
  if (!row.pin_hash) await setPin(db, DEFAULT_PIN);
  pinReady = true;
}

async function makeToken(db) {
  const issued = String(Date.now());
  return `${issued}.${await hmac((await authRow(db)).auth_secret, issued)}`;
}

async function tokenValid(db, token) {
  const [issued, sig] = String(token || '').split('.');
  if (!issued || !sig) return false;
  if (Date.now() - Number(issued) > MAX_AGE_DAYS * 86400000) return false;
  const row = await authRow(db);
  if (!row.auth_secret) return false;
  return sameText(await hmac(row.auth_secret, issued), sig);
}

const cookieOptions = { path: '/', httpOnly: true, secure: true, sameSite: 'Lax', maxAge: MAX_AGE_DAYS * 86400 };
const unlockDevice = async (c) => setCookie(c, COOKIE, await makeToken(c.env.DB), cookieOptions);

export async function requireAuth(c, next) {
  await ensurePin(c.env.DB);
  if (await tokenValid(c.env.DB, getCookie(c, COOKIE))) return next();
  return c.json({ error: 'Enter your PIN to continue', locked: true }, 401);
}

// ---------- Wrong-PIN limits (stored in D1: Workers keep no memory between requests) ----------

const clientIp = (c) => c.req.header('CF-Connecting-IP') || 'local';

async function lockedFor(db, ip) {
  const now = Date.now();
  const all = await one(db, "SELECT count, window_start FROM auth_failures WHERE key = '*'");
  if (all && now - all.window_start < 3600000 && all.count >= 30) return 15 * 60;
  const f = await one(db, 'SELECT until FROM auth_failures WHERE key = ?', ip);
  return f && f.until > now ? Math.ceil((f.until - now) / 1000) : 0;
}

// 5 wrong tries: wait 1 minute, then 5, then 15, then 60.
async function recordFailure(db, ip) {
  const now = Date.now();
  const f = (await one(db, 'SELECT count FROM auth_failures WHERE key = ?', ip)) || { count: 0 };
  const count = f.count + 1;
  const until = count % 5 === 0 ? now + [1, 5, 15, 60][Math.min(count / 5 - 1, 3)] * 60000 : 0;
  await db.batch([
    db.prepare(`INSERT INTO auth_failures (key, count, until, window_start) VALUES (?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET count = excluded.count, until = excluded.until`).bind(ip, count, until, now),
    db.prepare(`INSERT INTO auth_failures (key, count, until, window_start) VALUES ('*', 1, 0, ?)
      ON CONFLICT(key) DO UPDATE SET
        count = CASE WHEN ? - window_start > 3600000 THEN 1 ELSE count + 1 END,
        window_start = CASE WHEN ? - window_start > 3600000 THEN ? ELSE window_start END`).bind(now, now, now, now),
  ]);
  return 5 - (count % 5);
}

export const authRoutes = new Hono();

authRoutes.get('/status', async (c) => {
  await ensurePin(c.env.DB);
  return c.json({ unlocked: await tokenValid(c.env.DB, getCookie(c, COOKIE)) });
});

authRoutes.post('/unlock', async (c) => {
  const db = c.env.DB;
  await ensurePin(db);
  const ip = clientIp(c);
  const wait = await lockedFor(db, ip);
  if (wait) {
    return c.json({ error: `Too many wrong PINs. Try again in ${wait > 90 ? Math.ceil(wait / 60) + ' minutes' : wait + ' seconds'}.` }, 429);
  }
  const body = await c.req.json().catch(() => ({}));
  if (!(await pinMatches(String(body.pin ?? ''), (await authRow(db)).pin_hash))) {
    const left = await recordFailure(db, ip);
    const msg = left === 5 ? 'Wrong PIN. Please wait a minute before trying again.' : `Wrong PIN. ${left} ${left === 1 ? 'try' : 'tries'} left.`;
    return c.json({ error: msg }, 401);
  }
  await run(db, 'DELETE FROM auth_failures WHERE key = ?', ip);
  await unlockDevice(c);
  return c.json({ unlocked: true });
});

authRoutes.post('/lock', (c) => {
  deleteCookie(c, COOKIE, { path: '/', secure: true });
  return c.json({ unlocked: false });
});

authRoutes.put('/pin', requireAuth, async (c) => {
  const db = c.env.DB;
  const { current, next } = await c.req.json().catch(() => ({}));
  if (!(await pinMatches(String(current ?? ''), (await authRow(db)).pin_hash))) return c.json({ error: 'Current PIN is wrong' }, 400);
  if (!/^\d{4,8}$/.test(String(next ?? ''))) return c.json({ error: 'New PIN must be 4 to 8 digits' }, 400);
  await setPin(db, String(next));
  await unlockDevice(c);
  return c.json({ ok: true });
});
