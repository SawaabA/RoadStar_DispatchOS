# RoadStar DispatchOS

RoadStar DispatchOS is a unified Southern Ontario dispatch workspace. It combines manual dispatch, explainable fleet-wide planning, practical Canadian HOS checks, live track-and-trace, geofences, automated detention, a focused driver workflow, and stop-aware 3D trailer loading.

## Run the application

Requirements: Node.js 22+, Java 21+ for the xflp sidecar, and a Supabase project for cloud synchronization.

```powershell
npm install
Copy-Item .env.example .env.local
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

```powershell
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase migration list
npx supabase db push
```

Signed-out visitors use a deterministic local demo. Selecting the user menu sends a Supabase magic link; authenticated dispatchers with an explicitly provisioned `organization_members` record share their organization state through Supabase Realtime. Account creation does not grant organization access automatically.

## Commands

```powershell
npm run dev          # Vite web app
npm run simulator    # independent SSE telemetry provider on :7071
npm run solver       # xflp Java service on :7070
npm run dev:full     # all four development services
npm test             # dispatch constraint tests
npm run test:e2e     # Chrome workflow and accessibility tests
npm run build        # type-check and production bundle
npm run quality      # full deterministic release gate
npm start            # serve the built production app on :8080
```

## Container deployment

Set the browser-safe Supabase values in `.env.local`, then run `docker compose --env-file .env.local up --build` and open `http://localhost:8080`. On a host, set `APP_ORIGIN` to the public HTTPS origin. Never provide a service-role key to the web build.

See [P0 implementation](docs/P0-implementation.md), [P1 implementation](docs/P1-implementation.md), and the [deployment runbook](docs/deployment.md).
