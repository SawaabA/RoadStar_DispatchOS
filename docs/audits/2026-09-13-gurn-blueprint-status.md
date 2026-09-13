# Gurn merge and blueprint status — 13 September 2026

## Scope and decision

Compared the merged source with the 29 priority items on pages 4–6 of `docs/reference/roadstar-build-blueprint.pdf`: 14 P0, 8 P1, and 7 P2. This is a development/demo readiness assessment, not a certification of production operations. The remaining items below include partial implementations and configuration/verification work; a visible screen does not by itself complete a blueprint requirement.

Merge input: local `gurn` at `d41ad5b`, `origin/qazi2` at `97c3f30`, and `origin/sawaab-v2` at `ea07b46`. Qazi2 is already an ancestor of Sawaab-v2, so merging Sawaab-v2 brings both histories in. Earlier Qazi and Sawaab-v1 work is retained. The local conservative fleet optimizer and its constraint tests are preserved. Merge compatibility fixes pass active reservations/weights to the optimizer, preserve validated simulator incidents, evaluate backhaul availability at the projected future time, and retain Windows Java-build entry detection.

**Decision:** suitable for continued local development and a qualified demo. Production sign-off is blocked by the operational timing, mobile, integration, and authenticated-workflow gaps below. No cloud migrations, production data changes, deployment, or Git push were performed.

## Verification

- Dependencies refreshed with `npm ci --no-audit --no-fund`.
- Final quality gate passed: **233 tests across 26 files**, TypeScript/production build, **15 Chrome browser journeys**, and whitespace validation. The initial backhaul compatibility failure was fixed and the full gate rerun successfully. Vite reports large-chunk warnings; these are not build failures.
- The final staged diff additionally reports inherited trailing blank lines in two systemd files and one migration, and fixed-width PDF cross-reference whitespace in the incoming test fixture. These upstream bytes were preserved, including PDF offsets; the quality gate's working-tree whitespace check passed.
- Production gateway asset check: all 12 JavaScript/module/style assets have executable MIME types. Web and integration server syntax checks passed.
- Java solver compiled using JDK 24 targeting Java 17; `/api/health` returns `xflp-0.7.7` and `ok`.
- All four services start with `npm run dev:full`: web 5173, solver 7070, telemetry 7071, integrations 7072.
- Live local provider health: Ontario 511 connected; TMS and ELD explicitly demo; routing and AI not configured.
- Phone browser reproduction: Driver view at 390 × 844 has content width 1,114px and a body minimum width of 1,080px. Horizontal scrolling is required.
- Read-only Supabase `system_health` query returned HTTP 200 and schema version `20260913090218`, matching the newest local migration. This indicates the migration chain is reported current, but does not prove every policy or storage workflow works.
- No `.env.qa.local` or authenticated QA sessions were available. Real multiuser/tenant, driver-role, storage, conflict, and realtime tests are **blocked**. SQL contract tests and mocked HTTP tests are not substitutes for these checks. Existing teammate audit claims were not treated as fresh test results.

Status terminology: **Pass (local)** means implemented with local evidence; **Partial** means meaningful work remains; **Blocked** means the implementation exists but required live verification/configuration is unavailable. Remaining production integration work can still apply to locally passing features.

## P0 — core product (14 items)

