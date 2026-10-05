@echo off
setlocal DisableDelayedExpansion
rem Keep CMD open even if the launcher fails before PowerShell starts.
rem ASCII source avoids depending on the current Windows code page.
if /i "%~1"=="--console" goto launch
"%ComSpec%" /d /k ""%~f0" --console"
exit /b %ERRORLEVEL%

:launch
title Trust Remont Planner
set "PLANNER_PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
set "PLANNER_EXIT=1"
if not exist "%PLANNER_PS%" goto no_powershell
if not exist "%~dp0scripts\launch-planner.ps1" goto incomplete
if not exist "%~dp0scripts\start-planner.ps1" goto incomplete
set "PLANNER_ARGS="
if /i "%~2"=="--check" set "PLANNER_ARGS=-PrepareOnly -NoBrowser"
if /i "%~2"=="--server-test" set "PLANNER_ARGS=-NoBrowser"
"%PLANNER_PS%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch-planner.ps1" %PLANNER_ARGS%
set "PLANNER_EXIT=%ERRORLEVEL%"
goto finished

:no_powershell
echo ERROR: Windows PowerShell was not found. Windows 10/11 is required.
goto finished

:incomplete
echo ERROR: Launcher files are missing. Extract or update the entire repository.
echo Do not run the BAT inside a ZIP archive.
goto finished

:finished
echo.
echo Launcher exit code: %PLANNER_EXIT%
echo Startup log: %TEMP%\TrustRemontPlanner-start.log
if /i "%~2"=="--check" exit /b %PLANNER_EXIT%
if /i "%~2"=="--server-test" exit /b %PLANNER_EXIT%
echo This window stays open. Send the error text or startup log if startup failed.
exit /b %PLANNER_EXIT%
