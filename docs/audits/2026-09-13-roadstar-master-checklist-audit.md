# RoadStar master-checklist release audit — 2026-09-13

## Decision

The current `sawaab-v2` working tree is a deployable hosted-demo release candidate. Both pending Supabase migrations are applied and verified. Ontario OSRM still needs provisioning before the release can claim real road routing. The application is not represented as a live trucking-company ELD/TMS deployment; those cards and feeds remain explicitly labelled demo until vendors, API documentation and sandbox credentials exist.

The deterministic release gate, full local four-service stack, authenticated Supabase boundary checks and authenticated workflow checks pass. The current public deployment reports schema `20260913090218`, but it still serves the previous application version and presentation routing until this branch is committed and deployed.

## Confirmed findings and resolutions

| ID | Severity | Finding | Resolution / status |
|---|---|---|---|
| RSM-001 | S0 | The first version of the new plan migration attempted to create `loading_plans`, which already exists and is referenced by `loading_plan_items`. | Fixed before deployment. The migration now upgrades the table in place, preserves rows/FKs, backfills legacy plan data, and keeps existing RLS policies. Static regression added. |
| RSM-002 | S0 | Production Supabase was behind the code: expected `20260913090218`, live value was `20260913055147`. | Resolved. Both migrations were applied; live deployment verification now reads `20260913090218`. |
| RSM-003 | S1 | Editing a customer-facing load number could regenerate the internal load ID and make the update miss its original record. | Fixed. Edit preserves the immutable internal ID. Lifecycle browser regression added. |
| RSM-004 | S1 | Load-board headers rendered Status/Actions while row data rendered Actions/Status; custom rows had no table semantics. | Fixed. Column order now matches and table/row/header/cell roles are present. |
| RSM-005 | S1 | An OSRM-compatible provider could return invalid/negative metrics or malformed geometry and be treated as a valid route. | Fixed. Gateway validates positive finite distance/duration and at least two valid coordinate pairs, otherwise returning a controlled labelled fallback. |
| RSM-006 | S1 | Intermediate appointments could be outside the pickup-to-final-delivery window, and cargo could reference a nonexistent stop. | Fixed with chronological, duplicate-ID and stop-range validation plus unit coverage. |
| RSM-007 | S1 | Sync-event records were initially mutable by dispatch clients, weakening their value as an operational audit trail. | Fixed. Authenticated users can select/insert sync events, but not update/delete them; the integration outbox remains private. |
| RSM-008 | S2 | Local ELD health appeared `not_configured` while RoadStar demo telemetry was running. | Fixed. It reports `demo` and `RoadStar telemetry simulator`, never a live vendor. |
| RSM-009 | S1 | Ontario road routing is not active on the public deployment. | Open external gate. A guarded workflow, checksummed Ontario graph build, internal-only OSRM container, fail-closed readiness and route verification are ready. Run provisioning after confirming at least 8 GB combined RAM/swap; 72 GB disk is sufficient. |
| RSM-010 | S2 | No recurring host-monitor installation was packaged. | Fixed in code. Probe, hardened systemd oneshot and five-minute timer are included; production administrator must install/attach alerts once. |

## Master-checklist coverage

| Area | Evidence | Status |
|---|---|---|
| New-load workflow | Guided route/appointment form; multiple stops; mixed cargo; CAD/USD; validation; edit/duplicate/cancel/archive/restore; decision log; planner import | Pass locally |
| 3D planner | Mixed dimensions, clearance, pallet-displacement estimate, true layers, four objectives, floor-bearing/fragility/stack limits, manual safe moves, locks, cameras, layer/stop filters, unloading replay, plan history and approval | Pass locally; operational axle certification remains out of scope |
| Java xflp and browser fallback | Sidecar compilation plus fallback geometry/capacity/stack/floor-bearing tests | Pass |
| Ontario 511 | Server-side cached feed, map markers and re-plan decision UI | Pass locally and public endpoint responds |
| Routing | OSRM contract, readiness, input/output validation, representative-corridor verification and controlled fallback | Code pass; production provisioning pending |
| ELD foundation | Deterministic SSE simulator, event freshness/order/range validation, neutral health contract | Demo pass; real vendor pending |
| TMS foundation | Read-only normalized samples; conflict-authority contract; external IDs; sync events; idempotent private outbox | Demo pass; real vendor pending |
| Supabase tenancy | Five QA accounts, role checks, cross-organization RLS, driver ownership, decision records and optimistic concurrency | Pass against hosted Supabase |
| Deployment | GHCR build matrix, pinned SSH host identity, apex/www TLS config, OSRM override, readiness verification, monitoring assets | Static/local pass; new version not deployed |

## Verification evidence

- `npm run quality`: pass — 15 test files / 54 unit and integration tests, TypeScript build, Vite production bundle, Node gateway syntax, Java solver compile, 11 Chromium journeys and accessibility sweep.
- Full local `npm run dev:full`: solver, telemetry, integration gateway and Vite started; all 10 journeys present at that checkpoint passed against live local services.
- Direct local health probes: xflp `ok`, telemetry `demo` with fresh timestamps, integration gateway ready, neutral TMS demo returned three normalized read-only loads.
- `npm run verify:auth`: pass for Dispatcher A, Dispatcher A2, Driver A, Viewer A and Dispatcher B; foreign organization reads returned no rows.
- `npm run verify:auth:workflow`: pass — loading-plan version/save/approval/supersession, viewer approval denial, plan tenant isolation, realtime viewer update, viewer write denial, driver snapshot denial, cross-driver denial, invalid/repeated transition denial, driver accept/start, two decision records, tenant isolation, one-success/one-conflict concurrent save, QA cleanup and workspace restoration.
- The first realtime workflow attempt timed out waiting for a hosted event; the next complete run passed and restored state. Treat repeated occurrences as a Supabase/network reliability signal and monitor them, not as permission bypass.
- Production verification against `https://roadstardispatch.xyz`: web, readiness, SPA/CSP, solver, telemetry, Ontario 511, fallback routing, invalid coordinates, outside-graph behavior, schema `20260913090218` and anonymous-denial checks passed.
- Workflow/Compose YAML parsed successfully through Prettier and all four files conform to its formatting.
- `git diff --check`: pass. CRLF conversion notices are Git configuration warnings, not whitespace errors.

## Required activation order

1. Commit/push the release candidate and let the production workflow pass all jobs.
2. Independently verify and configure `DEPLOY_KNOWN_HOSTS` if it is not already present.
3. Confirm production has at least 8 GB combined RAM/swap, run **Provision Ontario OSRM** with `PROVISION-ONTARIO`, then set repository variable `REQUIRE_REAL_ROUTING=true`.
4. Rerun `npm run verify:deployment` with `ROADSTAR_REQUIRE_REAL_ROUTING=true`; all four Ontario corridors must return road geometry, positive distance and duration, not `presentation-fallback`.
5. Install/enable the included monitoring timer and connect failures to an external alerting destination.

## Honest remaining boundaries

- A selected real ELD and TMS, their private adapters, credentials, webhook signature verification and sandbox certification remain future integration work. RoadStar currently uses clearly labelled deterministic/synthetic data.
- Docker/Compose could not be executed on this Windows workstation because Docker is not installed. The user previously reported a production smoke test; this audit did not independently reproduce it.
- MapLibre and Three.js chunks remain large. Their workspaces are lazy-loaded and functional, but route-specific bundle reduction remains a worthwhile performance follow-up.
- The 3D plan is operational decision support. Axle geometry is visibly marked unverified and must not replace certified weight/securement checks.
