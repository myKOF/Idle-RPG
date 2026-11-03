# Role 人物與右手劍（2026-11-03）

- `role.glb` 是本次內測3D人物外觀；原 `sunbrand-knight.glb` 完整保留，供未來轉生外觀切換。本次不新增轉生切換功能。
- 來源為使用者提供的 `Role.glb`；使用者於本聊天明確確認「已取得授權」。未自行推定第三方授權條款，也未引入其他外部素材。
- 使用者最後指定只換人物與劍造型，**所有動作均不變**。附件自帶的跑步動畫沒有採用。將新外觀在 Blender 配合既有骨架的綁定姿勢，完整複製黃金騎士的 nodes、skin、inverse bind 與五段動畫；原始二進位區塊逐位元保持。
- 人物沿用附件外觀／1024px基色貼圖；在 Blender 中移除背劍、補合黏連處背部網格、固定握拳、重新配合既有骨架權重。新劍保留附件護手／皮柄造型與貼圖，劍身由 Blender 重建為筆直平面及開刃斜面，沒有原凹陷；僅護手到劍尖長度縮為附件的80%，劍柄不縮。握點配合原 Sword，整劍剛性綁定，不新增動畫、IK或手腕限制。
- 新人物沒有披風，不套用黃金騎士專用布料頂點清單，也不套用其金／銀／藍布調色。舊模型以 `Hero3D.create({model: ...})` 仍可使用原本布料／調色處理，待機、跑步、三個攻擊、技能、倒地及起身播放規則均沿用。
- 主端內測開關、正式服不載入3D的限制、戰鬥計算／射程／存檔／解鎖不變。縮劍只影響外觀，不改傷害判定。

可編輯來源、原始附件、匯出與製作工具保存在設定的素材庫 `codex-authored/hero3d-role-20261103/`；來源雜湊與量測見 `role.json` 及素材庫 `manifest.json`。

重製採專案的 Blender 流程（此人形底模由使用者直接指定提供，未另造底模）：

```text
blender -b --python tools/meshy-pipeline/blender/prepare_role.py -- <素材庫/source/Role.glb> images/models/hero3d/sunbrand-knight.glb <素材庫/exports/role.glb> <素材庫/source/role.blend> <素材庫/exports/role.json>
node tools/meshy-pipeline/src/export-role.cjs --apply
node tools/meshy-pipeline/src/export-role.cjs --source-check
node --test tests/hero3d-role.test.cjs tests/hero3d-internal-toggle.test.cjs tests/hero3d-battle-rules.test.cjs
```

更換來源後需核對品質／更新 manifest 的實際雜湊，再匯出；不得對原黃金騎士重跑修握姿或減劍流程。高清預覽使用正式 Hero3D／Pixi 渲染與遊戲場景；放大錄製只調整QA畫布解析度及檢視倍率，不寫入正式鏡頭或動畫數值。
