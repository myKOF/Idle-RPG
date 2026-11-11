# 神祕商人立繪來源

2026-11-11 使用 Codex 內建 imagegen 繪製原創暗金風格半身角色。使用者截圖僅提供顯示尺寸與位置，立繪未使用第三方素材。角色戴兜帽與蒙面布，左手掌心朝上邀請，手掌空著。

素材庫相對路徑為 `codex-authored/mystery-merchant-20261111`。內含蒙面原始稿、左手姿勢修改後的透明 PNG、688 × 688 透明 WebP 與 manifest。兩次繪圖提示詞及每份圖像的 SHA-256 記錄在 manifest。

2026-11-11 以 Codex 內建 imagegen 繪製商店背景。琥珀燈照亮石牆與木製貨架，陳列寶石、符文石、盔甲、劍、藥水及雜貨。背景和蒙面立繪分層，畫面下緣由 CSS 加深以提高操作文字可讀性。使用者截圖提供擺放範圍，完整提示詞及背景來源和成品的 SHA-256 皆在同一 manifest。

以同一工具另繪商品區底座。深色橫木板襯底，四角用雕花金屬與紅寶石收邊，外緣保留透明度。使用者截圖提供木製商牌的風格參考，完整提示詞與檔案雜湊收錄於同一 manifest。

執行 `node tools/assets/export-mystery-merchant.cjs --apply`，匯出立繪、店內背景與商品區底座，分別位於 `images/ui/mystery-merchant.webp`、`images/ui/mystery-merchant-shop.webp` 及 `images/ui/mystery-merchant-tray.webp`。使用 `--check` 核對來源與遊戲成品。RPG Mote Studio 已確認可連線，主要為像素繪圖工具。商人素材需要手繪質感，本次採 imagegen 製作。
