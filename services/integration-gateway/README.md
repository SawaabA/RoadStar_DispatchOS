# RoadStar integration gateway

Server-side adapter for providers that must not expose credentials to the browser. It normalizes and caches Ontario 511 events, proxies an OSRM-compatible road-routing provider, and reports whether production TMS and ELD endpoints are configured and healthy.

```bash
npm run integrations
```

Health: `GET http://127.0.0.1:7072/api/traffic/health`

Incidents: `GET http://127.0.0.1:7072/api/traffic/incidents`

Readiness: `GET http://127.0.0.1:7072/readyz`

Provider status: `GET http://127.0.0.1:7072/api/integrations/health`

Road route: `GET http://127.0.0.1:7072/api/routing/route?origin=-79.4,43.6&destination=-79.1,43.8`

Prometheus metrics: `GET http://127.0.0.1:7072/metrics`

AI readiness: `GET http://127.0.0.1:7072/api/ai/health`

## Production provider variables

- `ROUTING_BASE_URL` must expose the OSRM route contract at `/route/v1/driving/...`.
- `ROUTING_API_TOKEN` is sent as a bearer token when present.
- `REQUIRE_ROUTING=true` makes readiness fail closed if routing is missing.
- `TMS_HEALTH_URL` / `TMS_API_TOKEN` check the configured TMS adapter.
- `ELD_HEALTH_URL` / `ELD_API_TOKEN` check the configured ELD adapter.

Provider credentials are server-only. Never prefix them with `VITE_`. A vendor adapter must normalize its data to RoadStar's documented load and SSE telemetry contracts before it is called production-ready.

## RoadStar AI (SPUR Compute)

`npm run integrations` loads `.env` and then `.env.local`, so a local `SPUR_API_KEY` in `.env` and the existing Supabase values in `.env.local` both reach the gateway.

AI features are served as `POST /api/ai/*`. Every request must carry the caller's Supabase session as `Authorization: Bearer <access token>`. The gateway:

- verifies the session with Supabase and reads the caller's organization role using the caller's own token, so row-level security applies exactly as it does in the browser;
- rejects callers whose role is not permitted for that feature;
- rate-limits each user (`AI_RATE_LIMIT_PER_MINUTE`, default 20);
- calls only models on a sovereign allowlist. Several SPUR catalogue models are resold through OpenRouter, so a model variable naming one of them is refused rather than silently sending data outside Canada.

`GET /api/ai/health` reports whether the key and caller verification are configured, and the outcome of the most recent model call. It never makes a live model call.

`POST /api/ai/copilot` (admin, dispatcher, viewer) narrates one of five fixed questions from facts the browser has already computed: open exceptions, unassigned-load feasibility, HOS clocks, detention, and the optimizer's proposal. Every answer is checked before it is returned: citations must resolve to a known load, driver or truck, identifier-shaped tokens must exist, and any measured figure must appear in the facts. An answer that fails is still returned, marked `grounded: false`. If every model fails the response is `fallback: true` and the browser shows the facts unnarrated. Answers are cached per organization for five minutes.

| Variable | Default | Purpose |
|---|---|---|
| `SPUR_API_KEY` | none | Required for AI features |
| `SPUR_BASE_URL` | `https://ai.spuric.com/v1` | OpenAI-compatible endpoint |
| `SPUR_MODEL_EXTRACT` | `spur-glm-5-2` | Text extraction from documents |
| `SPUR_MODEL_VISION` | `spur-vision` | Scanned documents and photos |
| `SPUR_MODEL_COPILOT` | `spur-glm-5-2` | Dispatcher copilot (measured 2-4 s on real prompts) |
| `SPUR_MODEL_COPILOT_FALLBACK` | `spur-glm-air` | Copilot fallback |
| `SPUR_TIMEOUT_MS` | `8000` | Per-call timeout |
| `AI_RATE_LIMIT_PER_MINUTE` | `20` | Per-user request budget |
| `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` | `VITE_SUPABASE_*` | Caller verification |

The web gateway forwards the `Authorization` header to `/api/ai/*` only, and gives those requests 45 seconds instead of 10. GLM models are called with reasoning disabled: the reasoning is discarded anyway, and leaving it on costs roughly ten times the latency and can exhaust the token budget before any visible answer.
