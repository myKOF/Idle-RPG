@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto nonode
echo ================================================
echo    套用遊戲參數（Excel -^> CSV -^> 遊戲）
echo ================================================
echo.
echo [1/3] 撥離七表（技能/狀態/寶石/天賦/裝備詞條/NPC/任務）：xlsx -^> CSV -^> 遊戲 ...
echo       config\Excel\Skills.xlsx / Gems.xlsx / Talents.xlsx / Equipment_Affix.xlsx / NPC.xlsx / Task.xlsx
echo       Remaining Excel files are scanned automatically.
node tools/config_tables.cjs --sync
if errorlevel 1 goto cfgsyncfail
echo.
echo [2/3] Sync every Excel file to a same-name CSV...
echo       config\Excel\*.xlsx  -^>  config\CSV\*.csv
for %%F in ("%~dp0config\Excel\*.xlsx") do call :sync_remaining_xlsx "%%~fF" "%%~nF"
if errorlevel 1 goto xlsxfail
node tools/config_tables.cjs --apply --write
if errorlevel 1 goto cfgapplyfail
echo.
echo [3/3] 套用主參數表 CSV 數值到遊戲 ...
node tools/apply_params.cjs --write
if errorlevel 1 goto failed
echo.
echo 完成。若遊戲頁面開著（本機），約 2 秒內會自動重新整理，不必手動 F5。
echo.
echo （請自行檢視上方訊息，關閉此視窗即可。）
pause
goto end
:cfgsyncfail
echo.
echo [撥離表轉換失敗] 讀不到或無法解析七表 xlsx（可能被 Excel 鎖定）。未修改遊戲。
pause
goto end
:cfgapplyfail
echo.
echo [配置套用未完成] 請查看上方的 Excel 檔名、格位、欄位、填入值與修正方式。
echo 可能原因：未接線的特效欄、Preset 檔名不存在，或表格／JSON 格式錯誤。
echo Excel 轉 CSV 已完成；任何遊戲 JS 都未覆寫，原本的遊戲設定仍保留。
echo 請修正 Excel 並儲存，再重新執行本工具。
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
goto :eof

:sync_remaining_xlsx
if /I "%~2"=="Skills" exit /b 0
if /I "%~2"=="Skills2" exit /b 0
if /I "%~2"=="Status" exit /b 0
if /I "%~2"=="Gems" exit /b 0
if /I "%~2"=="Talents" exit /b 0
if /I "%~2"=="Equipment_Affix" exit /b 0
if /I "%~2"=="NPC" exit /b 0
if /I "%~2"=="Task" exit /b 0
echo       %~2.xlsx  -^>  config\CSV\%~2.csv
set "PARAMS_XLSX=%~1"
set "PARAMS_CSV_OUT=%~dp0config\CSV\%~2.csv"
set "PARAMS_SHEET=__first__"
set "PARAMS_MIN_COLUMNS=0"
node tools/xlsx_to_csv.cjs
set "sync_rc=%errorlevel%"
set "PARAMS_XLSX="
set "PARAMS_CSV_OUT="
set "PARAMS_SHEET="
set "PARAMS_MIN_COLUMNS="
exit /b %sync_rc%
