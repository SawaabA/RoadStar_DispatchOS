$ErrorActionPreference = 'Stop'
$roadStarPorts = @(5173, 7070, 7071)
$listeners = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $roadStarPorts -contains $_.LocalPort }

foreach ($listener in $listeners) {
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)" -ErrorAction SilentlyContinue
  if (-not $process) { continue }

  $command = [string]$process.CommandLine
  $isRoadStarProcess =
    $command -match 'RoadStar DispatchOS' -or
    $command -match 'services[\\/]telematics-simulator' -or
    $command -match 'LoaderServer'

  if ($isRoadStarProcess) {
    Write-Host "Stopping stale RoadStar process on port $($listener.LocalPort)..."
    Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
  } else {
    throw "Port $($listener.LocalPort) is used by another application (PID $($listener.OwningProcess)). Close it before launching RoadStar."
  }
}
