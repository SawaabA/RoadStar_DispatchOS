# RoadStar DispatchOS quality audit — 2026-09-11

## Executive result

**Decision: not ready for production deployment. The signed-out/local demo is ready.**

- Scope: every platform, P0, included P1, usability, accessibility, data-integrity, security, and deployment-readiness item in the RoadStar quality matrix.
- Environment: Windows, Node 22.13.1, npm 10.9.2, Java xflp 0.7.7, Chrome through Playwright, branch `sawaab-v1-`, baseline commit `d688627` with the audit fixes uncommitted.
- Traceability results: **27 pass, 2 fail, 3 blocked, 4 not tested** across 36 rows.
- Residual severity: **S0: 2, S1: 1, S2: 3, S3: 0**.
- Automated result: 15 unit tests, 6 browser tests, production build, preview smoke test, dependency audit, Java solver contract, SSE contract, and `git diff --check` passed.
- Highest risks: the new security/integrity migration has not been applied to the live Supabase project; the JSON snapshot design is last-write-wins and can lose simultaneous operator edits; a true least-privilege cloud driver account cannot yet update its assignment.

## Findings

### RSQA-001 — S0 — automatic dispatcher enrollment

| Field | Detail |
|---|---|
| Feature / role | Supabase authentication and organization isolation; every account |
| Impact | Before the fix, any new Supabase user was automatically inserted into the RoadStar organization as a dispatcher and could modify operational data. |
| Reproduction | 1. Inspect `private.add_new_user_to_roadstar` in the P0 migration. 2. Create any auth user. 3. Observe the trigger insert a `dispatcher` membership without an invitation or admin decision. |
| Expected / actual | Expected explicit provisioning; actual account creation granted operational access. |
| Evidence | `supabase/migrations/20260910074945_dispatch_operations_p0.sql`; forward fix in `20260911054054_enforce_tenant_integrity_and_roles.sql`. |
| Root cause | Prototype onboarding trigger treated authentication as authorization. |
| Resolution | The forward migration drops the trigger/function and documents explicit membership provisioning. Audit existing memberships before rollout. |
| Status | **Blocked:** fixed in repository, but the migration has not been applied to the live project. |

### RSQA-002 — S0 — concurrent cloud edits can overwrite each other

| Field | Detail |
|---|---|
| Feature / role | Cloud synchronization; two dispatchers |
| Impact | Two operators editing the same organization snapshot can overwrite each other's work without a conflict warning. |
| Reproduction | 1. Open the same organization in two sessions. 2. Make different assignments before either session receives the other's update. 3. Both clients upsert the same snapshot row. 4. Last write wins. |
| Expected / actual | Expected an atomic conflict or merge; actual whole-document upsert has no revision predicate. |
| Evidence | `src/features/dispatch/hooks/useDispatchOperations.ts`, debounced `dispatch_snapshots` upsert. |
| Root cause | The prototype persists the full dispatch model as one JSON document rather than transactional domain rows or a versioned compare-and-swap operation. |
| Resolution | Add a revision column and transactional RPC as the minimum fix; migrate assignments/trips to normalized row-level writes for production. |
| Status | **Open.** Do not claim multi-operator production safety. |

### RSQA-003 — S1 — cloud driver role cannot complete its workflow

| Field | Detail |
|---|---|
| Feature / role | Driver accept/start actions; least-privilege `driver` member |
| Impact | The browser driver experience works in local demo mode, but the hardened policies correctly restrict snapshot writes to admin/dispatcher roles. There is no driver-scoped mutation API, so a real driver account cannot accept or start a load. |
| Reproduction | 1. Provision a member with role `driver`. 2. Sign in and accept an assignment. 3. Snapshot update is denied by the operator-only RLS policy. |
| Expected / actual | Expected a driver to update only their own assignment status; actual architecture offers either broad snapshot write or no write. |
| Evidence | Driver controls in `src/app/App.tsx`; operator policies in the new migration. |
| Root cause | Driver identity is not linked to a driver record, and all state writes share one organization snapshot. |
| Resolution | Add user-to-driver linkage and a security-definer/RLS-checked RPC allowing only valid status transitions for that driver's current assignment. |
| Status | **Open.** Local workflow passes; production cloud workflow does not. |

