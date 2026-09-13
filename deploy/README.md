# Deploying RoadStar DispatchOS

CI builds four container images, pushes them to GitHub Container Registry, and restarts the stack on
the droplet. The droplet compiles nothing — it only pulls images and runs Caddy in front of them.

```
push to main ──▶ quality gate ──▶ build 4 images ──▶ push to ghcr.io ──▶ ssh: pull + up ──▶ probe /healthz
```

## One-time droplet setup

On a fresh Ubuntu droplet, as root:

```bash
# Docker
curl -fsSL https://get.docker.com | sh

# Caddy
apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy

# Deploy user and target directory
useradd -m -s /bin/bash deploy
usermod -aG docker deploy
install -d -o deploy -g deploy /opt/roadstar
install -d -o caddy -g caddy /var/log/caddy
```

Authorise the CI key for that user:

```bash
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
# paste the public half of the deploy keypair
nano /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys
```

Install the reverse proxy config and reload:

```bash
cp deploy/Caddyfile /etc/caddy/Caddyfile
systemctl reload caddy
```

Create `/opt/roadstar/.env`, which compose reads automatically:

```bash
APP_ORIGIN=https://roadstardispatch.xyz

# RoadStar AI. Read by the integration gateway, never compiled into the bundle.
SPUR_API_KEY=sk-spur-...
# The gateway verifies AI callers with Supabase. These are the same
# browser-safe values as the VITE_SUPABASE_* repository secrets.
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Without `SPUR_API_KEY` the rest of the application runs normally and the Integrations screen reports the
AI provider as not configured. Model choices (`SPUR_MODEL_*`) have working defaults; see `.env.example`.

Only port 80 and 443 need to be open. The application container binds to `127.0.0.1:8080`, so it is
unreachable from the internet except through Caddy.

## GitHub configuration

Repository → Settings → Secrets and variables → Actions.

**Secrets**

| Name | Value |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL — compiled into the browser bundle |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key — browser-safe by design |
| `DEPLOY_HOST` | Droplet IP or hostname |
| `DEPLOY_USER` | `deploy` |
| `DEPLOY_SSH_KEY` | Private half of the deploy keypair |
| `DEPLOY_KNOWN_HOSTS` | Required pinned host-key line for the production host. |

The workflow refuses to run rather than producing a broken release when these are missing: the web
image build fails if the two `VITE_` values are absent, and the release job fails before touching the
droplet if the `DEPLOY_` values are absent. Both errors name the missing secrets.

**Adding repository secrets requires admin permission on the repository.** A collaborator with only
push access cannot set them, from the web UI or `gh secret set`.

Never store a Supabase `service_role` or secret key here. The two `VITE_` values are the only
credentials the browser build needs, and row-level security is what protects the data.

Verify the SSH fingerprint independently before saving `DEPLOY_KNOWN_HOSTS`: read the ED25519 fingerprint from the hosting provider's recovery console with `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`, then compare it with `ssh-keyscan -t ed25519 <host> | ssh-keygen -lf -`. Only after they match, save the complete `ssh-keyscan -H -t ed25519 <host>` output as the GitHub secret. The deployment now fails closed when this secret is absent.

**Variables** (optional, these have defaults)

| Name | Default |
|---|---|
| `DEPLOY_PATH` | `/opt/roadstar` |
| `APP_ORIGIN` | `https://roadstardispatch.xyz` |
| `REQUIRE_REAL_ROUTING` | `false`; set to `true` after the Ontario graph is provisioned so post-deploy verification rejects presentation fallback |

The workflow uses a `production` environment, so you can add a required reviewer there if you want a
manual gate before anything reaches the droplet.

## Supabase

Add the public origin to **Authentication → URL Configuration**, or magic-link sign-in will redirect
to the wrong host:

- Site URL: `https://roadstardispatch.xyz`
- Redirect URLs: `https://roadstardispatch.xyz/**`

Keep `http://localhost:5173/**` in the redirect list so local development continues to work.

## Before DNS resolves

Caddy cannot obtain a certificate until `roadstardispatch.xyz` points at the droplet's public IP.

### Hardening notes

