# RoadStar deployment runbook

## Release gate

From a clean checkout with Node.js 22 and Java 21:

```bash
npm ci
npx playwright install --with-deps chromium
npm run quality
```

Continuous delivery runs the same gate. `.github/workflows/deploy.yml` builds and publishes the four
container images on every push to `main`, then pulls and restarts them on the droplet. Host setup,
required secrets and rollback are documented in [`deploy/README.md`](../deploy/README.md).

## Supabase

Use staging and production projects where possible. Authenticate, link the intended project, review parity, then push once:

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase migration list
npx supabase db push --dry-run
npx supabase db push
```

Run Supabase Security and Performance Advisors after the push. Confirm P1 tables are available to `authenticated` but not `anon`, and verify two sessions surface a revision conflict. Configure the exact HTTPS Site URL and redirect URL in Authentication settings. Provision `organization_members` explicitly.

## Runtime

Required browser build variables are `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Optional runtime variables are `APP_ORIGIN`, `SOLVER_URL`, `SIMULATOR_URL`, `INTEGRATION_URL`, `PORT`, and `HOST`. Never place a password, secret key, or `service_role` key in a `VITE_` variable.

```bash
# local, builds from source
docker compose --env-file .env.local up --build

# production, pulls images CI already published
IMAGE_TAG=latest docker compose -f docker-compose.prod.yml up -d
```

Expose only the web service over HTTPS. Keep the solver, simulator and integration services on the private network. Probe `/healthz`, `/api/health`, `/api/telemetry/health`, and `/api/traffic/health`.

## Recovery

Migrations are forward-only; correct a schema issue with a reviewed follow-up migration. Roll application containers back to a previous immutable image without deleting Supabase data. Enable backups or PITR appropriate to the production plan and expected database size.