| Blueprint item | Status and evidence | What remains |
|---|---|---|
| Unified data model | Partial. `src/features/dispatch/types.ts`, state validation, organization snapshots, normalized SQL entities. | Operational workbook/vendor ingestion and reconciliation into the shared model. Validate real fleet/load data rather than seeded fixtures. |
| Load board | Pass (local). `src/app/App.tsx`, `NewLoadForm.tsx`, load draft/new-load tests and browser journeys cover creation, editing and statuses. | Verify cloud-backed creation/edit permissions and persisted reload with signed-in users. |
| Driver and asset board | Pass (local). Fleet workspace and driver/truck/trailer models; equipment, HOS and assignment visibility. | Populate and validate real asset availability and driver clocks through an actual source. |
| Manual dispatch | Pass (local). `stateTransitions.ts`, optimizer feasibility checks, assignment/unassignment browser tests. | Verify dispatcher/viewer/driver cloud permissions and concurrent changes. |
| Feasibility checker | Pass (local). `optimizer.ts` plus local, Qazi and Sawaab tests cover equipment, capacity, temperature, availability, reservations, HOS, pickup waiting/service and delivery deadline. | Calibrate estimated travel times with road routing and actual operational data. |
| Morning auto-plan | Pass (local). Bounded fleet search maximizes coverage, then priority and weighted score, while avoiding duplicate asset/load assignment. | Benchmark realistic fleet sizes and road-time accuracy. Search has a 50,000-node bound; do not describe every result as a proven global optimum. |
| Map | Partial. `FleetMap.tsx`, `routingProvider.ts` support routes, fleet positions and map modes. | Configure `ROUTING_BASE_URL`; current route geometry fallback is a presentation aid. Validate provider/map behavior and attribution in the intended deployment. |
| Real-time simulator | Pass (local, synthetic). Seeded SSE service, simulated incidents, validation and browser fallback are implemented. | Reconcile simulated time, duty status, distance and detention consistently; use real telemetry for operational deployment. |
| Breadcrumb history | Partial. Assignments retain a rolling 300-point path with current speed and distance. | Durable timestamped historical telemetry, historical speed inspection and trip replay beyond the rolling snapshot. Keep traveled history distinct from proposed road geometry. |
| Practical HOS checks | Partial. Driving/on-duty/cycle budgets and assignment reserve checks exist. | Fix simulation duty/time accounting, particularly stopped vehicles; validate realistic rest/reset and shift scenarios before relying on clocks operationally. This is not a certified ELD. |
| Geofences | Pass (local). `geofencing.ts` and tests record entry/exit visits in dispatch state. | Verify cloud persistence, replay/out-of-order telemetry and real facility boundary behavior. Open dwell accounting still needs the timing fix below. |
| Detention | Partial. Facility free time/rates, visit history and charge estimates are implemented. | Use one consistent elapsed-time model, continue accrual for stationary/completed vehicles still inside a facility, and verify exit/re-entry without double billing. Current paths add two minutes per tick. |
| Driver interface / responsive PWA | Partial; phone layout fails. Driver transitions and POD controls exist, but 390px viewport produces 1,114px content width. | Bring in/review the separate mobile work, ensure phone-sized controls and workflows, and implement/verify installable PWA/offline behavior required for the intended driver experience. |
| Live sync | Blocked for live acceptance. Supabase snapshots, realtime, revision checks, membership/roles and driver RPCs exist. | Provision QA users and verify two-client updates, stale save conflicts, reconnect recovery, cross-tenant isolation and driver-only transitions. |

## P1 — intelligence (8 items)

| Blueprint item | Status and evidence | What remains |
|---|---|---|
| Explainable recommendations | Pass (local). Candidate component scores, reasons, HOS margin, rejected constraints and configurable weights. | Validate explanations against real route times and dispatch cases. |
| Exceptions inbox | Pass (local). `deriveExceptions`, document exceptions, stable IDs, acknowledgement state and decision log. | Verify realtime persistence/roles and production event sources. |
| Automatic re-plan | Partial. Closure impacts, projected delay/HOS risk and approve/reject UI exist. `resolveReplan` only changes the existing assignment ETA and logs a decision. | Recompute feasible routes/asset assignments across the fleet, compare alternatives, and apply a validated revised plan. An ETA adjustment is not fleet reoptimization. |
| Deadhead / backhaul | Partial. Future-position feasibility and avoided-empty-km suggestions exist. | `resolveBackhaul` currently logs “Reserved” without reserving the load or creating a chained assignment. Implement actual reservation, conflict protection and sequential trip scheduling. |
| Ontario 511 | Partial; event feed connected locally. Gateway normalizes/cache-fetches events; UI supports refresh and injected demo closures. | Verify full requested closure/construction/road-condition coverage and add camera support. Add an appropriate refresh policy; the client currently fetches on mount/manual refresh. |
| Historical replay | Partial. `historicalSummary.ts` is precomputed; analytics subtracts a matched-backhaul upper bound. | Import historical rows, reconstruct availability/constraints, run the optimizer over time, and compare actual versus feasible optimized dispatch. Current result is correctly labeled an upper bound, not a constrained replay. |
| KPI / ROI panel | Partial. Historical empty kilometres and current activity/decision metrics exist. | Implement measured before/after coverage, empty kilometres, HOS risk, late risk, detention and planning time from the same reproducible dataset. Avoid treating theoretical recoverable kilometres as realized savings. |
| Integration adapters | Partial. Gateway, OSRM contract, synthetic TMS/ELD endpoints, sync/outbox schema and health labels exist. | Configure routing and actual TMS/ELD credentials/endpoints; implement private ingestion/writeback workers, mapping, retries, idempotency and reconciliation. Health checks and demo endpoints do not complete two-way integrations. |

## P2 — advanced workflow (7 items)

