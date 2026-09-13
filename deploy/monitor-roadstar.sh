#!/usr/bin/env bash
set -euo pipefail

TARGET=${1:-/opt/roadstar}
ORIGIN=${ROADSTAR_ORIGIN:-https://roadstardispatch.xyz}
disk_percent=$(df -P "$TARGET" | awk 'NR==2 {gsub(/%/, "", $5); print $5}')
memory_percent=$(free | awk '/Mem:/ {printf "%d", $3 * 100 / $2}')
unhealthy=$(docker ps --filter health=unhealthy --format '{{.Names}}' | paste -sd, -)
restarting=$(docker ps --filter status=restarting --format '{{.Names}}' | paste -sd, -)
recent_errors=$(docker compose -f "$TARGET/docker-compose.prod.yml" logs --since 15m 2>&1 | grep -Eic '(^|[^a-z])(error|fatal|panic)([^a-z]|$)' || true)
http_status=$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 15 "$ORIGIN/readyz" || true)

printf '{"timestamp":"%s","diskPercent":%s,"memoryPercent":%s,"unhealthy":"%s","restarting":"%s","recentErrors":%s,"readinessHttp":%s}\n' "$(date --iso-8601=seconds)" "$disk_percent" "$memory_percent" "$unhealthy" "$restarting" "$recent_errors" "${http_status:-0}"

if [ "$disk_percent" -ge 85 ] || [ "$memory_percent" -ge 90 ] || [ -n "$unhealthy" ] || [ -n "$restarting" ] || [ "${http_status:-0}" != "200" ]; then
  exit 1
fi
