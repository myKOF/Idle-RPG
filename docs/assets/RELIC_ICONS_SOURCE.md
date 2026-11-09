# 遺物圖標（2026-11-09）

使用者授權依32件遺物的名稱與作用製作原創精細圖標。每件以內建 image_gen 單獨生成；沒有引入第三方圖像素材。使用者截圖僅供圖標大小與介面位置參考。RPG Mote Studio 可連線，但其像素繪圖／動畫方式不適合本輪具金屬、琺瑯及寶石細節的插畫，因此改用 image_gen。

- 遊戲版本：`images/relics/relic-01.webp` 至 `relic-32.webp`，256×256，WebP quality 88。只等比縮圖與編碼，圓框由 CSS 呈現；未覆蓋既有素材。
- 完整逐張提示詞：`docs/assets/RELIC_ICONS_PROMPTS.json`。編號19及20雖同名「刻工鑿」，分別以寶石雕刻刀／符文雕刻刀呈現其效果。
- 素材庫：由 `tools/vfx/vfx-library-root.cjs` 解析本機位置，套件相對路徑 `codex-authored/relic-icons-20261109`，保存32張原始PNG、32張WebP、提示詞、此文件與SHA256 manifest。原圖為可續編修來源，不依賴聊天／Temp路徑。
- `node tools/assets/export-relic-icons.cjs --apply` 從素材庫同步；`--check` 驗證來源及遊戲匯出逐位元一致。
- 中央升級光環為 UI CSS 動畫，沒有新增／引用 VFX Preset；成功音效重用已核准 `audio/ui-preview/05-success.wav`，經 UISound 共用音效音量及靜音。
