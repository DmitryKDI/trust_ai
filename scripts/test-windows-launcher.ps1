#requires -Version 5.1
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/start-planner.ps1"

function Assert([bool]$Condition, [string]$Message) {
    if (!$Condition) { throw $Message }
}

$testRoot = Join-Path $env:TEMP ('Planner проверка [' + [guid]::NewGuid().ToString() + ']')
$server = $null
$originalPath = $env:PATH
try {
    # Always exercise installation even if the runner already has Node.js.
    $runtime = Install-NodeRuntime (Join-Path $testRoot 'runtime')
    Assert (Test-NodeRuntime $runtime) 'Downloaded Node.js/npm must run.'
    $empty = Join-Path $testRoot 'empty'
    New-Item -ItemType Directory -Path $empty -Force | Out-Null
    Assert (!(Test-NodeRuntime $empty)) 'Missing runtime must be rejected.'
    Copy-Item -LiteralPath (Join-Path $runtime 'node.exe') -Destination $empty
    Assert (!(Test-NodeRuntime $empty)) 'Missing npm must be rejected.'

    $env:PATH = $runtime + ';' + $originalPath
    $launcher = Join-Path $PSScriptRoot 'start-planner.ps1'
    $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    & $powershell -NoProfile -ExecutionPolicy Bypass -File $launcher -SetupOnly
    Assert ($LASTEXITCODE -eq 0) 'First dependency setup failed.'
    $app = Join-Path (Split-Path $PSScriptRoot -Parent) 'app'
    $stamp = Join-Path $app 'node_modules\.planner-dependencies'
    Assert (Test-Path -LiteralPath $stamp) 'Dependency stamp missing.'
    $stampTime = (Get-Item -LiteralPath $stamp).LastWriteTimeUtc
    & $powershell -NoProfile -ExecutionPolicy Bypass -File $launcher -SetupOnly
    Assert ($LASTEXITCODE -eq 0) 'Repeat setup failed.'
    Assert ((Get-Item -LiteralPath $stamp).LastWriteTimeUtc -eq $stampTime) 'Repeat setup unnecessarily reinstalls packages.'

    Remove-Item -LiteralPath (Join-Path $app 'node_modules\vite') -Recurse -Force
    & $powershell -NoProfile -ExecutionPolicy Bypass -File $launcher -SetupOnly
    Assert ($LASTEXITCODE -eq 0) 'Repairing incomplete dependencies failed.'
    Assert (Test-Path -LiteralPath (Join-Path $app 'node_modules\vite\package.json')) 'Vite was not restored.'

    $port = New-Object Net.Sockets.TcpListener ([Net.IPAddress]::Loopback), 5190
    $port.Start()
    try {
        & $powershell -NoProfile -ExecutionPolicy Bypass -File $launcher -NoBrowser
        Assert ($LASTEXITCODE -ne 0) 'Occupied port must produce an error.'
    } finally { $port.Stop() }

    $server = Start-Process -FilePath $powershell -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $launcher + '"'), '-NoBrowser') -PassThru
    $responded = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        if ($server.HasExited) { throw 'Launcher exited before the server started.' }
        try {
            $response = Invoke-WebRequest 'http://127.0.0.1:5190/' -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -eq 200 -and $response.Content -match 'id="root"') { $responded = $true; break }
        } catch { Start-Sleep -Seconds 1 }
    }
    Assert $responded 'The actual application did not start.'
    Write-Host 'Windows launcher smoke checks passed.'
} finally {
    if ($server -and !$server.HasExited) { & taskkill.exe /PID $server.Id /T /F | Out-Null }
    $env:PATH = $originalPath
    if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
}
