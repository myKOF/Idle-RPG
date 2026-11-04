# 極短低沉鼓敲擊音 — D1～D5

獨立試聽候選，尚未接入遊戲。全部原創程序合成；沒有外部錄音、參考音檔或取樣庫。
以快速下沉音高、低頻鼓體、非整數比鼓膜共鳴及少量限頻敲擊噪音製作，快速阻尼，無混響。

| 編號 | 設計方向 | 長度 |
|---|---|---|
| D1 | 短底鼓：緊實低咚 | 45 ms |
| D2 | 悶手鼓：短而有鼓皮觸感 | 38 ms |
| D3 | 低音通鼓：稍有鼓腔厚度 | 50 ms |
| D4 | 厚實重咚：最低沉的一款 | 55 ms |
| D5 | 極短乾鼓：最短促、俐落 | 32 ms |

`comparison.wav` 依 D1 → D5，每款兩次，保持單檔音量。精確時間見 manifest.json。
48 kHz、16-bit PCM WAV、立體聲置中，首尾淡化。音量供試聽比較，接入可另調整。

重產：`node tools/audio/ui-low-drum.cjs --apply`；驗證：`node tools/audio/ui-low-drum.cjs --check`。
素材庫透過既有 `tools/vfx/vfx-library-root.cjs` 解析；相對目錄 `codex-authored/ui-low-drum-20261105-v1`。
