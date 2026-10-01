@echo off
setlocal
set "XMR_INSTALLER_SOURCE=%~f0"
set "XMR_INSTALLER_TEMP=%TEMP%\XMRControlInstaller-%RANDOM%-%RANDOM%.ps1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$source = [IO.File]::ReadAllText($env:XMR_INSTALLER_SOURCE); $marker = '# POWERSHELL_' + 'PAYLOAD'; $index = $source.IndexOf($marker); if ($index -lt 0) { throw 'Installer payload is missing.' }; $payload = $source.Substring($index + $marker.Length).TrimStart([char]13, [char]10); [IO.File]::WriteAllText($env:XMR_INSTALLER_TEMP, $payload, [Text.UTF8Encoding]::new($true)); try { & $env:XMR_INSTALLER_TEMP; $exitCode = 0 } catch { Write-Error $_; $exitCode = 1 } finally { Remove-Item -LiteralPath $env:XMR_INSTALLER_TEMP -Force -ErrorAction SilentlyContinue }; exit $exitCode"
echo.
pause
exit /b %errorlevel%
# POWERSHELL_PAYLOAD
param(
    [switch]$RunAgent
)

$ErrorActionPreference = 'Stop'
$taskName = 'XMR Miner Control Agent'
$configDirectory = Join-Path $env:LOCALAPPDATA 'XMRControlAgent'
$configPath = Join-Path $configDirectory 'config.json'
$installedScriptPath = Join-Path $configDirectory 'miner-control-agent.ps1'

function Read-InstallerValue([string]$Prompt, [string]$Default = '') {
    if ($Default) {
        $value = Read-Host "$Prompt [$Default]"
        if (-not $value) { return $Default }
        return $value
    }
    return Read-Host $Prompt
}

function Read-WorkerToken {
    while ($true) {
        $secureValue = Read-Host 'Enter this rig''s agent token (input is hidden)' -AsSecureString
        if ($secureValue.Length -lt 32) {
            Write-Host 'The token must be at least 32 characters.' -ForegroundColor Yellow
            continue
        }
        return ConvertFrom-SecureString $secureValue
    }
}

