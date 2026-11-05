# Role5：五轉金甲人物

使用者提供Role5.glb，於2026-11-05逐項確認本遊戲使用及修改授權，要求沿用Role4修改流程。輸入SHA256為`8f9dba13df728c8a87f22e149e5fa44e8d28ec3f7c5125ede08c91c69089f6c5`。沿既有MakeHuman手部／Blender骨架流程，在Blender4.5.10修復這份已授權人物，沒有另造人體、改舊人物或新取第三方素材。

雙手與腿、腋下的橋面分離，軀幹與左右臂各自封閉及限制骨骼權重；原身體／布料權重保留並平滑裙甲。頭部在來源空間校正-20°，頸部平滑過渡，消除原右轉。背劍含柄／護手／長刃及孤立碎片刪除，右手改用既有核准正握手，並沿用四轉核准的對稱護手紅紋新劍。右手幾何／法線／索引／權重、原骨架與六段動畫全部取樣保持，普攻仍四招隨機，不改手腕與刃向邏輯。

這次保留原始三張2048px基色／法線／金屬粗糙度貼圖，逐位相同，不再縮小或重新壓縮。`role5.glb`只含幾何、動作、材質與核准劍護手貼圖；人物三圖放在`role5/`，以版本化URI載入，`pbrExternal`指示使用已配置的原始Standard材質。原始法線及MR以Non-Color讀取。GLB約3.74MB低於5MB；三圖合計12959358bytes，五轉首次下載合計約16.7MB，僅目前所需外觀載入。這是保留原圖細節的容量成本，沒有新增HDR或Lightmap。

刪背劍後的補面採更細且與周邊一致的封邊，逐三角面從保留表面轉移UV；背部優先取對側相近甲片，讓補面沿用原金甲紋理、法線及金屬粗糙度，而非單色灰色填洞。原本被背劍遮住的部分屬合理補全，沒有宣稱完全還原不可見圖案。甲片獨立殼層有接觸／重合邊，整體強制空間焊接會改變拓樸，不是供3D列印的單一流形雕塑。

- 六動作／正握參考：role1.glb，SHA`54f104457683618ee328edd05749476dffd11bc093e7dbeb92619f59a55b1222`。
- 核准新劍：素材包`codex-authored/hero3d-role4-sword-v2-20261105`，Commit`305cb39`，SHA`9be98b40aee20fde05a3c5af928f64f5c22b0b51961668ce0eeae411c9334ea0`，沒有改造核准劍。
- 原始基色：`role5/base.jpg`，SHA`cc2955255eb4bda37cd39121deb4a1aee111423e11dbd07d19d6be6ef81c5e8d`。
- 原始法線：`role5/normal.png`，SHA`266b2a175593fddab63fdbe0faed1a64aa99dcc8844ddd5a54f833e91ea0bd70`。
- 原始MR：`role5/mr.jpg`，SHA`90734bb124d5f0905022be3aefb2733d75981f4665cf9c5296c8864dc1d9b9f7`。
- 成品SHA／刪除與修復統計：同資料夾role5.json。

載入時依原始glTF材質定義檢查必要基色／法線／MR；缺檔或解碼失敗會清理已載資源並拒絕新模型，不建立不完整材質的renderer，讓切換保留原外觀。此保護只套用新旁載PBR旗標，不改舊四套旁載回退流程。

遊戲0～4轉外觀及黃金騎士保留，5轉以上自動使用Role5。沿用既有當場轉生／存檔開局、動作進度／速度／朝向接續、過期載入釋放、失敗保留舊外觀及內測3D開關；不改轉生條件、戰鬥、存檔或系統解鎖。

素材庫相對路徑`codex-authored/hero3d-role5-20261105`保存授權原檔、可編輯且貼圖packed的Blend、修復資料、原圖、成品、製作／匯出工具與QA。經`tools/vfx/vfx-library-root.cjs`解析本機設定，單一匯出入口：

```text
blender -b --python-exit-code 1 --python tools/meshy-pipeline/blender/prepare_role5.py -- <Role5.glb> images/models/hero3d/role1.glb <核准role4-sword.glb> <role5.glb> <role5.blend> <role5.json>
node tools/meshy-pipeline/src/export-role5.cjs --source-check
```

驗證包含六段動畫各61姿勢CPU蒙皮、手腿權重／橋面、原圖尺寸／SHA與補面材質／UV、新劍剛性綁定與核准成品頂點／索引比對、原生前後與動作／握劍近拍、真index／Worker／Pixi轉生及存讀與高清GIF。詳細結果見docs/AI_TASKS.md的HERO3D-ROLE5-20261105；未做全庫、行動裝置長時間效能或全遊戲長玩。
