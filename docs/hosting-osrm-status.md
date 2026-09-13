# RoadStar Hosting and OSRM Status

**Date:** September 13, 2026  
**Production site:** https://roadstardispatch.xyz  
**Current routing status:** Hosted OSRM quick fix prepared for deployment; the live website remains on presentation fallback until this change is deployed.

## Hosting completed

- RoadStar is deployed to the production server with Docker Compose and Caddy HTTPS.
- GitHub Actions builds the web, solver, simulator, and integration images and publishes them to GHCR.
- The production deployment and post-deployment verification passed on `main`.
- The server SSH host identity is pinned through `DEPLOY_KNOWN_HOSTS`.
- Production monitoring files and health checks are installed.
- The server was upgraded from 4 GB to 8 GB RAM and has approximately 72 GB of storage.
- `REQUIRE_REAL_ROUTING=false` remains set so an unavailable OSRM service cannot break deployment.

## OSRM work completed

- Added `docker-compose.osrm.yml` for the self-hosted routing service.
- Added `.github/workflows/provision-osrm.yml` for guarded Ontario provisioning.
- Added `deploy/provision-osrm.sh` with RAM, disk, checksum, and safety checks.
- Configured the official Ontario Geofabrik map extract.
- Corrected the OSRM image to the published tag:
  `ghcr.io/project-osrm/osrm-backend:v26.9.0-debian`.
- Added checksum verification and reuse of the existing 949 MB Ontario download.
- Configured the OSRM MLD build stages: `osrm-extract`, `osrm-partition`, and `osrm-customize`.
- OSRM fixes are currently in branch `osrm-swap-activation` and PR #8.

## What happened

1. The first run stopped because the original server had only about 5 GB combined RAM and swap.
2. Another run confirmed that the non-root deployment user could not create system swap.
3. A later run found that the original OSRM image tag did not exist; the tag was corrected.
4. After the server upgrade, provisioning passed the RAM, storage, checksum, SSH, and image checks.
5. Ontario extraction ran for approximately two hours, but the GitHub-to-server SSH session ended with `Broken pipe` before the full workflow finished.

The latest failure was therefore an SSH-session failure, not the previous RAM or image problem.

## Current verification

This production request:

```text
https://roadstardispatch.xyz/api/routing/route?origin=-79.3832,43.6532&destination=-79.8711,43.2557
```

currently returns:

```json
{
  "source": "presentation-fallback",
  "fallback": true,
  "error": "Road routing unavailable"
}
```

Therefore, real road routing must not yet be described as live.

## Required next steps

1. Change provisioning so the long OSRM build survives an SSH disconnect, using a detached server-side job with status polling or reliable SSH keepalives.
2. Inspect and reuse any valid intermediate OSRM files left on the server.
3. Finish all three OSRM processing stages and start the OSRM container.
4. Merge PR #8 after its checks pass.
5. Set `REQUIRE_REAL_ROUTING=true` and redeploy `main` only after live verification passes.
6. Confirm the health endpoint reports OSRM connected and multiple Ontario route requests return `fallback: false`, road distance, duration, and geometry.

## Fast demo workaround

`docker-compose.hosted-routing.yml` points the integration gateway at
`https://router.project-osrm.org`. The deployment workflow automatically uses
this hosted endpoint when a completed local Ontario graph is absent. This gives
the judging/demo site real routing immediately, but the public service has no
RoadStar availability guarantee and should later be replaced by the self-hosted
Ontario service.

No production credentials or private keys are included in this report.
