# RoadStar integration gateway

Server-side adapter for providers that must not expose credentials to the browser. It normalizes and caches Ontario 511 events, proxies an OSRM-compatible road-routing provider, and reports whether production TMS and ELD endpoints are configured and healthy.

```powershell
npm run integrations
```

Health: `GET http://127.0.0.1:7072/api/traffic/health`

Incidents: `GET http://127.0.0.1:7072/api/traffic/incidents`

Readiness: `GET http://127.0.0.1:7072/readyz`

Provider status: `GET http://127.0.0.1:7072/api/integrations/health`

Road route: `GET http://127.0.0.1:7072/api/routing/route?origin=-79.4,43.6&destination=-79.1,43.8`

Prometheus metrics: `GET http://127.0.0.1:7072/metrics`

## Production provider variables

- `ROUTING_BASE_URL` must expose the OSRM route contract at `/route/v1/driving/...`.
- `ROUTING_API_TOKEN` is sent as a bearer token when present.
- `REQUIRE_ROUTING=true` makes readiness fail closed if routing is missing.
- `TMS_HEALTH_URL` / `TMS_API_TOKEN` check the configured TMS adapter.
- `ELD_HEALTH_URL` / `ELD_API_TOKEN` check the configured ELD adapter.

Provider credentials are server-only. Never prefix them with `VITE_`. A vendor adapter must normalize its data to RoadStar's documented load and SSE telemetry contracts before it is called production-ready.
