# RoadStar DispatchOS

RoadStar DispatchOS is a unified Southern Ontario dispatch workspace. It combines manual dispatch, explainable fleet-wide planning, practical Canadian HOS checks, live track-and-trace, geofences, automated detention, a focused driver workflow, and stop-aware 3D trailer loading.

## Run the application

Requirements: Node.js 22+ and a Supabase project for cloud synchronization. A JDK 17+ is optional: it enables the xflp loading solver, and without it the app falls back to the browser load planner.

```bash
npm install
cp .env.example .env.local   # Windows: copy .env.example .env.local
npm run dev:full
```

Open `http://localhost:5173`. `npm run dev` runs the web app alone with browser fallbacks. `npm run dev:full` also starts the independent telemetry simulator and Java xflp solver.

Every script is plain Node and runs on Linux, macOS, and Windows. The solver finds a JDK through `JAVA_HOME`, then `PATH`, then the platform's standard install locations, so a JDK that was never added to `PATH` still works. Set `JAVA_HOME` to override the choice.

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

```bash
npm run dev          # Vite web app
npm run simulator    # independent SSE telemetry provider on :7071
npm run solver       # xflp Java service on :7070 (skipped if no JDK is found)
npm run solver:build # compile the solver without running it
npm run dev:full     # all three services
npm test             # dispatch constraint tests
npm run test:e2e     # Chrome workflow and accessibility tests
npm run build        # type-check and production bundle
```

See [P0 implementation](docs/P0-implementation.md) for feature traceability, decisions, limitations, and source references.
See [P1 implementation](docs/P1-implementation.md) for the in-flight P1 capabilities, their status against the spec, and current limitations.
