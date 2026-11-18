@echo off
rem Close headless test browsers (Edge/Chrome) left running by AI tools. Visible browsers are never touched.
cd /d "%~dp0"
node tools\kill-test-browsers.cjs --all
pause
