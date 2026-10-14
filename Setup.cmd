@echo off
setlocal
echo Preparing HTML Editor (first run may take a minute)...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup.ps1"
echo.
echo You can close this window now.
pause
