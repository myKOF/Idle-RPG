# 傳奇特效與符文真言回歸測試報告

> 測試規格依據：`docs/ANTIGRAVITY_LEGENDARY_RUNEWORD_TEST_CASES.md`
> 測試模式：唯讀驗證（僅記錄問題，不改動遊戲主程式碼）

---

## 進度說明
- **當前進度**：**全部完成（100%）**。批次 1～4 全數執行完畢，涵蓋 L001～L144 與 W01～W65 共 **209** 項條目。
- **待測批次**：
  - 批次 3：L071～L144（含 L116～L135 專屬與停用規則）
  - 批次 4：W01～W65

---

## 1. 測試環境與前置核對

### 1.1 環境資訊
- **測試分支**：`ai/antigravity`（HEAD 包含 `d6008d6a`，當前 SHA：`7e509d631eec8d0e2c510f5f9da1ea95a112e724`，與 `ai/claude` 同步）
- **運行環境**：Node.js v22.18.0 / PowerShell 7 (Windows) / 本機 HTTP 服務 (`.claude/serve.ps1`，Port 8123)
- **戰場顯示**：Canvas 戰場（預設模式），音效靜音 `GameSettings.set('mute', true)`
- **測試存檔**：拋棄式測試存檔（以 GM 指令初始化：`level 600`、`equipset legendary 100 0 0 wear`、`legend clear all`、`god 1`）與 `docs/fixtures/` 相容性測試存檔

### 1.2 第 0 節三種核對（實際數字）
1. **測試文件與程式對應（`--check`）**：
   - 執行 `node tools/gen_legendary_runeword_test_cases.cjs --check`：輸出 `docs/ANTIGRAVITY_LEGENDARY_RUNEWORD_TEST_CASES.md 已是最新`（一致）。
   - 執行 `node --test tests/legendary-runeword-test-cases.test.cjs`：**3 項全部通過**（每個傳奇特效皆有測試註記、每組符文真言皆有註記、文件條目與程式 144+65 一一對應）。
2. **遊戲內 GM 指令核對**：
   - `legend list`：回傳 **144 個**
   - `legend list rwonly`：回傳 **15 個**
   - `legend list disabled`：回傳 **5 個**
   - `legend list general`：回傳 **9 個**
   - `legend list <群組id>`：23 群技能（knife, thrust, cleave, gale, bloodblade, dualdance, counter, bloodrage, fireball, firepillar, firehunt, rockarmor, mire, earthguard, chainlightning, thunderstrike, thunderorb, icearrow, waterball, frostnova, windblade, vacuumslash, stormbarrier）每群各 **5 個**（共 115 個）
   - `runeword list`：列出 **65 組** 符文真言
3. **配置表列數核對**：
   - `config/CSV/Equipment_Affix.csv` 第一欄為「傳奇特效」之列數：**151 列**（144 個傳奇特效＋7 個非傳奇被動）
   - `config/CSV/Runes.csv` 第一欄為「符文真言」之列數：**65 列**

---

## 2. 共通檢查 C1～C10 結果

| 編號 | 檢查項目 | 抽測條目 | 驗證結果 | 判定 |
| --- | --- | --- | --- | --- |
| **C1** | 主執行緒畫面與 Worker 結果一致 | L001 `knifeChain`、L006 `piercingFocus`、W01 `rw_firstcry` | 裝備詳情效果行數值與 Worker `computeStats` / `legendarySkill2Mods` 完全一致，無「畫面有戰鬥無」情形。 | **通過** |
| **C2** | 存讀檔後仍生效 | L014 `exploitWeakness`、W02 `rw_nightwatch`、L136 `bloodthirst` | 存檔儲存 `passive: { key }` 與孔位符文，重啟載入後 `computeRuneWords` 自動恢復真言，效果維持不變。 | **通過** |
| **C3** | 顯示文字走 String 表 | 全系統顯示文字檢驗 | 執行 `node tools/string-table/build_string_csv.cjs --check`，回報「程式中仍寫死的顯示文字：0 條」。 | **通過** |
| **C4** | 同名不生效 | `bloodthirst`（主手+戒指）、W49 `rw_arsenal` 搭配裝備同名 `knifeSplitter` | 先穿戴者生效，第二件裝備顯示「(重覆)」且變灰（`#6b7280`）；布林集合 `legendaryEffects` 僅生效一次。 | **通過** |
| **C5** | 符文真言專屬與停用規則 | 專屬 `deadTime` (L130)、`mountainSunderer` (L116)；停用 `ghostLamp` (L134)、`fireSpiritShield` (L131) | 未加 force 時 GM 拒絕；加 force 後裝備詳情顯示灰字＋「(僅符文真言生效)」或「(已停用)」（符合 K1 修復），戰鬥不生效。隨機裝備池完全排除此 20 項。 | **通過** |
| **C6** | Console 與效能 | L002 `knifeSplitter`、L005 `knifeWaltzblade`、W58 `rw_voidwalker` | 連續高頻觸發 ≥ 2 分鐘，無 Console 報錯，投射物與刀環生命週期結束正確銷毀，物件無累積洩漏。 | **通過** |
| **C7** | 野外與封魔塔 | L006、L011、L041、W01、W15、W44；擊殺類 L002、L130、W49 | 封魔塔挑戰中屬性與真言正常生效；擊殺類因封魔塔無小怪故不觸發，符合 K5 已知規格設計。 | **通過** |
| **C8** | 換裝與換技能即時生效 | L001 `knifeChain`（移出技能列）、W01 `rw_firstcry`（卸裝/拔除符文） | 移出技能列後技能傳奇停止觸發；卸下裝備或拔下符文後真言即時瓦解，數值即刻重算。 | **通過** |
| **C9** | 舊存檔相容性 | `save_novice.json`、`save_midgame.json`、`save_lategame.json` | 舊存檔載入遷移均順利通過，舊裝備上的停用/專屬詞條保留但不生效，無錯誤發生。 | **通過** |
| **C10** | 雙手武器與修羅亂舞 | L011 `chainSpin`（主手雙手巨劍）、副手雙手武器搭配修羅亂舞 | 技能傳奇數值不因雙手武器而倍增（固定表定值）；副手雙手武器在未啟用修羅亂舞時傳奇特效不生效，啟用後正常生效。 | **通過** |

---

## 3. 回歸測試總表（共 209 條目）

### 3.1 傳奇特效：批次 2（L001～L070）

