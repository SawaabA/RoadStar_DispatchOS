# RoadStar feature matrix

Use the current product documents as the authority; update this matrix when they change. Test P0 before P1.

## Platform and startup

- Install from a clean checkout using documented prerequisites.
- `npm run dev` serves the browser-fallback experience.
- `npm run dev:full` starts web, simulator, and Java solver without orphaning processes or failing on stale ports.
- Missing Java, simulator, solver, Supabase, or network access yields an understandable fallback or actionable error.
- Environment variables match `.env.example`; no secret/service-role credential is bundled or logged.
- Production build and preview load direct routes and static assets correctly.

## P0 journeys

### Unified data and cloud synchronization

- Signed-out demo data is deterministic and usable.
- Authentication succeeds, persists appropriately, signs out cleanly, and reports failure clearly.
- Authenticated users see only their organization data.
- Snapshot load, writes, refresh, and realtime updates converge without duplicates or lost edits.
- Reconnect and stale-data states are visible; local fallback never masquerades as saved cloud data.

### Load board

- Search, filters, priority, equipment, appointment, value, and status display agree with source data.
- Empty/no-result and malformed data states remain understandable.
- Load status changes propagate to assignments, metrics, recommendations, and driver view.

### Driver and asset board

- Driver, truck, and trailer pairing remains unique and consistent.
- Location, availability, duty status, and all three HOS clocks are clear and correct.
- Missing assets or unavailable drivers cannot be dispatched accidentally.

### Manual dispatch and feasibility

- Eligible-unit results enforce equipment, service status, capacity, pickup window, driving time, on-duty time, and HOS margin.
- Exact constraint boundaries and multiple simultaneous failures are explained.
- Assignment, unassignment, and reassignment are atomic and recoverable.
- Double booking, repeated clicks, and stale competing actions do not corrupt state.

### Morning Auto-Plan

- Proposal planning does not mutate live dispatch state before approval.
- A truck, trailer, or driver is not assigned twice.
- Results are deterministic for identical input, feasible, explainable, and safely rejectable.
- No-solution and partial-solution cases identify why.

### Fleet map, simulator, and breadcrumbs

- Road/satellite style switching, facilities, truck markers, selected route, and breadcrumbs render and remain synchronized.
- Independent SSE simulator health and stream contracts work; browser fallback works when unavailable.
- Reconnect does not duplicate events or reset valid state unexpectedly.
- Route progress, speed, distance, ETA, and up-to-300 breadcrumb retention are internally consistent.

### HOS, geofences, and detention

- Practical 13-hour driving, 14-hour on-duty, and cycle buffers decrement and block unsafe plans at boundaries.
- Geofence entry/exit uses the correct facility radius and resists noisy repeated transitions.
- Detention begins and ends once, honors the 120-minute free threshold, and calculates billable minutes, rate, charge, and evidence correctly.
- Time-zone, timestamp, refresh, and repeated-event behavior do not duplicate charges.
- UI states clearly identify practical planning guidance versus certified ELD data.

### Driver interface

- Load details match dispatcher state.
- Accept/decline, start route, and status transitions are explicit, idempotent, and reversible where intended.
- HOS, next action, feedback, and failure recovery are understandable without dispatcher-only knowledge.

### 3D trailer loading

- Solver and browser fallback accept the same validated contract.
- Dimensions, weight, orientation, capacity, stop sequence, and units are unambiguous.
- Multiple items/loads visualize without overlap or exceeding trailer bounds.
- Impossible plans fail honestly with reasons; fallback is visibly identified.
- Camera, selection, labels, reset, loading, and error controls work with pointer and keyboard where applicable.

## Included P1 journeys

- Explainable recommendations show consistent score inputs, feasibility reasons, deadhead, and projected HOS margin.
- Exceptions inbox detects real equipment, HOS, and detention risks without noisy duplicates; acknowledgement state behaves correctly.
- KPI counts and money/distance/time values agree with board and trip data after every state change.

## Cross-cutting scenarios

- Two operators change the same assignment.
- Refresh occurs during an in-flight write.
- Service disconnects and reconnects during an active trip.
- Long names, many rows, many breadcrumbs, and missing optional values do not break layout.
- Dates, currency, distance, weight, and time zones use clear consistent units.
- Destructive or consequential actions provide confirmation, feedback, and recovery where practical.
