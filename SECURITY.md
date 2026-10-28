# Security

## Reporting a vulnerability

Please report security issues privately using GitHub's **Report a vulnerability** button on the repository's **Security** tab, rather than opening a public issue. Include enough detail to reproduce the problem.

## Security testing

The app is tested against common attack techniques for web apps with Google sign-in, based on MITRE ATT&CK, along with a check of its dependencies for known vulnerabilities. The tests are automated and run against throwaway instances of the app:

```bash
cd web && npm run build && cd ..
node scripts/security-tests.mjs
```

All checks pass for the current release.

## Deploying securely

- **Use HTTPS.** Put the app behind an HTTPS reverse proxy and set `TRUST_PROXY` so the app sees users' real addresses and knows connections are secure.
- **Protect the Google accounts.** Anyone who can sign in to an allowlisted Google account gets that person's access. Require 2-Step Verification in Google Workspace.
- **Keep the allowlist short.** Every allowed user can view and edit the whole assessment. Only admins can manage users and restore backups.
- **Keep the data volume private.** It holds the database and the app's session secret.
- **Stay up to date.** Pull new releases to pick up security fixes.

Host, network and reverse-proxy security are outside the scope of this project's testing.