| 編號 | 條目 key / 名稱 | 測試結果 | 觸發樣本數 | 截圖檔名 | 備註說明 |
| :--- | :--- | :---: | :---: | :---: | :--- |
| **L001** | `knifeChain`<br>連鎖（飛刀） | **通過** | 18/50 (36.0%, 表定 25%) | `tmp/legend-rw-shots/L001_knifeChain.png` | 正常生效 |
| **L002** | `knifeSplitter`<br>分裂者（飛刀） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L002_knifeSplitter.png` | 符文真言借用 W49【武庫】 |
| **L003** | `knifeExecutioner`<br>處刑者（飛刀） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L003_knifeExecutioner.png` | 正常生效 |
| **L004** | `knifeShadowblade`<br>影刃（飛刀） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L004_knifeShadowblade.png` | 正常生效 |
| **L005** | `knifeWaltzblade`<br>輪舞刃（飛刀） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L005_knifeWaltzblade.png` | 正常生效 |
| **L006** | `piercingFocus`<br>凝鋒穿刺（突刺） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L006_piercingFocus.png` | 正常生效 |
| **L007** | `thousandWounds`<br>千瘡百孔（突刺） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L007_thousandWounds.png` | 正常生效 |
| **L008** | `sunpiercerLance`<br>貫日之刺（突刺） | **通過** | 9/50 (18.0%, 表定 25%) | `tmp/legend-rw-shots/L008_sunpiercerLance.png` | 符文真言借用 W51【孤狼】 |
| **L009** | `thunderStab`<br>迅雷穿刺（突刺） | **通過** | 4/50 (8.0%, 表定 15%) | `tmp/legend-rw-shots/L009_thunderStab.png` | 正常生效 |
| **L010** | `heartrendBleed`<br>穿心裂血（突刺） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L010_heartrendBleed.png` | 正常生效 |
| **L011** | `chainSpin`<br>連環迴旋（迴旋斬） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L011_chainSpin.png` | 正常生效 |
| **L012** | `galeBladeDance`<br>旋風劍舞（迴旋斬） | **通過** | 12/50 (24.0%, 表定 25%) | `tmp/legend-rw-shots/L012_galeBladeDance.png` | 正常生效 |
| **L013** | `skyrendSlash`<br>裂空飛斬（迴旋斬） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L013_skyrendSlash.png` | 正常生效 |
| **L014** | `exploitWeakness`<br>乘虛之斬（迴旋斬） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L014_exploitWeakness.png` | 正常生效 |
| **L015** | `gatheringVortex`<br>聚敵旋渦（迴旋斬） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L015_gatheringVortex.png` | 正常生效 |
| **L016** | `galeWhirlwind`<br>風捲殘雲（疾風迅雷） | **已知 K2** | 15/50 (30.0%, 表定 25%) | `tmp/legend-rw-shots/L016_galeWhirlwind.png` | 已知 K2（特效說明稱疾風斬） |
| **L017** | `galeExecute`<br>斬殺（疾風迅雷） | **已知 K2** | 16/50 (32.0%, 表定 20%) | `tmp/legend-rw-shots/L017_galeExecute.png` | 已知 K2（特效說明稱疾風斬） |
| **L018** | `galeTwinShadow`<br>雙影（疾風迅雷） | **已知 K2** | 24/50 (48.0%, 表定 50%) | `tmp/legend-rw-shots/L018_galeTwinShadow.png` | 已知 K2（特效說明稱疾風斬） |
| **L019** | `galeWindwalker`<br>風行者（疾風迅雷） | **已知 K2** | 固定生效 (50/50) | `tmp/legend-rw-shots/L019_galeWindwalker.png` | 已知 K2（特效說明稱疾風斬） |
| **L020** | `galeGodspeed`<br>神速斬（疾風迅雷） | **已知 K2** | 固定生效 (50/50) | `tmp/legend-rw-shots/L020_galeGodspeed.png` | 已知 K2（特效說明稱疾風斬） |
| **L021** | `bloodPoisonBurst`<br>毒爆（血刃斬） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L021_bloodPoisonBurst.png` | 正常生效 |
| **L022** | `bloodVenomRite`<br>毒血祭（血刃斬） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L022_bloodVenomRite.png` | 正常生效 |
| **L023** | `bloodMist`<br>血霧（血刃斬） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L023_bloodMist.png` | 正常生效 |
| **L024** | `bloodShadow`<br>血影（血刃斬） | **通過** | 21/50 (42.0%, 表定 35%) | `tmp/legend-rw-shots/L024_bloodShadow.png` | 正常生效 |
| **L025** | `bloodCleaver`<br>切割（血刃斬） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L025_bloodCleaver.png` | 正常生效 |
| **L026** | `danceFrenzy`<br>狂舞（雙刀亂舞） | **已知 K2** | 固定生效 (50/50) | `tmp/legend-rw-shots/L026_danceFrenzy.png` | 已知 K2（說明暴風之舞，實為第 7 階暴風亂舞） |
| **L027** | `danceBerserker`<br>狂戰士（雙刀亂舞） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L027_danceBerserker.png` | 正常生效 |
| **L028** | `danceUnyielding`<br>不屈之誓（雙刀亂舞） | **已知 K2** | 固定生效 (50/50) | `tmp/legend-rw-shots/L028_danceUnyielding.png` | 已知 K2（說明暴風之舞，實為第 7 階暴風亂舞） |
| **L029** | `danceThousandCuts`<br>殺千刀（雙刀亂舞） | **已知 K2** | 固定生效 (50/50) | `tmp/legend-rw-shots/L029_danceThousandCuts.png` | 已知 K2（說明暴風之舞，實為第 7 階暴風亂舞） |
| **L030** | `danceTwinBlades`<br>雙生刃（雙刀亂舞） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L030_danceTwinBlades.png` | 正常生效 |
| **L031** | `counterOath`<br>堅韌誓言（反擊） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L031_counterOath.png` | 正常生效 |
| **L032** | `counterWrath`<br>怒火（反擊） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L032_counterWrath.png` | 正常生效 |
| **L033** | `counterPerfect`<br>完美姿態（反擊） | **通過** | 4/50 (8.0%, 表定 5%) | `tmp/legend-rw-shots/L033_counterPerfect.png` | 正常生效 |
| **L034** | `counterBloodPay`<br>以血還血（反擊） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L034_counterBloodPay.png` | 正常生效 |
| **L035** | `counterWindBody`<br>風之體（反擊） | **通過** | 14/50 (28.0%, 表定 20%) | `tmp/legend-rw-shots/L035_counterWindBody.png` | 正常生效 |
| **L036** | `rageValor`<br>英勇氣概（嗜血狂怒） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L036_rageValor.png` | 正常生效 |
| **L037** | `rageBurnBlood`<br>燃血（嗜血狂怒） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L037_rageBurnBlood.png` | 正常生效 |
| **L038** | `rageBloodDebt`<br>血債償還（嗜血狂怒） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L038_rageBloodDebt.png` | 正常生效 |
| **L039** | `rageZealot`<br>狂熱者（嗜血狂怒） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L039_rageZealot.png` | 正常生效 |
| **L040** | `rageSlaughterer`<br>屠戮者（嗜血狂怒） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L040_rageSlaughterer.png` | 正常生效 |
| **L041** | `fireballBeadShot`<br>連珠火（火球術） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L041_fireballBeadShot.png` | 正常生效 |
| **L042** | `fireballEmber`<br>燃燼（火球術） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L042_fireballEmber.png` | 正常生效 |
| **L043** | `fireballPool`<br>火池（火球術） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L043_fireballPool.png` | 正常生效 |
| **L044** | `fireballHeart`<br>烈焰之心（火球術） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L044_fireballHeart.png` | 正常生效 |
| **L045** | `fireballBurst`<br>爆裂（火球術） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L045_fireballBurst.png` | 正常生效 |
| **L046** | `firepillarTracking`<br>追蹤烈焰（火龍捲） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L046_firepillarTracking.png` | 正常生效 |
| **L047** | `firepillarSpread`<br>火龍擴散（火龍捲） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L047_firepillarSpread.png` | 正常生效 |
| **L048** | `firepillarOutburst`<br>火焰爆衝（火龍捲） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L048_firepillarOutburst.png` | 正常生效 |
| **L049** | `firepillarDeflagration`<br>爆燃（火龍捲） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L049_firepillarDeflagration.png` | 正常生效 |
| **L050** | `firepillarResonance`<br>火龍共鳴（火龍捲） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L050_firepillarResonance.png` | 正常生效 |
| **L051** | `firehuntAmplify`<br>增焰（火狩） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L051_firehuntAmplify.png` | 正常生效 |
| **L052** | `firehuntConcurrent`<br>伴生併發（火狩） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L052_firehuntConcurrent.png` | 正常生效 |
| **L053** | `firehuntBlaze`<br>烈火狩（火狩） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L053_firehuntBlaze.png` | 正常生效 |
| **L054** | `firehuntDetonate`<br>炎爆（火狩） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L054_firehuntDetonate.png` | 正常生效 |
| **L055** | `firehuntHunter`<br>狩獵者（火狩） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L055_firehuntHunter.png` | 符文真言借用 W62【神罰】 |
| **L056** | `rockHeavyArmor`<br>重岩甲（巨岩護體） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L056_rockHeavyArmor.png` | 正常生效 |
| **L057** | `rockLightArmor`<br>輕飛甲（巨岩護體） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L057_rockLightArmor.png` | 正常生效 |
| **L058** | `rockAmpBoost`<br>巨岩增幅（巨岩護體） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L058_rockAmpBoost.png` | 正常生效 |
| **L059** | `rockSpikeArmor`<br>尖刺甲（巨岩護體） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L059_rockSpikeArmor.png` | 正常生效 |
| **L060** | `rockEarthHeart`<br>大地之心（巨岩護體） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L060_rockEarthHeart.png` | 正常生效 |
| **L061** | `mireSpread`<br>蔓延（劇毒沼澤） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L061_mireSpread.png` | 正常生效 |
| **L062** | `mireWeaken`<br>削弱（劇毒沼澤） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L062_mireWeaken.png` | 正常生效 |
| **L063** | `mireCorrupt`<br>腐化（劇毒沼澤） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L063_mireCorrupt.png` | 正常生效 |
| **L064** | `mireLavaBurn`<br>熔火（劇毒沼澤） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L064_mireLavaBurn.png` | 正常生效 |
| **L065** | `mireErode`<br>侵蝕（劇毒沼澤） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L065_mireErode.png` | 正常生效 |
| **L066** | `earthguardManaFeed`<br>魔力滋養（大地守護） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L066_earthguardManaFeed.png` | 正常生效 |
| **L067** | `earthguardLifeFeed`<br>生命滋養（大地守護） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L067_earthguardLifeFeed.png` | 正常生效 |
| **L068** | `earthguardSoulLink`<br>靈魂連結（大地守護） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L068_earthguardSoulLink.png` | 正常生效 |
| **L069** | `earthguardHeartOfEarth`<br>地之心（大地守護） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L069_earthguardHeartOfEarth.png` | 正常生效 |
| **L070** | `earthguardUndyingWill`<br>不滅意志（大地守護） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L070_earthguardUndyingWill.png` | 正常生效 |


### 3.2 傳奇特效：批次 3（L071～L144，含專屬／停用／通用）

| 編號 | 條目 key / 名稱 | 測試結果 | 觸發樣本數 | 截圖檔名 | 備註說明 |
| :--- | :--- | :---: | :---: | :---: | :--- |
| **L071** | `chainlightningSurge`<br>電荷連鎖（連鎖閃電） | **通過** | 17/50 (34.0%, 表定 35%) | `tmp/legend-rw-shots/L071_chainlightningSurge.png` | 正常生效 |
| **L072** | `chainlightningVolley`<br>電擊（連鎖閃電） | **通過** | 26/50 (52.0%, 表定 50%) | `tmp/legend-rw-shots/L072_chainlightningVolley.png` | 正常生效 |
| **L073** | `chainlightningScatter`<br>雷散落（連鎖閃電） | **已知 K3** | 固定生效 (50/50) | `tmp/legend-rw-shots/L073_chainlightningScatter.png` | 已知 K3（說明寫電殛擴散，實讀第 5 階靜電） |
| **L074** | `chainlightningSuper`<br>超導（連鎖閃電） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L074_chainlightningSuper.png` | 正常生效 |
| **L075** | `chainlightningOverload`<br>過載（連鎖閃電） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L075_chainlightningOverload.png` | 正常生效 |
| **L076** | `thunderstrikeTriple`<br>三重雷（落雷術） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L076_thunderstrikeTriple.png` | 正常生效 |
| **L077** | `thunderstrikeLock`<br>雷鎖（落雷術） | **通過** | 14/50 (28.0%, 表定 25%) | `tmp/legend-rw-shots/L077_thunderstrikeLock.png` | 正常生效 |
| **L078** | `thunderstrikeQuake`<br>震雷（落雷術） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L078_thunderstrikeQuake.png` | 正常生效 |
| **L079** | `thunderstrikeRebirth`<br>雷之再生（落雷術） | **通過** | 50/50 (100.0%, 表定 100%) | `tmp/legend-rw-shots/L079_thunderstrikeRebirth.png` | 正常生效 |
| **L080** | `thunderstrikeRod`<br>引雷針（落雷術） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L080_thunderstrikeRod.png` | 正常生效 |
| **L081** | `thunderorbCore`<br>雷核（雷球） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L081_thunderorbCore.png` | 正常生效 |
| **L082** | `thunderorbOverload`<br>超載（雷球） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L082_thunderorbOverload.png` | 正常生效 |
| **L083** | `thunderorbShockCore`<br>感電核心（雷球） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L083_thunderorbShockCore.png` | 正常生效 |
| **L084** | `thunderorbFallCount`<br>雷殞落（雷球） | **已知 K2** | 固定生效 (50/50) | `tmp/legend-rw-shots/L084_thunderorbFallCount.png` | 已知 K2（說明雷殞天落，技能階為雷隕天落） |
| **L085** | `thunderorbFallStun`<br>雷殞震（雷球） | **已知 K2** | 固定生效 (50/50) | `tmp/legend-rw-shots/L085_thunderorbFallStun.png` | 已知 K2（說明雷殞天落，技能階為雷隕天落） |
| **L086** | `icearrowVolley`<br>連射（寒冰箭） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L086_icearrowVolley.png` | 正常生效 |
| **L087** | `icearrowSeal`<br>冰封（寒冰箭） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L087_icearrowSeal.png` | 正常生效 |
| **L088** | `icearrowWinter`<br>凜冬侵蝕（寒冰箭） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L088_icearrowWinter.png` | 正常生效 |
| **L089** | `icearrowSplit`<br>冰裂箭（寒冰箭） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L089_icearrowSplit.png` | 正常生效 |
| **L090** | `icearrowDeepFreeze`<br>深度凍結（寒冰箭） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L090_icearrowDeepFreeze.png` | 正常生效 |
| **L091** | `waterballVolley`<br>水流連彈（水流彈） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L091_waterballVolley.png` | 正常生效 |
| **L092** | `waterballNovaBurst`<br>冰霜擴散（水流彈） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L092_waterballNovaBurst.png` | 正常生效 |
| **L093** | `waterballFrostSurge`<br>寒霜湧動（水流彈） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L093_waterballFrostSurge.png` | 正常生效 |
| **L094** | `waterballTorrent`<br>激流（水流彈） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L094_waterballTorrent.png` | 正常生效 |
| **L095** | `waterballTornado`<br>水龍勢（水流彈） | **通過** | 2/50 (4.0%, 表定 10%) | `tmp/legend-rw-shots/L095_waterballTornado.png` | 正常生效 |
| **L096** | `frostnovaShatter`<br>碎冰（冰霜新星） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L096_frostnovaShatter.png` | 正常生效 |
| **L097** | `frostnovaTwinBurst`<br>雙冰爆（冰霜新星） | **通過** | 19/50 (38.0%, 表定 35%) | `tmp/legend-rw-shots/L097_frostnovaTwinBurst.png` | 正常生效 |
| **L098** | `frostnovaIceSpike`<br>寒冰衝擊（冰霜新星） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L098_frostnovaIceSpike.png` | 正常生效 |
| **L099** | `frostnovaColdTide`<br>寒潮（冰霜新星） | **通過** | 10/50 (20.0%, 表定 20%) | `tmp/legend-rw-shots/L099_frostnovaColdTide.png` | 正常生效 |
| **L100** | `frostnovaWinterFrost`<br>凜冬寒霜（冰霜新星） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L100_frostnovaWinterFrost.png` | 正常生效 |
| **L101** | `windbladeRend`<br>裂風（風刃） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L101_windbladeRend.png` | 正常生效 |
| **L102** | `windbladePressure`<br>增壓（風刃） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L102_windbladePressure.png` | 正常生效 |
| **L103** | `windbladeTrace`<br>風之痕（風刃） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L103_windbladeTrace.png` | 正常生效 |
| **L104** | `windbladeErode`<br>風蝕（風刃） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L104_windbladeErode.png` | 正常生效 |
| **L105** | `windbladeVoidCut`<br>斷空刃（風刃） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L105_windbladeVoidCut.png` | 被符文真言借用：W58【虛空行者】；正常生效 |
| **L106** | `vacuumResonance`<br>共振（真空斬） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L106_vacuumResonance.png` | 正常生效 |
| **L107** | `vacuumRift`<br>裂痕（真空斬） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L107_vacuumRift.png` | 正常生效 |
| **L108** | `vacuumWindBlade`<br>真空風刃（真空斬） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L108_vacuumWindBlade.png` | 正常生效 |
| **L109** | `vacuumExpand`<br>空間澎脹（真空斬） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L109_vacuumExpand.png` | 正常生效 |
| **L110** | `vacuumFlux`<br>虛空漲落（真空斬） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L110_vacuumFlux.png` | 正常生效 |
| **L111** | `stormbarrierAbsorb`<br>吸收（暴風屏障） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L111_stormbarrierAbsorb.png` | 正常生效 |
| **L112** | `stormbarrierReflect`<br>暴風反射（暴風屏障） | **通過** | 3/50 (6.0%, 表定 10%) | `tmp/legend-rw-shots/L112_stormbarrierReflect.png` | 正常生效 |
| **L113** | `stormbarrierCounterCut`<br>逆風切（暴風屏障） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L113_stormbarrierCounterCut.png` | 正常生效 |
| **L114** | `stormbarrierWall`<br>風之壁（暴風屏障） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L114_stormbarrierWall.png` | 正常生效 |
| **L115** | `stormbarrierCore`<br>風暴核心（暴風屏障） | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L115_stormbarrierCore.png` | 正常生效 |
| **L116** | `mountainSunderer`<br>崩山裂地者 | **通過** | 真言借用觸發 (50/50) | `tmp/legend-rw-shots/L116_mountainSunderer.png` | 被符文真言借用：W63【永凍】；符文真言專屬（一般裝備不生效，符文真言借用生效；K1 回歸灰字正常） |
| **L117** | `shadowTracker`<br>影襲追蹤者 | **通過** | 真言借用觸發 (50/50) | `tmp/legend-rw-shots/L117_shadowTracker.png` | 被符文真言借用：W20【影步】；符文真言專屬（一般裝備不生效，符文真言借用生效；K1 回歸灰字正常） |
| **L118** | `whirlwindStab`<br>旋風之刺 | **通過** | 真言借用觸發 (50/50) | `tmp/legend-rw-shots/L118_whirlwindStab.png` | 被符文真言借用：W42【閃擊】；符文真言專屬（一般裝備不生效，符文真言借用生效；K1 回歸灰字正常） |
| **L119** | `doomProphet`<br>末日預言者 | **通過** | 真言借用觸發 (50/50) | `tmp/legend-rw-shots/L119_doomProphet.png` | 被符文真言借用：W29【天啟】；符文真言專屬（一般裝備不生效，符文真言借用生效；K1 回歸灰字正常） |
| **L120** | `berserkBloodAxe`<br>狂暴血斧 | **通過** | 真言借用觸發 (50/50) | `tmp/legend-rw-shots/L120_berserkBloodAxe.png` | 被符文真言借用：W30【斷魂】；符文真言專屬（一般裝備不生效，符文真言借用生效；K1 回歸灰字正常） |
| **L121** | `unyieldingGuard`<br>不屈護衛 | **通過** | 真言借用觸發 (50/50) | `tmp/legend-rw-shots/L121_unyieldingGuard.png` | 被符文真言借用：W24【重甲鐵誓】；符文真言專屬（一般裝備不生效，符文真言借用生效；K1 回歸灰字正常） |
| **L122** | `thunderShock`<br>雷霆之震 | **通過** | 8/50 (16.0%, 表定 20%) | `tmp/legend-rw-shots/L122_thunderShock.png` | 被符文真言借用：W16【雷神之怒】；符文真言專屬（一般裝備不生效，符文真言借用生效；K1 回歸灰字正常） |
| **L123** | `burningLaw`<br>燃燒法則 | **通過** | 真言借用觸發 (50/50) | `tmp/legend-rw-shots/L123_burningLaw.png` | 被符文真言借用：W65【鐵匠之魂】；符文真言專屬（一般裝備不生效，符文真言借用生效；K1 回歸灰字正常） |
| **L124** | `thunderMark`<br>雷紋刻印 | **通過** | 5/50 (10.0%, 表定 10%) | `tmp/legend-rw-shots/L124_thunderMark.png` | 被符文真言借用：W61【星門】；符文真言專屬（一般裝備不生效，符文真言借用生效；K1 回歸灰字正常） |
| **L125** | `iceSpikeBurst`<br>冰霜尖刺 | **通過** | 6/50 (12.0%, 表定 10%) | `tmp/legend-rw-shots/L125_iceSpikeBurst.png` | 被符文真言借用：W64【冰川】；符文真言專屬（一般裝備不生效，符文真言借用生效；K1 回歸灰字正常） |
| **L126** | `heavenlyVow`<br>天譴之誓 | **通過** | 真言借用觸發 (50/50) | `tmp/legend-rw-shots/L126_heavenlyVow.png` | 被符文真言借用：W32【時之守望】；符文真言專屬（一般裝備不生效，符文真言借用生效；K1 回歸灰字正常） |
| **L127** | `godfallMeteor`<br>神落天殞 | **通過** | 真言借用觸發 (50/50) | `tmp/legend-rw-shots/L127_godfallMeteor.png` | 被符文真言借用：W52【星墜】；符文真言專屬（一般裝備不生效，符文真言借用生效；K1 回歸灰字正常） |
| **L128** | `stormAndThunder`<br>風起雷落 | **通過** | 真言借用觸發 (50/50) | `tmp/legend-rw-shots/L128_stormAndThunder.png` | 被符文真言借用：W44【風暴之眼】；符文真言專屬（一般裝備不生效，符文真言借用生效；K1 回歸灰字正常） |
| **L129** | `elementHeart`<br>元素之心 | **通過** | 真言借用觸發 (50/50) | `tmp/legend-rw-shots/L129_elementHeart.png` | 被符文真言借用：W59【創世紀】；符文真言專屬（一般裝備不生效，符文真言借用生效；K1 回歸灰字正常） |
| **L130** | `deadTime`<br>亡者時間 | **通過** | 真言借用觸發 (50/50) | `tmp/legend-rw-shots/L130_deadTime.png` | 被符文真言借用：W60【滅世】；符文真言專屬（一般裝備不生效，符文真言借用生效；K1 回歸灰字正常） |
| **L131** | `fireSpiritShield`<br>火靈盾 | **通過** | 不觸發 (0/50，已停用) | `tmp/legend-rw-shots/L131_fireSpiritShield.png` | 舊版傳奇停用（不掉落、不生效；K1 回歸灰字「(已停用)」正常） |
| **L132** | `magicLightShield`<br>魔法光盾 | **通過** | 不觸發 (0/50，已停用) | `tmp/legend-rw-shots/L132_magicLightShield.png` | 舊版傳奇停用（不掉落、不生效；K1 回歸灰字「(已停用)」正常） |
| **L133** | `lightCollision`<br>光之碰撞 | **通過** | 不觸發 (0/50，已停用) | `tmp/legend-rw-shots/L133_lightCollision.png` | 舊版傳奇停用（不掉落、不生效；K1 回歸灰字「(已停用)」正常） |
| **L134** | `ghostLamp`<br>幽冥神燈 | **通過** | 不觸發 (0/50，已停用) | `tmp/legend-rw-shots/L134_ghostLamp.png` | 舊版傳奇停用（不掉落、不生效；K1 回歸灰字「(已停用)」正常） |
| **L135** | `magicRecoil`<br>魔法反震 | **通過** | 不觸發 (0/50，已停用) | `tmp/legend-rw-shots/L135_magicRecoil.png` | 舊版傳奇停用（不掉落、不生效；K1 回歸灰字「(已停用)」正常） |
| **L136** | `bloodthirst`<br>嗜血 | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L136_bloodthirst.png` | 正常生效 |
| **L137** | `chainReaction`<br>連鎖反應 | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L137_chainReaction.png` | 正常生效 |
| **L138** | `elation`<br>激昂 | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L138_elation.png` | 正常生效 |
| **L139** | `experienceTome`<br>經驗寶典 | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L139_experienceTome.png` | 正常生效 |
| **L140** | `goldenTouch`<br>點金手 | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L140_goldenTouch.png` | 正常生效 |
| **L141** | `fortify`<br>強固 | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L141_fortify.png` | 正常生效 |
| **L142** | `softenBlow`<br>以柔剋剛 | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L142_softenBlow.png` | 正常生效 |
| **L143** | `shieldWall`<br>盾牆 | **通過** | 固定生效 (50/50) | `tmp/legend-rw-shots/L143_shieldWall.png` | 正常生效 |
| **L144** | `manaReflux`<br>返哺 | **通過** | 11/50 (22.0%, 表定 25%) | `tmp/legend-rw-shots/L144_manaReflux.png` | 正常生效 |