- **Caddyfile is applied by hand.** The deploy workflow does not copy `deploy/Caddyfile`. After changing it, copy it to `/etc/caddy/Caddyfile` and run `sudo systemctl reload caddy`. It sets `Strict-Transport-Security` and refuses `/metrics` at the edge; the web gateway enforces both as well, so they hold even with an older Caddyfile.
- **`www` needs a DNS record.** Add a `CNAME` for `www` pointing to `roadstardispatch.xyz` (or an `A` record to the droplet). Until then Caddy cannot obtain a certificate for `www` and the redirect does not work.
- **`/metrics` is host-only.** Requests relayed by Caddy carry `X-Forwarded-For` and receive 404. Read counters from the host with `curl http://127.0.0.1:8080/metrics`, or set `METRICS_TOKEN` in `/opt/roadstar/.env` and send `Authorization: Bearer <token>` from an external scraper.
Until then, either wait, or serve over plain HTTP on the IP by replacing the site address in
`/etc/caddy/Caddyfile`:

```caddyfile
:80 {
	@telemetry path /api/telemetry/events
	handle @telemetry {
		reverse_proxy 127.0.0.1:8080 {
			flush_interval -1
		}
	}
	handle {
		encode zstd gzip
		reverse_proxy 127.0.0.1:8080
	}
}
```

Set `APP_ORIGIN` to `http://<droplet-ip>` to match, and add that origin to Supabase's redirect list.
Swap back to the hostname block once DNS propagates. The deploy workflow's final health probe targets
`APP_ORIGIN`, so set the `APP_ORIGIN` repository variable to the same value or that step will fail
while the domain is still unresolved.

## Running it by hand

```bash
cd /opt/roadstar
export IMAGE_PREFIX=ghcr.io/sawaaba/roadstar_dispatchos IMAGE_TAG=latest
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

## Ontario routing lifecycle

Run the **Provision Ontario OSRM** workflow manually and type `PROVISION-ONTARIO`. The guarded provisioner verifies at least 20 GB free disk and 8 GB combined RAM/swap, downloads the current Geofabrik Ontario extract, verifies its MD5, runs the official MLD extract/partition/customize pipeline, and enables the internal-only `osrm` service. It aborts before downloading when the host does not meet those checks. Once successful, set the GitHub `REQUIRE_REAL_ROUTING` variable to `true`.

Refresh the graph monthly when route freshness matters, or at least quarterly for a demonstration environment, by running the same workflow. The download is replaced only after checksum verification; the marker makes subsequent application deployments enable the OSRM override automatically. Re-run `npm run verify:deployment` after every refresh.

OSRM has no published host port. Only the integration gateway reaches `http://osrm:5000` through the Compose network. Gateway and web readiness fail when `REQUIRE_ROUTING=true` and the engine cannot answer its nearest-road probe.

## Lightweight host monitoring

The deployment copies `monitor-roadstar.sh` to `/opt/roadstar`. Run it every five minutes from a systemd timer or monitoring agent:

```bash
chmod 700 /opt/roadstar/monitor-roadstar.sh
ROADSTAR_ORIGIN=https://roadstardispatch.xyz /opt/roadstar/monitor-roadstar.sh /opt/roadstar
```

It emits one JSON record containing container health/restarts, 15-minute error count, disk use, memory use, and `/readyz` status, and exits non-zero at actionable thresholds. Route its output and failures to the host's journal/alerting destination; it is a probe, not a substitute for an external uptime monitor.

Install the included systemd timer once from an administrator shell:

```bash
cp /opt/roadstar/roadstar-monitor.service /etc/systemd/system/
cp /opt/roadstar/roadstar-monitor.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now roadstar-monitor.timer
systemctl list-timers roadstar-monitor.timer
```

The service runs as the `deploy` user and writes its JSON result to the journal. Inspect the latest run with `journalctl -u roadstar-monitor.service -n 20`. Connect failed units or non-zero probe output to the host's alerting provider before treating this as production operations coverage.

## Rollback

Images are tagged with the commit SHA as well as `latest`:

```bash
IMAGE_TAG=<previous-sha> docker compose -f docker-compose.prod.yml up -d
```

Database migrations are forward-only and are **not** run by this pipeline. Rolling application
containers back does not roll back schema; correct a schema problem with a new migration.

## Verifying a release

```bash
curl -fsS https://roadstardispatch.xyz/healthz
curl -fsS https://roadstardispatch.xyz/api/telemetry/health
curl -fsS https://roadstardispatch.xyz/api/traffic/health
curl -fsS https://roadstardispatch.xyz/api/health          # Java solver
curl -N  https://roadstardispatch.xyz/api/telemetry/events  # should stream, not hang silently
```

The last one is the important check after any proxy change: if frames do not arrive roughly once a
second, something in front of the app is buffering the event stream.
