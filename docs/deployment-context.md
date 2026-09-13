# RoadStar DispatchOS — system context for deployment planning

This is a standalone briefing document. It assumes no prior knowledge of the project and exists so
that someone (or an assistant) can reason about hosting and deployment without reading the codebase.

Everything marked **verified** was observed running on a Linux development machine on 2026-09-12.
Everything marked **untested** is configuration that exists but has not been exercised.

---

## 1. What the product is

RoadStar DispatchOS is a freight dispatch workspace for a Southern Ontario trucking carrier. A
dispatcher sees loads, drivers, trucks and trailers, assigns work manually or via a one-click
optimizer, then watches trips execute on a live map while the system tracks Hours of Service,
geofence arrivals and billable detention.

It is a hackathon project with a hard code freeze. It is **not** carrying real customer traffic, real
money, or regulated ELD data. Reliability for a single live demo matters far more than scale,
multi-region, or zero-downtime deploys.

Expected load: **one to five concurrent users.** Not a scaling problem.

---

## 2. Technology

| Layer | Choice |
|---|---|
| Frontend | React 19.2, TypeScript, Vite 7 (SPA, no SSR) |
| Map | MapLibre GL JS |
| 3D | Three.js / react-three-fiber |
| Backend services | Node.js 22 (ESM, zero framework, `node:http` only) |
| Optimization sidecar | Java (xflp library), plain `com.sun.net.httpserver` |
| Database / auth | Supabase (hosted Postgres + Auth + Realtime) |
| Tests | Vitest (unit), Playwright + axe (browser) |

There is **no application server framework**, no Redis, no queue, no ORM, and no server-side session
store. The Node services are single-file HTTP servers with no persistence of their own.

---

## 3. Runtime topology — four processes

All four are long-lived. None is serverless-compatible (see §10).

| Service | Port | Language | Role | State |
|---|---|---|---|---|
| `web-server` | 8080 | Node | Serves the built SPA, reverse-proxies `/api/*` | Stateless |
| `loading-solver` | 7070 | Java | 3D trailer load planning (xflp) | Stateless, in-memory only |
| `telematics-simulator` | 7071 | Node | Server-Sent Events stream of simulated truck movement | In-memory vehicle state |
| `integration-gateway` | 7072 | Node | Server-side Ontario 511 traffic adapter with cache | In-memory cache |

Only **`web-server` should be publicly exposed.** The other three should stay on a private network;
they have no authentication of their own.

### Request routing

Production — everything is same-origin through `web-server`:

```
browser ──▶ web-server :8080
              ├── /                    → static files from dist/
              ├── /healthz             → own health check
              ├── /api/telemetry/*     → simulator      :7071
              ├── /api/traffic/*       → gateway        :7072
              ├── /api/ai/*            → gateway        :7072  (Authorization forwarded)
              └── /api/*               → solver         :7070
```

Development — the same paths, proxied by Vite's dev server on :5173 instead. The path contracts are
identical in both modes, so behaviour does not change between dev and prod.

The browser also talks **directly** to Supabase over HTTPS; that traffic does not pass through
`web-server`.

---

## 4. Build

```
npm ci
npm run build      # tsc -b && vite build  →  dist/
```

Output is a static `dist/` directory, **2.6 MB** total. Largest chunks are the map library (~1.0 MB)
and Three.js (~0.9 MB). No server-side rendering; `index.html` is the only HTML entry point, so the
host must serve it as a fallback for unknown paths (SPA deep links). `web-server` already does this.

The Java solver compiles separately (`node services/loading-solver/build.mjs`), which downloads three
jars from Maven Central and runs `javac`. The Docker image does its own equivalent build.

---

## 5. Environment variables

**Build-time, required** — these are compiled into the JavaScript bundle by Vite, so they must be
present when `npm run build` runs, not at container start:

| Variable | Purpose |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable (anon) key |

Both are **safe to expose in a browser bundle** by design — row-level security is what protects the
data. A `service_role` or secret key must never be placed in a `VITE_` variable.

If they are absent the app still builds and runs; it simply stays in a local demo mode with no cloud
sync.

**Runtime, optional** — all have working defaults:

