@echo off
cd /d "%~dp0web"
call npm.cmd ci --omit=dev
if errorlevel 1 goto failed
call npx.cmd playwright install chromium
if errorlevel 1 goto failed
echo Playback is ready. Run Start Remote.cmd.
pause
exit /b 0
:failed
echo Playback setup failed. Check your internet connection and try again.
pause
exit /b 1
