import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, now, tx } from './db.js';
import {
  config,
  syncEnvUsers,
  findAllowedUser,
  verifyGoogleCredential,
  setSession,
  requireUser,
  requireAdmin,
  csrfGuard,
  recordLogin,
  endSession,
  endAllSessions,
  authLimiter,
  ipLimiter,
  userLimiter,
} from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frameworkPath = process.env.FRAMEWORK_PATH || path.join(__dirname, '..', 'data', 'framework.json');
const frameworkRaw = fs.readFileSync(frameworkPath, 'utf8');
const framework = JSON.parse(frameworkRaw);

// ---- Lookups used to validate saved answers -------------------------------
const domainNames = new Set(framework.domains.map((d) => d.name));
const actionKeys = new Set();
const igpKeys = new Set();
for (const d of framework.domains)
  for (const p of d.principles)
    for (const a of p.actions) {
      actionKeys.add(`${d.name}|${a.id}`);
      for (const i of a.indicators) igpKeys.add(`${d.name}|${i.id}`);
    }
const strategies = new Set(framework.e8.strategies);
const ismIds = new Set(framework.e8.controls.map((c) => c.id));

const RATINGS = ['Not assessed', 'Not effective', 'Partially effective', 'Fully effective'];
const IGP_VALUES = ['Not assessed', 'Yes', 'No'];
const LEVELS = ['ML0', 'ML1', 'ML2', 'ML3'];
const OVERRIDES = ['', 'Not assessed', 'Effective', 'Alternate control', 'Ineffective', 'No visibility', 'Not implemented', 'Not applicable'];
const MAX_TEXT = 20000;
const MAX_LINKS = 25;

/** Accept only absolute http(s) URLs, so links can never run script (javascript:, data:, etc.). */
function safeUrl(v) {
  if (typeof v !== 'string' || !v.trim() || v.length > 2000) throw new Error('Enter a valid link');
  let u;
  try {
    u = new URL(v.trim());
  } catch {
    throw new Error('Enter a full link starting with https://');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Only http and https links are allowed');
  return u.href;
}

const cleanTitle = (v) => (typeof v === 'string' ? v.trim().slice(0, 200) : '');
const newLinkId = () => crypto.randomBytes(6).toString('hex');

/** A full list of links (used by backup restore). */
function cleanLinks(v) {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length > MAX_LINKS) throw new Error(`Up to ${MAX_LINKS} links per item`);
  return v.map((l) => ({
    id: typeof l?.id === 'string' && /^[a-z0-9]{1,24}$/.test(l.id) ? l.id : newLinkId(),
    url: safeUrl(l?.url),
    title: cleanTitle(l?.title),
    addedBy: typeof l?.addedBy === 'string' ? l.addedBy.slice(0, 200) : '',
    addedAt: typeof l?.addedAt === 'string' ? l.addedAt.slice(0, 40) : '',
  }));
}

/** Link operations shared by actions and indicators. */
function linkOps(data) {
  return {
    links: cleanLinks(data.links),
    addLink: data.addLink === undefined ? undefined : { url: safeUrl(data.addLink?.url), title: cleanTitle(data.addLink?.title) },
    removeLink: data.removeLink === undefined ? undefined : String(data.removeLink).slice(0, 24),
  };
}

function cleanText(v) {
  if (v === undefined) return undefined;
  if (typeof v !== 'string') throw new Error('Text fields must be strings');
  if (v.length > MAX_TEXT) throw new Error('Text too long');
  return v;
}

function oneOf(v, allowed, field) {
  if (v === undefined) return undefined;
  if (!allowed.includes(v)) throw new Error(`Invalid ${field}`);
  return v;
}

