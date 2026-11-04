# 3轉人物 Role3（2026-11-04）

- 使用者提供桌面 Role3.glb，已於本聊天明確確認本遊戲使用與修改授權。來源 SHA256：d2c49d1bf12913203cbf082bbbb0b30aece20320a7ab2b5130bcbbee4c65ba67。未引入其他外部素材。
- 原檔高1.7公尺，含SmartRig骨架與Running動畫。本次僅採用外觀：Blender將原綁定姿勢按既有解剖尺度整理，刪除背後雙劍／鞘／柄殘片，分離右手與大腿、左手與髖部及兩側腋下的連接面；清除切口中獨立細碎殘片，各部位獨立補面，最終開放邊界0。
- 改綁遊戲現有25骨架。原劍、已核准右手正握幾何／權重、六段動畫（Attack1／Attack2／CombatIdle／Death／Run／Attack4）、骨架節點與inverse bind逐值保留。原來源Running不替換遊戲跑步。手套頂點色改為銀灰護甲，保留角色銀金盔甲、白髮與深藍布料的原基色貼圖，縮為1024px；成品小於5MB。
- 0轉Role、1轉Role1、2轉Role2保持；3轉及以上改Role3。共用Hero3D外觀選擇入口，初次載入、當場轉生與讀檔均適用；原動作進度、速度、朝向、倒地／起身及載入失敗保留原外觀的行為照舊。
- 可編輯Blender檔、授權原檔、製作／匯出工具、成品、SHA manifest與QA保存在設定素材庫 `codex-authored/hero3d-role3-20261104`。本項為3D製作，使用Blender既有流程，未另製點陣美術；原授權模型為使用者提供，網格修復、綁定、手套顏色及匯出為本次修改。

重製（來源SHA與參數次序固定；approved必須是目前正握Role1）：

```text
blender -b --python-exit-code 1 --python tools/meshy-pipeline/blender/prepare_role3.py -- <素材庫/source/Role3.glb> images/models/hero3d/role1.glb <素材庫/exports/role3.glb> <素材庫/source/role3.blend> <素材庫/exports/role3.json>
node tools/meshy-pipeline/src/export-role3.cjs --apply
node tools/meshy-pipeline/src/export-role3.cjs --source-check
node --test tests/hero3d-role3.test.cjs tests/hero3d-rebirth-skin.test.cjs
```

切除與解剖區域只適用於這份授權來源，不能套用至其他任意模型。驗收須包含左右手實際權重／橋面及六段動畫蒙皮，不能只檢查名稱或修復報告。遊戲GIF採正式Pixi／Hero3D與同步握劍近拍，錄製的畫布解析度及預覽鏡頭調整只存在QA。
