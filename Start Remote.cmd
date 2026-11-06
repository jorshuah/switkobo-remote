@echo off
cd /d "%~dp0web"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22 or newer from https://nodejs.org then run this again.
  pause
  exit /b 1
)
if not exist "node_modules\ffmpeg-static\ffmpeg.exe" (
  call npm.cmd ci --omit=dev
  if errorlevel 1 (
    echo Could not install the helper dependencies.
    pause
    exit /b 1
  )
)
node launch.mjs
if errorlevel 1 pause
