#!/usr/bin/env node
/**
 * Security tests mapped to MITRE ATT&CK techniques relevant to this app.
 *
 * Starts throwaway server instances (temporary database, test-only users),
 * attacks them over HTTP, and prints a pass/fail table.
 *
 *   node scripts/security-tests.mjs                 # run everything
 *   node scripts/security-tests.mjs --no-audit      # skip npm audit (offline)
 *   node scripts/security-tests.mjs --report out.md # also write a Markdown report
 *
 * Exit code is 1 if any check fails.
 */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { csvCell } from '../web/src/csv.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = path.join(ROOT, 'server', 'src', 'index.js');
const args = process.argv.slice(2);
const reportPath = args.includes('--report') ? args[args.indexOf('--report') + 1] : null;
const runAudit = !args.includes('--no-audit');

const ADMIN = 'admin@test.local';
const USER = 'user@test.local';
const SECRET = 'a'.repeat(64);
const results = [];
const servers = [];

// ---------------------------------------------------------------------------
// Helpers

function record(technique, check, pass, detail = '') {
  results.push({ technique, check, pass, detail });
}

async function startServer(port, env, { expectExit = false, dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ee-sec-')) } = {}) {
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', SERVER], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, PORT: String(port), DATA_DIR: dataDir, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const srv = { port, child, dataDir, log: '', exited: null, base: `http://127.0.0.1:${port}` };
  child.stdout.on('data', (d) => (srv.log += d));
  child.stderr.on('data', (d) => (srv.log += d));
  child.on('exit', (code) => (srv.exited = code ?? 1));
  servers.push(srv);
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (srv.exited !== null) return srv;
    if (!expectExit) {
      try {
        const r = await fetch(`${srv.base}/api/health`);
        if (r.ok) return srv;
      } catch {
        /* not up yet */
      }
    }
    await sleep(150);
  }
  return srv;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const H = { 'Content-Type': 'application/json', 'X-Requested-With': 'essentials-app' };

async function req(srv, method, url, { cookie, body, headers = {}, raw } = {}) {
  const res = await fetch(srv.base + url, {
    method,
    headers: { ...H, ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, headers: res.headers, text, json };
}

/** Raw HTTP request that sends the path exactly as given (no URL normalisation). */
function rawGet(srv, rawPath) {
  return new Promise((resolve) => {
    const r = http.request({ host: '127.0.0.1', port: srv.port, path: rawPath, method: 'GET' }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    r.on('error', (e) => resolve({ status: 0, body: String(e) }));
    r.end();
  });
}

async function login(srv, email, headers = {}) {
  const r = await req(srv, 'POST', '/api/auth/dev', { body: { email }, headers });
  const set = r.headers.get('set-cookie') || '';
  const m = set.match(/ee_session=[^;]+/);
  return { status: r.status, cookie: m ? m[0] : null, setCookie: set };
}

// ---------------------------------------------------------------------------
// Tests

async function main() {
  const devEnv = {
    DEV_LOGIN: 'true',
    ADMIN_EMAILS: ADMIN,
    ALLOWED_EMAILS: USER,
    SESSION_SECRET: SECRET,
    GOOGLE_CLIENT_ID: 'test-client.apps.googleusercontent.com',
  };
  const dev = await startServer(18431, devEnv);
  if (dev.exited !== null) throw new Error(`Dev server failed to start:\n${dev.log}`);

  const admin = await login(dev, ADMIN);
  const user = await login(dev, USER);
  if (!admin.cookie || !user.cookie) throw new Error('Test logins failed');

  // ---- T1078 Valid Accounts -------------------------------------------------
  {
    const T = 'T1078 Valid Accounts';
    const outsider = await login(dev, 'attacker@evil.example');
    record(T, 'Email not on allowlist cannot sign in', outsider.status === 403 && !outsider.cookie, `status ${outsider.status}`);

    for (const url of ['/api/assessment', '/api/framework', '/api/users', '/api/me']) {
      const r = await req(dev, 'GET', url);
      record(T, `Unauthenticated GET ${url} is refused`, r.status === 401, `status ${r.status}`);
    }

    const forged = await req(dev, 'POST', '/api/auth/google', { body: { credential: 'eyJhbGciOiJSUzI1NiJ9.eyJlbWFpbCI6ImFkbWluQHRlc3QubG9jYWwifQ.c2ln' } });
    record(T, 'Forged Google ID token is rejected', forged.status === 401, `status ${forged.status}`);

    await req(dev, 'POST', '/api/users', { cookie: admin.cookie, body: { email: 'temp@test.local' } });
    const temp = await login(dev, 'temp@test.local');
    await req(dev, 'DELETE', '/api/users/temp%40test.local', { cookie: admin.cookie });
    const after = await req(dev, 'GET', '/api/me', { cookie: temp.cookie });
    record(T, 'Removed user loses access immediately', temp.cookie && after.status === 401, `status ${after.status}`);

    const prodDevLogin = await startServer(18432, { NODE_ENV: 'production', DEV_LOGIN: 'true', SESSION_SECRET: SECRET }, { expectExit: true });
    record(T, 'Server refuses to start with DEV_LOGIN in production', prodDevLogin.exited !== null && prodDevLogin.exited !== 0, prodDevLogin.log.trim().split('\n').pop());

    // No SESSION_SECRET: one is generated on first start, saved owner-only, and reused after a restart
    const gen = await startServer(18433, { NODE_ENV: 'production' });
    const secretFile = path.join(gen.dataDir, 'session-secret');
    const first = fs.existsSync(secretFile) ? fs.readFileSync(secretFile, 'utf8').trim() : '';
    const mode = first ? (fs.statSync(secretFile).mode & 0o777).toString(8) : 'none';
    record(T, 'Without SESSION_SECRET, a strong secret is generated on first start', gen.exited === null && /^[0-9a-f]{64}$/.test(first), `${first.length} hex chars`);
    record(T, 'Generated secret file is readable by its owner only', mode === '600', `mode ${mode}`);
    gen.child.kill();
    await sleep(300);
    const again = await startServer(18433, { NODE_ENV: 'production' }, { dataDir: gen.dataDir });
    const second = fs.existsSync(secretFile) ? fs.readFileSync(secretFile, 'utf8').trim() : '';
    record(T, 'Generated secret is reused after a restart (sign-ins survive)', again.exited === null && !!first && first === second);

    const prodWeak = await startServer(18434, { NODE_ENV: 'production', SESSION_SECRET: 'short' }, { expectExit: true });
    record(T, 'Server refuses a weak SESSION_SECRET in production', prodWeak.exited !== null && prodWeak.exited !== 0, prodWeak.log.trim().split('\n').pop());

    const prod = await startServer(18435, { NODE_ENV: 'production', SESSION_SECRET: SECRET, ADMIN_EMAILS: ADMIN, GOOGLE_CLIENT_ID: 'x.apps.googleusercontent.com' });
    const devRoute = await req(prod, 'POST', '/api/auth/dev', { body: { email: ADMIN } });
    const issued = /ee_session=[^;\s]+/.test(devRoute.headers.get('set-cookie') || '');
    record(T, 'Dev login endpoint does not exist in production', devRoute.status !== 200 && !issued, `status ${devRoute.status}`);
  }

  // ---- T1110 Brute Force -------------------------------------------------------
  {
    const T = 'T1110 Brute Force';
    const probe = await startServer(18436, devEnv);
    let limited = 0;
    for (let i = 0; i < 60; i++) {
      const r = await req(probe, 'POST', '/api/auth/dev', { body: { email: `guess${i}@evil.example` } });
      if (r.status === 429) limited++;
    }
    record(T, 'Repeated failed sign-ins are rate limited', limited > 0, `${limited} of 60 attempts got 429`);

    let gLimited = 0;
    for (let i = 0; i < 60; i++) {
      const r = await req(probe, 'POST', '/api/auth/google', { body: { credential: `junk.${i}.token` } });
      if (r.status === 429) gLimited++;
    }
    record(T, 'Google sign-in endpoint is rate limited', gLimited > 0, `${gLimited} of 60 attempts got 429`);
  }

  // ---- T1539 Steal Web Session Cookie ------------------------------------------
  {
    const T = 'T1539 Steal Web Session Cookie';
    const sc = admin.setCookie;
    record(T, 'Session cookie is HttpOnly (not readable by scripts)', /HttpOnly/i.test(sc), sc.replace(/ee_session=[^;]+/, 'ee_session=…'));
    record(T, 'Session cookie is SameSite', /SameSite=(Lax|Strict)/i.test(sc));
    // Over HTTPS through a trusted proxy (the default trusts localhost), cookies are HTTPS-only and HSTS is sent
    const HTTPS = { 'X-Forwarded-Proto': 'https' };
    const viaHttps = await login(dev, ADMIN, HTTPS);
    record(T, 'Session cookie is Secure (HTTPS only) when served over HTTPS', /;\s*Secure/i.test(viaHttps.setCookie));
    const r = await req(dev, 'GET', '/api/health', { headers: HTTPS });
    record(T, 'HSTS header forces HTTPS when served over HTTPS', !!r.headers.get('strict-transport-security'), r.headers.get('strict-transport-security') || 'missing');
    // A proxy header from an address that isn't trusted is ignored
    const untrusted = await startServer(18440, { ...devEnv, TRUST_PROXY: '10.9.9.9' });
    const spoof = await login(untrusted, ADMIN, HTTPS);
    record(T, 'HTTPS claim from an untrusted proxy is ignored', !!spoof.cookie && !/;\s*Secure/i.test(spoof.setCookie));
    const value = admin.cookie.split('=')[1];
    record(T, 'Session token has at least 128 bits of entropy', Buffer.from(value.split('.').pop(), 'base64url').length >= 16 || value.length >= 32, `${value.length} chars`);
  }

  // ---- T1550.004 Web Session Cookie reuse ----------------------------------------
  {
    const T = 'T1550.004 Web Session Cookie';
    const [name, val] = admin.cookie.split('=');
    const mid = Math.floor(val.length / 2);
    const tampered = `${name}=${val.slice(0, mid)}${val[mid] === 'A' ? 'B' : 'A'}${val.slice(mid + 1)}`;
    const t = await req(dev, 'GET', '/api/me', { cookie: tampered });
    record(T, 'Tampered cookie is rejected', t.status === 401, `status ${t.status}`);

    const other = await startServer(18437, { ...devEnv, SESSION_SECRET: 'b'.repeat(64) });
    const foreign = await login(other, ADMIN);
    const f = await req(dev, 'GET', '/api/me', { cookie: foreign.cookie });
    record(T, 'Cookie from another deployment (different secret) is rejected', f.status === 401, `status ${f.status}`);

    const short = await startServer(18438, { ...devEnv, SESSION_HOURS: '0.0005' });
    const s = await login(short, USER);
    await sleep(2500);
    const e = await req(short, 'GET', '/api/me', { cookie: s.cookie });
    record(T, 'Expired session is rejected', e.status === 401, `status ${e.status}`);

    const victim = await login(dev, USER);
    await req(dev, 'POST', '/api/auth/logout', { cookie: victim.cookie });
    const replay = await req(dev, 'GET', '/api/me', { cookie: victim.cookie });
    record(T, 'Copied cookie stops working after sign-out', replay.status === 401, `status ${replay.status}`);
  }

  // ---- T1185 Browser Session Hijacking (CSRF / clickjacking) -------------------
  {
    const T = 'T1185 Browser Session Hijacking';
    const noHeader = await req(dev, 'PATCH', '/api/assessment', { cookie: admin.cookie, body: { name: 'pwned' }, headers: { 'X-Requested-With': '' } });
    record(T, 'State change without the app header is refused (CSRF)', noHeader.status === 403, `status ${noHeader.status}`);

    const form = await req(dev, 'POST', '/api/users', {
      cookie: admin.cookie,
      raw: 'email=attacker%40evil.example&isAdmin=true',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': '', Origin: 'https://evil.example' },
    });
    record(T, 'Cross-site form post cannot add a user', form.status === 403, `status ${form.status}`);

    const pre = await req(dev, 'OPTIONS', '/api/assessment', { headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'PUT' } });
    record(T, 'No CORS access granted to other origins', !pre.headers.get('access-control-allow-origin'), pre.headers.get('access-control-allow-origin') || 'none');

    const page = await req(dev, 'GET', '/');
    const csp = page.headers.get('content-security-policy') || '';
    record(T, 'Page cannot be framed (clickjacking)', page.headers.get('x-frame-options') === 'DENY' && csp.includes("frame-ancestors 'none'"));
  }

  // ---- T1059.007 JavaScript (stored XSS) and export injection -----------------
  {
    const T = 'T1059.007 JavaScript / XSS';
    const payload = '<img src=x onerror=alert(document.cookie)><script>alert(1)</script>';
    const save = await req(dev, 'PUT', '/api/assessment/responses', {
      cookie: user.cookie,
      body: { kind: 'action', domain: 'Boundary services', itemId: 'IT.PRO-01.1', data: { reasoning: payload } },
    });
    const back = await req(dev, 'GET', '/api/assessment', { cookie: user.cookie });
    record(T, 'Stored payload is returned as JSON data, not HTML', save.status === 200 && /application\/json/.test(back.headers.get('content-type')) && back.text.includes('onerror'));

    const csp = (await req(dev, 'GET', '/')).headers.get('content-security-policy') || '';
    const scriptSrc = (csp.match(/script-src([^;]*)/) || [])[1] || '';
    record(T, "CSP blocks inline and injected scripts (no 'unsafe-inline'/'unsafe-eval')", scriptSrc && !/unsafe-inline|unsafe-eval|\*/.test(scriptSrc), `script-src${scriptSrc}`);

    const sinks = [];
    const walk = (d) => {
      for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, f.name);
        if (f.isDirectory()) walk(p);
        else if (/\.(jsx?|mjs)$/.test(f.name) && /dangerouslySetInnerHTML|\.innerHTML\s*=|\beval\(|new Function\(/.test(fs.readFileSync(p, 'utf8'))) sinks.push(path.relative(ROOT, p));
      }
    };
    walk(path.join(ROOT, 'web', 'src'));
    record(T, 'Frontend has no raw HTML / eval sinks', sinks.length === 0, sinks.join(', ') || 'none found');

    const dist = path.join(ROOT, 'web', 'dist', 'index.html');
    if (fs.existsSync(dist)) {
      const html = fs.readFileSync(dist, 'utf8');
      record(T, 'Built page has no inline scripts', !/<script(?![^>]*\bsrc=)[^>]*>/i.test(html));
    }

    const cases = ['=1+1', '+1', '-1', '@SUM(A1)', '\t=1', '\r=1', ' =HYPERLINK("http://evil")', '=cmd|" /C calc"!A0'];
    const bad = cases.filter((c) => !csvCell(c).startsWith(`"'`));
    record('T1059.007 JavaScript / XSS', 'CSV exports neutralise spreadsheet formulas', bad.length === 0, bad.length ? `not neutralised: ${bad.map((b) => JSON.stringify(b)).join(', ')}` : `${cases.length} cases`);

    // Evidence links: only http(s) may be stored, whichever way they arrive
    const target = { kind: 'action', domain: 'Boundary services', itemId: 'IT.PRO-01.1' };
    const evil = ['javascript:alert(document.cookie)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:msgbox(1)', 'file:///etc/passwd', '//evil.example/x'];
    const accepted = [];
    for (const url of evil) {
      const r = await req(dev, 'PUT', '/api/assessment/responses', { cookie: user.cookie, body: { ...target, data: { addLink: { url, title: 'x' } } } });
      if (r.status !== 400) accepted.push(url);
    }
    record(T, 'Evidence links reject script and non-web URLs', accepted.length === 0, accepted.join(', ') || `${evil.length} URLs refused`);

    const smuggle = await req(dev, 'POST', '/api/assessment/restore', {
      cookie: admin.cookie,
      body: { assessment: { name: 'Restore test' }, responses: [{ ...target, data: { links: [{ id: 'a1', url: 'javascript:alert(1)', title: 'x' }] } }] },
    });
    record(T, 'Script links cannot be smuggled in through a backup restore', smuggle.status === 400, `status ${smuggle.status}`);

    const good = await req(dev, 'PUT', '/api/assessment/responses', { cookie: user.cookie, body: { ...target, data: { addLink: { url: 'https://docs.google.com/document/d/abc/edit', title: '<b>x</b>' } } } });
    record(T, 'Valid https links are accepted', good.status === 200 && good.json?.[0]?.data?.links?.some((l) => l.url.startsWith('https://')), `status ${good.status}`);

    const linksSrc = fs.readFileSync(path.join(ROOT, 'web', 'src', 'components', 'Links.jsx'), 'utf8');
    record(T, 'Links open in a new tab without access to the app (noopener)', /target="_blank"/.test(linksSrc) && /rel="noopener noreferrer"/.test(linksSrc));
  }

  // ---- T1190 Exploit Public-Facing Application ----------------------------------
  {
    const T = 'T1190 Exploit Public-Facing Application';
    const sqli = await req(dev, 'GET', `/api/assessment/changes?since=${encodeURIComponent("' OR '1'='1'; DROP TABLE responses;--")}`, { cookie: user.cookie });
    const still = await req(dev, 'GET', '/api/assessment', { cookie: user.cookie });
    record(T, 'SQL injection in query string has no effect', sqli.status === 200 && still.status === 200 && Array.isArray(still.json?.responses), `status ${sqli.status}`);

    const sqli2 = await req(dev, 'PUT', '/api/assessment/responses', { cookie: user.cookie, body: { kind: 'action', domain: "Boundary services' --", itemId: "x' OR 1=1--", data: {} } });
    record(T, 'Injection in item identifiers is rejected', sqli2.status === 400, `status ${sqli2.status}`);

    const del = await req(dev, 'DELETE', `/api/users/${encodeURIComponent("' OR '1'='1")}`, { cookie: admin.cookie });
    const users = await req(dev, 'GET', '/api/users', { cookie: admin.cookie });
    record(T, 'SQL injection in user delete removes nothing', del.status === 404 && users.json?.users?.length >= 2, `status ${del.status}`);

    const traversal = [
      '/../server/src/auth.js',
      '/..%2f..%2fserver%2fsrc%2fauth.js',
      '/%2e%2e/%2e%2e/server/src/auth.js',
      '/assets/..%2f..%2f..%2fserver%2fsrc%2fauth.js',
      '/assets/%2e%2e%2f%2e%2e%2f%2e%2e%2fserver%2fpackage.json',
      '/..%252f..%252fserver%252fsrc%252fauth.js',
      '/%2e%2e/%2e%2e/%2e%2e/%2e%2e/etc/passwd',
      '/....//....//server/src/auth.js',
    ];
    const leaks = [];
    for (const p of traversal) {
      const r = await rawGet(dev, p);
      if (/createHmac|SQLite format 3|root:x:0:0|"dependencies"/.test(r.body)) leaks.push(p);
    }
    record(T, 'Path traversal cannot read server files', leaks.length === 0, leaks.join(', ') || `${traversal.length} paths tried`);

    const proto = await req(dev, 'PUT', '/api/assessment/responses', {
      cookie: user.cookie,
      raw: '{"kind":"action","domain":"Boundary services","itemId":"IT.PRO-01.2","data":{"rating":"Fully effective","__proto__":{"is_admin":1,"isAdmin":true},"constructor":{"prototype":{"is_admin":1}}}}',
    });
    const meAfter = await req(dev, 'GET', '/api/me', { cookie: user.cookie });
    const usersAfter = await req(dev, 'GET', '/api/users', { cookie: user.cookie });
    record(T, 'Prototype pollution does not grant admin', proto.status === 200 && meAfter.json?.isAdmin === false && usersAfter.status === 403, `me.isAdmin=${meAfter.json?.isAdmin}, /users ${usersAfter.status}`);
    const stored = (await req(dev, 'GET', '/api/assessment', { cookie: user.cookie })).json.responses.find((r) => r.itemId === 'IT.PRO-01.2');
    record(T, 'Unknown fields are not stored', stored && Object.keys(stored.data).every((k) => ['rating', 'reasoning', 'evidence'].includes(k)), JSON.stringify(stored?.data));

    const malformed = await req(dev, 'PUT', '/api/assessment/responses', { cookie: user.cookie, raw: '{"kind": "action", broken' });
    record(T, 'Malformed JSON gets a 400 without internal details', malformed.status === 400 && !/SyntaxError|at .*\.js|node_modules/.test(malformed.text), malformed.text.slice(0, 60));

    const badRating = await req(dev, 'PUT', '/api/assessment/responses', { cookie: user.cookie, body: { kind: 'action', domain: 'Boundary services', itemId: 'IT.PRO-01.1', data: { rating: 'Hacked' } } });
    const badKind = await req(dev, 'PUT', '/api/assessment/responses', { cookie: user.cookie, body: { kind: 'users', domain: '', itemId: ADMIN, data: { is_admin: 1 } } });
    record(T, 'Invalid values and record types are rejected', badRating.status === 400 && badKind.status === 400, `rating ${badRating.status}, kind ${badKind.status}`);

    const r = await req(dev, 'GET', '/api/health');
    record(T, 'Server does not advertise its framework', !r.headers.get('x-powered-by'));
  }

  // ---- T1068 Exploitation for Privilege Escalation ----------------------------------
  {
    const T = 'T1068 Privilege Escalation';
    const checks = [
      ['GET', '/api/users', undefined],
      ['POST', '/api/users', { email: 'friend@evil.example', isAdmin: true }],
      ['POST', '/api/users', { email: USER, isAdmin: true }],
      ['DELETE', `/api/users/${encodeURIComponent(ADMIN)}`, undefined],
      ['POST', '/api/assessment/restore', { assessment: { name: 'x' }, responses: [] }],
    ];
    for (const [m, u, b] of checks) {
      const r = await req(dev, m, u, { cookie: user.cookie, body: b });
      const label = b?.isAdmin && b.email === USER ? 'Normal user cannot make themselves admin' : `Normal user refused: ${m} ${u.replace(/%40/g, '@')}`;
      record(T, label, r.status === 403, `status ${r.status}`);
    }
    const me = await req(dev, 'GET', '/api/me', { cookie: user.cookie });
    record(T, 'Normal user is still not admin after attempts', me.json?.isAdmin === false);

    const envDel = await req(dev, 'DELETE', `/api/users/${encodeURIComponent(USER)}`, { cookie: admin.cookie });
    const envDemote = await req(dev, 'POST', '/api/users', { cookie: admin.cookie, body: { email: ADMIN, isAdmin: false } });
    record(T, 'Users from .env cannot be changed through the app', envDel.status === 400 && envDemote.status === 400, `delete ${envDel.status}, demote ${envDemote.status}`);
  }

  // ---- T1499 Endpoint Denial of Service ------------------------------------------
  {
    const T = 'T1499 Endpoint Denial of Service';
    const big = await req(dev, 'PUT', '/api/assessment/responses', { cookie: user.cookie, raw: JSON.stringify({ pad: 'x'.repeat(11 * 1024 * 1024) }) });
    record(T, 'Request bodies over the size limit are refused', big.status === 413, `status ${big.status}`);

    const many = Array.from({ length: 6000 }, () => ({ kind: 'action', domain: 'Boundary services', itemId: 'IT.PRO-01.1', data: {} }));
    const m = await req(dev, 'PUT', '/api/assessment/responses', { cookie: user.cookie, body: many });
    record(T, 'Oversized batches are refused', m.status === 400, `status ${m.status}`);

    const long = await req(dev, 'PUT', '/api/assessment/responses', { cookie: user.cookie, body: { kind: 'action', domain: 'Boundary services', itemId: 'IT.PRO-01.1', data: { evidence: 'x'.repeat(20001) } } });
    record(T, 'Over-long text fields are refused', long.status === 400, `status ${long.status}`);

    const t0 = Date.now();
    const burst = await Promise.all(Array.from({ length: 300 }, () => req(dev, 'GET', '/api/assessment', { cookie: admin.cookie }).catch(() => ({ status: 0 }))));
    const answered = burst.filter((r) => r.status > 0).length;
    const errors = burst.filter((r) => r.status >= 500).length;
    const health = await req(dev, 'GET', '/api/health');
    // Connections the OS drops before they reach the app (macOS queues only 128) don't count against it
    record(T, 'Server stays up under a 300-request burst', errors === 0 && health.status === 200, `${answered}/300 answered in ${Date.now() - t0} ms, ${errors} server errors`);

    const flood = await startServer(18439, devEnv);
    const f = await login(flood, USER);
    let limited = 0;
    await Promise.all(
      Array.from({ length: 1500 }, async () => {
        const r = await req(flood, 'GET', '/api/me', { cookie: f.cookie }).catch(() => ({ status: 0 }));
        if (r.status === 429) limited++;
      })
    );
    record(T, 'A single session flooding the API is rate limited', limited > 0, `${limited} of 1500 requests got 429`);
  }

  // ---- T1552 Unsecured Credentials ---------------------------------------------
  {
    const T = 'T1552 Unsecured Credentials';
    const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
    const risky = tracked.filter((f) => /(^|\/)\.env$|\.db$|data-store\/|\.pem$|\.key$/.test(f));
    record(T, 'No .env, database or key files in git', risky.length === 0, risky.join(', ') || `${tracked.length} files checked`);

    const secretHits = [];
    for (const f of tracked) {
      // This script contains the search patterns themselves, so skip it
      if (f.endsWith('package-lock.json') || f.endsWith('framework.json') || f === 'scripts/security-tests.mjs') continue;
      const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
      if (/SESSION_SECRET["'=:\s]+[0-9a-f]{32,}|BEGIN (RSA |EC )?PRIVATE KEY|GOCSPX-|client_secret/i.test(text)) secretHits.push(f);
    }
    record(T, 'No secrets committed in tracked files', secretHits.length === 0, secretHits.join(', ') || 'none found');

    const history = execFileSync('git', ['log', '-p', '--all', '--', '.', ':!*package-lock.json', ':!server/data/framework.json', ':!scripts/security-tests.mjs'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    record(T, 'No secrets anywhere in git history', !/SESSION_SECRET["'=:\s]+[0-9a-f]{32,}|PRIVATE KEY|GOCSPX-/.test(history));

    const dockerignore = fs.readFileSync(path.join(ROOT, '.dockerignore'), 'utf8');
    record(T, '.env and the database are kept out of the Docker image', /^\.env$/m.test(dockerignore) && /data-store/.test(dockerignore));

    const cfg = await req(dev, 'GET', '/api/config');
    record(T, 'Public config exposes only the Google client ID', JSON.stringify(Object.keys(cfg.json || {}).sort()) === JSON.stringify(['devLogin', 'googleClientId']));

    const all = servers.map((s) => s.log).join('\n');
    record(T, 'Server logs never contain session tokens or secrets', !/ee_session=|aaaaaaaaaaaaaaaa|eyJ[A-Za-z0-9_-]{20,}/.test(all));
  }

  // ---- T1195.002 Supply chain (npm audit) --------------------------------------
  if (runAudit) {
    const T = 'T1195.002 Supply Chain';
    for (const dir of ['server', 'web']) {
      try {
        const out = execFileSync('npm', ['audit', '--omit=dev', '--json'], { cwd: path.join(ROOT, dir), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        const v = JSON.parse(out).metadata.vulnerabilities;
        record(T, `No known high/critical vulnerabilities in ${dir} dependencies`, v.high + v.critical === 0, `critical ${v.critical}, high ${v.high}, moderate ${v.moderate}, low ${v.low}`);
      } catch (e) {
        let detail = 'npm audit could not run (offline?)';
        try {
          const v = JSON.parse(e.stdout).metadata.vulnerabilities;
          record(T, `No known high/critical vulnerabilities in ${dir} dependencies`, v.high + v.critical === 0, `critical ${v.critical}, high ${v.high}, moderate ${v.moderate}, low ${v.low}`);
          continue;
        } catch {
          /* fall through */
        }
        record(T, `No known high/critical vulnerabilities in ${dir} dependencies`, null, detail);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Run and report

function report() {
  const passed = results.filter((r) => r.pass === true).length;
  const failed = results.filter((r) => r.pass === false).length;
  const skipped = results.filter((r) => r.pass === null).length;
  const lines = [];
  let current = '';
  for (const r of results) {
    if (r.technique !== current) {
      current = r.technique;
      lines.push(`\n${current}`);
    }
    const mark = r.pass === true ? 'PASS' : r.pass === false ? 'FAIL' : 'SKIP';
    lines.push(`  ${mark}  ${r.check}${r.detail ? `  (${r.detail})` : ''}`);
  }
  console.log(lines.join('\n'));
  console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);

  if (reportPath) {
    const md = [`# Security test results`, '', `Run ${new Date().toISOString()}: **${passed} passed, ${failed} failed, ${skipped} skipped**`, ''];
    current = '';
    for (const r of results) {
      if (r.technique !== current) {
        current = r.technique;
        md.push('', `## ${current}`, '', '| Result | Check | Detail |', '| --- | --- | --- |');
      }
      md.push(`| ${r.pass === true ? 'Pass' : r.pass === false ? '**Fail**' : 'Skipped'} | ${r.check} | ${String(r.detail).replace(/\|/g, '\\|')} |`);
    }
    fs.writeFileSync(reportPath, md.join('\n') + '\n');
  }
  return failed;
}

let failed = 1;
try {
  await main();
  failed = report();
} catch (e) {
  console.error(e);
  report();
} finally {
  for (const s of servers) if (s.exited === null) s.child.kill();
}
process.exit(failed ? 1 : 0);
