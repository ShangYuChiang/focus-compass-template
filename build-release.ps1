[CmdletBinding()]
param(
    [string]$TargetDirectory
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$focusProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$focusCargoBin = Join-Path $env:USERPROFILE '.cargo\bin'
$env:Path = "$focusCargoBin;$env:Path"

if ($TargetDirectory) {
    $focusTargetDirectory = [System.IO.Path]::GetFullPath((Join-Path $focusProjectRoot $TargetDirectory))
    $focusRootPrefix = [System.IO.Path]::GetFullPath($focusProjectRoot).TrimEnd('\') + '\'
    if (-not $focusTargetDirectory.StartsWith($focusRootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'TargetDirectory must stay inside the focus-compass project.'
    }
    $env:CARGO_TARGET_DIR = $focusTargetDirectory
}

Push-Location $focusProjectRoot
try {
    if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
        throw 'Cargo was not found. Run install-desktop-toolchain.cmd first.'
    }
    npm install
    npm run build
    npm test
    npm run tauri build
    $focusOutputFolder = if ($TargetDirectory) { Join-Path $focusTargetDirectory 'release\bundle\nsis' } else { Join-Path $focusProjectRoot 'src-tauri\target\release\bundle\nsis' }
    Write-Host "Build complete. See $focusOutputFolder" -ForegroundColor Green
}
finally {
    Pop-Location
}
