# Security testing

The app is tested against ten of the most commonly used MITRE ATT&CK techniques that apply to a web app with Google sign-in, plus a dependency check. The tests are automated in [`scripts/security-tests.mjs`](scripts/security-tests.mjs). The script starts throwaway server instances with a temporary database and test-only users, attacks them over HTTP, and prints pass/fail for each check.

```bash
node scripts/security-tests.mjs                 # all checks
node scripts/security-tests.mjs --no-audit      # skip npm audit when offline
node scripts/security-tests.mjs --report out.md # also write a Markdown report
```

Re-run it after any change to authentication, routes or dependencies. Build the frontend first (`cd web && npm run build`) so the built page is checked too.

## Latest result: 64 passed, 0 failed (28 Oct 2026)

| Technique | What was tested | Result |
| --- | --- | --- |
| **T1190** Exploit Public-Facing Application | SQL injection in query strings, IDs and URLs; 8 path traversal variants; prototype pollution; malformed JSON; invalid values | Pass (10 checks) |
| **T1078** Valid Accounts | Non-allowlisted accounts, unauthenticated access, forged Google tokens, removed users, dev login and weak secrets in production | Pass (11) |
| **T1110** Brute Force | Repeated failed sign-ins on both sign-in endpoints | Pass (2), **fixed** |
| **T1539** Steal Web Session Cookie | HttpOnly, Secure and SameSite cookie flags, HSTS, token strength | Pass (5), **fixed** (HSTS) |
| **T1550.004** Web Session Cookie | Tampered, foreign, expired and signed-out cookies | Pass (4), **fixed** (sign-out) |
| **T1185** Browser Session Hijacking | CSRF from other sites, cross-site form posts, CORS, clickjacking | Pass (4) |
| **T1059.007** JavaScript (XSS) | Stored script payloads, Content Security Policy, unsafe code patterns, formula injection in CSV exports, evidence links (`javascript:`, `data:` and other non-web URLs refused on save and restore; links open with `noopener`) | Pass (9), **fixed** (CSV) |
| **T1068** Privilege Escalation | Normal user calling every admin function, self-promotion, changing users managed in `.env` | Pass (7) |
| **T1499** Endpoint Denial of Service | Oversized bodies, oversized batches, long text, 300-request burst, single-session flood | Pass (5), **fixed** (rate limits) |
| **T1552** Unsecured Credentials | `.env`, databases and keys in git or git history, Docker build context, public config, server logs | Pass (6) |
| T1195.002 Supply Chain | `npm audit` of production dependencies | Pass (2), **fixed** |

There was also a manual browser check. Script payloads saved in answers, indicator notes and the business name were displayed as plain text on every page, and none of them ran.

## Issues found and fixed

The first run had 52 passes and 8 failures. Two of the failures were test or environment issues: a too-strict test check, and macOS dropping excess connections during the burst test. The other six were fixed:

1. **Signed-out cookies still worked (T1550.004).** Sessions were stateless signed cookies, so a copied cookie stayed valid for up to 12 hours after sign-out. Sessions are now stored on the server. Sign-out deletes the session, and removing a user deletes all of theirs. The database holds only an HMAC of each token, so a copy of the database can't be used to sign in, and changing `SESSION_SECRET` signs everyone out.
2. **No sign-in rate limiting (T1110).** After 20 failed sign-ins from one address within 15 minutes, further attempts are refused with HTTP 429. Each failure is logged.
3. **No request rate limiting (T1499).** Each session is limited to 600 API requests a minute and each IP address to 1,200. Normal use with polling and auto-save is well under this.
4. **No HSTS (T1539).** `Strict-Transport-Security` is now sent when `COOKIE_SECURE=true`, so browsers refuse to downgrade to plain HTTP. A `Permissions-Policy` header that switches off camera, microphone and similar features was added too.
5. **CSV formula bypass (T1059.007).** A value starting with spaces and then `=`, such as ` =HYPERLINK(...)`, wasn't neutralised in exports. It is now.
6. **Moderate advisory in a dependency (T1195.002).** `uuid`, used through `google-auth-library` 9, had a moderate advisory. Upgrading to `google-auth-library` 11 removed it, and `npm audit` now reports 0 vulnerabilities.

User additions, removals, role changes and backup restores are now written to the server log, as an audit trail visible in `docker compose logs`.

## Remaining risks and deployment notes

- **Set `TRUST_PROXY` behind a reverse proxy.** Otherwise every request appears to come from the proxy. Rate limits would then apply to the whole team together, and someone could lock everyone out of sign-in for 15 minutes with 20 bad attempts. See the README.
- **HTTPS is the reverse proxy's job.** The app sets Secure cookies and HSTS but doesn't terminate TLS itself.
- **Rate limits are in memory.** They reset when the app restarts and assume a single app instance, which is how Docker Compose runs it.
- **Google accounts are the front door.** Anyone who takes over an allowlisted Google account gets their access. Require 2-Step Verification in Google Workspace.
- **Any allowlisted user can edit everything** except user management and restores, which are admin-only. There's no per-answer history; the app keeps only who changed each answer last.
- **Not covered:** the host, network, TLS and reverse-proxy configuration, and manual penetration testing beyond these automated checks.

## Docker image check (26 Oct 2026)

The image was built and run through `docker-compose.yml` with a test configuration, then checked from outside and inside. All checks passed:

- **Health:** the container reports healthy.
- **Headers:** the CSP, HSTS and anti-framing headers are present.
- **Sign-in:** unauthenticated requests are refused, and dev login is off. Forged Google tokens are rejected, and further attempts are rate-limited after 20 failures.
- **Requests:** path traversal can't reach `/etc/passwd`, the app source or the database, and oversized requests are refused.
- **Container:** it runs as the unprivileged `node` user, and the app code is read-only to it. The image contains no `.env`, git data, scripts or workbook files.
- **Data:** data in the `/data` volume survives the container being removed and recreated.
- **Unsafe settings:** the image refuses to start with `DEV_LOGIN=true` or without a `SESSION_SECRET`.
