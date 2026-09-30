@echo off
chcp 65001 >nul
title Траст ремонт — планировщик
cd /d "%~dp0app"

where node >nul 2>nul
if errorlevel 1 (
  echo Не найден Node.js. Установите его с https://nodejs.org и запустите снова.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Первый запуск: устанавливаю компоненты, это займёт минуту...
  call npm install
)

echo Планировщик запускается. Не закрывайте это окно, пока работаете.
echo Браузер откроется сам: http://127.0.0.1:5190
start "" cmd /c "timeout /t 3 >nul & start http://127.0.0.1:5190"
call npm run dev
