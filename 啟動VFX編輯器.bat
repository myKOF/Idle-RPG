@echo off
chcp 65001 > nul
setlocal
cd /d "%~dp0"

rem One-click launcher for the VFX editor.
rem
rem Keep CRLF line endings and keep non-echo lines ASCII-only.  chcp switches
rem the codepage mid-file and cmd parses batch incrementally, so multi-byte text
rem in rem/command positions gets mangled and executed as commands.  Editors
rem that default to LF will silently break this launcher.
rem
rem Identity, not just "is the port answering":  all five worktrees
rem (claude/codex/antigravity/develop/production) ship this same launcher and
rem the same 28361-28370 range.  A bare port probe cannot tell them apart, so
rem launching from claude while develop already had an editor up would open
rem develop pages -- you then edit presets in the wrong copy and only notice
rem after the changes fail to show up.  /__whoami reports the served directory
rem and MARK below includes %CD%, so we only ever adopt OUR own server.
rem The sim launcher hit exactly this bug; its comments have the detail.

rem Optional argument: which preset to open, e.g. pass fire-tornado to open
rem that preset instead of the default below.  Drag a shortcut with the argument
rem baked in if you always want a specific one.
set PRESET=%~1
if "%PRESET%"=="" set PRESET=lightning-orb-field

set MARK=idle-rpg-vfx-editor %CD%
rem Second marker on /__whoami: the server saying its own code is out of date.
set STALE_MARK=idle-rpg-vfx-editor-stale
set PORT=

where node >nul 2>nul
if errorlevel 1 (
  echo 找不到 Node.js，無法啟動 VFX 編輯器。
  echo 請先安裝 Node.js，並在命令列執行 node -v 確認可用。
  pause
  exit /b 1
)

rem Do not put multi-byte text and a %VAR% expansion on the same echo line.
rem Measured: an echo line carrying a CJK label followed by %CD% lost its
rem echo prefix after chcp switched the codepage, and cmd then tried to run the
rem label itself as a command.  Same class of
rem failure the sim launcher documents, but it can hit echo lines too, not just
rem rem/command positions.  Chinese labels get their own line; values get theirs.
echo ========================================================
echo   VFX 編輯器
echo ========================================================
echo   工作副本
echo     %CD%
echo   Preset
echo     %PRESET%
echo ========================================================

rem Already running from THIS worktree?  Adopt it instead of starting a second --
rem but only if its code is still current.  A node process loads editor-server.cjs
rem and everything it requires once, at start; the static files it serves are read
rem per request.  So after a merge you get a NEW page talking to an OLD backend,
rem which looks like "half the feature is missing" with nothing on screen to
rem explain it.  Measured 2026-09-09: the preset dropdown's new search UI showed
rem up while the usage labels it needs from the server did not -- the process had
rem been running for three and a half hours before that code landed.
rem The server reports this itself on /__whoami; refuse to adopt when it does.
call :scan
if defined PORT (
  call :checkstale
  if defined STALE goto :stale
  echo 伺服器已在執行中，直接開啟頁面。連接埠：
  echo     %PORT%
  goto :open
)

echo 啟動伺服器...
start "VFX 編輯器伺服器 - 關閉此視窗即停止" cmd /c tools\vfx\editor_server_window.bat

rem Poll instead of a fixed sleep: a fixed wait races the cold start and the
rem browser opens first, giving ERR_CONNECTION_REFUSED with no explanation.
echo 等待伺服器就緒...
set /a TRIES=0
:wait
set /a TRIES+=1
call :scan
if defined PORT goto :open
if %TRIES% GEQ 40 goto :failed
ping -n 1 -w 250 127.0.0.1 > nul
goto :wait

:open
set URL=http://127.0.0.1:%PORT%/tools/vfx/editor/index.html?preset=%PRESET%
echo.
echo 正在開啟：
echo   %URL%
start "" "%URL%"
exit /b 0

:failed
echo.
echo 伺服器在 10 秒內沒有就緒。請看剛才另外開啟的「VFX 編輯器伺服器」視窗，
echo 錯誤原因會印在那裡（最常見的是這台電腦還沒設定素材庫位置）。
echo.
echo 目前占用 28361~28370 這段連接埠的程序：
netstat -ano | findstr LISTENING | findstr ":2836"
echo.
pause
exit /b 1

:stale
echo.
echo ========================================================
echo   執行中的伺服器程式已經過期，沒有沿用
echo ========================================================
echo.
echo   這個埠上的伺服器行程比磁碟上的程式舊，多半是 merge 或切分支之後
echo   沒有重啟。它會服務新版的頁面檔，卻用舊版的後端邏輯，結果是
echo   功能少一半，而且畫面上看不出原因。
echo.
echo   請把那個「VFX 編輯器伺服器」視窗關掉，再執行一次本檔。
echo   找不到那個視窗時，用下面列出的 PID 強制結束：
echo     taskkill /F /PID 那個PID
echo.
echo   目前占用這個連接埠的程序：
netstat -ano | findstr LISTENING | findstr ":%PORT% "
echo ========================================================
pause
exit /b 1

rem ---- checkstale : set STALE when the adopted server reports outdated code ----
rem Separate marker line on /__whoami, so the identity match above is untouched.
:checkstale
set STALE=
curl -s --max-time 2 http://127.0.0.1:%PORT%/__whoami 2>nul | find /i "%STALE_MARK%" > nul
if not errorlevel 1 set STALE=1
goto :eof

rem ---- scan : set PORT to the first port in range serving OUR editor ----
:scan
set PORT=
for /l %%p in (28361,1,28370) do (
  curl -s --max-time 1 http://127.0.0.1:%%p/__whoami 2>nul | find /i "%MARK%" > nul
  if not errorlevel 1 (
    set PORT=%%p
    goto :eof
  )
)
goto :eof