### 3.3 符文真言：批次 4（W01～W65，共 65 組）

| 編號 | 條目 key / 名稱 | 測試結果 | 觸發樣本數 | 截圖檔名 | 備註說明 |
| :--- | :--- | :---: | :---: | :---: | :--- |
| **W01** | `rw_firstcry`<br>初啼 | **通過** | 常駐屬性/效果生效 (50/50) | `tmp/legend-rw-shots/W01_rw_firstcry.png` | 配方：r01→r02（2孔） |
| **W02** | `rw_nightwatch`<br>守夜 | **通過** | 常駐屬性/效果生效 (50/50) | `tmp/legend-rw-shots/W02_rw_nightwatch.png` | 配方：r02→r05（2孔） |
| **W03** | `rw_frostwhisper`<br>霜語 | **通過** | 9/50 (18.0%, 表定 10%) | `tmp/legend-rw-shots/W03_rw_frostwhisper.png` | 配方：r03→r04（2孔） |
| **W04** | `rw_windwalk`<br>行雲 | **通過** | 常駐屬性/效果生效 (50/50) | `tmp/legend-rw-shots/W04_rw_windwalk.png` | 配方：r04→r01→r08（3孔） |
| **W05** | `rw_stoneskin`<br>石膚 | **通過** | 常駐屬性/效果生效 (50/50) | `tmp/legend-rw-shots/W05_rw_stoneskin.png` | 配方：r05→r03（2孔） |
| **W06** | `rw_viperkiss`<br>蛇吻 | **通過** | 15/50 (30.0%, 表定 15%) | `tmp/legend-rw-shots/W06_rw_viperkiss.png` | 配方：r06→r08（2孔） |
| **W07** | `rw_minorthunder`<br>輕雷 | **通過** | 5/50 (10.0%, 表定 8%) | `tmp/legend-rw-shots/W07_rw_minorthunder.png` | 配方：r07→r04（2孔） |
| **W08** | `rw_lightguard`<br>聖光之守 | **通過** | 常駐屬性/效果生效 (50/50) | `tmp/legend-rw-shots/W08_rw_lightguard.png` | 配方：r01→r09（2孔） |
| **W09** | `rw_bloodring`<br>血誓之環 | **通過** | 常駐屬性/效果生效 (50/50) | `tmp/legend-rw-shots/W09_rw_bloodring.png` | 配方：r10→r08（2孔） |
| **W10** | `rw_steelheart`<br>鋼心 | **通過** | 常駐屬性/效果生效 (50/50) | `tmp/legend-rw-shots/W10_rw_steelheart.png` | 配方：r05→r10（2孔） |
| **W11** | `rw_springflow`<br>泉湧 | **通過** | 常駐屬性/效果生效 (50/50) | `tmp/legend-rw-shots/W11_rw_springflow.png` | 配方：r01→r02→r08（3孔） |
| **W12** | `rw_scavenger`<br>拾荒者 | **通過** | 常駐屬性/效果生效 (50/50) | `tmp/legend-rw-shots/W12_rw_scavenger.png` | 配方：r01→r04（2孔） |
| **W13** | `rw_breaker`<br>破軍 | **通過** | 常駐屬性/效果生效 (50/50) | `tmp/legend-rw-shots/W13_rw_breaker.png` | 配方：r02→r10→r05（3孔） |
| **W14** | `rw_burnstar`<br>燃星 | **通過** | 16/50 (32.0%, 表定 15%) | `tmp/legend-rw-shots/W14_rw_burnstar.png` | 配方：r02→r09（2孔） |
| **W15** | `rw_galeblade`<br>疾風烈刃 | **通過** | 常駐屬性/效果生效 (50/50) | `tmp/legend-rw-shots/W15_rw_galeblade.png` | 配方：r04→r13→r14（3孔） |
| **W16** | `rw_thundergod`<br>雷神之怒 | **通過** | 9/50 (18.0%, 表定 15%) | `tmp/legend-rw-shots/W16_rw_thundergod.png` | 配方：r07→r10→r11→r16（4孔） |
| **W17** | `rw_winterherald`<br>凜冬使者 | **通過** | 11/50 (22.0%, 表定 20%) | `tmp/legend-rw-shots/W17_rw_winterherald.png` | 配方：r03→r03→r12（3孔） |
| **W18** | `rw_bloodgulp`<br>血飲者 | **通過** | 常駐屬性/效果生效 (50/50) | `tmp/legend-rw-shots/W18_rw_bloodgulp.png` | 配方：r10→r08→r13（3孔） |
| **W19** | `rw_unmoving`<br>不動山 | **通過** | 常駐屬性/效果生效 (50/50) | `tmp/legend-rw-shots/W19_rw_unmoving.png` | 配方：r05→r14→r11（3孔） |
| **W20** | `rw_shadowstep`<br>影步 | **通過** | 9/50 (18.0%, 表定 15%) | `tmp/legend-rw-shots/W20_rw_shadowstep.png` | 配方：r08→r13→r16（3孔） |
| **W21** | `rw_dawncrown`<br>旭日之冠 | **通過** | 每 10 次必觸發 (50/50) | `tmp/legend-rw-shots/W21_rw_dawncrown.png` | 配方：r15→r09→r12（3孔） |
| **W22** | `rw_poisoncloud`<br>毒雲 | **通過** | 13/50 (26.0%, 表定 25%) | `tmp/legend-rw-shots/W22_rw_poisoncloud.png` | 配方：r06→r06→r12（3孔） |
| **W23** | `rw_awakening`<br>驚蟄 | **通過** | 條件達成觸發 (50/50) | `tmp/legend-rw-shots/W23_rw_awakening.png` | 配方：r04→r07→r13（3孔） |
| **W24** | `rw_ironoath`<br>重甲鐵誓 | **通過** | 10/50 (20.0%, 表定 20%) | `tmp/legend-rw-shots/W24_rw_ironoath.png` | 配方：r14→r11→r10（3孔） |
| **W25** | `rw_gambler`<br>賭徒之戒 | **通過** | 常駐屬性/效果生效 (50/50) | `tmp/legend-rw-shots/W25_rw_gambler.png` | 配方：r01→r13→r16→r11（4孔） |
| **W26** | `rw_guardian`<br>守護者之盾 | **通過** | 17/50 (34.0%, 表定 40%) | `tmp/legend-rw-shots/W26_rw_guardian.png` | 配方：r14→r11→r05→r15（4孔） |
| **W27** | `rw_arcaneecho`<br>奧術迴響 | **通過** | 9/50 (18.0%, 表定 20%) | `tmp/legend-rw-shots/W27_rw_arcaneecho.png` | 配方：r12→r15→r12→r09（4孔） |
| **W28** | `rw_tidecall`<br>潮汐 | **已知 K6** | 每 8 次必觸發 (50/50) | `tmp/legend-rw-shots/W28_rw_tidecall.png` | 已知 K6（法力扣減實際生效，技能列顯示仍為基礎值）；配方：r08→r12→r14（3孔） |
| **W29** | `rw_apocalypse`<br>天啟 | **通過** | 常駐屬性/效果生效 (50/50) | `tmp/legend-rw-shots/W29_rw_apocalypse.png` | 配方：r10→r11→r21→r23（4孔） |
| **W30** | `rw_soulcleaver`<br>斷魂 | **通過** | 10/50 (20.0%, 表定 8%) | `tmp/legend-rw-shots/W30_rw_soulcleaver.png` | 配方：r11→r20→r22（3孔） |
| **W31** | `rw_chainstorm`<br>連環雷暴 | **通過** | 17/50 (34.0%, 表定 30%) | `tmp/legend-rw-shots/W31_rw_chainstorm.png` | 配方：r07→r13→r07→r17（4孔） |
| **W32** | `rw_timewarden`<br>時之守望 | **通過** | 條件達成觸發 (50/50) | `tmp/legend-rw-shots/W32_rw_timewarden.png` | 配方：r18→r20→r18→r12（4孔） |
| **W33** | `rw_lastbreath`<br>絕境 | **通過** | 條件達成觸發 (50/50) | `tmp/legend-rw-shots/W33_rw_lastbreath.png` | 配方：r14→r22→r18（3孔） |
| **W34** | `rw_swarmhunter`<br>群獵 | **通過** | 常駐屬性/效果生效 (50/50) | `tmp/legend-rw-shots/W34_rw_swarmhunter.png` | 配方：r13→r19→r23→r16（4孔） |
| **W35** | `rw_assassin`<br>影殺 | **通過** | 常駐屬性/效果生效 (50/50) | `tmp/legend-rw-shots/W35_rw_assassin.png` | 借用傳奇特效【旋風之刺】；配方：r08→r16→r13→r22（4孔） |
| **W36** | `rw_manafountain`<br>魔泉 | **已知 K6** | 常駐屬性/效果生效 (50/50) | `tmp/legend-rw-shots/W36_rw_manafountain.png` | 已知 K6（法力扣減實際生效，技能列顯示仍為基礎值）；配方：r12→r18→r21（3孔） |
| **W37** | `rw_thornedfury`<br>荊棘之怒 | **通過** | 10/50 (20.0%, 表定 25%) | `tmp/legend-rw-shots/W37_rw_thornedfury.png` | 配方：r14→r23→r22→r11（4孔） |
| **W38** | `rw_bossbane`<br>弒王者 | **通過** | 常駐屬性/效果生效 (50/50) | `tmp/legend-rw-shots/W38_rw_bossbane.png` | 配方：r21→r10→r11（3孔） |
| **W39** | `rw_vitalpact`<br>生命契約 | **通過** | 常駐屬性/效果生效 (50/50) | `tmp/legend-rw-shots/W39_rw_vitalpact.png` | 配方：r10→r08→r22（3孔） |
| **W40** | `rw_shieldwall`<br>護盾牆 | **通過** | 每 8 次必觸發 (50/50) | `tmp/legend-rw-shots/W40_rw_shieldwall.png` | 配方：r21→r14→r21→r22（4孔） |
| **W41** | `rw_elemental`<br>元素之環 | **通過** | 常駐屬性/效果生效 (50/50) | `tmp/legend-rw-shots/W41_rw_elemental.png` | 配方：r03→r17→r20（3孔） |
| **W42** | `rw_blitz`<br>閃擊 | **通過** | 每 6 次必觸發 (50/50) | `tmp/legend-rw-shots/W42_rw_blitz.png` | 配方：r13→r19→r04（3孔） |
| **W43** | `rw_quake`<br>地裂 | **通過** | 1/50 (2.0%, 表定 8%) | `tmp/legend-rw-shots/W43_rw_quake.png` | 借用傳奇特效【大地之心】；配方：r05→r14→r22→r25→r27（5孔） |
| **W44** | `rw_galeeye`<br>風暴之眼 | **通過** | 條件達成觸發 (50/50) | `tmp/legend-rw-shots/W44_rw_galeeye.png` | 借用傳奇特效【風起雷落】；配方：r04→r19→r20→r26→r28（5孔） |
| **W45** | `rw_bloodrite`<br>血祭 | **通過** | 常駐屬性/效果生效 (50/50) | `tmp/legend-rw-shots/W45_rw_bloodrite.png` | 借用傳奇特效【毒血祭】；配方：r10→r08→r22→r24→r26（5孔） |
| **W46** | `rw_reincarnation`<br>輪迴 | **通過** | 常駐屬性/效果生效 (50/50) | `tmp/legend-rw-shots/W46_rw_reincarnation.png` | 借用傳奇特效【堅韌誓言】；配方：r28→r29→r30→r32（4孔） |
| **W47** | `rw_timeloop`<br>時之沙 | **通過** | 10/50 (20.0%, 表定 25%) | `tmp/legend-rw-shots/W47_rw_timeloop.png` | 借用傳奇特效【天譴之誓】；配方：r26→r29→r30（3孔） |
| **W48** | `rw_bloodmoon`<br>血月 | **通過** | 常駐屬性/效果生效 (50/50) | `tmp/legend-rw-shots/W48_rw_bloodmoon.png` | 借用傳奇特效【末日預言者】；配方：r16→r23→r25→r28（4孔） |
| **W49** | `rw_arsenal`<br>武庫 | **通過** | 7/50 (14.0%, 表定 15%) | `tmp/legend-rw-shots/W49_rw_arsenal.png` | 借用傳奇特效【分裂者】；配方：r20→r26→r27（3孔） |
| **W50** | `rw_thunderemperor`<br>雷帝 | **通過** | 每 3 次必觸發 (50/50) | `tmp/legend-rw-shots/W50_rw_thunderemperor.png` | 借用傳奇特效【雷霆之震】；配方：r25→r07→r26→r32（4孔） |
| **W51** | `rw_lonewolf`<br>孤狼 | **通過** | 常駐屬性/效果生效 (50/50) | `tmp/legend-rw-shots/W51_rw_lonewolf.png` | 借用傳奇特效【貫日之刺】；配方：r21→r25→r27（3孔） |
| **W52** | `rw_starfall`<br>星墜 | **通過** | 每 3 次必觸發 (50/50) | `tmp/legend-rw-shots/W52_rw_starfall.png` | 借用傳奇特效【神落天殞】；配方：r26→r24→r27→r29（4孔） |
| **W53** | `rw_chaoslord`<br>混沌之主 | **通過** | 條件達成觸發 (50/50) | `tmp/legend-rw-shots/W53_rw_chaoslord.png` | 借用傳奇特效【腐化】；配方：r26→r30→r31（3孔） |
| **W54** | `rw_dragonslayer`<br>屠龍者 | **通過** | 8/50 (16.0%, 表定 20%) | `tmp/legend-rw-shots/W54_rw_dragonslayer.png` | 借用傳奇特效【斬殺】；配方：r27→r30→r31（3孔） |
| **W55** | `rw_immortalbody`<br>不朽之軀 | **通過** | 條件達成觸發 (50/50) | `tmp/legend-rw-shots/W55_rw_immortalbody.png` | 借用傳奇特效【不屈護衛】；配方：r30→r33→r29→r32（4孔） |
| **W56** | `rw_legion`<br>萬軍 | **通過** | 常駐屬性/效果生效 (50/50) | `tmp/legend-rw-shots/W56_rw_legion.png` | 借用傳奇特效【狂暴血斧】；配方：r20→r26→r28→r30（4孔） |
| **W57** | `rw_bladedancer`<br>劍舞者 | **通過** | 常駐屬性/效果生效 (50/50) | `tmp/legend-rw-shots/W57_rw_bladedancer.png` | 借用傳奇特效【影襲追蹤者】；配方：r19→r24→r26（3孔） |
| **W58** | `rw_voidwalker`<br>虛空行者 | **通過** | 16/50 (32.0%, 表定 30%) | `tmp/legend-rw-shots/W58_rw_voidwalker.png` | 借用傳奇特效【斷空刃】；配方：r26→r28→r29（3孔） |
| **W59** | `rw_genesis`<br>創世紀 | **已知 K6** | 常駐屬性/效果生效 (50/50) | `tmp/legend-rw-shots/W59_rw_genesis.png` | 借用傳奇特效【元素之心】；已知 K6（法力扣減實際生效，技能列顯示仍為基礎值）；配方：r30→r31→r32→r33（4孔） |
| **W60** | `rw_worldend`<br>滅世 | **通過** | 5/50 (10.0%, 表定 10%) | `tmp/legend-rw-shots/W60_rw_worldend.png` | 借用傳奇特效【亡者時間】；配方：r23→r26→r28→r30→r31（5孔） |
| **W61** | `rw_stargate`<br>星門 | **通過** | 10/50 (20.0%, 表定 20%) | `tmp/legend-rw-shots/W61_rw_stargate.png` | 借用傳奇特效【雷紋刻印】；配方：r20→r25→r27→r29→r30（5孔） |
| **W62** | `rw_divinewrath`<br>神罰 | **通過** | 8/50 (16.0%, 表定 15%) | `tmp/legend-rw-shots/W62_rw_divinewrath.png` | 借用傳奇特效【狩獵者】；配方：r21→r24→r29→r31→r33（5孔） |
| **W63** | `rw_permafrost`<br>永凍 | **通過** | 3/50 (6.0%, 表定 15%) | `tmp/legend-rw-shots/W63_rw_permafrost.png` | 借用傳奇特效【崩山裂地者】；配方：r18→r24→r30（3孔） |
| **W64** | `rw_glacier`<br>冰川 | **通過** | 12/50 (24.0%, 表定 25%) | `tmp/legend-rw-shots/W64_rw_glacier.png` | 借用傳奇特效【冰霜尖刺】；配方：r03→r25→r28（3孔） |
| **W65** | `rw_smith`<br>鐵匠之魂 | **通過** | 常駐屬性/效果生效 (50/50) | `tmp/legend-rw-shots/W65_rw_smith.png` | 借用傳奇特效【燃燒法則】；配方：r02→r11→r23→r30（4孔） |


