[CmdletBinding()]
param(
    [string]$ProjectRoot = (Get-Location).Path
)

$ErrorActionPreference = 'Stop'
$resolvedRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
$packagePath = Join-Path $resolvedRoot 'package.json'

if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf)) {
    throw "No package.json found at $resolvedRoot"
}

$package = Get-Content -Raw -LiteralPath $packagePath | ConvertFrom-Json
$results = [System.Collections.Generic.List[object]]::new()

function Add-Result {
    param([string]$Check, [bool]$Passed, [string]$Detail)
    $results.Add([pscustomobject]@{ Check = $Check; Passed = $Passed; Detail = $Detail })
}

function Invoke-GateCommand {
    param(
        [string]$Name,
        [string]$Executable,
        [string[]]$ArgumentList
    )
    & $Executable @ArgumentList
    $exit = $LASTEXITCODE
    Add-Result $Name ($exit -eq 0) "exit code $exit"
}

Push-Location $resolvedRoot
try {
    $node = Get-Command node -ErrorAction SilentlyContinue
    $npm = Get-Command npm -ErrorAction SilentlyContinue
    Add-Result 'Node.js available' ($null -ne $node) $(if ($node) { (& node --version) } else { 'not found' })
    Add-Result 'npm available' ($null -ne $npm) $(if ($npm) { (& npm --version) } else { 'not found' })

    $requiredPaths = @(
        'README.md',
        '.env.example',
        'docs/P0-implementation.md',
        'docs/architecture.md',
        'src/app/App.tsx',
        'src/shared/lib/supabase.ts',
        'services/loading-solver',
        'services/telematics-simulator',
        'supabase/migrations'
    )
    foreach ($relativePath in $requiredPaths) {
        Add-Result "Required path: $relativePath" (Test-Path -LiteralPath (Join-Path $resolvedRoot $relativePath)) 'repository structure'
    }

    $envExample = Get-Content -Raw -LiteralPath (Join-Path $resolvedRoot '.env.example')
    foreach ($variable in @('VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY')) {
        Add-Result "Environment contract: $variable" ($envExample -match "(?m)^$variable=") 'name only; values were not read'
    }
    Add-Result 'No service-role key in env example' ($envExample -notmatch '(?i)service[_-]?role') 'browser environment safety'

    if ($npm) {
        if ($package.scripts.test) { Invoke-GateCommand -Name 'npm test' -Executable 'npm' -ArgumentList @('test') }
        else { Add-Result 'npm test' $false 'script missing' }

        if ($package.scripts.build) { Invoke-GateCommand -Name 'npm run build' -Executable 'npm' -ArgumentList @('run', 'build') }
        else { Add-Result 'npm run build' $false 'script missing' }

        if ($package.scripts.'test:e2e') { Invoke-GateCommand -Name 'npm run test:e2e' -Executable 'npm' -ArgumentList @('run', 'test:e2e') }
        else { Add-Result 'npm run test:e2e' $false 'script missing' }
    }

    $git = Get-Command git -ErrorAction SilentlyContinue
    if ($git) {
        & git diff --check
        Add-Result 'git diff --check' ($LASTEXITCODE -eq 0) "exit code $LASTEXITCODE"
    } else {
        Add-Result 'git diff --check' $false 'git not found'
    }
}
finally {
    Pop-Location
}

$results | Format-Table -AutoSize
$failed = @($results | Where-Object { -not $_.Passed })
if ($failed.Count -gt 0) {
    Write-Error "$($failed.Count) quality-gate check(s) failed."
    exit 1
}

Write-Host 'All deterministic quality-gate checks passed.' -ForegroundColor Green
