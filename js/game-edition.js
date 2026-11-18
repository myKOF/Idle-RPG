'use strict';
/* ============ 遊戲版本旗標（主執行緒與 Worker 共載）============
   'full' ＝ 正式版（網頁版、桌面正式版）；'demo' ＝ Steam 封測 demo。
   這個檔永遠是 'full'。demo 版由桌面外殼改寫回應內容（electron/main.cjs：開發時 --demo、
   demo 打包時 electron/edition.json），所以遊戲程式與存檔格式不分兩份。
   demo 的倍率與開放範圍見 js/data.js「Demo 版」區塊，數值來源 game_parameters「11-Demo版」。 */
var GAME_EDITION = 'full';
