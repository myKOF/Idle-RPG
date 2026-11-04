# UI互動音效候選 — 2026-11-04

狀態：只供使用者試聽，尚未核准、未接入遊戲。index、UI、Worker、設定、String、存檔與系統解鎖均未變更。

全部由本次Codex以正弦波、非整數諧波、固定種子噪音、包絡與短回聲原創合成；沒有外部素材、錄音、取樣庫或參考音檔。製作程式與音色設計為本專案自製來源，不含第三方音訊授權依賴。

| 檔案 | 試聽用途／設計 |
| --- | --- |
| 01-hover.wav | 觸碰／懸停：輕短柔和的提示 |
| 02-click.wav | 點擊／確認：短促實體按壓感，微量晶體亮音 |
| 03-reroll.wav | 洗煉：魔力流動與上升碎晶音 |
| 04-divine-forge.wav | 神鑄：三下金屬敲擊與聚能共鳴 |
| 05-success.wav | 成功：向上的明亮和弦 |
| 06-failure.wav | 失敗／無法執行：柔和下降提示 |
| 00-all-preview.wav | 合輯：觸碰三次→點擊三次→洗煉→神鑄→成功→失敗，間隔0.45秒；時間點見manifest |

規格：48kHz、16-bit、立體聲PCM WAV。短起音與尾端淡出避免爆音，保留音色間相對音量，非逐檔正規化；未製作背景音樂或戰鬥音效。

唯一可編輯來源：`tools/audio/ui-preview.cjs`。依既有素材庫Root解析器，先將母檔保存至`codex-authored/ui-sound-preview-20261104`，再原樣匯出本候選目錄；兩端manifest記錄來源及WAV的SHA256。

重產與檢查：`node tools/audio/ui-preview.cjs --apply`／`node tools/audio/ui-preview.cjs --check`。素材庫保存的來源鏡像用於追溯，重產請從遊戲專案執行；沒有本機絕對路徑進入受管設定。

使用者聽過並授權後，才另行接線、設定開關與音量、登記玩家文字及執行遊戲操作驗證。
