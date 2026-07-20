@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto nonode
echo ================================================
echo    套用遊戲參數（Excel -^> CSV -^> 遊戲）
echo ================================================
echo.
echo [1/3] 撥離四表（技能/寶石/天賦/裝備詞條）：xlsx -^> CSV -^> 遊戲 ...
echo       config\Excel\Skills.xlsx / Gems.xlsx / Talents.xlsx / Equipment_Affix.xlsx
node tools/config_tables.cjs --sync
if errorlevel 1 goto cfgsyncfail
node tools/config_tables.cjs --apply --write
if errorlevel 1 goto cfgapplyfail
echo.
echo [2/3] 從 Excel 產生 CSV（主參數表）...
echo       config\Excel\game_parameters.xlsx  -^>  config\CSV\game_parameters.csv
node tools/xlsx_to_csv.cjs
if errorlevel 1 goto xlsxfail
echo.
echo [3/3] 套用主參數表 CSV 數值到遊戲 ...
node tools/apply_params.cjs --write
if errorlevel 1 goto failed
echo.
echo 完成。若遊戲頁面開著（本機），約 2 秒內會自動重新整理，不必手動 F5。
timeout /t 3 >nul
goto end
:cfgsyncfail
echo.
echo [撥離表轉換失敗] 讀不到或無法解析四表 xlsx（可能被 Excel 鎖定）。未修改遊戲。
pause
goto end
:cfgapplyfail
echo.
echo [撥離表套用失敗] 四表 CSV 格式錯誤或 JSON 無法解析（見上方訊息）。未修改遊戲。
pause
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
