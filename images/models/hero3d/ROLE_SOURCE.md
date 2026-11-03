# Role 人物、右手正握與第四普攻（2026-11-03）

- 使用者提供的Role.glb及Attack4.glb皆已確認本遊戲與修改授權。原始附件及歷史製程保留在hero3d-role-20261103、hero3d-grip-attack4-20261103；無新外部素材。
- 這次依使用者指出的正／反握錯誤，修復舊重建手掌的手性：原掌面朝向與拇指側不符合右手。Blender以腕部為中心反射掌面／指形，反轉三角面順序及重算法線；現在是右手正握，拇指／食指側朝向護手及劍身，小指側朝柄尾。手柄跟隨新掌面平移約4.2cm以保持真實貼合，刀刃方向與形狀不變。
- 283個手部頂點距柄小於1mm，手／刀身、護手、皮柄的BVH交叉三角面均0；手部保持封閉、法線向外。回歸直接量測實際掌面／拇指／劍網格及右手手性，不只檢查標籤或固定骨骼。
- 全部六段動畫（Attack1／Attack2／CombatIdle／Death／Run／Attack4）、骨架及inverse bind逐位保持。第四招所有72幀仍同一揮擊與刀刃迎敵方向，握點不離掌；原三招、跑步與倒地起身不重做。原背劍已刪，平整劍身維持原長80%（0.7396067m）。
- 0轉Role、1轉起Role1，兩皮膚同步修正；普攻四招隨機不連續同招、技能仍三招。黃金騎士完整保留。轉生切換、內測3D限制、命中／傷害／攻速、Worker／存檔及解鎖保持。

這次可編輯Blender來源與正式匯出在設定素材庫codex-authored/hero3d-forward-grip-20261103/role；其manifest逐檔SHA核對，role.json保存作者量測。Role1在同包role1子目錄。先前素材包作為已提交的歷史輸入保留，不能對已修正成品再次反射。

重製此次修正（Blender4.5.10 LTS）：

```text
blender -b --python tools/meshy-pipeline/blender/forward_grip.py -- <素材庫/hero3d-grip-attack4-20261103/exports/role.glb> <新包/role/exports/role.glb> <新包/role/source/role.blend> <新包/role/qa/author-report.json>
node tools/meshy-pipeline/src/export-role.cjs --apply
node tools/meshy-pipeline/src/export-role.cjs --source-check
node --test tests/hero3d-forward-grip.test.cjs tests/hero3d-role.test.cjs tests/hero3d-rebirth-skin.test.cjs
```

若由原Role重新製作外觀，歷史prepare_role.py→sculpt_grip.py→mirror_attack.py之後仍需執行forward_grip.py；或直接使用本包已修正的可編輯來源。不得把已含forwardGripVersion的模型重複修正。預覽的近拍鏡頭與同步放大框只用於QA，不寫正式遊戲。