function Install-Agent {
    Write-Host 'XMR Miner Control Agent setup' -ForegroundColor Cyan
    Write-Host 'This rig will poll the control service over HTTPS and start with your Windows account.'

    do {
        $dashboardUrl = Read-InstallerValue 'Control API URL' 'https://xmr-tracker.vercel.app/api/miner-control'
        $parsedUrl = $null
        $validUrl = [Uri]::TryCreate($dashboardUrl, [UriKind]::Absolute, [ref]$parsedUrl) -and
            $parsedUrl.Scheme -eq 'https' -and
            $parsedUrl.AbsolutePath.TrimEnd('/') -eq '/api/miner-control' -and
            -not $parsedUrl.Query -and -not $parsedUrl.Fragment
        if (-not $validUrl) {
            Write-Host 'Enter the deployed HTTPS URL ending in /api/miner-control.' -ForegroundColor Yellow
        }
    } while (-not $validUrl)

    do {
        $workerId = Read-InstallerValue 'Worker ID (as shown in the dashboard)' 'aoi1'
        if ($workerId -notmatch '^aoi\d+$') {
            Write-Host 'Worker IDs must look like aoi1, aoi2, and so on.' -ForegroundColor Yellow
        }
    } while ($workerId -notmatch '^aoi\d+$')

    do {
        $minerExecutable = Read-InstallerValue 'Full path to the miner executable' 'C:\Program Files\xmrig\xmrig.exe'
        if (-not (Test-Path -LiteralPath $minerExecutable -PathType Leaf)) {
            Write-Host 'That executable was not found. Enter its full path on this rig.' -ForegroundColor Yellow
        }
    } while (-not (Test-Path -LiteralPath $minerExecutable -PathType Leaf))

    $minerArgs = Read-InstallerValue 'Miner arguments (for example: --config config.json; leave blank if not needed)'
    $encryptedToken = Read-WorkerToken
    $config = [ordered]@{
        dashboardUrl = $dashboardUrl.TrimEnd('/')
        workerId = $workerId
        minerExecutable = (Resolve-Path -LiteralPath $minerExecutable).Path
        minerArgs = $minerArgs
        pollSeconds = 5
        encryptedToken = $encryptedToken
    }

    New-Item -ItemType Directory -Path $configDirectory -Force | Out-Null
    $config | ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding UTF8
    Copy-Item -LiteralPath $PSCommandPath -Destination $installedScriptPath -Force

    $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    $taskAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$installedScriptPath`" -RunAgent"
    $taskTrigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
    $taskPrincipal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
    $taskSettings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero)
    Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger $taskTrigger -Principal $taskPrincipal -Settings $taskSettings -Description 'Polls the authenticated XMR miner control API for this rig.' -Force | Out-Null
    Start-ScheduledTask -TaskName $taskName

    Write-Host "Installed for $workerId. The agent will start now and at your next sign-in." -ForegroundColor Green
    Write-Host "Configuration is stored under $configDirectory; the token is encrypted for this Windows user."
}

function Get-ManagedProcesses([string]$ExecutablePath) {
    $resolvedPath = (Resolve-Path -LiteralPath $ExecutablePath -ErrorAction Stop).Path
    $executableName = [IO.Path]::GetFileName($resolvedPath)
    Get-CimInstance Win32_Process -Filter "Name='$executableName'" -ErrorAction SilentlyContinue |
        Where-Object { $_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath) -eq $resolvedPath }
}

function Apply-MiningState([string]$MiningState, [string]$ExecutablePath, [string]$MinerArgs) {
    if (-not (Test-Path -LiteralPath $ExecutablePath -PathType Leaf)) {
        Write-Host "Configured miner executable not found: $ExecutablePath" -ForegroundColor Red
        return
    }

    if ($MiningState -eq 'paused') {
        foreach ($process in (Get-ManagedProcesses $ExecutablePath)) {
            Write-Host "Stopping configured miner process $($process.ProcessId)." -ForegroundColor Yellow
            Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
        }
        return
    }

    if ($MiningState -ne 'running') { return }
    if (Get-ManagedProcesses $ExecutablePath) { return }

    $resolvedPath = (Resolve-Path -LiteralPath $ExecutablePath).Path
    $startArguments = @{
        FilePath = $resolvedPath
        WorkingDirectory = Split-Path $resolvedPath -Parent
        WindowStyle = 'Hidden'
    }
    if ($MinerArgs.Trim()) { $startArguments.ArgumentList = $MinerArgs }
    Write-Host "Starting configured miner: $resolvedPath" -ForegroundColor Green
    Start-Process @startArguments
}

function Run-Agent {
    if (-not (Test-Path -LiteralPath $configPath)) { throw 'Agent configuration is missing. Run this file without -RunAgent to install it.' }
    $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    $secureToken = ConvertTo-SecureString $config.encryptedToken
    $tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
    try {
        $agentToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer)
    }

    Write-Host "Polling control service for $($config.workerId)."
    while ($true) {
        try {
            $workerId = [Uri]::EscapeDataString($config.workerId)
            $uri = '{0}?workerId={1}' -f $config.dashboardUrl.TrimEnd('/'), $workerId
            $control = Invoke-RestMethod -Uri $uri -Method Get -Headers @{ Authorization = "Bearer $agentToken" } -TimeoutSec 10 -ErrorAction Stop
            Apply-MiningState ([string]$control.state) $config.minerExecutable $config.minerArgs
        }
        catch {
            Write-Host "Control check failed: $($_.Exception.Message)" -ForegroundColor Yellow
        }
        Start-Sleep -Seconds ([Math]::Max(5, [int]$config.pollSeconds))
    }
}

try {
    if ($RunAgent) {
        Run-Agent
    }
    else {
        Install-Agent
    }
}
catch {
    Write-Host "Miner control agent error: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}