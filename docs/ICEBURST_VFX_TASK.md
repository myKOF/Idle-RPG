# 寒冰爆裂箭冰爆預覽

- 任務：VFX-ICEBURST-20260911；Owner：Codex；狀態：In Progress。
- 已唯讀核對技能文檔 E–I247 與內嵌參考圖 41/42：中心向外爆出藍白冰刺、碎裂晶體；冰爆半徑 6 米。
- 範圍：新增 iceburst-renew author、burst-icearrow-crystal preset/layout 與本紀錄。只製作預覽，不改 Excel、傷害、觸發條件或遊戲接線。
- 沿用既有冰錐與粒子素材，以縮放、旋轉、粒子擴散製作，不新增序列幀圖集。保留使用者未提交的寒冰箭調整。
- 驗收：Core 動態渲染預覽、preset/layout 測試及 Build。待使用者確認後由 Codex 接入。
- 預覽完成（Review）：0.75 秒藍白冰晶爆裂，14 道粗細不一的放射冰刺、26 片飛散冰晶及冰霧收尾。實際 Core 渲染 GIF 已目視檢查；136 項 Core/layout 測試、Build 339 檔通過。預覽存在系統暫存目錄，不納入遊戲提交；尚未接入、尚未 Commit，等待使用者確認。
- 使用者要求爆開後停留約 0.5 秒：冰刺 duration=1 秒，scaleX/Y 曲線在 0.12–0.62 維持尺寸、alpha 至 0.62 維持不透明，再淡出。這些皆為 VFX 編輯器原生可編輯曲線與 duration；總 duration=1.05 秒包含延遲。調整 duration 會等比改變爆開、停留與淡出；只調停留則修改曲線平台終點並保留爆開端點。更新 Core 動態 GIF 已檢視停留幀，136 項測試通過。仍待確認，未接入。
- 使用者批准接入：T7 attack 改為 burst-icearrow-crystal，同步 Excel Z178、CSV、JS、catalog 及主執行緒/Worker 快取。凍結結束事件、傷害與半徑保持不變。Excel ZIP 完整，逐格比較僅 Z178 值變動且樣式不變；未作桌面 Excel 驗證。144 項測試通過，包含實際 Runtime 冰刺停留與淡出回收；素材匯出已是最新，素材庫無變更。使用者最新 projectile 調整一併提交。
- 完成：Build 339 檔通過，Skills2 重建語意變更 0；預覽暫存已刪除。未作遊戲實機錄影。功能可合併，未推送。
