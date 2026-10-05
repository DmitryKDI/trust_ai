#Requires -Version 5.1
[CmdletBinding()]
param(
    [switch]$PrepareOnly,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$logPath = Join-Path ([IO.Path]::GetTempPath()) 'TrustRemontPlanner-start.log'
$logging = $false
$result = 0
try {
    try {
        Start-Transcript -LiteralPath $logPath -Force | Out-Null
        $logging = $true
    } catch { Write-Host ('Не удалось создать журнал: ' + $_.Exception.Message) }
    Write-Host ('Журнал запуска: ' + $logPath)
    # Load inside try so syntax and initialization errors are visible and logged.
    . "$PSScriptRoot/start-planner.ps1" -PrepareOnly:$PrepareOnly -NoBrowser:$NoBrowser
    Start-Planner
} catch {
    $result = 1
    Write-Host ('ОШИБКА ЗАПУСКА: ' + $_.Exception.Message) -ForegroundColor Red
    Write-Host $_.ScriptStackTrace
} finally {
    if ($logging) { Stop-Transcript | Out-Null }
}
exit $result
