# RoadStar DispatchOS

RoadStar DispatchOS is a unified Southern Ontario dispatch workspace. It combines manual dispatch, explainable fleet-wide planning, practical Canadian HOS checks, live track-and-trace, geofences, automated detention, a focused driver workflow, and stop-aware 3D trailer loading.

## Run the application

Requirements: Node.js 22+ and a Supabase project for cloud synchronization. A JDK 17+ is optional: it enables the xflp loading solver, and without one the app falls back to the browser load planner.

Every script is plain Node and runs on Linux, macOS, and Windows. The solver finds a JDK through `JAVA_HOME`, then `PATH`, then the platform's standard install locations, so a JDK that was never added to `PATH` still works.

```bash
npm install
cp .env.example .env.local   # Windows: copy .env.example .env.local
npm run dev:full
```

Open `http://localhost:5173`. `npm run dev` runs the web app alone with browser fallbacks. `npm run dev:full` starts the web app, telemetry simulator, Java xflp solver, and Ontario 511 gateway.

## Environment

Only browser-safe Supabase values belong in `.env.local`:

```text
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
```

Never expose a Supabase secret or service-role key through a `VITE_` variable.

## Database

Migrations live in `supabase/migrations` and are forward-only. The P1 migration adds traffic, optimization, decision, replay, provider, irregular-cargo, and revision-checked snapshot records. Apply them through a linked Supabase CLI:

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase migration list
npx supabase db push
```

Signed-out visitors use a deterministic local demo. Selecting the user menu sends a Supabase magic link; authenticated dispatchers with an explicitly provisioned `organization_members` record share their organization state through Supabase Realtime. Account creation does not grant organization access automatically.

Authenticated driver accounts also require an explicit `driver_user_links` record. Drivers are restricted to the driver/map experience, and assignment acceptance, route start, and decline are validated and audited inside Postgres.

## Commands

```bash
npm run dev          # Vite web app
npm run simulator    # independent SSE telemetry provider on :7071
npm run solver       # xflp Java service on :7070 (skipped if no JDK is found)
npm run dev:full     # all four development services
npm test             # dispatch constraint tests
npm run test:e2e     # Chrome workflow and accessibility tests
npm run build        # type-check and production bundle
npm run quality      # full deterministic release gate
npm start            # serve the built production app on :8080
```

## Container deployment

Set the browser-safe Supabase values in `.env.local`, then run `docker compose --env-file .env.local up --build` and open `http://localhost:8080`. On a host, set `APP_ORIGIN` to the public HTTPS origin. For a self-hosted Ontario routing engine, prepare the map once with `npm run osrm:prepare`, then start the complete stack with `npm run docker:osrm`. The graph is generated from the Geofabrik Ontario OpenStreetMap extract and stays outside Git. Configure production ELD/TMS adapters with server-only variables when those providers are required. Never provide a service-role key to the web build.

See [P0 implementation](docs/P0-implementation.md), [P1 implementation](docs/P1-implementation.md), the [deployment runbook](docs/deployment.md), and the [deployment context briefing](docs/deployment-context.md).

For authenticated role, realtime, cross-organization, driver-action, and concurrency verification, follow [the multi-user QA guide](docs/auth-testing.md), then run `npm run verify:auth` and `npm run verify:auth:workflow`.
