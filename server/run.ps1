& (Join-Path $PSScriptRoot 'build.ps1')
$deps = Join-Path $PSScriptRoot '.deps'
$classpath = @(
  (Join-Path $PSScriptRoot 'out'),
  (Join-Path $deps 'xflp-0.7.7-RELEASE.jar'),
  (Join-Path $deps 'guava-33.7.1-jre.jar'),
  (Join-Path $deps 'gson-2.13.2.jar')
) -join [IO.Path]::PathSeparator
java -cp $classpath com.roadstar.loader.LoaderServer