| Variable | Default | Used by |
|---|---|---|
| `PORT` / `HOST` | 8080 / 0.0.0.0 | web-server |
| `SOLVER_URL` | `http://127.0.0.1:7070` | web-server proxy target |
| `SIMULATOR_URL` | `http://127.0.0.1:7071` | web-server proxy target |
| `INTEGRATION_URL` | `http://127.0.0.1:7072` | web-server proxy target |
| `APP_ORIGIN` | `http://localhost:8080` | gateway CORS allow-origin |
| `SIMULATOR_PORT` / `SIMULATOR_HOST` | 7071 / 127.0.0.1 | simulator bind |
| `SIMULATOR_SEED` | 20260913 | simulator event randomisation seed |
| `INTEGRATION_PORT` / `INTEGRATION_HOST` | 7072 / 127.0.0.1 | gateway bind |
| `SPUR_API_KEY` | none | gateway AI calls; AI is reported not configured without it |
| `SPUR_MODEL_*` / `SPUR_TIMEOUT_MS` | see `.env.example` | gateway model selection and per-call timeout |
| `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` | `VITE_SUPABASE_*` | gateway verification of AI callers |
| `JAVA_HOME` | auto-discovered | solver build/run scripts |

---

## 6. External dependencies

| Host | When | Who calls it | Failure behaviour |
|---|---|---|---|
| Supabase (`*.supabase.co`) | Runtime | Browser, directly | App falls back to local demo mode |
| `511on.ca` | Runtime | `integration-gateway`, server-side | Gateway returns labelled demo incidents |
| `tiles.openfreemap.org` | Runtime | Browser | Map tiles fail to render |
| `server.arcgisonline.com` | Runtime | Browser | Satellite view fails; road view unaffected |
| `repo1.maven.org` | **Build only** | Solver build script | Solver cannot compile |

Every runtime dependency except map tiles degrades gracefully. The application is usable with **no
network at all** except that the map goes blank and cloud sync is unavailable.

---

## 7. Data and persistence

Supabase hosted Postgres. The application stores the entire dispatch workspace as a single JSON
snapshot row per organization (`dispatch_snapshots.state`), plus normalized tables for decisions,
road incidents, optimization runs, replay runs, provider connections and cargo items.

Writes go through a compare-and-swap RPC (`save_dispatch_snapshot`) that rejects a stale writer with
SQLSTATE `40001`, so two dispatchers cannot silently overwrite each other. Live updates arrive over
Supabase Realtime.

Schema is managed by forward-only SQL migrations in `supabase/migrations/`. **All migrations are
currently applied to the live project** (verified). Row-level security is enabled on every exposed
table, granting access to `authenticated` only — never to `anon`.

**The Node and Java services hold no durable state.** They can be restarted or replaced freely.
Restarting the simulator resets simulated truck positions, which is cosmetic.

---

## 8. Authentication

Supabase Auth, email magic link only (implicit flow). There is no password login in the UI.

Deployment-relevant consequence: **the deployed origin must be added to the Supabase redirect
allowlist**, and the Site URL must match, or sign-in links will bounce to the wrong host. This is
configured in the Supabase dashboard, not in code.

The built-in Supabase email service is rate-limited to a small number of messages per hour per
project. For anything beyond light testing this needs custom SMTP.

Signed-out visitors get a fully functional local demo; authentication is only required for cloud
sync between dispatchers.

---

## 9. Containerization

Four Dockerfiles plus `docker-compose.yml`. **Verified** — all four images build and the full stack
runs end to end in containers: static assets, SPA deep links, all three proxied APIs, live Ontario
511 data fetched from inside the container network, and the Supabase publishable key correctly baked
into the bundle through build args.

Image sizes: web 235 MB, solver 484 MB, simulator 232 MB, integrations 232 MB (~1.2 GB total).
All four containers run as non-root.

- `Dockerfile.web` — two-stage: `node:22-alpine` builds, then serves `dist/` via `web-server`.
  Takes `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` as **build args**.
- `Dockerfile.solver` — two-stage: `eclipse-temurin:21-jdk` compiles, `21-jre` runs.
- `Dockerfile.simulator`, `Dockerfile.integrations` — plain Node runtime images.

