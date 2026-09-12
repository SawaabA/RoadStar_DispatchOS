$ErrorActionPreference = 'Stop'

function Invoke-RoadStarCheck([string]$Name, [scriptblock]$Command) {
  Write-Host "`n[QUALITY] $Name" -ForegroundColor Cyan
  & $Command
  if ($LASTEXITCODE -ne 0) { throw "$Name failed with exit code $LASTEXITCODE" }
}

Invoke-RoadStarCheck 'Unit and domain tests' { npm test }
Invoke-RoadStarCheck 'Production type-check and bundle' { npm run build }
Invoke-RoadStarCheck 'Node service syntax' {
  node --check services/web-server/server.mjs
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  node --check services/integration-gateway/server.mjs
}
Invoke-RoadStarCheck 'xflp sidecar compilation' { powershell -ExecutionPolicy Bypass -File services/loading-solver/build.ps1 }
Invoke-RoadStarCheck 'Browser journeys and accessibility' { npm run test:e2e }
Invoke-RoadStarCheck 'Working tree whitespace' { git diff --check }
Write-Host "`n[QUALITY] All deterministic release checks passed." -ForegroundColor Green
