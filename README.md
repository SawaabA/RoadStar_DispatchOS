# RoadStar DispatchOS

RoadStar DispatchOS is a unified Southern Ontario dispatch workspace. It combines manual dispatch, explainable fleet-wide planning, practical Canadian HOS checks, live track-and-trace, geofences, automated detention, a focused driver workflow, and stop-aware 3D trailer loading.

## Run the application

Requirements: Node.js 22+, Java 17+ for the xflp sidecar, and a Supabase project for cloud synchronization.

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev:full
```

Open `http://localhost:5173`. `npm run dev` runs the web app alone with browser fallbacks. `npm run dev:full` also starts the independent telemetry simulator and Java xflp solver.

## Environment

Only browser-safe Supabase values belong in `.env.local`:

```text
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
```

Never expose a Supabase secret or service-role key through a `VITE_` variable.

## Database

Migrations live in `supabase/migrations` and are forward-only. Apply them in timestamp order. The current P0 operations migration adds stops, trips, HOS clocks, detention, recommendations, organization-scoped write policies, realtime publication, and synchronized workspace snapshots.

Signed-out visitors use a deterministic local demo. Selecting the user menu sends a Supabase magic link; authenticated dispatchers with an explicitly provisioned `organization_members` record share their organization state through Supabase Realtime. Account creation does not grant organization access automatically.

## Commands

```powershell
npm run dev          # Vite web app
npm run simulator    # independent SSE telemetry provider on :7071
npm run solver       # xflp Java service on :7070
npm run dev:full     # all three services
npm test             # dispatch constraint tests
npm run test:e2e     # Chrome workflow and accessibility tests
npm run build        # type-check and production bundle
```

See [P0 implementation](docs/P0-implementation.md) for feature traceability, decisions, limitations, and source references.
