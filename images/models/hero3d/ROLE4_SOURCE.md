# Role4：四轉角色與核准新劍

使用者提供並授權修改 `Role4.glb` 及劍參考圖；2026-11-05 接受第二版劍並明確允許接入遊戲。角色原檔及參考圖保存在素材庫首版包，不重複詢問既有授權。

以專案既有 MakeHuman 手部／Blender 骨架為基準，在 Blender 4.5.10 修復這份已授權人物，沒有另造人體或改動畫。頭部在來源空間向左校正 20°，頸部平滑過渡；刪除背劍、雙手與腿的橋面及腋下黏連，獨立封閉軀幹／雙臂，再依各自骨骼權重對齊。保留原身體與布料權重、平滑裙甲權重，避免裙甲誤受手骨影響。補面顏色取自附近保留的原人物貼圖，隱藏部位屬合理補全。

右手幾何、權重、正握及手腕使用既有核准版本；新劍只作剛性 Sword 綁定，握點及刃向保持。新劍來源為已核准第二版，護手幾何／貼圖左右對稱、中央紅寶石完整覆蓋底圖、劍身紅紋均勻。劍長及握柄保持第二版規格，不再重複縮短。骨架節點、inverse bind matrices 與六段動畫的全部取樣逐位等同 `role1.glb`。

- 角色原檔 SHA256：`3d22a180e843ad253c23b8b555f53ebf742a8df595404df2b8957a05bfc8c9bb`
- 核准劍 SHA256：`9be98b40aee20fde05a3c5af928f64f5c22b0b51961668ce0eeae411c9334ea0`
- 動作／正握參考 SHA256：`54f104457683618ee328edd05749476dffd11bc093e7dbeb92619f59a55b1222`
- 遊戲成品 SHA256 與修復統計：見同資料夾 `role4.json`。
- 遊戲成品約 4.86 MB，低於 5 MB；身體基色 1024px JPEG、法線／金屬粗糙度 512px PNG、護手 512px PNG 均內嵌。法線與 MR 為 Non-Color；不新增 HDR、Lightmap 或旁載貼圖。
- 遊戲使用範圍：0／1／2／3 轉分別維持 Role／Role1／Role2／Role3，4 轉以上使用 Role4；黃金騎士原檔保留。沿用內測 3D 開關、切換失敗保留原外觀、過期載入釋放及動作狀態接續。

素材庫相對路徑 `codex-authored/hero3d-role4-20261105` 保存可編輯 Blend、修復資料、成品、製作／匯出工具、依賴 SHA 與原生 QA。原始授權輸入依賴 `hero3d-role4-sword-preview-20261105`（素材 Commit `1fcac01`）；核准劍依賴 `hero3d-role4-sword-v2-20261105`（`305cb39`），舊包不覆寫。

重建指令（路徑由本機素材庫設定解析）：

```text
blender -b --python-exit-code 1 --python tools/meshy-pipeline/blender/prepare_role4.py -- <原始Role4.glb> images/models/hero3d/role1.glb <核准role4-sword.glb> <role4.glb> <role4.blend> <role4.json>
node tools/meshy-pipeline/src/export-role4.cjs --source-check
```

QA 包含六動畫各 61 姿勢的實際 CPU 蒙皮、手腿無混合橋面／權重、頭部中立方向、新劍 11021 頂點與索引比對、原生前後／動作／1400px 握劍近拍、真實 index／Worker／Pixi 的轉生與存讀及 1600×1000 遊戲 GIF。獨立軀幹與手臂拓樸封閉，成品幾何邊計數亦無單邊或奇數邊；接觸甲片仍有重合邊，整體強制空間焊接會改變原有獨立殼層，不能視為單一流形雕塑。未做行動裝置長時間效能或全遊戲長玩。