### RSQA-004 — S1 — realtime tenant filter initialized too early

| Field | Detail |
|---|---|
| Feature / role | Supabase Realtime; dispatcher |
| Impact | The channel could subscribe with `organization_id=eq.null`, silently missing other operators' updates. |
| Reproduction | Sign in and inspect the original effect: `connect()` started asynchronously while the channel was created immediately from the still-null organization ref. |
| Expected / actual | Expected subscription after membership resolution; actual subscription raced organization lookup. |
| Evidence | Fixed organization-scoped subscription in `useDispatchOperations.ts`. |
| Root cause | Async initialization order. |
| Resolution | Create the channel only after the membership and initial snapshot succeed; validate tenant ID on each payload; suppress state echoes. |
| Status | **Fixed and statically verified; live two-account verification blocked by unavailable test credentials.** |

### RSQA-005 — S1 — stale dispatch actions and incomplete feasibility

| Field | Detail |
|---|---|
| Feature / role | Manual dispatch and Morning Auto-Plan; dispatcher |
| Impact | The prior checker did not enforce truck availability or the cycle clock, and assignment did not revalidate the current state at click time. Unsafe or duplicate pairing was possible. |
| Reproduction | Mark a driver's truck unavailable or cycle clock exhausted, or click an old candidate after the asset state changes. |
| Expected / actual | Expected a hard rejection; actual candidate/assignment could proceed. |
| Evidence | `optimizer.test.ts`, `stateTransitions.test.ts`, and browser assign/unassign test. |
| Root cause | Feasibility only considered driver/trailer state, and UI candidates were trusted as current. |
| Resolution | Enforce driver, truck, trailer, equipment, capacity, pickup window, driving, on-duty and cycle constraints; re-evaluate inside the atomic state transition; add database uniqueness guards. |
| Status | **Fixed and verified locally; database guards await migration rollout.** |

### RSQA-006 — S1 — simulator advanced the wrong work and overbilled detention

| Field | Detail |
|---|---|
| Feature / role | Live trip, HOS, geofence, detention; dispatcher |
| Impact | External telemetry could advance work that had not started, increment unrelated open visits, and overlap with the browser timer to double detention minutes. Historical completed assignments could also release a reused driver/trailer. |
| Reproduction | Start simulation with proposed/accepted work and multiple open visits, or reuse an asset after a completed assignment. |
| Expected / actual | Expected only the telemetry truck's active trip/visit to change once; actual unrelated or duplicated updates occurred. |
| Evidence | Corrected per-truck telemetry freshness, active-status checks, dwell update, and active-before-completed release logic in `useDispatchOperations.ts`. |
| Root cause | Global simulator flags and history-insensitive resource release. |
| Resolution | Track freshness per truck, move only `in_transit` assignments, increment only the relevant provider's visits, and prefer active reuse over historical completion. |
| Status | **Fixed; unit/build/browser/full-stack regression passes.** |

### RSQA-007 — S1 — noisy geofence boundaries could create repeated visits

| Field | Detail |
|---|---|
| Feature / role | Geofence and detention evidence |
| Impact | GPS movement around the exact radius could repeatedly close and reopen a visit, fragmenting evidence and charges. |
| Reproduction | Alternate points just inside and just outside a facility radius. |
| Expected / actual | Expected a stable transition; actual exact-threshold logic flapped. |
| Evidence | `geofencing.ts` and `geofencing.test.ts`. |
| Root cause | Identical entry and exit threshold with no hysteresis. |
| Resolution | Keep entry at the configured radius and require 115% of radius to exit; retain one open visit per truck/facility. |
| Status | **Fixed and unit-tested.** |

### RSQA-008 — S1 — 3D fallback accepted or displayed impossible freight

