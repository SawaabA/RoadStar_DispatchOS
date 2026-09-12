# RoadStar P1 release audit — 2026-09-11

## Executive result

- Decision: **not ready for production until the P1 migration is authenticated, pushed, and cloud-tested**. The local application and full four-service development stack pass the release gate.
- Environment: branch `sawaab-v1-`, base commit `6d0ac0a`, working tree containing this P1 implementation; Windows, Node 22.13.1, npm 10.9.2, Java 23.0.1, Chrome at 1440×1000.
- Scope: all eight blueprint P1 capabilities, irregular cargo extension, Supabase persistence/concurrency, production serving, container packaging, security, usability and regression.
- Results: 12 pass, 0 fail, 3 blocked external checks.
- Open severity: S0 1, S1 0, S2 1, S3 0. Fixed and verified during this audit: S0 1, S1 3, S2 1.
- Highest residual risk: the remote Supabase project is not CLI-linked, so migration execution, RLS isolation, Data API grants, and two-session compare-and-swap behavior remain unverified on the real database.

## Findings

### RS-P1-001 / S0 — remote P1 schema is not applied

| Field | Evidence |
|---|---|
| Feature / role | Supabase persistence; every authenticated operator |
| Impact | Authenticated P1 writes and revision-checked snapshots cannot be released safely until the schema exists remotely. |
| Reproduction | Run `npx supabase link --project-ref rowwrpvjrzjlrdngwac --yes`. |
| Expected / actual | Expected a linked project; actual CLI error: access token not provided. |
| Root cause | Supabase CLI has not been authenticated in this environment. A publishable browser key is intentionally insufficient for schema administration. |
| Resolution | Run `npx supabase login`, link the intended project, review `migration list`, push, run advisors, and execute the cloud test matrix below. |
| Status | **Blocked — external authentication required.** |

### RS-P1-002 / S0 — stale realtime update could overwrite an unsaved edit

| Field | Evidence |
|---|---|
| Feature / role | Shared dispatch workspace; two dispatchers |
| Impact | A local consequential dispatch edit could be lost when a newer realtime snapshot arrived before the debounced save. |
| Root cause | The realtime handler accepted remote state without first comparing local state with the last synchronized state. |
| Resolution | Added revision-backed compare-and-swap RPC and client-side dirty-state detection. Conflicts preserve the local edit and show an explicit reload action. |
| Status | **Fixed; unit/build/browser regression pass. Remote two-session verification blocked by RS-P1-001.** |

### RS-P1-003 / S1 — traffic refresh could erase an injected closure

| Field | Evidence |
|---|---|
| Feature / role | Automatic re-plan; dispatcher |
| Impact | A dispatcher could inject a training incident, then see it disappear when the initial provider request completed. |
| Root cause | Provider results and operator-injected events shared one replaceable state array. |
| Resolution | Injected events now use separate state and merge deterministically with the provider result. |
| Status | **Fixed and verified by Playwright re-plan approval journey.** |

### RS-P1-004 / S1 — nearer minor incident could hide a closure

| Field | Evidence |
|---|---|
| Feature / role | Automatic re-plan; dispatcher |
| Impact | The re-plan could use a 14-minute roadwork delay while ignoring a relevant full closure on the same corridor. |
| Root cause | Incident selection sorted only by distance. |
| Resolution | Relevant events now rank closure and severity before distance. |
| Status | **Fixed; 35-minute closure proposal and decision log verified in browser.** |

### RS-P1-005 / S1 — unverified axle model rejected valid demo pallets

| Field | Evidence |
|---|---|
| Feature / role | 3D loading; load planner |
| Impact | xflp placed only 13 of 23 standard pallets even though geometry and gross weight fit. |
| Root cause | Generic steer/rear values were passed as a calibrated xflp two-axle model without verified tractor/trailer geometry. |
| Resolution | Axle enforcement is opt-in through `axleModelVerified`; uncalibrated plans show a release warning. xflp then placed 23/23 at 41,000 lb. |
| Status | **Fixed and verified against the live Java sidecar.** |

