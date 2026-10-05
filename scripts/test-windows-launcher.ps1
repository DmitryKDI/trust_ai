#requires -Version 5.1
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/start-planner.ps1"

function Assert([bool]$Condition, [string]$Message) {
    if (!$Condition) { throw $Message }
}

function Invoke-Batch([string]$BatchFile, [string]$Mode) {
    # Start-Process passes a raw command line; the PS 5.1 call operator would
    # re-escape CMD's nested quotes and break a BAT filename containing spaces.
    $process = Start-Process -FilePath $env:ComSpec -ArgumentList ('/d /s /c ""' + $BatchFile + '" --console ' + $Mode + '"') -NoNewWindow -Wait -PassThru
    return $process.ExitCode
}

$testRoot = Join-Path $env:TEMP ('Planner проверка [' + [guid]::NewGuid().ToString() + ']')
$server = $null
$originalPath = $env:PATH
try {
    # Always exercise installation even if the runner already has Node.js.
    $toolsDir = Join-Path $testRoot 'runtime'
    $runtime = Install-PortableNode
    Assert (Test-NodeTools $runtime) 'Downloaded Node.js/npm must run.'
    $empty = Join-Path $testRoot 'empty'
    New-Item -ItemType Directory -Path $empty -Force | Out-Null
    Assert (!(Test-NodeTools $empty)) 'Missing runtime must be rejected.'
    Copy-Item -LiteralPath (Join-Path $runtime 'node.exe') -Destination $empty
    Assert (!(Test-NodeTools $empty)) 'Missing npm must be rejected.'

    $env:PATH = $runtime + ';' + $originalPath
    $batch = Join-Path (Split-Path $PSScriptRoot -Parent) 'Запустить планировщик.bat'
    Assert ((Invoke-Batch $batch '--check') -eq 0) 'First dependency setup failed.'
    $app = Join-Path (Split-Path $PSScriptRoot -Parent) 'app'
    $stamp = Join-Path $app 'node_modules\.planner-dependencies'
    Assert (Test-Path -LiteralPath $stamp) 'Dependency stamp missing.'
    $stampTime = (Get-Item -LiteralPath $stamp).LastWriteTimeUtc
    Assert ((Invoke-Batch $batch '--check') -eq 0) 'Repeat setup failed.'
    Assert ((Get-Item -LiteralPath $stamp).LastWriteTimeUtc -eq $stampTime) 'Repeat setup unnecessarily reinstalls packages.'

    Remove-Item -LiteralPath (Join-Path $app 'node_modules\vite') -Recurse -Force
    Assert ((Invoke-Batch $batch '--check') -eq 0) 'Repairing incomplete dependencies failed.'
    Assert (Test-Path -LiteralPath (Join-Path $app 'node_modules\vite\package.json')) 'Vite was not restored.'

    $port = New-Object Net.Sockets.TcpListener ([Net.IPAddress]::Loopback), 5190
    $port.Start()
    try {
        Assert ((Invoke-Batch $batch '--server-test') -ne 0) 'Occupied port must produce an error.'
    } finally { $port.Stop() }

    $server = Start-Process -FilePath $env:ComSpec -ArgumentList ('/d /s /c ""' + $batch + '" --console --server-test"') -PassThru
    $responded = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        if ($server.HasExited) { throw 'Launcher exited before the server started.' }
        try {
            $response = Invoke-WebRequest 'http://127.0.0.1:5190/' -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -eq 200 -and $response.Content -match 'id="root"') { $responded = $true; break }
        } catch { Start-Sleep -Seconds 1 }
    }
    Assert $responded 'The actual application did not start.'
    # The interactive entry point must survive a missing script, including paths
    # containing spaces, Cyrillic, brackets, ampersands and parentheses.
    $brokenRoot = Join-Path $testRoot 'План & тест (копия) [1]'
    New-Item -ItemType Directory -Path $brokenRoot -Force | Out-Null
    $brokenBatch = Join-Path $brokenRoot 'Запустить планировщик.bat'
    Copy-Item -LiteralPath $batch -Destination $brokenBatch
    $inputFile = Join-Path $testRoot 'stdin.txt'
    $stdoutFile = Join-Path $testRoot 'stdout.txt'
    $stderrFile = Join-Path $testRoot 'stderr.txt'
    Set-Content -LiteralPath $inputFile -Value 'exit' -Encoding ASCII
    $broken = Start-Process -FilePath $env:ComSpec -ArgumentList ('/d /s /c ""' + $brokenBatch + '""') -RedirectStandardInput $inputFile -RedirectStandardOutput $stdoutFile -RedirectStandardError $stderrFile -PassThru
    if (!$broken.WaitForExit(15000)) {
        & taskkill.exe /PID $broken.Id /T /F | Out-Null
        throw 'Interactive BAT did not return after closing CMD.'
    }
    $output = Get-Content -LiteralPath $stdoutFile -Raw
    Assert ($output -match 'Launcher files are missing') 'Missing launcher did not produce a readable error.'
    Assert ($output -match 'This window stays open') 'Interactive error path did not reach the persistent console.'

    # PowerShell parse failures must also reach the log via the bootstrap.
    $brokenScripts = Join-Path $brokenRoot 'scripts'
    New-Item -ItemType Directory -Path $brokenScripts -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'launch-planner.ps1') -Destination $brokenScripts
    Set-Content -LiteralPath (Join-Path $brokenScripts 'start-planner.ps1') -Value 'function Broken {' -Encoding UTF8
    Assert ((Invoke-Batch $brokenBatch '--check') -ne 0) 'Broken PowerShell script must return a failure.'
    $log = Join-Path ([IO.Path]::GetTempPath()) 'TrustRemontPlanner-start.log'
    Assert ((Get-Content -LiteralPath $log -Raw) -match 'start-planner.ps1') 'Parse error was not logged.'
    Write-Host 'Windows BAT launcher smoke checks passed.'
} finally {
    if ($server -and !$server.HasExited) { & taskkill.exe /PID $server.Id /T /F | Out-Null }
    $env:PATH = $originalPath
    if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
}