| Field | Detail |
|---|---|
| Feature / role | 3D trailer loading; planner user |
| Impact | Zero pallets could appear successful; entered pallet dimensions were ignored; oversized/tall freight could be placed outside the trailer; rotation was ignored. |
| Reproduction | Enter zero pallets, custom dimensions, a pallet taller/wider than the trailer, or a pallet that only fits after rotation. |
| Expected / actual | Expected validation or honest unplanned output; actual fallback could show a plausible but invalid plan. |
| Evidence | `planner.test.ts`, Java 400 contract check, and browser invalid-input journey. |
| Root cause | Hard-coded fallback geometry and incomplete bounds checks. |
| Resolution | Share contract validation, use shipment dimensions, honor rotation, enforce length/width/height/weight, and expose warnings/unplanned items. |
| Status | **Fixed and verified.** |

### RSQA-009 — S2 — malformed persisted/telemetry data could crash views

| Field | Detail |
|---|---|
| Feature / role | Local persistence, cloud snapshot, map/simulation |
| Impact | Orphaned assignments/assets or invalid SSE JSON could cause non-null assertion and parsing failures. |
| Reproduction | Store an assignment referencing a missing truck or emit malformed SSE JSON. |
| Expected / actual | Expected fallback/error state; actual code trusted data shape. |
| Evidence | `stateValidation.test.ts`; guarded SSE and map lookups. |
| Root cause | External/persisted data was cast directly to `DispatchState`. |
| Resolution | Validate collection shape and referential integrity at storage/realtime boundaries; ignore malformed telemetry; skip orphaned map/simulation records safely. |
| Status | **Fixed and verified.** |

### RSQA-010 — S2 — accessibility and interaction semantics

| Field | Detail |
|---|---|
| Feature / role | All workspaces; keyboard and assistive-technology users |
| Impact | Unnamed icon buttons, low contrast, non-semantic modals, missing focus indication, and inert-looking actions made important workflows difficult or misleading. |
| Reproduction | Run axe across all eight views and navigate controls by accessible role/name. |
| Expected / actual | Expected labelled, keyboard-visible controls and semantic dialogs; original scan reported serious/critical violations. |
| Evidence | `tests/e2e/dispatchos.e2e.ts`; updated `App.tsx` and `styles.css`. |
| Root cause | Visual-first prototype controls lacked semantic and contrast requirements. |
| Resolution | Add dialog roles/names, button labels, focus-visible styling, improved contrast, real/disabled affordances, empty states, keyboard search, and escape/close behavior. |
| Status | **Fixed: zero serious/critical axe findings across all eight primary workspaces.** |

### RSQA-011 — S2 — map style and missing-reference recovery

| Field | Detail |
|---|---|
| Feature / role | Live map; dispatcher |
| Impact | A selected route could disappear after a style change, and an orphan assignment could crash route construction. |
| Reproduction | Select a route then switch road/satellite, or provide an assignment with no load. |
| Expected / actual | Expected route restoration/safe omission; actual load timing and non-null lookup were unsafe. |
| Evidence | `FleetMap.tsx`; browser map-style toggle test. |
| Root cause | Route layer restored on a less reliable event and trusted assignment references. |
| Resolution | Restore on `style.load` and skip missing loads. |
| Status | **Fixed and browser-tested.** |

### RSQA-012 — S2 — production bundle size

| Field | Detail |
|---|---|
| Feature / role | Startup/performance; all users |
| Impact | Map and Three bundles are approximately 1.03 MB and 0.91 MB minified before gzip, increasing first-load cost. |
| Reproduction | Run `npm run build` and inspect chunk warnings. |
| Expected / actual | Expected feature code to load on demand; actual heavy libraries are manual chunks but still part of the initial dependency graph. |
| Evidence | Vite build output. |
| Root cause | Workspace modules are conditionally rendered but not dynamically imported. |
| Resolution | Lazy-load map and 3D workspaces and set measured performance budgets. |
| Status | **Open; workaround is modern-browser caching.** |

## Feature traceability

