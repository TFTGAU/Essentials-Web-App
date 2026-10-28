import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { OAuth2Client } from 'google-auth-library';
import { db, now, dataDir } from './db.js';

const list = (v) =>
  (v || '')
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

export const config = {
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  allowedEmails: list(process.env.ALLOWED_EMAILS),
  adminEmails: list(process.env.ADMIN_EMAILS),
  allowedDomains: list(process.env.ALLOWED_DOMAINS),
  sessionHours: Number(process.env.SESSION_HOURS || 12),
  devLogin: process.env.DEV_LOGIN === 'true',
};

if (config.devLogin && process.env.NODE_ENV === 'production') {
  console.error('DEV_LOGIN cannot be enabled when NODE_ENV=production. Refusing to start.');
  process.exit(1);
}

// Session secret: SESSION_SECRET if set, otherwise one generated on first start
// and kept in the data folder so sign-ins survive restarts.
let secret = process.env.SESSION_SECRET;
if (secret) {
  if (secret.length < 32) {
    console.error('SESSION_SECRET must be at least 32 characters (or leave it unset to have one generated). Refusing to start.');
    process.exit(1);
  }
} else {
  secret = loadOrCreateSecret();
}

function loadOrCreateSecret() {
  const file = path.join(dataDir, 'session-secret');
  try {
    const saved = fs.readFileSync(file, 'utf8').trim();
    if (saved.length >= 32) return saved;
  } catch {
    /* not created yet */
  }
  const fresh = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(file, `${fresh}\n`, { mode: 0o600 });
  console.log(`Generated a session secret and saved it to ${file}`);
  return fresh;
}

/** Seed users from env on every start so env changes take effect. */
export function syncEnvUsers() {
  const envEmails = new Set([...config.allowedEmails, ...config.adminEmails]);
  for (const email of envEmails) {
    const isAdmin = config.adminEmails.includes(email) ? 1 : 0;
    db.prepare(
      `INSERT INTO users (email, is_admin, source, added_by) VALUES (?, ?, 'env', 'environment')
       ON CONFLICT(email) DO UPDATE SET is_admin = excluded.is_admin, source = 'env'`
    ).run(email, isAdmin);
  }
  // The environment is the source of truth for env users: drop any no longer listed.
  const rows = db.prepare(`SELECT email FROM users WHERE source = 'env'`).all();
  for (const { email } of rows) {
    if (!envEmails.has(email)) db.prepare(`DELETE FROM users WHERE email = ?`).run(email);
  }
}

/** Returns the user row if the email is allowed to sign in, else null. */
export function findAllowedUser(email, hostedDomain) {
  email = email.toLowerCase();
  let user = db.prepare(`SELECT * FROM users WHERE email = ?`).get(email);
  if (user) return user;
  const domain = email.split('@')[1];
  // Domain-wide access requires Google to confirm the Workspace domain (hd claim).
  if (config.allowedDomains.length && hostedDomain && domain === hostedDomain.toLowerCase() && config.allowedDomains.includes(domain)) {
    db.prepare(`INSERT INTO users (email, source, added_by) VALUES (?, 'domain', 'domain rule')`).run(email);
    return db.prepare(`SELECT * FROM users WHERE email = ?`).get(email);
  }
  return null;
}

const googleClient = new OAuth2Client();

export async function verifyGoogleCredential(credential) {
  const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: config.googleClientId });
  const p = ticket.getPayload();
  if (!p?.email || !p.email_verified) throw new Error('Google account email is not verified');
  return { email: p.email.toLowerCase(), name: p.name || '', picture: p.picture || '', hd: p.hd || '' };
}

// ---- Server-side sessions -------------------------------------------------
// The cookie holds a random 256-bit token. The database stores only an HMAC of
// it, so a copied database can't be used to sign in, and changing
// SESSION_SECRET signs everyone out.

const COOKIE = 'ee_session';

const hashToken = (token) => crypto.createHmac('sha256', secret).update(token).digest('hex');

export function setSession(res, email) {
  const token = crypto.randomBytes(32).toString('base64url');
  const created = new Date();
  const expires = new Date(created.getTime() + config.sessionHours * 3600_000);
  db.prepare(`DELETE FROM sessions WHERE expires_at < ?`).run(created.toISOString());
  db.prepare(`INSERT INTO sessions (token_hash, email, created_at, expires_at) VALUES (?, ?, ?, ?)`).run(
    hashToken(token),
    email,
    created.toISOString(),
    expires.toISOString()
  );
  // Secure when the request came over HTTPS. Behind a proxy that needs TRUST_PROXY.
  res.cookie(COOKIE, token, {
    httpOnly: true,
    secure: res.req.secure,
    sameSite: 'lax',
    maxAge: config.sessionHours * 3600_000,
    path: '/',
  });
}

