@echo off
setlocal
chcp 65001 >nul
title Траст ремонт — планировщик
set "PLANNER_PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PLANNER_PS%" (
  echo Не найден Windows PowerShell. Для запуска нужна Windows 10/11.
  pause
  exit /b 1
)
if not exist "%~dp0scripts\start-planner.ps1" (
  echo Не найден scripts\start-planner.ps1. Скачайте или обновите весь репозиторий.
  pause
  exit /b 1
)
"%PLANNER_PS%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-planner.ps1"
set "PLANNER_EXIT=%ERRORLEVEL%"
if not "%PLANNER_EXIT%"=="0" (
  echo.
  echo Запуск не завершён. Причина указана выше.
  pause
)
exit /b %PLANNER_EXIT%
