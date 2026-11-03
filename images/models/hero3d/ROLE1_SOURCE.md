# 1轉人物外觀 Role1（2026-11-03）

- 原始Role1.glb由使用者在本聊天提供，並於2026-11-03明確確認已取得本遊戲使用及修改授權。原檔SHA：7a169dbae8130939e6ed05ef3d1130c8520d80a18c266ded5456fe8988881e58。
- 0轉使用Role，1轉及以上使用Role1。以Worker header.player.reincarnations為準；已轉生存檔首次載入選對模型，遊戲中轉生在新模型就緒後換外觀。交換保留當前動畫實際秒數、速度、朝向、倒地保持及起身反播，舊WebGL與Pixi貼圖釋放。快速變更時淘汰過期載入，載入失敗保留當前人物；正式服依原限制不下載3D。
- Blender沿用使用者指定Role1人體／1024px基色貼圖，配合既有25骨架；移除438個背劍三角面及補背部。右手直接使用已修好的封閉握姿、原Sword武器與0.8劍身長度；護腕固定前臂。護手沿用原造型，小護手用舊圖集512px版本，人物本身仍1024px。沒有新增外部素材。
- 六段動畫Attack1、Attack2、CombatIdle、Death、Run、Attack4的全部取樣／時間／插值／目標均與目前Role完全相同。普攻四招隨機且不連續重複、技能仍原三招。Role1自帶Running不採用；轉生公式、門檻、存檔及戰鬥數值不變。原黃金騎士完整保留。
- 原始Role1、可編輯且貼圖已打包的role1.blend、匯出、作者工具與QA保存在設定素材庫codex-authored/hero3d-role1-20261103；依賴素材為hero3d-grip-attack4-20261103（素材Commit89d34a3）。role1.json與manifest記錄實際SHA及量測。成品小於5MB。

重製（Blender4.5.10 LTS）：

```text
blender -b --python tools/meshy-pipeline/blender/prepare_role1.py -- <素材庫/source/Role1.glb> images/models/hero3d/sunbrand-knight.glb images/models/hero3d/role.glb <素材庫/exports/role1.glb> <素材庫/source/role1.blend> <素材庫/exports/role1.json>
node tools/meshy-pipeline/src/export-role1.cjs --apply
node tools/meshy-pipeline/src/export-role1.cjs --source-check
node --test tests/hero3d-rebirth-skin.test.cjs tests/hero3d-attack4.test.cjs tests/hero3d-role.test.cjs
```

prepare_role1.py依賴同目錄既有prepare_role.py與sculpt_grip.py；先配合新人體／修護腕，再直接複用已核准的手與劍／六段動畫，整理未使用緩衝。外觀切換及GIF診斷不改正式鏡頭與動作。