| # | Feature / requirement source | Verification and evidence | Result |
|---:|---|---|---|
| 1 | Clean-checkout install | Existing dirty worktree was intentionally preserved; `npm install` succeeded earlier, but no separate clean clone was created. | NOT TESTED |
| 2 | `npm run dev` browser experience | Vite-only run loaded all views; loader reported `BROWSER-FALLBACK`. | PASS |
| 3 | `npm run dev:full` | Web `:5173`, Java `:7070`, and simulator `:7071` started together; stale app ports were cleaned. | PASS |
| 4 | Missing solver/simulator fallback | Loader falls back visibly; new in-transit trucks use per-truck browser telemetry. Missing Java executable itself was not simulated. | PASS |
| 5 | Environment/secrets contract | `.env.example` names pass; only browser-safe URL/publishable key names were inspected; no service-role key is tracked. | PASS |
| 6 | Production build/preview | TypeScript/Vite build passed; preview loaded all eight code-split views and correct document titles. | PASS |
| 7 | Deterministic signed-out data | Local state loads, resets with confirmation, persists locally, and never caches a cloud organization snapshot. | PASS |
| 8 | Auth success/persistence/sign-out/failure | UI error/loading paths reviewed; no disposable mailbox/authenticated test account was available. | BLOCKED |
| 9 | Authenticated organization isolation | SQL/RLS reviewed and hardened; live cross-tenant tests require migration rollout plus two organizations/accounts. | BLOCKED |
| 10 | Snapshot read/write/realtime convergence | Race/echo/tenant checks fixed in code; live multi-session verification unavailable. | BLOCKED |
| 11 | Two-operator conflict safety | Whole-snapshot upsert remains last-write-wins. | FAIL |
| 12 | Load board values/search/filter/status | Browser search, priority/equipment/appointment/value/status display, global Ctrl+K focus, and no-result state exercised. | PASS |
| 13 | Malformed/empty load state | Boundary validator rejects orphaned snapshots; board empty states render. | PASS |
| 14 | Load status propagation | Browser assignment/unassignment updates open count; driver start changes route state. | PASS |
| 15 | Driver/truck/trailer pairing and HOS display | Fleet board visually exercised; state and DB constraints reviewed. | PASS |
| 16 | Missing/unavailable assets cannot dispatch | Optimizer and state-boundary tests cover unavailable truck, asset mismatch, stale repeat action, and orphan state. | PASS |
| 17 | Manual feasibility and exact boundaries | Unit tests cover status, equipment, weight, pickup timing, driving/on-duty/cycle, exact HOS equality, and simultaneous reasons. | PASS |
| 18 | Atomic assignment/unassignment | Pure transition tests and browser journey verify all paired resources and active-trip protection. | PASS |
| 19 | Morning Auto-Plan | Proposal-before-approval browser test plus feasibility, uniqueness, determinism, partial/no-solution unit checks. | PASS |
| 20 | Fleet map layers/style/selection | Chrome exercised road/satellite state, facilities/trucks/routes source code, and selected-route restoration. | PASS |
| 21 | SSE simulator and browser fallback | Health returned two vehicles; SSE emitted structured samples; fallback visibly identified with services off. | PASS |
| 22 | Disconnect/reconnect during active trip | Offline start is covered, but a forced mid-trip disconnect/reconnect sequence was not automated. | NOT TESTED |
| 23 | Progress/speed/distance/ETA/breadcrumbs | SSE contract sampled; only `in_transit` work progresses; breadcrumbs cap at 300; map consumes the same assignment state. | PASS |
| 24 | Practical HOS | Three clocks block at boundaries and decrement only active driving. UI labels the feature as practical guidance rather than certified ELD. | PASS |
| 25 | Geofence stability | Unit test verifies single entry, no duplicate inside event, 15% exit hysteresis, and single departure. | PASS |
| 26 | Detention calculation/evidence | Correct truck-only dwell progression, 120-minute free threshold, rate/charge calculation, and browser evidence disclosure reviewed. | PASS |
| 27 | Time-zone/DST and refresh during open detention | ISO timestamps/repeat protection reviewed, but DST boundary and authenticated refresh tests were unavailable. | NOT TESTED |
| 28 | Driver interface | Browser verifies accepted load starts route; details/HOS/next actions/decline path and empty-assignment state reviewed. | PASS |
| 29 | Least-privilege cloud driver mutations | No user-to-driver identity/RPC exists. | FAIL |
| 30 | 3D solver/fallback contract | Java valid request placed two pallets; invalid request returned 400; shared frontend validation tests pass. | PASS |
| 31 | 3D geometry/capacity/impossible plans | Unit tests cover entered dimensions, rotation, height/width/length/weight bounds, multi-pallet non-overlap, and honest unplanned output. | PASS |
| 32 | 3D controls/accessibility | Loading/error/reset/regenerate/detail/scene labelling exercised; pointer scene remains supplemental to textual counts/warnings. | PASS |
| 33 | Explainable recommendations (P1) | Scores, deadhead, HOS margin, feasibility, and structured rejection reasons are generated from the tested optimizer. | PASS |
| 34 | Exceptions inbox (P1) | Equipment, HOS, and detention exceptions render and navigate to the relevant workspace; persistent acknowledgement is not a documented included capability. | PASS |
| 35 | KPI surface (P1) | Open/active/available/revenue/detention values derive from current shared state and update with tested transitions. | PASS |
| 36 | Long names, very large lists/breadcrumb volumes | Breadcrumb cap is reviewed, but generated stress data and layout/performance thresholds were not exercised. | NOT TESTED |

