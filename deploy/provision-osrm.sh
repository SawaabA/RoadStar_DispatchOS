#!/usr/bin/env bash
set -euo pipefail

TARGET=${1:-/opt/roadstar}
IMAGE=ghcr.io/project-osrm/osrm-backend:v26.9.0
SOURCE=https://download.geofabrik.de/north-america/canada/ontario-latest.osm.pbf
DATA="$TARGET/deploy/osrm/data"

available_kb=$(df -Pk "$TARGET" | awk 'NR==2 {print $4}')
memory_kb=$(awk '/MemTotal|SwapTotal/ {sum += $2} END {print sum}' /proc/meminfo)
if [ "$available_kb" -lt 20971520 ]; then
  echo "Need at least 20 GB free under $TARGET; only $((available_kb / 1024 / 1024)) GB is available." >&2
  exit 1
fi
if [ "$memory_kb" -lt 8388608 ]; then
  echo "Need at least 8 GB combined RAM and swap for guarded Ontario preprocessing; found $((memory_kb / 1024 / 1024)) GB." >&2
  exit 1
fi

mkdir -p "$DATA"
curl --fail --location --retry 3 --output "$DATA/ontario-latest.osm.pbf.download" "$SOURCE"
curl --fail --location --retry 3 --output "$DATA/ontario-latest.osm.pbf.md5" "$SOURCE.md5"
expected=$(awk '{print $1}' "$DATA/ontario-latest.osm.pbf.md5")
actual=$(md5sum "$DATA/ontario-latest.osm.pbf.download" | awk '{print $1}')
if [ "$expected" != "$actual" ]; then
  echo "Ontario extract checksum mismatch." >&2
  rm -f "$DATA/ontario-latest.osm.pbf.download"
  exit 1
fi
mv "$DATA/ontario-latest.osm.pbf.download" "$DATA/ontario-latest.osm.pbf"

docker pull "$IMAGE"
docker run --rm -t -v "$DATA:/data" "$IMAGE" osrm-extract -p /opt/car.lua /data/ontario-latest.osm.pbf
docker run --rm -t -v "$DATA:/data" "$IMAGE" osrm-partition /data/ontario-latest.osrm
docker run --rm -t -v "$DATA:/data" "$IMAGE" osrm-customize /data/ontario-latest.osrm
printf '%s\n%s\n' "$IMAGE" "$actual" > "$DATA/.prepared-version"

cd "$TARGET"
docker compose -f docker-compose.prod.yml -f docker-compose.osrm.yml up -d osrm integrations web
echo "Ontario OSRM is prepared and RoadStar is now using real road routing."