export function clearSession(res) {
  res.clearCookie(COOKIE, { path: '/', httpOnly: true, secure: res.req.secure, sameSite: 'lax' });
}

function readCookie(req) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) {
      try {
        return decodeURIComponent(v.join('='));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Ends the session in the request's cookie, on the server as well as in the browser. */
export function endSession(req, res) {
  const token = readCookie(req);
  if (token) db.prepare(`DELETE FROM sessions WHERE token_hash = ?`).run(hashToken(token));
  clearSession(res);
}

export function endAllSessions(email) {
  db.prepare(`DELETE FROM sessions WHERE email = ?`).run(email);
}

function readSession(req) {
  const token = readCookie(req);
  if (!token || token.length > 100) return null;
  const row = db.prepare(`SELECT email, expires_at FROM sessions WHERE token_hash = ?`).get(hashToken(token));
  if (!row || row.expires_at < now()) return null;
  return { email: row.email, key: hashToken(token) };
}

/** Requires a valid session for a user that is still on the allowlist. */
export function requireUser(req, res, next) {
  const session = readSession(req);
  const user = session && db.prepare(`SELECT * FROM users WHERE email = ?`).get(session.email);
  if (!user) {
    // Only clear a cookie that was actually sent
    if (readCookie(req)) clearSession(res);
    return res.status(401).json({ error: 'Not signed in' });
  }
  req.user = user;
  req.sessionKey = session.key;
  next();
}

// ---- Rate limiting -----------------------------------------------------------
// Fixed-window counters held in memory (one app instance). Behind a reverse
// proxy, set TRUST_PROXY so req.ip is the real client address.

const buckets = new Map();
setInterval(() => {
  const t = Date.now();
  for (const [k, b] of buckets) if (b.reset < t) buckets.delete(k);
}, 60_000).unref();

function hit(key, limit, windowMs) {
  const t = Date.now();
  let b = buckets.get(key);
  if (!b || b.reset < t) {
    b = { count: 0, reset: t + windowMs };
    buckets.set(key, b);
  }
  b.count++;
  return { over: b.count > limit, retryAfter: Math.ceil((b.reset - t) / 1000) };
}

function peek(key, limit) {
  const b = buckets.get(key);
  return b && b.reset > Date.now() && b.count >= limit ? Math.ceil((b.reset - Date.now()) / 1000) : 0;
}

function tooMany(res, retryAfter, message) {
  res.set('Retry-After', String(retryAfter));
  return res.status(429).json({ error: message });
}

const AUTH_FAILS = Number(process.env.AUTH_FAIL_LIMIT || 20); // failed sign-ins per IP per 15 minutes
const AUTH_WINDOW = 15 * 60_000;

/** Blocks sign-in attempts from an address that has failed too often recently. */
export function authLimiter(req, res, next) {
  const wait = peek(`authfail:${req.ip}`, AUTH_FAILS);
  if (wait) return tooMany(res, wait, 'Too many failed sign-in attempts. Try again later.');
  // Count the attempt as failed unless it ends in success
  res.on('finish', () => {
    if (res.statusCode >= 400) {
      hit(`authfail:${req.ip}`, AUTH_FAILS, AUTH_WINDOW);
      console.warn(`Failed sign-in from ${req.ip} (${res.statusCode})`);
    }
  });
  next();
}

const IP_LIMIT = Number(process.env.IP_RATE_LIMIT || 1200); // API requests per IP per minute
const USER_LIMIT = Number(process.env.USER_RATE_LIMIT || 600); // API requests per session per minute

export function ipLimiter(req, res, next) {
  const r = hit(`ip:${req.ip}`, IP_LIMIT, 60_000);
  if (r.over) return tooMany(res, r.retryAfter, 'Too many requests. Slow down.');
  next();
}

export function userLimiter(req, res, next) {
  const r = hit(`user:${req.sessionKey}`, USER_LIMIT, 60_000);
  if (r.over) return tooMany(res, r.retryAfter, 'Too many requests. Slow down.');
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user?.is_admin) return res.status(403).json({ error: 'Admin only' });
  next();
}

/** Simple CSRF guard: state-changing requests must be JSON with a custom header. */
export function csrfGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-requested-with') !== 'essentials-app') return res.status(403).json({ error: 'Bad request origin' });
  next();
}

export function recordLogin(email, profile = {}) {
  db.prepare(`UPDATE users SET last_login = ?, name = COALESCE(NULLIF(?, ''), name), picture = COALESCE(NULLIF(?, ''), picture) WHERE email = ?`).run(
    now(),
    profile.name || '',
    profile.picture || '',
    email
  );
}
