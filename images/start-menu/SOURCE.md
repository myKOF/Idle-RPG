# 開始選單背景素材

原型為本專案的荒原序章分鏡 `codex-authored/intro-dark-fantasy-20261105/originals/desolate-human-world.png`，使用者提供的兩張截圖供比對構圖及標記動態位置。2026-11-06 確認 RPG Mote Studio 可存取。這次需要保留高解析寫實繪景、重繪旗布後方及輸出透明布料，使用內建 ImageGen 以原畫編修。保留兩張生成母圖、實際提示詞及 Canvas 動畫來源於 Effects-Materials 的 `codex-authored/start-menu-wasteland-20261106`。

- `battlefield.webp` 是 1672 × 941 的暗色無字繪景。保留岩壁、拱門、遺骸、武器及旗桿，另將旗布和鬼火移出底圖以便獨立播放。
- `cloth-atlas.webp` 是 1774 × 887 的透明圖集。上半為破旗，下半為窄布條，場景以旗桿為錨點做連續的網格變形。
- 兩張 WebP 保留母圖尺寸及透明資料，Pillow WebP method 6，品質依序 90、87。色調、雲、鬼火、貼地風沙與遠山戰火由場景程式合成。

以 `node tools/intro/sync-start-menu.cjs --archive` 保存背景動畫來源及 SHA；`--apply` 將素材庫的匯出檔同步到本目錄；`--check` 核對來源、動畫程式與遊戲匯出。

## 陣風與遠山戰火

風沙在不同景深與位置形成寬幅陣風，陣風間隔、起砂位置、強度、持續時間與粒子壽命均有變化。每批粒子在掠過地表後消散。右上三段火線取底圖暖色做局部遮罩，分別疊上反射光暈、火尖與少量火星。最遠處降低亮度以保留山脊遮擋的距離感。

## 接入開始選單

由選單載入 `<script src="js/start-menu-background.js?v=1.0.1"></script>`，並在選單背景的定位容器呼叫：

```js
const backdrop = StartMenuBackground.mount(document.getElementById('start-menu'));
// backdrop.ready 是 Promise<boolean>，底圖及布料可用時為 true。
// 離開選單或拆卸容器時再呼叫 backdrop.destroy()。可重複呼叫。
```

容器應有定位與自己的堆疊環境，例如 `position: fixed; isolation: isolate`。背景佔滿容器，z-index 為 0。選單卡片須有較高層級。可在序章播放時掛載至隱藏的選單容器以提前載入素材。背景不攔截指標、不管理焦點與遊戲流程。縮窄視窗時以置中的滿版裁切維持拱門，兩側物件可能超出可視區。減少動態偏好會保留靜止的構圖，隱藏分頁或選單時停止計時。素材載入失敗時保留已可用的背景層，選單可照常使用。
