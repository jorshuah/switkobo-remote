@echo off
cd /d "%~dp0"
node web/setup-https.mjs
if errorlevel 1 (pause & exit /b 1)
node web/launch.mjs --stop
node web/launch.mjs
if errorlevel 1 pause
