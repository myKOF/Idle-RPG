# 繪本式序章素材（storybook）

2026-11-11 製作。全部為**原創程序生成**，沒有使用任何外部圖片、字型以外的第三方素材或 AI 生圖。

| 檔案 | 產生方式 |
|---|---|
| `paper.webp`、`paper-edge.webp` | `python tools/intro/storybook-paper.py`（Pillow 雜訊、纖維、水漬、焦邊） |
| 其餘 `*.svg` | `node tools/intro/storybook-art.cjs`（墨線、淡彩、描金的向量插畫） |

兩支產生器都固定亂數種子，重跑結果相同；要改造型請改產生器再重跑，不要手改輸出檔。改完記得把 `js/intro-data.js` 裡 `storybook` 的 `?v=` 加一。

## 畫風與造型

- 參考使用者指定影片的**表現手法**（舊書頁、黃皮紙上的墨線插畫、分層視差、部件分開動），不沿用影片中的任何角色、場景或圖像。
- 天使為原創造型：翼盔＋T 形面甲、日紋胸甲、白色罩袍、紅披風、兩對羽毛光翼。
  使用者附圖是既有遊戲的角色，**刻意不沿用其辨識特徵**（兜帽空臉、飄帶狀光翼、特定盔甲與劍型）。

## 分件

每個會動的部位都是獨立檔案，由 `js/intro-scene.js` 分開控制（座標與軸心見 `js/intro-data.js` 的 `storybook`）：

- 背景：`paper`、`rays`、`clouds-far`／`clouds-mid`／`clouds-near`
- 天使：`wing-upper`、`wing-lower`（左右共用，右側翻轉）、`cape`、`body`、`sword`、`halo`
- 前景：`frame`、`paper-edge`

## 預覽

本機伺服器開 `/tools/intro/storybook-preview.html?id=storybook`（`?t=毫秒` 停在指定時間，下方滑桿可拖動）。
遊戲內：GM 指令 `intro storybook`。
