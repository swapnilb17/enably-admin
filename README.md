# enably-admin

Internal admin & observability console for the Enably platform.

- Single Next.js 16 app (App Router, `output: "standalone"`).
- UI under `app/(admin)/...`, BFF route handlers under `app/api/admin/*`.
- Talks **only** to `/internal/admin/*` on the existing FastAPI backend, with
  a server-side `X-Admin-Key` header. The browser never sees the key.
- Every read goes through `unstable_cache` with a configurable TTL
  (`ADMIN_CACHE_TTL`, default 60s) so opening pages repeatedly does **not**
  generate extra load on the existing app server. A manual "Refresh" button
  busts the cache via `revalidateTag` when needed.

## Local development

```bash
cp .env.example .env.local
# fill in BACKEND_URL, ADMIN_API_KEY, ADMIN_PASSWORD, SESSION_SECRET
# generate a secret: openssl rand -base64 48
npm install
npm run dev
# open http://localhost:3000
```

The app starts at `/login`. Use the `ADMIN_PASSWORD` you set above.

## Backend contract (to be added on the existing FastAPI)

These are the endpoints `lib/admin-api.ts` expects. They must be guarded by a
new `_require_admin_api_key` dependency that validates the `X-Admin-Key`
header against a server-side `ADMIN_API_KEY` env var.

| Method | Path                              | Purpose                          |
|--------|-----------------------------------|----------------------------------|
| GET    | `/internal/admin/health`          | Liveness check                   |
| GET    | `/internal/admin/users`           | Paginated users + credit balance |
| GET    | `/internal/admin/payments`        | Paginated Razorpay payments join |
| POST   | `/internal/admin/codes`           | Create one or more credit codes  |
| GET    | `/internal/admin/templates`       | (later) admin template listing   |
| POST   | `/internal/admin/templates`       | (later) upload/publish a template|

Until these exist, the admin UI degrades gracefully (each page shows a
"backend not yet ready" message). The existing user-facing app is **not**
touched in any way.

## Deployment

GitHub Actions deploys to a single EC2 over SSH. See
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml).

### One-time EC2 setup

This repo's first instance was provisioned on **Amazon Linux 2023** (default
user `ec2-user`, IP `65.0.170.188`). The commands below are what was run.
For Ubuntu AMIs swap `dnf` for `apt-get` and `ec2-user` for `ubuntu`.

```bash
# 1. Install Node 20 + Nginx + git
sudo dnf install -y nodejs20 nodejs20-npm nginx git openssl

# 2. Lay out directories
sudo mkdir -p /srv/enably-admin/releases
sudo chown -R ec2-user:ec2-user /srv/enably-admin

# 3. Drop in the systemd unit + env file (see deploy/*.example) and
#    generate strong secrets.
sudo cp deploy/enably-admin.service.example /etc/systemd/system/enably-admin.service
sudo cp deploy/enably-admin.env.example /etc/enably-admin.env
sudo sed -i "s|change-me-base64-48-bytes|$(openssl rand -base64 48)|" /etc/enably-admin.env
sudo chmod 0640 /etc/enably-admin.env
sudo chown root:ec2-user /etc/enably-admin.env

# 4. Nginx vhost (Amazon Linux uses /etc/nginx/conf.d/, not sites-available).
sudo cp deploy/nginx.conf.example /etc/nginx/conf.d/enably-admin.conf
sudo nginx -t && sudo systemctl enable nginx --now

# 5. Enable the service (will start after the first GitHub Actions deploy
#    lands a bundle in /srv/enably-admin/current).
sudo systemctl daemon-reload
sudo systemctl enable enably-admin

# 6. (Later) Add HTTPS once you have a domain pointing at this IP:
#    sudo dnf install -y certbot python3-certbot-nginx
#    sudo certbot --nginx -d admin.example.com
#    Then set SESSION_COOKIE_SECURE=true in /etc/enably-admin.env and restart.
```

**AWS Security Group** must allow inbound `22` (SSH from your IP) and
`80` (HTTP, ideally restricted to your IPs). Open `443` once you add TLS.

### GitHub repo secrets

Set these under **Settings → Secrets and variables → Actions**:

| Secret              | Value                                          |
|---------------------|------------------------------------------------|
| `ADMIN_EC2_HOST`    | EC2 public DNS or IP (e.g. `65.0.170.188`)     |
| `ADMIN_EC2_USER`    | SSH user (typically `ubuntu`)                  |
| `ADMIN_EC2_SSH_KEY` | Contents of the private key (`.pem`) file      |

The key on the EC2 side must be in `/home/ubuntu/.ssh/authorized_keys`.

### Push to deploy

```bash
git push origin main
```

CI builds, copies a tarball to the EC2, swaps the `current` symlink, restarts
the systemd service, and reloads Nginx.

## Architecture

See `AGENTS.md` for non-negotiables and `app/` for the layout. In short:

```
Browser ──HTTPS (cookie only)──> Next.js on Admin EC2 ──HTTPS + X-Admin-Key──> FastAPI on App EC2
                                  ^                                              ^
                                  └ unstable_cache (60s) reduces backend load    └ /internal/admin/*
```
