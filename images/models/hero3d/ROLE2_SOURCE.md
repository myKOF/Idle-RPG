# 2轉人物 Role2（2026-11-04）

- 使用者指定桌面Role2.glb，於本聊天確認已取得本遊戲使用及修改授權。來源SHA73c8e5667ef0dbf4b3394ae01e7f4193b0269d962d5f0f03949791dc81cd504f；原始未綁骨靜態人物、三份內嵌貼圖，無動畫。未另引入外部素材。
- Blender4.5.10整理人物拓樸：刪除背後交叉雙劍與護手／劍柄殘片，分離右手與大腿橋面；左手及腋下也有原始橋接，分開並對手臂、軀幹各自補面，避免舉劍拉扯。補面後分區邊界0。原右手換成既有正握手部並配手套頂點色，原有右手劍全部幾何／權重直接沿用，維持0.8劍身長度。Role／Role1／黃金騎士不改。
- 以這份人物的站姿建立來源解剖骨架、Blender骨熱權重及部位限制，配合既有25骨架綁定姿勢；原頭髮、銀甲、藍布、護具與人體保持。使用1024px原基色貼圖，手套採皮革／金屬／露指頂點色；小護手使用原劍貼圖。成品小於5MB。
- 全部六段動畫Attack1／Attack2／CombatIdle／Death／Run／Attack4的時間、插值、骨架目標與每個取樣均與Role1一致。四招隨機普攻、技能三招、待機／跑步／倒地／起身沿用原設計。
- 外觀分配：0轉Role、1轉Role1、2轉及以上Role2。仍依Worker header.player.reincarnations判斷，當場轉生及讀入2轉存檔皆可；切換保留動作進度、速度、朝向，舊請求淘汰及失敗保留原模型。既有3D內測限制、轉生條件、戰鬥數值、存檔與解鎖不變。
- 可編輯Blend、26.45MB授權原檔、匯出與製作工具／QA保存在設定素材庫codex-authored/hero3d-role2-20261104。角色原素材是使用者提供，網格修復、綁定、手套配色與匯出在Blender完成；未使用點陣繪圖工具，因本項為3D模型編修。

重製（參數次序固定，approved必須為現有正握Role1）：

```text
blender -b --python-exit-code 1 --python tools/meshy-pipeline/blender/prepare_role2.py -- <素材庫/source/Role2.glb> images/models/hero3d/role1.glb <素材庫/exports/role2.glb> <素材庫/source/role2.blend> <素材庫/exports/role2.json>
node tools/meshy-pipeline/src/export-role2.cjs --apply
node tools/meshy-pipeline/src/export-role2.cjs --source-check
node --test tests/hero3d-role2.test.cjs tests/hero3d-rebirth-skin.test.cjs
```

作者工具的來源骨架／雙劍切除範圍專門對應本份Role2，不能直接用於任意未綁骨模型。修改綁定後需驗四招及全部動作，不能只看靜止姿勢或動畫名稱。QA GIF採正式Hero3D／Pixi與同步握劍近拍，僅錄製時調整畫布解析度及檢視鏡頭。