### RS-P1-006 / S2 — container execution unavailable

| Field | Evidence |
|---|---|
| Feature / role | Hosting; release engineer |
| Impact | Dockerfiles and Compose could not be executed on this Windows environment. |
| Resolution | CI/build inputs and native production gateway were tested; execute `docker compose ... up --build` on a Docker host before deployment. |
| Status | **Blocked by missing Docker installation.** |

## Feature traceability

| Requirement | Verification and evidence | Result |
|---|---|---|
| Explainable recommendations | Four visible score inputs, adjustable weights, separate hard feasibility reasons; optimizer tests | Pass |
| Exceptions inbox | Dynamic equipment/HOS/detention/traffic rows, stable IDs, acknowledgement and open-count updates | Pass |
| Automatic re-plan | Projected/original ETA, delay, delivery/HOS margins, approve/reject and audit record | Pass |
| Backhaul assistant | Feasible downstream matching, reposition/baseline/opportunity kilometres, approval-first decision | Pass |
| Ontario 511 | Official endpoint through gateway; live response `source=ontario-511`, 80 bounded incidents; markers and fallback | Pass |
| Historical replay | Workbook-derived 10,479-leg baseline, scenario and five lanes; upper-bound disclaimer | Pass |
| KPI/ROI dashboard | Live metrics plus baseline/scenario comparison; browser test | Pass |
| Integration adapters | Six provider cards, health-derived xflp/simulator status and documented swap targets | Pass |
| Irregular cargo | Presets/custom input, clearance, displacement estimate, actual dimensions into both solvers | Pass |
| Decision persistence | Local/cloud snapshot plus normalized authenticated `decision_records` path | Pass locally; remote blocked |
| Supabase concurrency | Revision column, security-invoker CAS RPC, local dirty-state protection and conflict recovery UI | Pass in code; remote blocked |
| Production host | Static SPA/direct routes/health/security headers and controlled upstream failure | Pass |
| Docker deployment | Four isolated services and private upstream networking | Not tested; Docker unavailable |
| Tenant RLS/grants | P1 migration has RLS, organization policies, explicit grants and indexes | Static pass; remote behavior blocked |
| Accessibility/usability | Axe serious/critical sweep across 11 workspaces, operator workflows, visible visual review | Pass |

## Verification record

- `npm test`: 7 files, 22 tests passed.
- `npm run build`: TypeScript and Vite production build passed.
- `services/loading-solver/build.ps1`: Java/xflp compilation passed.
- `npm run test:e2e`: 9 Chrome journeys passed, including Axe checks across all 11 workspaces.
- `npm audit --omit=dev`: 0 known vulnerabilities.
- Full-stack health: Ontario 511 live with 80 bounded events; simulator `ok`; xflp `0.7.7`.
- xflp base plan: 23 planned, 0 unplanned, 41,000 lb.
- Production gateway: root, direct SPA route, and `/healthz` returned 200 with `nosniff`; unavailable upstream returned controlled 502.
- Secret scan: only `.env.example` is tracked; no credential value or service-role key found.
- Visual inspection: intelligence and loader at 1440×1000; no overlap, clipped primary action, or inaccessible critical state observed.

## Remaining actions

1. Authenticate Supabase CLI, link project `rowwrpvjrzjlrdngwac`, inspect migration parity, and push the P1 migration.
2. Run Supabase Security and Performance Advisors, then test anon denial, two organizations, viewer read-only access, dispatcher writes, and a two-session revision conflict.
3. Build and smoke-test `docker-compose.yml` on a Docker host, then publish immutable images behind HTTPS.
4. Configure the final HTTPS Site URL and redirect URL in Supabase Auth before public release.

No remaining locally reproduced S0/S1 product defect was left unfixed. The production decision remains blocked because remote database authorization and Docker execution are external release evidence, not assumptions.
