Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$manifestPath = Join-Path $root "manifest.json"

if (-not (Test-Path $manifestPath)) {
  throw "manifest.json not found at $manifestPath"
}

$manifest = Get-Content -Raw -Path $manifestPath | ConvertFrom-Json
$version = [string]$manifest.version

if ([string]::IsNullOrWhiteSpace($version)) {
  throw "Extension version is missing from manifest.json"
}

$distDir = Join-Path $root "dist"
$packageName = "faceberg-v$version-chrome-store.zip"
$packagePath = Join-Path $distDir $packageName
$stageDir = Join-Path $distDir "package"

$includePaths = @(
  "manifest.json",
  "background.js",
  "content-utils.js",
  "content-debug.js",
  "content-feed.js",
  "content-comments.js",
  "content.js",
  "injected.js",
  "shared-stats.js",
  "popup.html",
  "popup.css",
  "popup.js",
  "icons\icon16.png",
  "icons\icon32.png",
  "icons\icon48.png",
  "icons\icon128.png",
  "icons\logo.png",
  "icons\book.gif"
)

New-Item -ItemType Directory -Force -Path $distDir | Out-Null

if (Test-Path $stageDir) {
  Remove-Item -Recurse -Force $stageDir
}

New-Item -ItemType Directory -Force -Path $stageDir | Out-Null

foreach ($relativePath in $includePaths) {
  $sourcePath = Join-Path $root $relativePath
  if (-not (Test-Path $sourcePath)) {
    throw "Missing required packaging file: $relativePath"
  }

  $targetPath = Join-Path $stageDir $relativePath
  $targetDir = Split-Path -Parent $targetPath
  New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
  Copy-Item -Path $sourcePath -Destination $targetPath -Force
}

if (Test-Path $packagePath) {
  Remove-Item -Force $packagePath
}

Compress-Archive -Path (Join-Path $stageDir '*') -DestinationPath $packagePath -CompressionLevel Optimal

Write-Host "Created package: $packagePath"
