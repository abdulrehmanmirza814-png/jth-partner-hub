@echo off
REM Double-click to start the JTH assistant. Keep this window open (minimise it).
cd /d "%~dp0.."
:loop
node src/cli.js start
echo Assistant stopped or crashed. Restarting in 15 seconds... (close this window to stop)
timeout /t 15 /nobreak >nul
goto loop
