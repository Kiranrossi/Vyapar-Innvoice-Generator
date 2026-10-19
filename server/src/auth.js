import { Router } from 'express';
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { db } from './db.js';

// One PIN for the business. Entering it once marks the device as unlocked
// for a long time (cookie), so day to day there is no login screen.
// Changing the PIN rotates the secret, which locks every device again.

const COOKIE = 'invoice_session';
const MAX_AGE_DAYS = 400;
const DEFAULT_PIN = '2000';

const row = () => db.prepare('SELECT pin_hash, auth_secret FROM business WHERE id = 1').get();

function hashPin(pin) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(pin, salt, 32).toString('hex')}`;
}

function pinMatches(pin, stored) {
  const [salt, hash] = (stored || '').split(':');
  if (!salt || !hash) return false;
  const given = scryptSync(String(pin), salt, 32);
  return timingSafeEqual(given, Buffer.from(hash, 'hex'));
}

export function setPin(pin) {
  db.prepare('UPDATE business SET pin_hash = ?, auth_secret = ? WHERE id = 1').run(hashPin(pin), randomBytes(32).toString('hex'));
}

export function initAuth() {
  if (!row().pin_hash) setPin(process.env.DEFAULT_PIN || DEFAULT_PIN);
}

const sign = (value, secret) => createHmac('sha256', secret).update(value).digest('hex');

function makeToken() {
  const issued = String(Date.now());
  return `${issued}.${sign(issued, row().auth_secret)}`;
}

function tokenValid(token) {
  const [issued, sig] = String(token || '').split('.');
  if (!issued || !sig) return false;
  if (Date.now() - Number(issued) > MAX_AGE_DAYS * 86400000) return false;
  const expected = Buffer.from(sign(issued, row().auth_secret));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

function readCookie(req) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return decodeURIComponent(v.join('='));
  }
  return '';
}

function setCookie(req, res, value, maxAgeSeconds) {
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`);
}

export function requireAuth(req, res, next) {
  if (tokenValid(readCookie(req))) return next();
  res.status(401).json({ error: 'Enter your PIN to continue', locked: true });
}

// A 4-digit PIN can be guessed by trying them all, so wrong attempts are limited
// per device (IP) and across all devices.
const failures = new Map();
let globalFails = [];

function lockedFor(ip) {
  const now = Date.now();
  globalFails = globalFails.filter((t) => now - t < 60 * 60 * 1000);
  if (globalFails.length >= 30) return 15 * 60;
  const f = failures.get(ip);
  if (f && f.until > now) return Math.ceil((f.until - now) / 1000);
  return 0;
}

function recordFailure(ip) {
  const now = Date.now();
  globalFails.push(now);
  const f = failures.get(ip) || { count: 0, until: 0 };
  f.count += 1;
  // 5 wrong tries: wait 1 minute, then 5, then 15...
  if (f.count % 5 === 0) f.until = now + [1, 5, 15, 60][Math.min(f.count / 5 - 1, 3)] * 60 * 1000;
  failures.set(ip, f);
  return 5 - (f.count % 5);
}

export const authRoutes = Router();

authRoutes.get('/status', (req, res) => res.json({ unlocked: tokenValid(readCookie(req)) }));

authRoutes.post('/unlock', (req, res) => {
  const wait = lockedFor(req.ip);
  if (wait) return res.status(429).json({ error: `Too many wrong PINs. Try again in ${wait > 90 ? Math.ceil(wait / 60) + ' minutes' : wait + ' seconds'}.` });
  if (!pinMatches(String(req.body?.pin ?? ''), row().pin_hash)) {
    const left = recordFailure(req.ip);
    const msg = left === 5 ? 'Wrong PIN. Please wait a minute before trying again.' : `Wrong PIN. ${left} ${left === 1 ? 'try' : 'tries'} left.`;
    return res.status(401).json({ error: msg });
  }
  failures.delete(req.ip);
  setCookie(req, res, makeToken(), MAX_AGE_DAYS * 86400);
  res.json({ unlocked: true });
});

authRoutes.post('/lock', (req, res) => {
  setCookie(req, res, '', 0);
  res.json({ unlocked: false });
});

authRoutes.put('/pin', requireAuth, (req, res) => {
  const { current, next } = req.body || {};
  if (!pinMatches(String(current ?? ''), row().pin_hash)) return res.status(400).json({ error: 'Current PIN is wrong' });
  if (!/^\d{4,8}$/.test(String(next ?? ''))) return res.status(400).json({ error: 'New PIN must be 4 to 8 digits' });
  setPin(String(next));
  setCookie(req, res, makeToken(), MAX_AGE_DAYS * 86400);
  res.json({ ok: true });
});
