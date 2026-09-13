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
required_memory_kb=8388608
if [ "$memory_kb" -lt "$required_memory_kb" ]; then
  # OSRM extraction is memory intensive. Small production droplets can safely
  # satisfy the preprocessing guard with a dedicated, persistent swapfile.
  # Never replace an existing inactive file automatically: it may belong to an
  # administrator and must be inspected manually.
  if [ "$(id -u)" -ne 0 ]; then
    echo "Need at least 8 GB combined RAM and swap; found $((memory_kb / 1024 / 1024)) GB. Run this provisioner as root so it can create dedicated swap." >&2
    exit 1
  fi
  swapfile=/swapfile-roadstar
  missing_kb=$((required_memory_kb - memory_kb + 1048576))
  swap_gb=$(((missing_kb + 1048575) / 1048576))
  if [ "$swap_gb" -lt 4 ]; then swap_gb=4; fi
  if swapon --show=NAME --noheadings | grep -Fxq "$swapfile"; then
    echo "RoadStar swapfile is already active."
  elif [ -e "$swapfile" ]; then
    echo "$swapfile exists but is not active; refusing to overwrite it. Inspect or activate it manually." >&2
    exit 1
  else
    echo "Creating a dedicated ${swap_gb} GB RoadStar swapfile for Ontario preprocessing."
    fallocate -l "${swap_gb}G" "$swapfile"
    chmod 600 "$swapfile"
    mkswap "$swapfile"
    swapon "$swapfile"
    if ! grep -Fq "$swapfile none swap sw 0 0" /etc/fstab; then
      printf '%s\n' "$swapfile none swap sw 0 0" >> /etc/fstab
    fi
  fi
  memory_kb=$(awk '/MemTotal|SwapTotal/ {sum += $2} END {print sum}' /proc/meminfo)
  if [ "$memory_kb" -lt "$required_memory_kb" ]; then
    echo "Need at least 8 GB combined RAM and swap after provisioning; found $((memory_kb / 1024 / 1024)) GB." >&2
    exit 1
  fi
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
