# 神祕商人立繪來源

2026-11-11 使用 Codex 內建 imagegen 繪製原創暗金風格半身角色。使用者截圖僅提供顯示尺寸與位置，立繪未使用第三方素材。角色戴兜帽與蒙面布，左手掌心朝上邀請，手掌空著。

素材庫相對路徑為 `codex-authored/mystery-merchant-20261111`。內含蒙面原始稿、左手姿勢修改後的透明 PNG、688 × 688 透明 WebP 與 manifest。兩次繪圖提示詞及每份圖像的 SHA-256 記錄在 manifest。

執行 `node tools/assets/export-mystery-merchant.cjs --apply` 匯出至 `images/ui/mystery-merchant.webp`，使用 `--check` 核對來源與遊戲成品。RPG Mote Studio 已確認可連線，主要為像素繪圖工具，此次手繪質感與透明角色稿採 imagegen 製作。