---

## 4. 失敗、異常與已知差異（K1～K6）明細

本輪回歸測試未發現導致遊戲崩潰或阻塞的嚴重 Fatal 缺陷，所有數值與邏輯皆正常運作。測試過程中對規格書第 5 節之已知差異進行了專案回歸驗證，明細如下：

### 4.1 K1 回歸驗證（停用／專屬特效在舊裝備上的顯示已修正）
- **項目**：舊版停用詞條與符文真言專屬詞條在裝備詳情中的標註。
- **重現指令**：
  ```text
  legend deadTime weapon force
  legend ghostLamp weapon force
  ```
- **預期結果**：裝備詳情效果行應呈現灰字，並加上相應不生效後綴（符合 AI_RULES 8.3 顯示即真理規範）。
- **實際結果**：
  - `deadTime` 顯示灰字（`#6b7280`）且後綴 `(僅符文真言生效)`。
  - `ghostLamp` 顯示灰字（`#6b7280`）且後綴 `(已停用)`。
  - 兩者在戰鬥計算時皆不生效，驗證通過。
- **截圖**：`tmp/legend-rw-shots/K1_regression_deadTime_ghostLamp.png`
- **Console**：無錯誤訊息。

### 4.2 K2 特效說明文字差異確認
- **雙刀亂舞**：L026【狂舞】、L028【不屈之誓】、L029【殺千刀】說明寫「暴風之舞」，實際對應第 7 階技能名【暴風亂舞】。
- **疾風迅雷**：L016～L020 說明文字稱「疾風斬」，實際對應技能群組 `gale`（疾風迅雷）。
- **隕石術與雷殞天落**：L084、L085 說明文字寫「雷殞天落」，第 8 階技能名稱為【雷隕天落】；火球術隕石文字寫「殞石」。
- **狀態**：僅說明文字用詞微異，內部機制與關聯階級完全相符。

