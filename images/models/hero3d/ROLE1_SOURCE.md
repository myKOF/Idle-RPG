# 1轉人物外觀 Role1與右手正握（2026-11-03）

- 原始Role1.glb由使用者在本聊天提供，並於2026-11-03明確確認已取得本遊戲使用及修改授權。原檔SHA：7a169dbae8130939e6ed05ef3d1130c8520d80a18c266ded5456fe8988881e58。
- 0轉使用Role，1轉及以上使用Role1。以Worker header.player.reincarnations為準；已轉生存檔首次載入選對模型，遊戲中轉生在新模型就緒後換外觀。交換保留當前動畫實際秒數、速度、朝向、倒地保持及起身反播，舊WebGL與Pixi貼圖釋放。快速變更時淘汰過期載入，載入失敗保留當前人物；正式服依原限制不下載3D。
- Blender沿用使用者指定Role1人體／1024px基色貼圖，配合既有25骨架；移除438個背劍三角面及補背部。右手直接使用已修好的封閉握姿、原Sword武器與0.8劍身長度；護腕固定前臂。護手沿用原造型，小護手用舊圖集512px版本，人物本身仍1024px。沒有新增外部素材。
- 六段動畫Attack1、Attack2、CombatIdle、Death、Run、Attack4的全部取樣／時間／插值／目標均與目前Role完全相同。普攻四招隨機且不連續重複、技能仍原三招。Role1自帶Running不採用；轉生公式、門檻、存檔及戰鬥數值不變。原黃金騎士完整保留。
- 本輪正握修正與Role同步：修復掌面手性、拇指／食指側出刃，握柄隨掌面平移，六段動畫與刀刃方向保持。原始Role1保留於已提交的hero3d-role1-20261103（8c2c8e0），本輪可編輯role1.blend／正式匯出／作者工具與QA在設定素材庫codex-authored/hero3d-forward-grip-20261103/role1。role1.json與manifest記錄實際SHA及量測。成品小於5MB。

重製（Blender4.5.10 LTS）：

```text
blender -b --python tools/meshy-pipeline/blender/forward_grip.py -- <素材庫/hero3d-role1-20261103/exports/role1.glb> <新包/role1/exports/role1.glb> <新包/role1/source/role1.blend> <新包/role1/qa/author-report.json>
node tools/meshy-pipeline/src/export-role1.cjs --apply
node tools/meshy-pipeline/src/export-role1.cjs --source-check
node --test tests/hero3d-forward-grip.test.cjs tests/hero3d-rebirth-skin.test.cjs tests/hero3d-attack4.test.cjs tests/hero3d-role.test.cjs
```

若由原始Role1重新製作外觀，可用已正握修正的Role作approved輸入執行prepare_role1.py，直接複用正確手部及武器，勿再反射一次。歷史prepare_role1.py依賴同目錄既有prepare_role.py與sculpt_grip.py；先配合新人體／修護腕，再直接複用已核准的手與劍／六段動畫，整理未使用緩衝。外觀切換及GIF診斷不改正式鏡頭與動作。
