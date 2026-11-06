# 傳奇特效與符文真言回歸測試報告

> 測試規格依據：`docs/ANTIGRAVITY_LEGENDARY_RUNEWORD_TEST_CASES.md`
> 測試模式：唯讀驗證（僅記錄問題，不改動遊戲主程式碼）

---

## 進度說明
- **當前進度**：已完成 **批次 1**（第 0 節三種核對＋第 1 節環境＋共通檢查 C1～C10）與 **批次 2**（**L001～L070**）。
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

*(待批次 3 填入 L071～L144，待批次 4 填入 W01～W65)*

---

## 4. 失敗與異常明細
*（批次 2 測試中未發現新增 Fatal 程式缺陷，已知差異 K2 已標註於對應條目）*
