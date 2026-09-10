$ErrorActionPreference = 'Stop'
$serverRoot = $PSScriptRoot
$deps = Join-Path $serverRoot '.deps'
$output = Join-Path $serverRoot 'out'
New-Item -ItemType Directory -Force -Path $deps, $output | Out-Null

$libraries = @{
  'xflp-0.7.7-RELEASE.jar' = 'https://repo1.maven.org/maven2/com/github/hschneid/xflp/0.7.7-RELEASE/xflp-0.7.7-RELEASE.jar'
  'guava-33.7.1-jre.jar' = 'https://repo1.maven.org/maven2/com/google/guava/guava/33.7.1-jre/guava-33.7.1-jre.jar'
  'gson-2.13.2.jar' = 'https://repo1.maven.org/maven2/com/google/code/gson/gson/2.13.2/gson-2.13.2.jar'
}
foreach ($library in $libraries.GetEnumerator()) {
  $destination = Join-Path $deps $library.Key
  if (-not (Test-Path -LiteralPath $destination)) {
    Invoke-WebRequest -Uri $library.Value -OutFile $destination
  }
}

$classpath = (($libraries.Keys | ForEach-Object { Join-Path $deps $_ }) -join [IO.Path]::PathSeparator)
$sources = Get-ChildItem -LiteralPath (Join-Path $serverRoot 'src') -Filter '*.java' -Recurse | ForEach-Object FullName
javac --release 21 -cp $classpath -d $output $sources
Write-Host "RoadStar xflp service compiled successfully."