/** Validate one response and return the cleaned data fields to merge. */
function validateResponse({ kind, domain = '', itemId, data = {} }) {
  if (typeof data !== 'object' || data === null) throw new Error('Invalid data');
  switch (kind) {
    case 'action':
      if (!actionKeys.has(`${domain}|${itemId}`)) throw new Error('Unknown action');
      return { rating: oneOf(data.rating, RATINGS, 'rating'), reasoning: cleanText(data.reasoning), evidence: cleanText(data.evidence), ...linkOps(data) };
    case 'igp':
      if (!igpKeys.has(`${domain}|${itemId}`)) throw new Error('Unknown indicator');
      return { present: oneOf(data.present, IGP_VALUES, 'value'), reasoning: cleanText(data.reasoning), evidence: cleanText(data.evidence), ...linkOps(data) };
    case 'e8level':
      if (domain !== '' || !strategies.has(itemId)) throw new Error('Unknown strategy');
      return { level: oneOf(data.level, LEVELS, 'level') };
    case 'e8override':
      if (domain !== '' || !ismIds.has(itemId)) throw new Error('Unknown ISM control');
      return { override: oneOf(data.override, OVERRIDES, 'override'), notes: cleanText(data.notes) };
    default:
      throw new Error('Unknown response kind');
  }
}

