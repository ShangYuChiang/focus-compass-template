[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$focusProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$focusInstallerDir = Join-Path (Split-Path -Parent $focusProjectRoot) '.installers'
$focusLogPath = Join-Path $focusProjectRoot 'desktop-toolchain-install.log'

$focusIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
$focusPrincipal = [Security.Principal.WindowsPrincipal]::new($focusIdentity)
$focusIsAdmin = $focusPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $focusIsAdmin) {
    Write-Host 'Please run install-desktop-toolchain.cmd and approve the Windows UAC prompt.' -ForegroundColor Yellow
    Read-Host 'Press Enter to close'
    exit 1
}

New-Item -ItemType Directory -Path $focusInstallerDir -Force | Out-Null
Start-Transcript -Path $focusLogPath -Append | Out-Null

try {
    Write-Host 'Step 1/2: Checking Rust stable-msvc...' -ForegroundColor Cyan
    $focusCargoBin = Join-Path $env:USERPROFILE '.cargo\bin'
    $focusRustc = Join-Path $focusCargoBin 'rustc.exe'
    if (-not (Test-Path -LiteralPath $focusRustc)) {
        $focusRustupExe = Join-Path $focusInstallerDir 'rustup-init.exe'
        Invoke-WebRequest -Uri 'https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe' -OutFile $focusRustupExe
        $focusRustProcess = Start-Process -FilePath $focusRustupExe -ArgumentList @('-y', '--default-host', 'x86_64-pc-windows-msvc', '--default-toolchain', 'stable') -Wait -PassThru -WindowStyle Hidden
        if ($focusRustProcess.ExitCode -ne 0) { throw "Rust installer failed with exit code $($focusRustProcess.ExitCode)." }
    }

    Write-Host 'Step 2/2: Checking Microsoft C++ Build Tools...' -ForegroundColor Cyan
    $focusVswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    $focusBuildTools = if (Test-Path -LiteralPath $focusVswhere) {
        & $focusVswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    }

    if (-not $focusBuildTools) {
        $focusBuildToolsExe = Join-Path $focusInstallerDir 'vs_BuildTools.exe'
        Invoke-WebRequest -Uri 'https://aka.ms/vs/17/release/vs_BuildTools.exe' -OutFile $focusBuildToolsExe
        $focusArguments = @(
            '--quiet', '--wait', '--norestart', '--nocache',
            '--installPath', 'C:\BuildTools',
            '--add', 'Microsoft.VisualStudio.Workload.VCTools',
            '--includeRecommended'
        )
        $focusVsProcess = Start-Process -FilePath $focusBuildToolsExe -ArgumentList $focusArguments -Wait -PassThru -WindowStyle Hidden
        if ($focusVsProcess.ExitCode -notin @(0, 3010)) { throw "Build Tools installer failed with exit code $($focusVsProcess.ExitCode)." }
        if ($focusVsProcess.ExitCode -eq 3010) { Write-Host 'Restart Windows before building the app.' -ForegroundColor Yellow }
    }

    $env:Path = "$focusCargoBin;$env:Path"
    & (Join-Path $focusCargoBin 'rustup.exe') default stable-msvc
    & (Join-Path $focusCargoBin 'rustc.exe') --version
    & (Join-Path $focusCargoBin 'cargo.exe') --version

    Write-Host ''
    Write-Host 'Desktop toolchain installation is complete. Return to Codex and say: installation complete.' -ForegroundColor Green
}
catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host "Installation log: $focusLogPath" -ForegroundColor Yellow
    throw
}
finally {
    Stop-Transcript | Out-Null
}

Read-Host 'Press Enter to close'
