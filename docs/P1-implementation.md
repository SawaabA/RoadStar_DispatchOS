# RoadStar DispatchOS P1 implementation

P1 turns the P0 operating picture into an approval-first decision system. Recommendations remain explainable and reversible; live traffic can propose ETA changes, but only an operator can apply them.

## Traceability

| Capability | Connected implementation | Verification |
|---|---|---|
| Explainable recommendations | Weighted deadhead, on-time, HOS-buffer and future-position scores; hard constraints stay separate | Optimizer tests and browser candidate workflow |
| Exceptions inbox | Equipment, pickup, HOS, detention and traffic exceptions; stable IDs and acknowledgement state | Intelligence tests and browser accessibility sweep |
| Automatic re-plan | Corridor incidents show projected ETA, delivery slack and HOS margin before approval/rejection | Re-plan unit and browser approval test |
| Deadhead/backhaul assistant | Feasible next-load options compare repositioning with terminal return | Non-mutation test and decision cards |
| Ontario 511 | Cached server-side official feed, timeout, labelled demo fallback, map markers and re-plan input | Gateway contract and map workspace |
| Historical replay | Actual workbook baseline for 10,479 legs; reverse-lane result labelled upper-bound | KPI/replay browser journey |
| KPI/ROI dashboard | Live KPIs, historical distance, scenario comparison and top lanes | Browser journey and source reconciliation |
| Integration adapters | TMS, telematics, routing, traffic, loading and database contracts with swap targets | Integration workspace |
| Irregular cargo | Presets/custom dimensions, clearance, conservative pallet displacement and actual 3D protected geometry | Unit test, browser journey and Java compile |
| Versioned load plans | Immutable plan versions, history/restore and one approved version per trailer workspace | Supabase RPC contract and planner UI |
| Advanced trailer planning | Mixed dimensions, real stack layers, floor-bearing/fragility limits, four objectives, manual safe placement, locks, camera/layer/stop controls and unloading replay | Planner unit tests, xflp compile and browser journeys |
| Load intake | Guided order/route/stops/cargo creation, edit/duplicate/cancel/archive controls and decision history | Validation tests and end-to-end import into the 3D planner |

## Supabase model

`20260911145838_roadstar_p1_intelligence_and_concurrency.sql` adds `road_incidents`, `optimization_runs`, `decision_records`, `historical_replay_runs`, `provider_connections`, and `cargo_items`. Every exposed table has RLS, explicit authenticated grants, tenant predicates and access-pattern indexes. Authenticated decisions are also normalized into `decision_records`.

`save_dispatch_snapshot` is a security-invoker compare-and-swap RPC. It only updates an authorized tenant row when the expected revision matches. A stale writer receives a non-retryable `P0001` application error with the revision-conflict message; the app preserves the edit, shows a conflict, and requires an explicit reload. Authorization failures use `42501` so they cannot be mistaken for concurrent edits.

`20260913070240_support_load_creation_decisions.sql` extends decision logging for the load lifecycle. `20260913090218_loading_plan_versions_and_neutral_sync_contract.sql` upgrades the existing loading-plan table in place, adds atomic version/approval RPCs, cargo constraints, stable external-record links, append-only sync events and a private idempotent outbox. It deliberately preserves the original `loading_plan_items` foreign key and legacy plan rows.

## Honest boundaries

- Ontario 511 supplies incidents. An internal-only Ontario OSRM service, guarded preprocessing workflow and strict route verification are included; production remains on labelled presentation fallback until the graph is provisioned and `REQUIRE_REAL_ROUTING` is enabled.
- Backhaul and replay kilometres are opportunities, not guaranteed savings.
- HOS is planning guidance, not a certified ELD. Demo telemetry is explicitly labelled; a real vendor adapter remains a deployment input.
- TMS samples are read-only and explicitly labelled demo. The schema provides stable IDs, idempotency and an outbox, but real two-way sync waits for vendor documentation and sandbox credentials.
- Docker configuration is included but could not run on the development machine because Docker is not installed.
- The two latest migrations cannot be pushed from this workstation until the Supabase CLI is authenticated and linked; a publishable browser key cannot perform schema administration.
