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
```

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
| `DEPLOY_KNOWN_HOSTS` | Optional. Output of `ssh-keyscan <host>`. Without it the workflow trusts the host key on first use and logs a warning. |

Never store a Supabase `service_role` or secret key here. The two `VITE_` values are the only
credentials the browser build needs, and row-level security is what protects the data.

**Variables** (optional, these have defaults)

| Name | Default |
|---|---|
| `DEPLOY_PATH` | `/opt/roadstar` |
| `APP_ORIGIN` | `https://roadstardispatch.xyz` |

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
