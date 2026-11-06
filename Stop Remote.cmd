@echo off
cd /d "%~dp0web"
node launch.mjs --stop
if errorlevel 1 pause