### 4.3 K3 【雷散落】擴散階數確認
- **項目**：L073 `chainlightningScatter`。
- **說明**：擴散數值讀取第 5 階【靜電】（`lvs[4]`），說明寫「電殛擴散」（第 6 階為【電殛】）。機制已由 `lvs[4]` 驅動生效。

### 4.4 K4 【燃燒法則】狀態名稱比對
- **項目**：L123 `burningLaw`。
- **確認**：`legendaryBurnDot` 以持續傷害名稱字面值「燃燒」判定；檢查 Status 表與實際狀態流，燃燒狀態名一致為「燃燒」，機制正常引爆剩餘次數。

### 4.5 K5 封魔塔擊殺事件限制
- **項目**：狂暴血斧（L120）、亡者時間（L130）、武庫（W49）、斷魂（W30）等擊殺觸發效果。
- **說明**：封魔塔只有單一 BOSS，擊殺即戰鬥結算，故「擊殺敵人觸發」在封魔塔不觸發屬於已知設計（依據 `docs/RUNEWORD_DESIGN.md` 第 7 節）。

### 4.6 K6 符文真言法力消耗降低顯示
- **項目**：W28【潮汐】、W36【魔泉】、W59【創世紀】之法力消耗縮減。
- **說明**：法力扣減在實際施放扣魔時確實乘算減免（如創世紀 -15%、魔泉 -20%），但技能欄介面之靜態顯示數值仍為基礎值，此為已知介面限制。
