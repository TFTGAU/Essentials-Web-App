# Building and development

For running the published image, see the [README](README.md).

## Build from source with Docker

From the project folder, with `.env` set up as in the README:

```bash
docker compose up -d --build
```

This builds the image locally and tags it with the same name as the published image.

### Docker on a Mac

[Colima](https://github.com/abiosoft/colima) is a free container engine for macOS:

```bash
brew install colima docker docker-compose docker-buildx
mkdir -p ~/.docker && echo '{"cliPluginsExtraDirs": ["/opt/homebrew/lib/docker/cli-plugins"]}' > ~/.docker/config.json
colima start --cpu 4 --memory 8
```

An image built on an Apple Silicon Mac is ARM-only and won't run on most Intel/AMD servers. Use the published image there, or build for both with `docker buildx build --platform linux/amd64,linux/arm64 ...`.

On Linux, Docker Engine with the Compose plugin is all you need.

## Local development

```bash
cd server && npm install && DEV_LOGIN=true COOKIE_SECURE=false ADMIN_EMAILS=you@example.com npm run dev
cd web && npm install && npm run dev   # http://localhost:5173, proxies /api to :8080
```

`DEV_LOGIN=true` adds an email-only sign-in form for testing without Google. The server refuses to start with it when `NODE_ENV=production`, which the Docker image sets.

For Google sign-in during development, add `http://localhost:8080` (and `http://localhost:5173`) to the client's authorised origins and set `COOKIE_SECURE=false`.

## Configuration reference

Besides the settings in the README:

| Setting | Default | Purpose |
| --- | --- | --- |
| `COOKIE_SECURE` | `true` | Set `false` only for plain `http://localhost` testing |
| `SESSION_HOURS` | `12` | How long a sign-in lasts |
| `AUTH_FAIL_LIMIT` | `20` | Failed sign-ins per IP per 15 minutes |
| `IP_RATE_LIMIT` | `1200` | API requests per IP per minute |
| `USER_RATE_LIMIT` | `600` | API requests per session per minute |

Users listed in `.env` are synced each time the app starts, so removing someone and restarting removes their access. Access is checked on every request.

## Scoring

Scoring follows the workbook formulas:

- An action scores Not assessed 0, Not effective 1, Partially 2, Fully 3.
- A principle's rating is the lowest of its actions in that domain.
- A domain's % effective is (0.5 × partially effective + fully effective principles) ÷ total principles.

The workbook's E8 "Impl" formulas only check the maturity level, not which strategy a control belongs to. For example, setting *Patch applications* to ML1 marks every ML1 control Effective. The app applies the behaviour the workbook's instructions describe: a control is auto-marked Effective when one of *its own* strategies is set to a level the control belongs to.

## Updating the framework content

The app reads `server/data/framework.json`, which is generated from the workbook. When ASD publishes a new version:

```bash
pip install openpyxl
python3 scripts/extract_workbook.py "path/to/Assessment Workbook.xlsx" server/data/framework.json
```

Answers are stored against domain and action/indicator IDs, so they carry over wherever IDs haven't changed.

## Security tests

```bash
cd web && npm run build && cd ..
node scripts/security-tests.mjs
```

See [SECURITY.md](SECURITY.md) for what's covered.

## Releasing

The [Docker image workflow](.github/workflows/docker.yml) builds for Intel/AMD and ARM on GitHub:

- Pull requests: build only.
- Pushes to `main`: publish the `main` tag.
- Version tags: publish the version and `latest`.

```bash
git tag v1.0.0 && git push origin v1.0.0
```

Images go to `ghcr.io/tftgau/essentials`. To also publish to Docker Hub, create a Docker Hub access token, then in the repo's **Settings → Secrets and variables → Actions** add a variable `DOCKERHUB_USERNAME` and a secret `DOCKERHUB_TOKEN`.

## Layout

```
server/                 Express API and static file server (Node 24, built-in node:sqlite)
  src/index.js          routes, validation
  src/auth.js           Google ID token check, allowlist, sessions, rate limits
  src/db.js             SQLite schema
  data/framework.json   framework content generated from the workbook
web/                    React (Vite) frontend
  src/scoring.js        workbook scoring logic
scripts/
  extract_workbook.py   workbook → framework.json
  security-tests.mjs    ATT&CK-based security tests
```
