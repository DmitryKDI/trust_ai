#Requires -Version 5.1
[CmdletBinding()]
param(
    [Alias("SetupOnly")]
    [switch]$PrepareOnly,
    [switch]$UsePortableNode,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$repoRoot = Split-Path -Parent $PSScriptRoot
$appDir = Join-Path $repoRoot 'app'
$toolsDir = Join-Path $env:LOCALAPPDATA 'TrustRemontPlanner\runtime'
$transcriptStarted = $false

function Invoke-NodeTool([string]$Executable, [string[]]$ToolArguments, [switch]$Capture) {
    # Invoke executable paths literally: Windows PowerShell 5.1 treats brackets
    # in paths passed to the call operator as wildcard patterns.
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = $Executable
    $info.UseShellExecute = $false
    $info.Arguments = ($ToolArguments | ForEach-Object {
        if ($_ -match '"') { throw 'Unexpected quote in tool argument.' }
        '"' + $_ + '"'
    }) -join ' '
    $info.RedirectStandardOutput = [bool]$Capture
    $info.RedirectStandardError = [bool]$Capture
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $info
    try {
        $null = $process.Start()
        if ($Capture) {
            $stdout = $process.StandardOutput.ReadToEndAsync()
            $stderr = $process.StandardError.ReadToEndAsync()
        }
        $process.WaitForExit()
        if ($Capture) {
            return [pscustomobject]@{ ExitCode = $process.ExitCode; Output = $stdout.Result; Error = $stderr.Result }
        }
        return $process.ExitCode
    } finally { $process.Dispose() }
}

function Test-NodeTools([string]$Directory) {
    $node = Join-Path $Directory 'node.exe'
    $npm = Join-Path $Directory 'npm.cmd'
    if (!(Test-Path -LiteralPath $node) -or !(Test-Path -LiteralPath $npm)) { return $false }
    try {
        $nodeCheck = Invoke-NodeTool $node @('--version') -Capture
        $version = $nodeCheck.Output.Trim()
        if ($nodeCheck.ExitCode -ne 0 -or $version -notmatch '^v(\d+)\.') { return $false }
        if ([int]$Matches[1] -ne 24) { Write-Host "Не подходит Node.js: $version"; return $false }
        $npmCli = Join-Path $Directory 'node_modules\npm\bin\npm-cli.js'
        if (!(Test-Path -LiteralPath $npmCli)) { return $false }
        $npmCheck = Invoke-NodeTool $node @($npmCli, '--version') -Capture
        return $npmCheck.ExitCode -eq 0
    } catch { Write-Host ("Проверка Node.js/npm: " + $_.Exception.Message); return $false }
}

function Install-PortableNode {
    $nativeArch = $env:PROCESSOR_ARCHITEW6432
    if (!$nativeArch) { $nativeArch = $env:PROCESSOR_ARCHITECTURE }
    switch ($nativeArch) {
        'AMD64' { $arch = 'x64' }
        'ARM64' { $arch = 'arm64' }
        default { throw 'Нужна 64-разрядная Windows 10/11 (x64 или ARM64).' }
    }

    Write-Host 'Скачиваю Node.js 24 с npm с nodejs.org. Права администратора не нужны.'
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $checksums = (Invoke-WebRequest -UseBasicParsing -Uri 'https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt' -TimeoutSec 60).Content
    $pattern = '(?m)^([a-fA-F0-9]{64})\s+(node-v24\.\d+\.\d+-win-' + $arch + '\.zip)\s*$'
    $entry = [regex]::Match($checksums, $pattern)
    if (!$entry.Success) { throw 'Не найден официальный ZIP Node.js 24 для этого компьютера.' }
    $fileName = $entry.Groups[2].Value
    $version = [regex]::Match($fileName, 'v24\.\d+\.\d+').Value
    $tempDir = Join-Path $toolsDir ([guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
    try {
        $zip = Join-Path $tempDir $fileName
        # A version-specific URL prevents the latest alias changing the ZIP mid-download.
        # Write through .NET so brackets in a user path remain literal on PS 5.1.
        $request = [Net.HttpWebRequest]::Create("https://nodejs.org/dist/$version/$fileName")
        $request.Timeout = 300000
        $request.ReadWriteTimeout = 300000
        $response = $request.GetResponse()
        try {
            $stream = $response.GetResponseStream()
            $output = [IO.File]::Create($zip)
            try { $stream.CopyTo($output) }
            finally { $output.Dispose(); $stream.Dispose() }
        } finally { $response.Dispose() }
        if ((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash -ne $entry.Groups[1].Value) {
            throw 'Контрольная сумма Node.js не совпала. Скачанный файл не будет запускаться.'
        }
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        [IO.Compression.ZipFile]::ExtractToDirectory($zip, $tempDir)
        $directoryName = $fileName.Substring(0, $fileName.Length - 4)
        $source = Join-Path $tempDir $directoryName
        if (!(Test-NodeTools $source)) { throw 'Скачанная копия Node.js/npm не проходит проверку.' }
        $target = Join-Path $toolsDir $directoryName
        if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
        Move-Item -LiteralPath $source -Destination $target
        return $target
    } finally {
        Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

function Start-Planner {
try {
    foreach ($file in @('package.json', 'package-lock.json')) {
        if (!(Test-Path -LiteralPath (Join-Path $appDir $file))) {
            throw "Не найден app/$file. Сначала полностью распакуйте ZIP репозитория."
        }
    }
    Set-Location -LiteralPath $appDir
    try {
        Start-Transcript -Path (Join-Path $appDir 'planner-start.log') -Force | Out-Null
        $transcriptStarted = $true
    } catch { Write-Host 'Не удалось записать журнал; сообщения будут показаны в этом окне.' }

    Write-Host 'Проверяю Node.js и npm...'
    $nodeDir = $null
    if (!$UsePortableNode) {
        $nodeCommand = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($nodeCommand) {
            $candidate = Split-Path -Parent $nodeCommand.Source
            if (Test-NodeTools $candidate) { $nodeDir = $candidate }
        }
    }
    if (!$nodeDir -and (Test-Path -LiteralPath $toolsDir)) {
        foreach ($candidate in (Get-ChildItem -LiteralPath $toolsDir -Directory -Filter 'node-v24.*-win-*' | Sort-Object LastWriteTime -Descending)) {
            if (Test-NodeTools $candidate.FullName) { $nodeDir = $candidate.FullName; break }
        }
    }
    if (!$nodeDir) { $nodeDir = Install-PortableNode }
    # Only this process and its children use this Node; system PATH stays unchanged.
    $env:PATH = "$nodeDir;$env:PATH"
    $node = Join-Path $nodeDir 'node.exe'
    $npm = Join-Path $nodeDir 'npm.cmd'
    $npmCli = Join-Path $nodeDir 'node_modules\npm\bin\npm-cli.js'
    $nodeVersion = (Invoke-NodeTool $node @('--version') -Capture).Output.Trim()
    $npmVersion = (Invoke-NodeTool $node @($npmCli, '--version') -Capture).Output.Trim()
    Write-Host "Node.js $nodeVersion, npm $npmVersion"

    # This marker disappears if the dependencies are removed.
    $marker = Join-Path $appDir 'node_modules\.planner-dependencies'
    $lockHash = (Get-FileHash -LiteralPath (Join-Path $appDir 'package-lock.json') -Algorithm SHA256).Hash
    $packageHash = (Get-FileHash -LiteralPath (Join-Path $appDir 'package.json') -Algorithm SHA256).Hash
    $fingerprint = "$lockHash|$packageHash|$nodeVersion|$npmVersion"
    $installed = (Test-Path -LiteralPath $marker) -and
        (Test-Path -LiteralPath (Join-Path $appDir 'node_modules\.bin\vite.cmd'))
    if ($installed) { $installed = (Get-Content -LiteralPath $marker -Raw).Trim() -eq $fingerprint }
    if ($installed) {
        # Verify the actual dependency tree, including dev tools, as well as the marker.
        $dependencyCheck = Invoke-NodeTool $node @($npmCli, 'ls', '--all', '--include=dev', '--include=optional', '--silent') -Capture
        $installed = $dependencyCheck.ExitCode -eq 0
    }
    if (!$installed) {
        Write-Host 'Устанавливаю зависимости программы. При первом запуске нужен интернет...'
        if (Test-Path -LiteralPath $marker) { Remove-Item -LiteralPath $marker -Force }
        $installExit = Invoke-NodeTool $node @($npmCli, 'ci', '--include=dev', '--include=optional', '--no-audit', '--no-fund')
        if ($installExit -ne 0) { throw 'npm ci завершился с ошибкой. Проверьте интернет и сообщения выше, затем запустите батник снова.' }
        Set-Content -LiteralPath $marker -Value $fingerprint -Encoding ASCII
    } else { Write-Host 'Зависимости уже установлены и соответствуют текущей версии программы.' }

    if (!$PrepareOnly) {
        $listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 5190)
        try { $listener.Start() }
        catch { throw 'Порт 5190 занят. Закройте ранее запущенное окно планировщика (Ctrl+C) и повторите запуск.' }
        finally { $listener.Stop() }
        Write-Host 'Запускаю планировщик: http://127.0.0.1:5190'
        Write-Host 'Браузер откроется после запуска сервера. Не закрывайте это окно; остановка — Ctrl+C.'
        $arguments = @('run', 'dev', '--', '--host', '127.0.0.1', '--port', '5190', '--strictPort')
        if (!$NoBrowser) { $arguments += '--open' }
        $serverExit = Invoke-NodeTool $node (@($npmCli) + $arguments)
        if ($serverExit -ne 0) { throw 'Сервер завершился с ошибкой. Подробности показаны выше.' }
    }
} catch {
    Write-Host ''
    Write-Host ('ОШИБКА: ' + $_.Exception.Message) -ForegroundColor Red
    Write-Host 'Если журнал создан, он находится в app\planner-start.log.'
    exit 1
} finally {
    if ($transcriptStarted) { Stop-Transcript | Out-Null }
}
}

if ($MyInvocation.InvocationName -ne '.') { Start-Planner }
