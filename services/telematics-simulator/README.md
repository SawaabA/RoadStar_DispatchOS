# RoadStar telematics simulator

Independent accelerated telemetry provider for the DispatchOS demo. It exposes:

- `GET /api/telemetry/health` — service status, seed, and any active events
- `GET /api/telemetry/events` — Server-Sent Events stream
- `POST /api/telemetry/inject?kind=<kind>&truckId=<id>` — trigger an event on cue

Each real second advances a vehicle by roughly two simulated minutes and emits its coordinates, speed, distance, and route progress. Run it with `npm run simulator`; `npm run dev:full` starts it with the web app and xflp service.

## Event generator

The simulator injects the disruptions the project brief asks for: route delays, dock waits, and duty-cycle shifts. Each telemetry frame carries an `event` field holding the vehicle's active event, or `null`.

| Kind | Effect while active |
|---|---|
| `traffic` | Highway 401 slowdown; speed falls to 35% |
| `closure` | Lane closure; speed falls to 12% |
| `dock_wait` | Truck holds position, so dwell — and detention — accrues |
| `duty_change` | Duty status shift carrying an HOS delta |

Events are drawn from a seeded generator, so a rehearsed demo replays identically. Set `SIMULATOR_SEED` to change the sequence. Because scheduled events take a minute or two to appear, use the inject endpoint to trigger one on cue:

```bash
curl -X POST "http://localhost:5173/api/telemetry/inject?kind=closure&truckId=T-067"
```

Events change the vehicle's motion, so their downstream effects are real rather than cosmetic: a `dock_wait` holds the truck in place, dwell accrues, and the detention exception fires on its own. This is provider-level and complements the dispatcher's `Inject demo closure` button, which adds an informational corridor incident without moving a truck.

The browser fallback provider does not generate events; run this service to demonstrate them.
