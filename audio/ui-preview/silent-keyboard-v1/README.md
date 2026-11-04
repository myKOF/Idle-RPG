# 無聲鍵盤風格按鈕音 — K1～K5

獨立試聽候選，尚未接入遊戲。全為原創程序合成，沒有外部錄音、取樣庫或第三方素材。
「無聲鍵盤」指矽膠緩衝、悶而短的觸底聲，不代表完全無聲。保留試聽音量，可在接入時調整。

| 編號 | 設計方向 | 長度 |
|---|---|---|
| K1 | 矽膠輕嗒：柔和、乾淨 | 55 ms |
| K2 | 低沉悶嗒：較厚的觸底 | 65 ms |
| K3 | 薄膜輕按：稍清楚的指尖觸感 | 48 ms |
| K4 | 軟墊短噗：較鬆軟、氣墊感 | 70 ms |
| K5 | 靜音短鍵：極短按下／微弱回彈 | 62 ms |

`comparison.wav` 依 K1 → K5，每款兩次，保持單檔音量。精確播放時間見 manifest.json 的 timeline。

格式：48 kHz、16-bit PCM WAV、立體聲置中。短起音淡化／快速阻尼，沒有旋律、金屬鈴音或混響。

重產：`node tools/audio/ui-silent-keyboard.cjs --apply`；驗證：`node tools/audio/ui-silent-keyboard.cjs --check`。
素材庫位置透過既有 `tools/vfx/vfx-library-root.cjs` 解析；相對路徑為 `codex-authored/ui-silent-keyboard-20261104-v1`。
