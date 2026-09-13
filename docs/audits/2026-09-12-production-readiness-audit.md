# RoadStar production-readiness audit — 2026-09-12

## Executive result

- Decision: **ready for a hosted judging build after applying the new driver migration; not yet ready for real fleet operations until production TMS, ELD, and routing providers are selected and configured.**
- Environment: branch `sawaab-v1-`, base commit `ab2e93c`, Windows, Node 22.13.1, Java xflp 0.7.7, Chrome at 1440×1000.
- Verified live Supabase state: schema `20260911145838`; P1 tables exist; anonymous reads of `dispatch_snapshots`, `decision_records`, and `cargo_items` are denied.
- Local verification: 9 test files / 28 tests, production bundle, Java compilation, 9 browser journeys, Node service syntax, production gateway health/readiness, CSP, direct SPA route, routing success/fallback contracts, and dependency audit.
- Open severity: S0 1, S1 0, S2 2, S3 0.

## Findings

### RSPR-001 / S0 — production driver migration is not live

| Field | Detail |
|---|---|
| Feature / role | Authenticated driver workflow |
| Impact | The new least-privilege driver action RPC and explicit user-to-driver links are unavailable until the migration is applied. |
| Reproduction | Run `npm run verify:deployment`; the live schema reports `20260911145838` and `driver_user_links` returns 404. |
| Expected / actual | Expected schema `20260912231741`; actual remote schema is the preceding P1 version. |
| Resolution | Apply `20260912231741_production_driver_workflow_and_observability.sql`, provision a linked driver, then rerun deployment verification and two-account tests. |
| Status | Open — remote schema authorization is unavailable in this terminal. |

### RSPR-002 / S2 — production providers are not configured

| Field | Detail |
|---|---|
| Feature / role | TMS, ELD and routing; operations team |
| Impact | The judging build has deterministic/demo fallbacks, but cannot claim live vendor data or road routing. |
| Evidence | `/api/integrations/health` reports `tms:not_configured`, `eld:not_configured`, `routing:not_configured`, and `traffic:connected`. |
| Resolution | Select vendors and set the documented server-only health/API variables. ELD must implement the RoadStar SSE contract; routing must be OSRM-compatible. |
| Status | Open external dependency; the UI labels each fallback honestly. |

### RSPR-003 / S2 — Docker execution is not independently available here

| Field | Detail |
|---|---|
| Feature / role | Container release |
| Impact | The user's smoke test is reported complete, but this machine cannot independently rebuild Docker images. |
| Resolution | A Linux `container-smoke` CI job now builds the four images, waits for health, and checks readiness/direct routes on every pull request and main-branch push. |
| Status | CI verification pending the next push. |

## Fixed and verified

| Capability | Result |
|---|---|
| Driver identity | Added one-to-one organization/user/driver links with tenant FK and indexed access paths. |
| Driver authorization | Private security-definer implementation validates `auth.uid()`, driver membership, linked driver, assignment ownership, and allowed transition; the public wrapper remains security-invoker. |
| Driver UX | Driver accounts see only driver/map navigation; pending, missing-link, failure, accept, start, and decline states are explicit. |
| Decision audit | Driver accept/start/decline actions create durable decision records and increment the shared snapshot revision atomically. |
| Viewer safety | Cloud viewers cannot execute mutation hooks and receive a visible read-only banner. |
| Routing | OSRM-compatible server adapter returns distance, duration and road geometry; maps visibly label road-routed versus presentation fallback. |
| Provider truthfulness | TMS/ELD/routing cards no longer describe simulators or configuration readiness as live connections. |
| Operations | Added liveness/readiness, request IDs, structured JSON logs, Prometheus counters, upstream timeouts, bounded request bodies, graceful shutdown and container health checks. |
| Web security | Added CSP, frame protection, referrer/permissions policies, safe path handling, generic upstream errors and correlation IDs. |
| Resilience | Added a user-facing React error boundary that preserves stored data and supplies a support reference. |
| Performance | Fleet map is now lazy-loaded independently from the main application bundle. |

## Verification record

- `scripts/run-quality-gate.ps1`: pass after implementation.
- `npm test`: 9 files, 28 tests pass.
- `npm run build`: pass; heavy MapLibre/Three chunks remain lazy boundaries.
- `npm run test:e2e`: 9 browser journeys pass with no serious/critical Axe result.
- Production-host browser accessibility/console sweep: pass after CSP correction.
- Native production `/healthz`, `/readyz`, direct `/driver`, API proxy and metrics: pass.
- Routing adapter: live OSRM-compatible smoke returned a 42.707 km route; unconfigured mode returned a labelled presentation fallback without breaking the map.
- `npm audit --omit=dev`: 0 known vulnerabilities.
- `npm run verify:deployment`: correctly fails only for the not-yet-applied `20260912231741` schema and missing `driver_user_links` table.

## Required release actions

1. Apply the new migration and create at least one explicit driver link.
2. Test admin, dispatcher, viewer, linked driver, unlinked driver and non-member accounts against the live project.
3. Push the branch so the container smoke job runs, then merge it into `main` only after both jobs pass.
4. For real fleet use, configure contracted TMS, ELD and routing adapters. The code intentionally does not call a simulator “production.”
5. Run Supabase Security and Performance Advisors, configure backups/PITR, production SMTP, exact HTTPS auth redirects and hosting alerts.
