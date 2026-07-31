@echo off
chcp 65001 > nul
setlocal
cd /d "%~dp0"

set PORT=28342
set URL=http://127.0.0.1:%PORT%/monte_carlo_app.html
set LOG=sim_server.log

echo ========================================================
echo 🌐 正在啟動放置型 RPG 模擬伺服器...
echo ========================================================

rem ---- 已經在跑就不重複啟動（重複啟動會因為 port 被占用而立刻死掉）----
curl -s -o nul --max-time 1 http://127.0.0.1:%PORT%/ 2>nul
if not errorlevel 1 (
  echo ✅ 伺服器已在執行中，直接開啟儀表板。
  goto :open
)

rem ---- 啟動 ----
rem 用獨立視窗承載 node，而不是 start /b：/b 會把 node 掛在這個主控台底下，
rem 主控台一關就可能把伺服器一起帶走。獨立視窗也讓使用者知道怎麼關掉它。
rem 輸出導到 %LOG% 而不是 nul——先前把輸出全吞掉，於是 node 沒裝、port 被占、
rem 程式有錯全都是靜默失敗，畫面上只看得到瀏覽器的「拒絕連線」。
start "Idle-RPG 模擬伺服器（關閉此視窗即停止）" /min cmd /c "node tools\sim_server.cjs > %LOG% 2>&1"

rem ---- 等到真的連得上才開瀏覽器 ----
rem ⚠️ 原本是固定 timeout /t 1。實測 node 冷啟動到 port 可連線約需 1050ms，
rem 而 timeout /t 1 最多只等 1000ms（且計時不精確，可能更短），
rem 於是瀏覽器比伺服器早開，穩定重現 ERR_CONNECTION_REFUSED。
rem 固定秒數在別台機器（防毒掃描、冷開機）只會更不夠，所以改成輪詢實際連線。
echo ⏳ 等待伺服器就緒...
set /a TRIES=0
:wait
set /a TRIES+=1
curl -s -o nul --max-time 1 http://127.0.0.1:%PORT%/ 2>nul
if not errorlevel 1 goto :open
if %TRIES% GEQ 40 goto :failed
rem 每次約 0.25 秒，最多等 10 秒
ping -n 1 -w 250 127.0.0.1 > nul
goto :wait

:failed
echo.
echo ❌ 伺服器在 10 秒內沒有就緒。以下是它的輸出：
echo --------------------------------------------------------
if exist "%LOG%" (
  type "%LOG%"
) else (
  echo （沒有產生 %LOG%，多半是找不到 node 指令）
  echo   請確認已安裝 Node.js，並在命令列執行 node -v 確認可用。
)
echo --------------------------------------------------------
pause
exit /b 1

:open
echo.
echo 📊 正在開啟數據儀表板 (%URL%)...
start "" "%URL%"
exit /b 0