Compose wires internal service URLs (`http://solver:7070` etc.) and publishes only port 8080.

---

## 10. Constraints that rule options in or out

These are the decisive facts for choosing a host.

1. **The simulator holds an open Server-Sent Events connection.** Serverless and most edge platforms
   cap or kill long-lived responses. This service needs a real always-on process.
2. **The solver is a JVM.** Static hosts and Node-only serverless platforms cannot run it. It is
   optional — the app falls back to an in-browser load planner and stays usable, with reduced
   physical-constraint accuracy — so it *can* be dropped if a host cannot accommodate Java.
3. **The gateway caches in memory.** It works as a single instance. Multiple replicas would each keep
   their own cache, which is acceptable but wasteful against a rate-limited upstream API.
4. **Supabase keys are baked in at build time**, so changing projects requires a rebuild, not a
   restart or env change.
5. **No sticky sessions or shared server state are needed.** All user state lives in the browser and
   in Supabase.

A single small VM or a single container host is entirely sufficient. There is no horizontal scaling
requirement.

---

## 11. Verification

Full release gate, all stages passing (verified):

```
npm run quality
  ├─ vitest              26 unit tests
  ├─ tsc -b && vite build
  ├─ solver compile      (javac)
  └─ playwright          9 browser journeys incl. axe accessibility
```

Health endpoints, all implemented and confirmed responding:

| Endpoint | Service |
|---|---|
| `/healthz` | web-server |
| `/api/health` | solver |
| `/api/telemetry/health` | simulator |
| `/api/traffic/health` | integration gateway |

Production serving was verified locally: static assets, SPA deep links, all three API proxy routes,
and four security headers (`X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`,
`Cross-Origin-Opener-Policy`).

---

## 12. Known gotchas

- **Port 8080 collided** with an unrelated process on the development machine; `web-server` exits
  with `EADDRINUSE` rather than falling back. Set `PORT` if 8080 is taken.
- **Supabase vars must be build args, not runtime env.** A container started with them only in the
  environment will produce a bundle with no Supabase configuration and silently run in demo mode.
- **`APP_ORIGIN` must match the real public origin** or the traffic gateway's CORS will reject
  browser requests.
- **`ports` in an override file merges rather than replaces.** Use the `!override` tag to change the
  published port.
- **The public origin must be added to Supabase's redirect allowlist and Site URL**, or magic-link
  sign-in redirects to the wrong host.
- **`APP_ORIGIN` must match the public origin** or the traffic gateway's CORS refuses browser calls.
- **Database migrations are not part of the deploy pipeline.** They are applied out of band, and
  rolling containers back does not roll back schema.
- The Java version is inconsistent between paths: local build targets Java 17, the Docker image uses
  JDK 21. Both work; worth aligning eventually.

---

## 13. Deployment pipeline

`.github/workflows/deploy.yml` runs on every push to `main`:

```
quality gate ──▶ build 4 images ──▶ push to ghcr.io ──▶ ssh: pull + up ──▶ probe /healthz
```

Images are built in CI, never on the host, so a small droplet is never asked to run `npm ci` or
`vite build`. Each image is tagged with both `latest` and the commit SHA, making rollback a matter of
re-running compose with an earlier `IMAGE_TAG`.

`docker-compose.prod.yml` pulls those images rather than building. It binds the web container to
`127.0.0.1:8080`, so the only route in is Caddy, which terminates TLS (`deploy/Caddyfile`).

The Caddy config handles `/api/telemetry/events` as a separate route with `flush_interval -1` and no
compression. That is load-bearing: the telemetry stream is Server-Sent Events, and a proxy that
buffers or gzips it will leave the live map frozen while the connection stays open.

Setup instructions, the required secrets, and the pre-DNS fallback are in `deploy/README.md`.

---

## 14. What is explicitly not required

To avoid over-engineering advice: this project does not need a CDN, autoscaling, a load balancer,
multi-region deployment, a managed Kubernetes cluster, a separate API gateway, Redis, a message
queue, or observability tooling beyond basic container logs. It needs one host that can run four
processes and terminate TLS.
