# RoadStar DispatchOS P0 Implementation

## Product objective

DispatchOS reproduces the dispatcher’s manual morning workflow first, then adds deterministic optimization and live operational automation. The central loop is loads → feasibility → proposal → dispatcher approval → driver acceptance → live trip → geofence and detention evidence. This follows the build order and definition of done in the supplied product strategy.^1

## P0 traceability

| P0 capability | Implementation | Verification |
|---|---|---|
| Unified data model | Organization-scoped Postgres tables for drivers, trucks, trailers, loads, assignments, stops, trips, HOS clocks, telemetry, geofences, detention, and recommendations | Forward migration and schema health version |
| Load board | Searchable order table plus priority, equipment, appointment, value, and status views | Production build and visual QA |
| Driver and asset board | Driver–truck–trailer pairing, location, availability, duty status, and three practical HOS clocks | Production build and visual QA |
| Manual dispatch | “Find eligible unit” workflow, hard feasibility failures, assignment, unassignment, and reassignment path | Constraint tests and interactive UI |
| Feasibility checker | Equipment, status, capacity, pickup-window, driving-time, on-duty-time, and HOS-margin checks | Vitest constraint suite |
| Morning Auto-Plan | Fleet-wide backtracking search that avoids double-booking and returns an approval proposal without mutating live state | Vitest uniqueness/feasibility test |
| Fleet map | MapLibre Southern Ontario map, road/satellite toggle, facilities, truck markers, active route and breadcrumbs | Browser visual QA |
| Real-time simulator | Independent Node/SSE service; browser provider is the automatic fallback | `/api/telemetry/health` and live SSE sample |
| Breadcrumbs | Up to 300 coordinates retained per active trip, with speed and distance progression | Simulator stream and map rendering |
| HOS checks | Practical 13-hour driving, 14-hour on-duty, and cycle buffers represented and decremented during simulation | Constraint test and live fleet cards |
| Geofences | Turf distance checks against facility radius during each telemetry update | End-to-end simulation logic |
| Detention | Arrival/departure state, 120-minute free threshold, billable minutes, hourly rate, charge, and evidence state | Detention desk demo records |
| Driver interface | Focused driver workflow for load details, acceptance, route start, and HOS | Driver view interaction |
| Live synchronization | Authenticated organization snapshot via Supabase Realtime; deterministic local mode remains available | Auth/session and realtime subscription implementation |

## P1 capabilities included

- Explainable recommendations: every feasible or rejected pairing carries structured reasons, deadhead, score, and projected HOS margin.
- Exceptions inbox: equipment mismatch, HOS risk, and detention opportunities appear in the command center.
- KPI surface: open loads, active trips, available drivers, detention revenue, speed, ETA, distance, and route progress.

## Build-versus-reuse decisions

MapLibre GL JS is used for WebGL mapping and GeoJSON layers; its official documentation describes the map/style/source model used here.^2 Turf modules provide the geospatial distance primitive used by the geofence provider. Supabase supplies authentication, Postgres, RLS, and realtime; its current guidance requires both grants and RLS policies for exposed tables, which the operations migration applies explicitly.^3 Supabase Postgres Changes requires selected tables to be placed in the realtime publication, also handled by the migration.^4

The dispatcher domain, feasibility rules, batch proposal workflow, simulator contract, and detention state are RoadStar-specific code. xflp remains isolated behind the existing Java HTTP sidecar because its truck-loading constraints are more specialized than the dispatch assignment problem. Restricted-license full TMS repositories were not copied.

## Operational limitations

- Dispatch estimates use great-circle distance multiplied by 1.2, 60 km/h average travel, 30 minutes at each service stop, and a 30-minute reserve on each available HOS clock. Pickup waiting consumes on-duty and cycle time. Delivery feasibility checks completion after service. These are configurable code assumptions, not road-routing results or a complete regulatory HOS model.
- The morning planner maximizes the number of covered loads, then summed priority (critical 3, high 2, standard 1), then minimizes deadhead. It reserves each driver, truck, trailer, and load at most once, including existing active assignments supplied by the application. A deterministic 50,000-node search budget returns the best proposal found; larger fleets are not guaranteed globally optimal. Driver availability must be `Now` or a dated timestamp. No rest-related clock replenishment is inferred.
- Manual and batch assignments are rechecked against current state when applied. The UI's HOS-after figure is the smallest remaining driving, on-duty, or cycle margin. The existing model does not supply elapsed-shift or rest-history data, so those constraints cannot yet be validated.

- Map routes currently use presentation geometry between known points; production road-snapped geometry should come from a contracted routing provider such as Mapbox, GraphHopper, or OSRM.
- The batch planner is deterministic and fleet-wide but is not yet the planned OR-Tools service. OR-Tools is the appropriate next solver when scale, time windows, and look-ahead chains exceed the in-browser search space; Google’s reference model supports vehicle-routing time windows.^5
- HOS is a practical dispatch feasibility aid, not a certified ELD replacement.
- Demo pallet dimensions are explicitly estimated because the supplied workbook does not include item-level dimensions.
- The new P0 migration must be applied before authenticated cloud synchronization is used. Signed-out local demo mode is immediately usable.

## Sources

1. RoadStar, “RoadStar Hackathon Build Blueprint: Unified Dispatch, Automation, and Open-Source Reuse,” supplied PDF, pp. 4–7 and 25–35.
2. MapLibre, “[MapLibre GL JS documentation](https://maplibre.org/maplibre-gl-js/docs/).”
3. Supabase, “[Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security).”
4. Supabase, “[Subscribing to Database Changes](https://supabase.com/docs/guides/realtime/subscribing-to-database-changes).”
5. Google for Developers, “[Vehicle Routing Problem with Time Windows](https://developers.google.com/optimization/routing/vrptw).”
