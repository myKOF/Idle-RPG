@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto nonode
echo ================================================
echo    套用遊戲參數（Excel -^> CSV -^> 遊戲）
echo ================================================
echo.
echo [1/2] 從 Excel 產生 CSV ...
echo       config\Excel\game_parameters.xlsx  -^>  config\CSV\game_parameters.csv
node tools/xlsx_to_csv.cjs
if errorlevel 1 goto xlsxfail
echo.
echo [2/2] 套用 CSV 數值到遊戲 ...
node tools/apply_params.cjs --write
if errorlevel 1 goto failed
echo.
echo 完成。若遊戲頁面開著（本機），約 2 秒內會自動重新整理，不必手動 F5。
timeout /t 3 >nul
goto end
:xlsxfail
echo.
echo [轉換失敗] 讀不到或無法解析 config\Excel\game_parameters.xlsx（見上方訊息）。未修改遊戲。
pause
goto end
:failed
echo.
echo [套用失敗] 請看上方訊息（常見：CSV 格式錯誤或數值無法解析）。未修改遊戲。
pause
goto end
:nonode
echo [錯誤] 系統找不到 node（Node.js）。
echo 請先安裝 Node.js： https://nodejs.org
echo 安裝完成後，重新開機或重開此視窗再試一次。
pause
:end
