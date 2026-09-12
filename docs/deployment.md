# RoadStar deployment runbook

## Release gate

From a clean checkout with Node.js 22 and Java 21:

```powershell
npm ci
npm run quality
```

## Supabase

Use staging and production projects where possible. Authenticate, link the intended project, review parity, then push once:

```powershell
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase migration list
npx supabase db push --dry-run
npx supabase db push
```

Run Supabase Security and Performance Advisors after the push. Confirm P1 tables are available to `authenticated` but not `anon`, and verify two sessions surface a revision conflict. Configure the exact HTTPS Site URL and redirect URL in Authentication settings. Provision `organization_members` explicitly.

## Runtime

Required browser build variables are `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Optional runtime variables are `APP_ORIGIN`, `SOLVER_URL`, `SIMULATOR_URL`, `INTEGRATION_URL`, `PORT`, and `HOST`. Never place a password, secret key, or `service_role` key in a `VITE_` variable.

```powershell
docker compose --env-file .env.local up --build
```

Expose only the web service over HTTPS. Keep the solver, simulator and integration services on the private network. Probe `/healthz`, `/api/health`, `/api/telemetry/health`, and `/api/traffic/health`.

## Recovery

Migrations are forward-only; correct a schema issue with a reviewed follow-up migration. Roll application containers back to a previous immutable image without deleting Supabase data. Enable backups or PITR appropriate to the production plan and expected database size.