| Blueprint item | Status and evidence | What remains |
|---|---|---|
| Multi-stop LTL consolidation | Partial. Mixed manifests, stop indexes and trailer packing are supported. | Joint load consolidation and route/stop-sequence optimization with capacity, appointments and HOS. Packing a manually ordered manifest does not optimize a multi-stop dispatch route. |
| 3D trailer | Pass (local core). `LoaderWorkspace`, `TrailerScene`, Java xflp and browser fallback support dimensions, irregular cargo estimates, layers, rotations, stacking, locks, manual moves, versions and printing. | Harden manual/locked placement revalidation and verify cloud version approval with authenticated roles. |
| Stop-aware loading | Partial. Stop colouring, unloading playback and unload strategy exist. | Enforce unloading accessibility after all manual moves, rotations, locks and stacking combinations, with regression tests for blocked deliveries. |
| Weight / balance | Partial. Payload, support/bearing constraints, centre-of-gravity and indicative axle/balance displays exist. | Calibrate real trailer/axle geometry and limits; the default axle model is explicitly unverified. Revalidate structural support/bearing/stop constraints after manual edits. |
| AI document intake | Partial / live blocked. Rate-confirmation text PDFs, scans/photos, extraction schema and reviewed load creation are implemented; server has a BOL schema. | Set server-only `SPUR_API_KEY`, sign in, test real documents, and complete BOL intake UI/workflow. Confirm field/date/unit mapping and review errors; no local live model calls were verified. |
| Dispatcher copilot | Partial / live blocked. Five grounded preset questions, references and deterministic fallback facts exist. | Configure SPUR and verify responses with real authenticated data. Extend beyond preset questions if the blueprint's broader conversational assistant is expected. |
| POD / documents | Blocked for live acceptance. Upload/signature/classification UI, private storage metadata, document exceptions and policies are present. | Verify actual upload, signed access, tenant/driver permissions, classification, delivery completion and recovery on upload failures using QA accounts and SPUR. |

## Highest-priority findings

1. **S1 — operational timing:** `useDispatchOperations.ts` increments open visits by two minutes per simulation update and updates HOS in an active-assignment loop. Stationary/completed vehicles and mixed wall/simulation time can yield misleading detention and driving clocks. Evidence is source inspection; no real-world billing impact was exercised. Fix the clock model and test waiting, completed-at-dock, duplicate telemetry and departure cases.
2. **S1 — backhaul acceptance does not reserve:** in the same hook, accepting a suggestion only records a decision whose summary says “Reserved.” Another dispatcher/plan can still allocate that freight. Add a real future assignment/reservation transaction, or change the product wording until implemented.
3. **S2 — driver mobile layout:** browser reproduction above confirms horizontal overflow. Review the separate mobile branch and add phone workflow coverage.
4. **S2 — manual loading validation:** `LoaderWorkspace.tsx:152` checks bounds and collisions but does not rerun support, bearing and stop-order constraints. Reproduction by code path: move a supporting floor item out from under an elevated item without colliding; the elevated item is left in place. Full physical acceptance remains untested. Revalidate the complete plan after changes and lock merges.
5. **S2 — scope overstatement:** re-plan, historical replay and LTL planning have narrower implementations than their blueprint names. Complete the algorithms described in the matrix before marking those priorities done.

## Setup and next work

Use `npm run dev:full` and open `http://localhost:5173`. Dependencies and the JDK are available on this machine. For individual services use `npm run dev`, `npm run solver`, `npm run simulator`, and `npm run integrations`.

The gateway loads `.env` then `.env.local`. Keep SPUR/provider tokens server-only. Configure `SPUR_API_KEY` for AI, `ROUTING_BASE_URL` for OSRM, and actual vendor adapter credentials when available. Supabase browser credentials are already present in ignored `.env.local`; their values were not copied into this report. Follow `docs/auth-testing.md` and `supabase/qa/README.md` for dedicated test users. The current auth verifier npm scripts explicitly load `.env`; this machine only has `.env.local`, so use the equivalent Node invocation with the correct env file or provide the expected ignored file before running them.

The reported latest schema version makes blindly reapplying migrations unnecessary. First run the authenticated verification against an approved test organization; investigate a specific failure before changing the database.

There is additional work outside the requested branch heads: `origin/driver-mobile`, `origin/detention-hardening`, `origin/osrm-swap-activation`, `origin/password-sign-in`, and newer `origin/main` commits. Some directly address gaps identified here. They were inspected as candidate follow-up sources but were not silently added to this merge. Review their diffs and dependencies before merging them.

Recommended order: fix timing and backhaul reservation; integrate mobile improvements; configure routing; run authenticated database/storage tests; then finish real re-planning/replay/LTL and validate AI. Accounting, payroll, maintenance and certified ELD remain outside this blueprint scope.
