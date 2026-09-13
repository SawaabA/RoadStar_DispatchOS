# Ontario OSRM

RoadStar uses a pinned OSRM container and the Geofabrik Ontario OpenStreetMap
extract. The generated routing graph is local deployment data and is not stored
in Git.

## Prepare the graph

Docker Desktop must be running. Allow at least 15 GB of free disk space and
expect the download and MLD preprocessing to take a while.

```powershell
npm run osrm:prepare
```

The script downloads the current `ontario-latest.osm.pbf`, verifies its MD5
checksum, and runs `osrm-extract`, `osrm-partition`, and `osrm-customize` using
the same pinned image used at runtime.

## Start RoadStar with routing

```powershell
npm run docker:osrm
```

Open `http://localhost:8080`. OSRM is reachable only inside the Compose network;
the RoadStar integration gateway exposes the same-origin routing API. Its
readiness check fails when routing is required but OSRM is unreachable.

Refresh the graph periodically with:

```powershell
npm run osrm:prepare -- --refresh
```

Geofabrik's extract is distributed under the OpenStreetMap ODbL. Preserve the
required OpenStreetMap attribution in deployed map experiences.
