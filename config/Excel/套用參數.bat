@echo off
chcp 65001 >nul
setlocal
for %%I in ("%~dp0..\..") do echo Workspace: %%~fI
call "%~dp0..\..\%~nx0"
exit /b %errorlevel%
