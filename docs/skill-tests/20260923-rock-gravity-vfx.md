# ROCK-FIELD-VFX-20260923：岩甲領域敵方特效

- 任務編號：ROCK-FIELD-VFX-20260923
- 完成內容：超重力場與超重岩之術對敵人作用的事件只攜帶各自的 `attack`、`hit` 特效，不再沿岩甲本體特效繼承玩家專用的 `ground` 石碑環。玩家施放與狀態持續特效維持原路徑。
- 修改檔案：`js/skills2.js`、`index.html`、`tests/skill2-firehunt-rock-legendary.test.cjs`、`docs/AI_TASKS.md`、本文件。未修改但檢查：`js/vfx-runtime.js`、`js/status.js`、超神兩列技能表。素材庫無變更。
- 衝突：Claude 工作區 `js/skills2.js` 第 5239–5584 行火狩修改，與本次第 6058–6079 行不重疊；Claude 工作區 `index.html` 第 879 行快取 1.0.212 與本次同一行。本次在 Codex 工作區改為 1.0.213；使用者已明確同意這樣分別修改，整合時需保留兩邊功能並確認快取版號。
- 測試：`node --test --test-name-pattern="岩甲領域作用敵人時" tests/skill2-firehunt-rock-legendary.test.cjs`，1/1 通過，涵蓋兩種超神並確認玩家石碑仍在。整份同檔測試 29 項、26 通過；火神降臨 2 項及金剛不壞 1 項失敗，與這次敵方特效角色過濾無關。`node tools/build_check.cjs`，400 檔通過；`git diff --check` 通過。
- 已知風險：尚未用同時裝備兩種超神的實戰存檔觀察畫面。僅改特效事件角色，不改僵化／石化狀態和戰鬥數值。
- Commit：見包含本文件的遊戲專案提交；素材庫沒有必要修改，不建立素材庫 Commit。
- 未完成項目：無程式待辦。建議整合後檢查兩種超神實戰畫面；可合併，未自行合併／推送。
