# 人物 PBR 材質恢復（2026-11-04）

Role／Role1／Role2／Role3原始GLB內的法線與金屬粗糙度貼圖，均來自使用者已確認可用於本遊戲及修改的模型。沒有新增第三方素材。材質製作使用Blender4.5.10，棚光環境由Three幾何面板即時產生，沒有外部HDR／Lightmap。

原始檔保留於設定素材庫codex-authored下的hero3d-role-20261103、hero3d-role1-20261103、hero3d-role2-20261104、hero3d-role3-20261104；本次新增hero3d-pbr-20261104，依來源SHA保留依賴、四份可編輯packed Blend及匯出。原遊戲GLB／UV／骨架／動畫／握劍幾何逐位保持，不覆寫前輪素材包。

`materials.json`依外觀及primitive綁定貼圖。資料貼圖縮為1024px，Non-Color處理；法線縮圖後重新正規化，MR綠色通道為粗糙度、藍色為金屬度。法線與MR不作sRGB解碼，flipY=false與glTF方向一致。新雕手部使用固定UV或頂點色，禁止直接套整張人物法線；原劍護手保留自己的基色UV。Role／Role1修補的純色皮革仍為獨立材質。

Hero3D保留Standard材質、頂點色與基色；自製PMREM環境提供隨轉身變化的反射，ACES色調映射及中性棚光維持亮暗層次。非本組模型仍沿用舊渲染；任一旁載圖失敗則整體回退，釋放包括晚到的貼圖。外觀切換時先釋放環境render target、所有共享貼圖及材質，再關閉renderer與該角色獨立WebGL context，避免舊context與內部快取累積。預設離屏畫布512px，遊戲人物尺寸保持。

每套人物新增約3MB貼圖，只載目前外觀；GLB本體維持原先小於5MB，總下載量因此高於原先只有基色的版本。正式服仍依既有內測限制不下載3D資源。

重製及驗證：

```text
blender -b --python-exit-code 1 --python tools/meshy-pipeline/blender/restore_pbr.py -- <遊戲專案> <設定素材庫/codex-authored/hero3d-pbr-20261104>
node tools/meshy-pipeline/src/export-hero-pbr.cjs --apply
node tools/meshy-pipeline/src/export-hero-pbr.cjs --source-check
node --test tests/hero3d-pbr.test.cjs
```

修改製作來源後須更新素材庫manifest SHA，再匯出、驗四套人物的正背面及全部動畫。修改旁載配置或貼圖時，同步更新hero3d.js的PBR配置／貼圖快取及index入口快取。修復網格仍沿用原貼圖UV，材質恢復不會重新生成背劍或變動蒙皮。
