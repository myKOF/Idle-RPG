# 太古星星素材

- 任務：ANCIENT-STARS-20261105。來源為使用者本次提供並指定用於遊戲的 `star3.jpg`；使用範圍為本專案裝備太古星星及太古精鑄變色版，未引入其他第三方素材。
- 內建 image_gen 編修：金色版去除 JPG 內烘焙棋盤格與外部光暈；藍色版以金色透明母圖變色，保留六芒星輪廓與金屬切面。屬 AI 編修輸出，非原 JPG 逐像素裁切。
- RPG Mote Studio 於本次嘗試無法存取，故使用內建圖片工具。三份完整提示詞保存在素材庫 `source.json`。
- 素材庫相對路徑：`codex-authored/ancient-stars-20261105/`。保留 `reference/star3.jpg`、`originals/gold.png`、`originals/light-blue.png`、`originals/blue.png`、三張 `icons/*.png` 與 SHA256 manifest。
- 縮圖：Pillow 依 alpha>16 邊界等比縮至最長邊124px，LANCZOS 重採樣，置中於128×128透明畫布；不調整生成的 alpha，PNG optimize／compression 9。最外圈保留透明邊緣。
- 使用者補充：太古精鑄保留淺藍／深藍兩種星星。新增以深藍母圖編修的淺藍版；第三份完整提示詞及透明母圖 `originals/light-blue.png` 同樣保存。
- 遊戲版本：`images/ui/ancient-star-gold.png`（一般）、`images/ui/ancient-star-light-blue.png`（精鑄第一條）、`images/ui/ancient-star-blue.png`（精鑄第二條／深藍）。CSS共用於裝備格及詞條標記，文字顏色沿用既有規則。
- 2026-11-05排列修正：以原本✡字形佔位維持原字級／基線／星列間距，PNG透過絕對定位偽元素覆蓋。三色共用黃色CSS外光暈（drop-shadow），光暈不占排版空間；PNG及素材庫母圖均不改寫，仍維持128px與原SHA。
- 2026-11-05淺藍微調：僅第一條精鑄的圖片以CSS `brightness(0.92) saturate(1.08)`略微加深；濾鏡先調圖片再產生原黃色外暈，不影響另外兩色及原排版，PNG／母圖SHA保持。
- 2026-11-05再調整：依使用者截圖，以正式防禦文字`--afx-def: #7fdcf5`為參考，取代上列微調。第一條精鑄使用內嵌SVG的sRGB色彩矩陣將R／G／B分別乘127／255、220／255、245／255，白色亮面對應參考藍，原明暗與alpha保留；黃色外暈在調色後產生，其他兩色及素材SHA保持。
- 2026-11-05加強外框光暈：三色共用CSS內嵌SVG濾鏡，SourceAlpha膨脹1個CSS像素、減去原alpha後填深金色，再將原圖疊回，形成沿圖案的1px外描邊；最後套近／中／遠三層金黃色drop-shadow。描邊與光暈均不參與排版，保留原PNG／母圖／SHA及第一條的防禦藍調色。
- 2026-11-05窄格避框：星列使用可壓縮Grid軌道，max-width為格內寬扣除左右共24px；每顆星星保留max-content及原18px字級，軌道縮短時只增加重疊，不縮圖案。寬格原步距保持，>4顆原重疊以兩側負margin及對稱padding保留，三色／描邊／光暈與PNG／母圖SHA不變。
- 匯出：`node tools/ancient-stars/export-source.cjs --apply`；驗證：`node tools/ancient-stars/export-source.cjs --check`。素材庫路徑由共用 `vfx-library-root.cjs` 解析，不記錄本機絕對路徑。
- 2026-11-05效能修正（烘焙光暈）：上列CSS濾鏡（SVG色彩矩陣＋SVG feMorphology描邊＋三層drop-shadow）每次重繪都在CPU重算，背包上百顆星星使介面卡頓。改由 `tools/ancient-stars/bake-glow.cjs` 以相同參數（1 CSS px≈7.6圖像素；描邊1px #6b3f16；外暈1／3／6px，σ＝半徑／2；淺藍色彩矩陣）離線烘進 `images/ui/ancient-star-{gold,light-blue,blue}-glow.png`（256px，四周各留64px光暈）。CSS只換圖並以 `transform: scale(2)` 抵銷留白，星星本體尺寸／基線／間距不變，已無任何濾鏡。原128px PNG仍為母圖、SHA不變。重新烘焙：`node tools/ancient-stars/bake-glow.cjs --apply`；驗證：`--check`。