## Verification record

| Verification | Result |
|---|---|
| `powershell -ExecutionPolicy Bypass -File .agents/skills/roadstar-quality-auditor/scripts/run-quality-gate.ps1` | PASS: Node/npm, required paths, env contract, tests, build, browser suite, and diff check. |
| `npm test` | PASS: 5 files, 15 tests. |
| `npm run build` | PASS: production bundle built; large map/Three chunk warning retained as RSQA-012. |
| `npx playwright test` | PASS: 6 Chrome tests covering all eight workspaces, serious/critical axe scan, dispatch, plan approval, driver route start, loader validation, search, map style, and detention evidence. |
| `npm audit --omit=dev --json` | PASS: 0 known vulnerabilities across production dependencies. |
| `npm run dev:full` | PASS: all three services reached ready state. |
| Solver `GET /api/health` | PASS: `ok`, engine `xflp-0.7.7`. |
| Solver valid/invalid `POST /api/plan` | PASS: 2 planned/0 unplanned; zero-pallet request returned HTTP 400. |
| Simulator health/SSE | PASS: 2 vehicles and multiple valid `data:` events sampled. |
| Vite-only fallback | PASS: 3D plan health displayed `BROWSER-FALLBACK`. |
| Production preview | PASS: all eight workspaces loaded; title ended at `3D load planner · RoadStar DispatchOS`. |
| `git diff --check` | PASS; Windows line-ending notices are informational. |
| RoadStar skill validation | PASS: `quick_validate.py` reported `Skill is valid!`. |

## Remaining limitations and next actions

1. **Before any production use:** audit current `organization_members`, apply `20260911054054_enforce_tenant_integrity_and_roles.sql`, then verify the trigger is gone, operator policies exist, tenant FKs validate, and active-resource indexes were created. The migration intentionally fails if existing cross-tenant or duplicate-active data violates the new invariants.
2. Test RLS with four disposable accounts: admin, dispatcher, driver, and non-member. Confirm a non-member sees no organization data and viewer/driver cannot mutate general tables.
3. Replace last-write-wins snapshot writes with a revision-checked transactional RPC, then automate two-browser conflict and refresh-during-write tests.
4. Add user-to-driver linkage and a narrowly scoped assignment-status RPC; rerun the complete driver journey as an actual `driver` role.
5. Add a forced SSE disconnect/reconnect browser test and DST/open-detention refresh tests.
6. Lazy-load MapLibre and Three workspaces, define Core Web Vitals budgets, and run generated long-name/large-list stress fixtures.
7. Product limitations remain: routes are presentation geometry rather than road-snapped routing, practical HOS is not a certified ELD, and estimated pallet geometry must be verified operationally.

The audit did **not** apply a remote migration, create users, change live data, expose environment values, or deploy the application.
