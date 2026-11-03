# Role 人物、握劍與第四普攻（2026-11-03）

- 使用者提供 Role.glb 與 Attack4.glb，於本聊天分別確認已取得用於遊戲及修改的授權。未使用其他外部素材。
- 0轉預設人物為Role；原sunbrand-knight.glb完整保留，黃金騎士後續用途由使用者決定。本包沒有刪改黃金騎士。
- Role原背劍已移除，背部補面；劍身重建筆直平面與開刃斜面、護手至尖為原長80%（0.7396067m）。本次保留此劍身形狀，重建28mm皮柄，將掌心、拇指及四指做成封閉握柄網格，護腕固定在前臂。刀柄與掌面有0.5mm設計間隙，避免穿插；BVH量測與近拍見素材庫QA。
- 原五動畫Attack1／Attack2／CombatIdle／Death／Run、骨架及inverse bind資料完整保持；不使用附件Role自帶Running。第三普攻仍為既有Attack2後半片段。
- 新Attack4來自Shield_Push_Left：全身X反射、交換左右、配合現有骨架，72幀／30fps／2.366667秒；右手握劍，揮擊時刃口迎向前方敵人。起手／收招保留，沿用原普攻加速與播放完成後銜接規則。
- 使用者最新指示授權接入：3D普攻四招隨機、不連續同招；技能維持原三招。不改命中判定、攻速數值、傷害、Worker、存檔及系統解鎖。3D仍依既有內測限制。
- 使用Role貼圖及材質；重建手部以既有膚色貼圖取樣，皮柄為程序材質。沒有披風，不套黃金騎士專用布料及調色。

可編輯來源與已授權Attack4原檔：設定素材庫codex-authored/hero3d-grip-attack4-20261103；原Role及原始外觀製作仍保存在已提交的codex-authored/hero3d-role-20261103。新包manifest逐檔SHA核對，role.json記錄量測與來源。

重製順序（Blender 4.5.10 LTS，參數路徑依素材庫位置）：

```text
blender -b --python tools/meshy-pipeline/blender/sculpt_grip.py -- <原Role包/exports/role.glb> <新包/source/role-grip-fixed.glb> <新包/source/grip.blend> <新包/qa/hand-author-report.json>
blender -b --python tools/meshy-pipeline/blender/mirror_attack.py -- <新包/source/Attack4.glb> <新包/source/role-grip-fixed.glb> <新包/exports/role.glb> <新包/source/role-attack4.blend> <新包/qa/attack-author-report.json>
node tools/meshy-pipeline/src/export-role.cjs --apply
node tools/meshy-pipeline/src/export-role.cjs --source-check
node --test tests/hero3d-role.test.cjs tests/hero3d-attack4.test.cjs tests/hero3d-battle-rules.test.cjs
```

原始prepare_role.py保留歷史製程；不要將已修好手部的成品再次當sculpt輸入。預覽採正式Hero3D／Pixi，QA鏡頭與前方箭頭僅用於檢視。
