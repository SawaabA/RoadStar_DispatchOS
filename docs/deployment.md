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

The production driver workflow additionally requires `20260912231741_production_driver_workflow_and_observability.sql`. Link each driver account explicitly after creating the auth user and organization membership:

```sql
begin;
insert into public.organization_members (organization_id, user_id, role)
values (YOUR_ORGANIZATION_ID, 'AUTH_USER_UUID', 'driver')
on conflict (organization_id, user_id) do update set role = 'driver';

insert into public.driver_user_links (organization_id, user_id, driver_external_id, created_by)
values (YOUR_ORGANIZATION_ID, 'AUTH_USER_UUID', 'D-131', 'ADMIN_AUTH_USER_UUID');
commit;
```

Use the real external driver identifier instead of `D-131`. The database RPC permits only the linked driver to accept, start, or decline their own current assignment and logs every action.

## Runtime

Required browser build variables are `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Runtime variables include `APP_ORIGIN`, `SOLVER_URL`, `SIMULATOR_URL`, `INTEGRATION_URL`, `PORT`, and `HOST`. Provider credentials are server-only; see `.env.example` and the integration gateway README. The integration gateway also needs `SPUR_API_KEY` for AI features and `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` to verify AI callers; model selections default through `SPUR_MODEL_*`. Never place a password, secret key, or `service_role` key in a `VITE_` variable.

```bash
# local, builds from source
docker compose --env-file .env.local up --build

# production, pulls images CI already published
IMAGE_TAG=latest docker compose -f docker-compose.prod.yml up -d
```

### Self-hosted Ontario routing

For the RoadStar-managed OSRM option, install Docker Desktop and allow at least
15 GB of free disk space. Prepare the current Ontario graph, then start Compose
with the routing override:

```powershell
npm run osrm:prepare
npm run docker:osrm
```

The graph is downloaded from Geofabrik, checksum-verified, and processed with
OSRM's MLD pipeline. It remains in `deploy/osrm/data` and is excluded from both
Git and Docker build contexts. Only the integration gateway can reach OSRM;
the browser continues to use `/api/routing/route`. When routing is required,
gateway readiness now checks that OSRM can snap a Toronto coordinate rather
than treating a configured URL as proof of availability.

After the stack or hosted URL is live, verify it together with the expected database version:

```powershell
$env:ROADSTAR_BASE_URL = "https://dispatch.example.com"
npm run verify:deployment
```

Expose only the web service over HTTPS. Keep the solver, telemetry and integration services on the private network. Probe `/healthz` for liveness and `/readyz` for dependency readiness. Prometheus-format counters are available at `/metrics`; restrict that route at the ingress if metrics should not be public.

For a judging environment, the included simulator can supply the RoadStar SSE contract. For fleet operations, set `TELEMATICS_URL` to a private ELD adapter implementing `/api/telemetry/health` and `/api/telemetry/events`. Set `ROUTING_BASE_URL` to a contracted OSRM-compatible service and `REQUIRE_ROUTING=true`. TMS and ELD provider cards report `not configured` rather than pretending a simulator or Supabase is a live vendor connection.

Before opening traffic, set the final HTTPS `APP_ORIGIN`, configure TLS at the load balancer, enable Supabase backups/PITR as appropriate, configure production SMTP, and route the JSON service logs plus `/metrics` into the hosting platform's monitoring system.

## Recovery

Migrations are forward-only; correct a schema issue with a reviewed follow-up migration. Roll application containers back to a previous immutable image without deleting Supabase data. Enable backups or PITR appropriate to the production plan and expected database size.
