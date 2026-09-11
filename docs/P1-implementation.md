# RoadStar DispatchOS P1 Implementation

## Product objective

P0 reproduced the dispatcher’s manual morning and automated the assignment decision. P1 adds the layer the blueprint calls the difference between a dashboard and an operational product: the software must actively surface what a dispatcher would otherwise find by bouncing between tabs, and must keep the morning plan honest as traffic, docks and HOS clocks change.^1 The loop P0 ended at — plan → approve → execute — continues into detect → explain → recommend → re-approve.

## Status legend

| Marker | Meaning |
|---|---|
| Shipped | Implemented, covered by a test or a stated verification method |
| In progress | Partially implemented; the gap is named in this document |
| Planned | Designed and scheduled, not yet written |
| Deferred | Deliberately out of scope before code freeze, with a reason |

## P1 traceability

| P1 capability | Spec source | Implementation | Verification | Status |
|---|---|---|---|---|
| Explainable recommendations | Blueprint, explainability layer^1 | Every feasible and rejected pairing carries structured `FeasibilityReason` codes, deadhead, pickup ETA, projected HOS margin, score and a generated explanation; contention is reported separately from a hard blocker | Vitest constraint suite, 22 cases, mutation-verified | Shipped |
| Exceptions inbox | Blueprint, “build an exceptions system, not just a pretty dashboard”^1; brief, hidden-problem discovery^2 | Pure `detectExceptions(state, now)` deriving equipment, detention, HOS and pickup-window exceptions from live state | Vitest exception suite; interactive QA against the simulator | Planned |
| Automatic re-plan | Blueprint, live re-optimization^1 | Per-assignment health check recomputing ETA and HOS margin from current position, emitting a proposal diff rather than mutating assignments | Vitest re-plan suite; simulated 401 incident | Planned |
| Deadhead / backhaul assistant | Blueprint, look-ahead over nearest-truck^1 | Downstream positioning term in the optimizer objective | Vitest scenario comparing look-ahead against nearest-truck | Planned |
| KPI surface | Brief, workflow speed and financial value^2 | Open loads, active trips, available drivers, detention revenue, speed, ETA, distance and route progress | Production build and visual QA | Shipped |
| ROI baseline | Blueprint, “demonstrate baseline versus simulated optimized plan”^1 | Historical replay over the supplied workbook, comparing recorded empty distance against the planner’s projection | Deterministic replay over `data/raw` | Planned |
| Historical replay | Blueprint, prove value with supplied data^1 | Workbook importer normalising orders, dispatch legs, drivers, trucks and trailers | Row counts reconciled against the workbook | Planned |
| Integration adapters | Blueprint, provider contract architecture^1 | Telemetry reaches the app over SSE with an automatic browser fallback; the loading solver falls back to the in-browser planner | `/api/telemetry/health`, solver fallback path | In progress |
| Ontario 511 integration | Blueprint, Southern Ontario intelligence^1 | Incident overlay feeding ETA and delivery-risk recalculation | — | Deferred |

## Exceptions inbox: design of record

### Derivation, not storage

Exceptions are computed, never persisted. `detectExceptions(state, now)` is a pure function over the existing `DispatchState`, mirroring the optimizer’s contract so it is unit-testable without React, Supabase or a live simulator. Nothing in the exceptions layer mutates dispatch state; acting on an exception routes the dispatcher to the screen that already owns that action.

### Conditions detected

| Kind | Condition | Source of truth |
|---|---|---|
| `equipment` | An unassigned load whose every candidate fails on equipment, i.e. no compatible trailer exists in the current asset master | `evaluateCandidate` reasons |
| `detention` | A geofence visit whose dwell has passed the facility free allowance, and a separate warning as it approaches | `visits`, `facilities.freeMinutes` |
| `hos` | A driver whose remaining driving clock has fallen below the dispatch reserve, or an in-flight assignment projected to exhaust HOS before delivery | `drivers`, `assignments` |
| `pickup` | An unassigned load whose pickup window will close before any available unit can reach it | `evaluateCandidate` reasons |

The `equipment` case is the workbook’s own data-quality exception: the supplied orders contain 218 Flatbed loads while the trailer master contains only Dry Van and Reefer types. The blueprint treats detecting this rather than silently forcing an assignment as a scored outcome.^1 The detention thresholds implement the brief’s critical requirement that dock time beyond the free allowance be surfaced rather than lost.^2

### Contract

Each exception carries a stable identifier derived from its kind and subject, a severity, a title, a detail line, the entity it refers to, and the view that resolves it. Stable identifiers matter because the list recomputes on every telemetry tick; deriving the key from the subject keeps React reconciliation and any future dismissal state attached to the condition rather than to a list position.

### Cost

Detection evaluates unassigned loads against available drivers only. On the demo fleet this is a few dozen candidate evaluations per recomputation. Against the full supplied workbook the same naive product would be large enough to matter, so the importer work records a bound on candidate evaluation as a prerequisite rather than leaving it implicit.

### Explicit non-goals

The inbox detects and explains. It does not remediate, re-plan or reassign; automatic re-plan is a separate capability that consumes the same detectors and adds the per-assignment health check. No exception in this iteration depends on an external network service.

## Correction to the P0 record

The P0 implementation document lists an exceptions inbox under “P1 capabilities included.”^3 That entry overstates the shipped state. The command centre currently renders three fixed exception cards and a fixed open count in `src/app/App.tsx`; none of the three is derived from dispatch state, so the panel does not respond when the underlying condition is resolved. The capability is tracked here as Planned, and this document supersedes that claim.

## Operational limitations

- Optimizer weights remain compiled constants. The blueprint asks for them to live in configuration and to be surfaced to the dispatcher as an adjustable optimization goal; until that lands, a judge’s question about trade-offs cannot be answered by changing the weighting live.^1
- The optimizer scores each load in isolation. The downstream and utilization terms of the blueprint’s objective are absent, so a pairing that strands a unit after delivery is not penalised.^1
- Driver HOS carries three clocks. The brief additionally specifies a 16-hour elapsed window, which is not represented.^2
- The telemetry simulator interpolates movement but generates no events. Automatic re-plan cannot be demonstrated until route delays, dock waits and duty-cycle shifts can be injected, which the brief lists as required simulator functionality.^2
- No P1 capability writes to the relational schema. Dispatch state synchronises as a single snapshot document, so the `recommendations` and `detention_events` tables created by the P0 migration remain unwritten.

## Sources

1. RoadStar, “RoadStar Hackathon Build Blueprint: Unified Dispatch, Automation, and Open-Source Reuse,” supplied PDF, `docs/reference/roadstar-build-blueprint.pdf`.
2. RoadStar, “Hackathon Project Brief: City Dispatch Workflow & Fleet Automation,” supplied PDF, `docs/reference/roadstar-hackathon-project-brief.pdf`.
3. `docs/P0-implementation.md`, “P1 capabilities included.”