function upsertResponse(assessmentId, r, email) {
  const fields = validateResponse(r);
  const domain = r.domain || '';
  const existing = db
    .prepare(`SELECT data FROM responses WHERE assessment_id = ? AND kind = ? AND domain = ? AND item_id = ?`)
    .get(assessmentId, r.kind, domain, r.itemId);
  const merged = { ...(existing ? JSON.parse(existing.data) : {}) };
  const { addLink, removeLink, ...plain } = fields;
  for (const [k, v] of Object.entries(plain)) if (v !== undefined) merged[k] = v;
  const ts = now();
  // Link changes apply to the stored list, so two people adding links at once both keep theirs
  if (removeLink !== undefined) merged.links = (merged.links || []).filter((l) => l.id !== removeLink);
  if (addLink !== undefined) {
    const links = merged.links || [];
    if (links.length >= MAX_LINKS) throw new Error(`Up to ${MAX_LINKS} links per item`);
    merged.links = [...links, { id: newLinkId(), ...addLink, addedBy: email, addedAt: ts }];
  }
  db.prepare(
    `INSERT INTO responses (assessment_id, kind, domain, item_id, data, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(assessment_id, kind, domain, item_id) DO UPDATE SET data = excluded.data, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
  ).run(assessmentId, r.kind, domain, r.itemId, JSON.stringify(merged), email, ts);
  return { kind: r.kind, domain, itemId: r.itemId, data: merged, updatedBy: email, updatedAt: ts };
}

const rowToResponse = (r) => ({ kind: r.kind, domain: r.domain, itemId: r.item_id, data: JSON.parse(r.data), updatedBy: r.updated_by, updatedAt: r.updated_at });
const rowToAssessment = (a) => a && { ...a, scope: JSON.parse(a.scope), archived: !!a.archived };

function touchAssessment(id, email) {
  db.prepare(`UPDATE assessments SET updated_at = ?, updated_by = ? WHERE id = ?`).run(now(), email, id);
}

// ---- App -------------------------------------------------------------------
syncEnvUsers();
ensureAssessment();
const app = express();
app.disable('x-powered-by');
// TRUST_PROXY: a hop count (e.g. 1), 'true', or proxy IPs/subnets. Default trusts only localhost.
const trustProxy = process.env.TRUST_PROXY || 'loopback';
app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy === 'true' ? true : trustProxy);

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    // Google Identity Services needs its script, frames and styles from accounts.google.com
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self' https://accounts.google.com/gsi/client",
      "frame-src https://accounts.google.com/gsi/",
      "connect-src 'self' https://accounts.google.com/gsi/",
      "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style",
      "img-src 'self' data: https://*.googleusercontent.com",
      "frame-ancestors 'none'",
    ].join('; '),
    // Lets the Google sign-in popup talk back to this page
    'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  });
  // Tell browsers to only ever use HTTPS for this site (ignored over plain http)
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=15552000');
  next();
});
app.use('/api', ipLimiter);
app.use(express.json({ limit: '10mb' }));
app.use('/api', csrfGuard);

const api = express.Router();

api.get('/health', (req, res) => res.json({ ok: true }));

api.get('/config', (req, res) => res.json({ googleClientId: config.googleClientId, devLogin: config.devLogin }));

api.post('/auth/google', authLimiter, async (req, res) => {
  if (!config.googleClientId) return res.status(500).json({ error: 'GOOGLE_CLIENT_ID is not configured on the server' });
  let profile;
  try {
    profile = await verifyGoogleCredential(req.body?.credential);
  } catch (err) {
    return res.status(401).json({ error: 'Google sign-in could not be verified' });
  }
  const user = findAllowedUser(profile.email, profile.hd);
  if (!user) {
    console.warn(`Sign-in refused for ${profile.email} (not on allowlist)`);
    return res.status(403).json({ error: `${profile.email} is not authorised to use this app. Ask an administrator to add you.` });
  }
  recordLogin(user.email, profile);
  setSession(res, user.email);
  res.json({ ok: true });
});

if (config.devLogin) {
  console.warn('DEV_LOGIN is enabled: anyone on the allowlist can sign in without Google. Do not use in production.');
  api.post('/auth/dev', authLimiter, (req, res) => {
    const user = findAllowedUser(String(req.body?.email || ''), '');
    if (!user) return res.status(403).json({ error: 'Email not on allowlist' });
    recordLogin(user.email);
    setSession(res, user.email);
    res.json({ ok: true });
  });
}

api.post('/auth/logout', (req, res) => {
  endSession(req, res);
  res.json({ ok: true });
});

// Everything below requires sign-in
api.use(requireUser);
api.use(userLimiter);

api.get('/me', (req, res) => {
  const { email, name, picture, is_admin } = req.user;
  res.json({ email, name, picture, isAdmin: !!is_admin });
});

api.get('/framework', (req, res) => {
  res.type('application/json').set('Cache-Control', 'private, max-age=3600').send(frameworkRaw);
});

// -- The assessment (one per deployment)
function getAssessment() {
  return db.prepare(`SELECT * FROM assessments ORDER BY id LIMIT 1`).get();
}

function ensureAssessment() {
  if (getAssessment()) return;
  const name = (process.env.ORG_NAME || 'Our organisation').slice(0, 200);
  db.prepare(`INSERT INTO assessments (name, created_by, updated_by) VALUES (?, 'system', 'system')`).run(name);
}

function loadAssessment(req, res, next) {
  req.assessment = getAssessment();
  next();
}

api.get('/assessment', loadAssessment, (req, res) => {
  const responses = db.prepare(`SELECT * FROM responses WHERE assessment_id = ?`).all(req.assessment.id).map(rowToResponse);
  res.json({ assessment: rowToAssessment(req.assessment), responses, serverTime: now() });
});

// Changes since a timestamp, so open browsers can pick up teammates' edits
api.get('/assessment/changes', loadAssessment, (req, res) => {
  const since = String(req.query.since || '');
  const responses = db
    .prepare(`SELECT * FROM responses WHERE assessment_id = ? AND updated_at >= ?`)
    .all(req.assessment.id, since)
    .map(rowToResponse);
  res.json({ assessment: rowToAssessment(req.assessment), responses, serverTime: now() });
});

api.patch('/assessment', loadAssessment, (req, res) => {
  const a = req.assessment;
  const b = req.body || {};
  const name = b.name !== undefined ? String(b.name).trim().slice(0, 200) : a.name;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const description = b.description !== undefined ? String(b.description).slice(0, 2000) : a.description;
  let scope = a.scope;
  if (b.scope !== undefined) {
    if (!Array.isArray(b.scope) || !b.scope.every((s) => domainNames.has(s))) return res.status(400).json({ error: 'Invalid scope' });
    scope = JSON.stringify(b.scope);
  }
  db.prepare(`UPDATE assessments SET name = ?, description = ?, scope = ?, updated_at = ?, updated_by = ? WHERE id = ?`).run(
    name,
    description,
    scope,
    now(),
    req.user.email,
    a.id
  );
  res.json(rowToAssessment(getAssessment()));
});

api.put('/assessment/responses', loadAssessment, (req, res) => {
  const items = Array.isArray(req.body) ? req.body : [req.body];
  if (items.length > 5000) return res.status(400).json({ error: 'Too many items' });
  try {
    const saved = tx(() => items.map((r) => upsertResponse(req.assessment.id, r, req.user.email)));
    touchAssessment(req.assessment.id, req.user.email);
    res.json(saved);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Replace all answers with the contents of a JSON backup (admins only)
api.post('/assessment/restore', requireAdmin, loadAssessment, (req, res) => {
  const b = req.body || {};
  if (!b.assessment?.name || !Array.isArray(b.responses)) return res.status(400).json({ error: 'Not a valid assessment backup file' });
  if (b.responses.length > 20000) return res.status(400).json({ error: 'Backup file is too large' });
  const id = req.assessment.id;
  try {
    tx(() => {
      const scope = Array.isArray(b.assessment.scope) ? b.assessment.scope.filter((s) => domainNames.has(s)) : [];
      const ts = now();
      db.prepare(`UPDATE assessments SET name = ?, description = ?, scope = ?, updated_at = ?, updated_by = ?, restored_at = ? WHERE id = ?`).run(
        String(b.assessment.name).slice(0, 200),
        String(b.assessment.description || '').slice(0, 2000),
        JSON.stringify(scope),
        ts,
        req.user.email,
        ts,
        id
      );
      db.prepare(`DELETE FROM responses WHERE assessment_id = ?`).run(id);
      for (const r of b.responses) upsertResponse(id, r, req.user.email);
    });
    console.log(`Assessment restored from backup by ${req.user.email} (${b.responses.length} answers)`);
    res.json({ ok: true, count: b.responses.length });
  } catch (err) {
    res.status(400).json({ error: `Restore failed: ${err.message}` });
  }
});

// -- User management (admins)
api.get('/users', requireAdmin, (req, res) => {
  const users = db.prepare(`SELECT email, name, is_admin, source, added_by, created_at, last_login FROM users ORDER BY email`).all();
  res.json({ users: users.map((u) => ({ ...u, is_admin: !!u.is_admin })), allowedDomains: config.allowedDomains });
});

api.post('/users', requireAdmin, (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });
  const isAdmin = req.body?.isAdmin ? 1 : 0;
  const existing = db.prepare(`SELECT * FROM users WHERE email = ?`).get(email);
  if (existing?.source === 'env') return res.status(400).json({ error: 'This user is managed by environment variables' });
  db.prepare(
    `INSERT INTO users (email, is_admin, source, added_by) VALUES (?, ?, 'app', ?)
     ON CONFLICT(email) DO UPDATE SET is_admin = excluded.is_admin, source = 'app'`
  ).run(email, isAdmin, req.user.email);
  console.log(`User ${email} ${existing ? 'updated' : 'added'} as ${isAdmin ? 'admin' : 'user'} by ${req.user.email}`);
  res.status(201).json({ ok: true });
});

api.delete('/users/:email', requireAdmin, (req, res) => {
  const email = req.params.email.toLowerCase();
  const u = db.prepare(`SELECT * FROM users WHERE email = ?`).get(email);
  if (!u) return res.status(404).json({ error: 'User not found' });
  if (u.source === 'env') return res.status(400).json({ error: 'This user is managed by environment variables; remove them from .env instead' });
  if (email === req.user.email) return res.status(400).json({ error: "You can't remove yourself" });
  db.prepare(`DELETE FROM users WHERE email = ?`).run(email);
  endAllSessions(email);
  console.log(`User ${email} removed by ${req.user.email}`);
  res.json({ ok: true });
});

app.use('/api', api);
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// ---- Static frontend ---------------------------------------------------------
const webDir = process.env.WEB_DIR || path.join(__dirname, '..', '..', 'web', 'dist');
if (fs.existsSync(webDir)) {
  // Hashed build assets can be cached forever; index.html must always be fresh.
  app.use('/assets', express.static(path.join(webDir, 'assets'), { maxAge: '1y', immutable: true }));
  app.use(express.static(webDir, { index: false, maxAge: 0 }));
  app.get('*', (req, res) => res.set('Cache-Control', 'no-cache').sendFile(path.join(webDir, 'index.html')));
}

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.type === 'entity.too.large' ? 'Upload too large' : 'Server error' });
});

const port = Number(process.env.PORT || 8080);
app.listen(port, () => console.log(`Essentials assessment app listening on :${port}`));
