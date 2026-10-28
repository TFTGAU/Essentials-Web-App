# Essentials for Enterprise IT — Assessment app

A web version of ASD's *Essentials for Enterprise IT – Assessment Workbook*, for teams that find the Excel file heavy or awkward in Collabrative enviroment.

- One assessment for one business, shared by everyone on an allowlist.
- Google sign-in, limited to the emails or Workspace domains you choose.
- Changes save automatically and appear for teammates within a few seconds.
- Summary dashboard with a domain radar chart and principle heatmap.
- Evidence links (for example Google Drive files) on every action and indicator.
- CSV export and full JSON backup.
- Light and dark themes.

Scoring matches the workbook. The one exception is E8 controls: the workbook's formula ignores which strategy a control belongs to, and the app uses the behaviour the workbook's instructions describe. See [BUILD.md](BUILD.md#scoring) for details.

## Quick start

### 1. Create a Google OAuth client ID

1. Open [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials).
2. If prompted, set up the **OAuth consent screen**. Choose **Internal** for a Workspace-only app.
3. **Create credentials → OAuth client ID → Web application**.
4. Under **Authorised JavaScript origins**, add the URL you'll open the app on, for example `https://essentials.example.com`.
5. Copy the **Client ID**. You don't need a client secret.

### 2. Download and configure

```bash
mkdir essentials && cd essentials
curl -fsSLO https://raw.githubusercontent.com/TFTGAU/Essentials-Web-App/main/docker-compose.yml
curl -fsSL -o .env https://raw.githubusercontent.com/TFTGAU/Essentials-Web-App/main/.env.example
```

Edit `.env`:

| Setting | What to put |
| --- | --- |
| `ORG_NAME` | The business being assessed (first start only; change it later in Settings) |
| `GOOGLE_CLIENT_ID` | The client ID from step 1 |
| `ADMIN_EMAILS` | Admins. They can also add users in the app. |
| `ALLOWED_EMAILS` | Other people allowed to sign in |
| `ALLOWED_DOMAINS` | Optional: allow a whole Google Workspace domain |
| `TRUST_PROXY` | Set to `1` if the app is behind an HTTPS reverse proxy |
| `PORT` | Port the app is served on (default `8080`) |

### 3. Start

```bash
docker compose pull && docker compose up -d
```

The app is served on port 8080, or whatever `PORT` is set to. Put it behind an HTTPS reverse proxy such as Caddy, nginx or Cloudflare Tunnel. Google sign-in needs HTTPS, except on `localhost`.

To update, run the same command again. To stay on a specific version, change `latest` in `docker-compose.yml` to a version number, for example `:1.0.0`.

## Backups

Everything is in one SQLite file in the `essentials-data` volume. To copy it while the app is running:

```bash
docker compose exec app node -e "new (require('node:sqlite').DatabaseSync)('/data/essentials.db').exec(\"VACUUM INTO '/data/backup.db'\")"
docker compose cp app:/data/backup.db ./essentials-backup.db
docker compose exec app rm /data/backup.db
```

You can also download a JSON backup from **Settings & export**, and admins can restore one there.

## More

- [BUILD.md](BUILD.md): building from source, local development, updating the framework content, releasing.
- [SECURITY.md](SECURITY.md): reporting security issues, security testing and deployment advice.

## Licence and attribution

The application code is released under the [MIT licence](LICENSE).

The framework content (domains, principles, actions, indicators and Essential Eight mappings in `server/data/framework.json`) comes from the *Essentials for Enterprise IT – Assessment Workbook* published by the Australian Signals Directorate (ASD), [cyber.gov.au](https://www.cyber.gov.au). It remains ASD's material and is used under ASD's licence terms. This project is not affiliated with or endorsed by ASD.
