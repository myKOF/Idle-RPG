# 太古星星素材

- 任務：ANCIENT-STARS-20261105。來源為使用者本次提供並指定用於遊戲的 `star3.jpg`；使用範圍為本專案裝備太古星星及太古精鑄變色版，未引入其他第三方素材。
- 內建 image_gen 編修：金色版去除 JPG 內烘焙棋盤格與外部光暈；藍色版以金色透明母圖變色，保留六芒星輪廓與金屬切面。屬 AI 編修輸出，非原 JPG 逐像素裁切。
- RPG Mote Studio 於本次嘗試無法存取，故使用內建圖片工具。三份完整提示詞保存在素材庫 `source.json`。
- 素材庫相對路徑：`codex-authored/ancient-stars-20261105/`。保留 `reference/star3.jpg`、`originals/gold.png`、`originals/light-blue.png`、`originals/blue.png`、三張 `icons/*.png` 與 SHA256 manifest。
- 縮圖：Pillow 依 alpha>16 邊界等比縮至最長邊124px，LANCZOS 重採樣，置中於128×128透明畫布；不調整生成的 alpha，PNG optimize／compression 9。最外圈保留透明邊緣。
- 使用者補充：太古精鑄保留淺藍／深藍兩種星星。新增以深藍母圖編修的淺藍版；第三份完整提示詞及透明母圖 `originals/light-blue.png` 同樣保存。
- 遊戲版本：`images/ui/ancient-star-gold.png`（一般）、`images/ui/ancient-star-light-blue.png`（精鑄第一條）、`images/ui/ancient-star-blue.png`（精鑄第二條／深藍）。CSS共用於裝備格及詞條標記，文字顏色沿用既有規則。
- 2026-11-05排列修正：以原本✡字形佔位維持原字級／基線／星列間距，PNG透過絕對定位偽元素覆蓋。三色共用黃色CSS外光暈（drop-shadow），光暈不占排版空間；PNG及素材庫母圖均不改寫，仍維持128px與原SHA。
- 匯出：`node tools/ancient-stars/export-source.cjs --apply`；驗證：`node tools/ancient-stars/export-source.cjs --check`。素材庫路徑由共用 `vfx-library-root.cjs` 解析，不記錄本機絕對路徑。
