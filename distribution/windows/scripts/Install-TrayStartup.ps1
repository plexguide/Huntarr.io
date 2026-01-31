#Requires -Version 5.1
<#
.SYNOPSIS
    Ensures Huntarr runs in the user session so the system tray icon appears.

.DESCRIPTION
    The system tray icon only appears when Huntarr runs as a normal application
    in the logged-in user's session. If Huntarr is installed as a Windows Service,
    it runs in Session 0 and has no access to the taskbar or system tray.

    This script creates a shortcut in the current user's Startup folder so that
    Huntarr starts at logon as a normal app. The tray icon will then appear next
    to the clock.

    Use this when you want the tray icon. Do not install/start the Huntarr
    Windows Service if you want the tray (or stop the service and use this
    shortcut instead).

.PARAMETER HuntarrExePath
    Full path to Huntarr.exe (built installer). If not set, the script looks
    for Huntarr in common locations.

.PARAMETER ProjectRoot
    If running from source: full path to the Huntarr repo (contains main.py).
    When set, the shortcut runs: python main.py with WorkingDirectory = ProjectRoot.

.EXAMPLE
    .\Install-TrayStartup.ps1 -HuntarrExePath "C:\Program Files\Huntarr\Huntarr.exe"
.EXAMPLE
    .\Install-TrayStartup.ps1 -ProjectRoot "C:\Users\Me\Huntarr.io"
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string] $HuntarrExePath = "",
    [Parameter(Mandatory = $false)]
    [string] $ProjectRoot = ""
)

$ErrorActionPreference = "Stop"
$startupFolder = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startupFolder "Huntarr (System Tray).lnk"

function Write-Info { param([string]$Message) Write-Host $Message -ForegroundColor Cyan }
function Write-Ok   { param([string]$Message) Write-Host $Message -ForegroundColor Green }
function Write-Warn { param([string]$Message) Write-Host $Message -ForegroundColor Yellow }

Write-Info "Huntarr System Tray Startup installer"
Write-Info "Tray icon only appears when Huntarr runs in your user session (not as a service)."
Write-Info ""

# Resolve target: either Huntarr.exe or python main.py from ProjectRoot
$targetPath = $null
$arguments = ""
$workingDir = $null

if ($HuntarrExePath -and (Test-Path -LiteralPath $HuntarrExePath -PathType Leaf)) {
    $targetPath = $HuntarrExePath
    $workingDir = [System.IO.Path]::GetDirectoryName($targetPath)
    Write-Ok "Using Huntarr.exe: $targetPath"
} elseif ($ProjectRoot -and (Test-Path -LiteralPath (Join-Path $ProjectRoot "main.py"))) {
    $pythonExe = (Get-Command python -ErrorAction SilentlyContinue).Source
    if (-not $pythonExe) { $pythonExe = (Get-Command py -ErrorAction SilentlyContinue).Source }
    if (-not $pythonExe) {
        Write-Warn "Python not found in PATH. Install Python or use -HuntarrExePath with the built Huntarr.exe."
        exit 1
    }
    $targetPath = $pythonExe
    $arguments = "main.py"
    $workingDir = $ProjectRoot
    Write-Ok "Using Python from source: $pythonExe, working dir: $workingDir"
} else {
    # Try common locations for Huntarr.exe
    $candidates = @(
        (Join-Path $env:ProgramFiles "Huntarr\Huntarr.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "Huntarr\Huntarr.exe"),
        (Join-Path $env:LOCALAPPDATA "Huntarr\Huntarr.exe")
    )
    foreach ($c in $candidates) {
        if ($c -and (Test-Path -LiteralPath $c -PathType Leaf)) {
            $targetPath = $c
            $workingDir = [System.IO.Path]::GetDirectoryName($targetPath)
            Write-Ok "Found Huntarr.exe: $targetPath"
            break
        }
    }
}

if (-not $targetPath -or -not $workingDir) {
    Write-Warn "Could not find Huntarr. Specify -HuntarrExePath or -ProjectRoot."
    Write-Info "Example (installer): .\Install-TrayStartup.ps1 -HuntarrExePath 'C:\Program Files\Huntarr\Huntarr.exe'"
    Write-Info "Example (source):    .\Install-TrayStartup.ps1 -ProjectRoot 'C:\Users\You\Huntarr.io'"
    exit 1
}

try {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $targetPath
    $shortcut.Arguments = $arguments
    $shortcut.WorkingDirectory = $workingDir
    $shortcut.Description = "Huntarr - starts in user session so system tray icon appears"
    $shortcut.Save()
    [System.Runtime.Interopservices.Marshal]::ReleaseComObject($shell) | Out-Null
    Write-Ok "Shortcut created: $shortcutPath"
    Write-Info "Huntarr will start at logon in your user session; the tray icon will appear."
} catch {
    Write-Warn "Failed to create shortcut: $_"
    exit 1
}

Write-Info ""
Write-Info "To remove: delete the shortcut or run: Remove-Item -LiteralPath '$shortcutPath' -Force"
