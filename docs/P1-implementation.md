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

## Supabase model

`20260911145838_roadstar_p1_intelligence_and_concurrency.sql` adds `road_incidents`, `optimization_runs`, `decision_records`, `historical_replay_runs`, `provider_connections`, and `cargo_items`. Every exposed table has RLS, explicit authenticated grants, tenant predicates and access-pattern indexes. Authenticated decisions are also normalized into `decision_records`.

`save_dispatch_snapshot` is a security-invoker compare-and-swap RPC. It only updates an authorized tenant row when the expected revision matches. A stale writer receives a non-retryable `P0001` application error with the revision-conflict message; the app preserves the edit, shows a conflict, and requires an explicit reload. Authorization failures use `42501` so they cannot be mistaken for concurrent edits.

## Honest boundaries

- Ontario 511 supplies incidents. Production road-snapped routing still requires a contracted routing adapter.
- Backhaul and replay kilometres are opportunities, not guaranteed savings.
- HOS is planning guidance, not a certified ELD.
- Docker configuration is included but could not run on the development machine because Docker is not installed.
- The migration cannot be pushed until the Supabase CLI is authenticated and linked; a publishable browser key cannot perform schema administration.
