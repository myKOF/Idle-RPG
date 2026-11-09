# Damage Reduction Calculation Report V3 (2026-11-09 11:55:00)

> **報告版本**：V3（最新數值平衡與公式全面重算對照總表）  
> **基準對照組**：第二版報告 [`docs/DAMAGE_REDUCTION_CALCULATION_REPORT_V2.md`](file:///d:/MyGame/Idle-RPG/antigravity/docs/DAMAGE_REDUCTION_CALCULATION_REPORT_V2.md) 與第一版報告 [`docs/DAMAGE_REDUCTION_CALCULATION_REPORT.md`](file:///d:/MyGame/Idle-RPG/antigravity/docs/DAMAGE_REDUCTION_CALCULATION_REPORT.md)  
> **計算基準設定**：
> - **裝備等級**：**Lv.600**（全套 13 部位，詞條全太古滿 roll，品質係數覆蓋 R0～R11）。
> - **受測對象等級**：**Lv.650**（對標第 600 關「永恒神域」地圖怪標準等級，含魔物威能加成）。
> - **角色狀態**：Lv.1000 滿級角色，轉生覆蓋 1轉至 10轉。
> - **視覺標示規範**：
>   - 數值與減傷率**上升**以 **<span style="color:blue">藍色（▲ +數值）</span>** 標示。
>   - 數值與減傷率**下降**以 **<span style="color:red">紅色（▼ -數值）</span>** 標示。
>   - 數值維持不變以 **<span style="color:gray">持平</span>** 標示。
>   - 各類減傷率精確列出至小數點後 6 位，並在每格標註對應之**底層屬性數值**。
>   - 本 V3 版本完整補齊**四維主屬性（以力量 Str 為代表基準）**於全情境、全階級、全轉生分佈。

---

## 本次公式更新與平衡參數重大異動對照

本次平衡更新對減傷體系、寶石數值與威能天賦進行了以下核心調整與重構對照：

| 調整項目 | 舊版 (V1) 公式與參數 | 現行最新版 (V2/V3) 公式與參數 | 變動方向與機制影響 |
| :--- | :--- | :--- | :--- |
| **防禦減傷率公式** | $r_{\text{Def}} = \frac{\text{Def}}{\text{Def} + 10000 + 100 \times \text{Lv}}$<br>(固定以受測怪 Lv.650 計算，分母常數為 75,000) | $r_{\text{Def}} = \frac{\text{Def}}{\text{Def} + \max(c, a + b \times (\text{AtkLv} - \text{DefLv}))}$<br>($a=10000, b=100, c=1000$)<br>怪物攻擊玩家時等級差為 $650 - 1000 = -350$ | **<span style="color:blue">巨幅上升 ▲</span>**<br>等級差為負（玩家等級碾壓怪物），分母常數觸及下限 $c = 1,000$，相較舊版 75,000 縮小 75 倍，防禦穿透殘留率大幅暴降 75 倍。 |
| **全局減傷率公式** | $r_{\text{Global}} = \min(100\%, \frac{\text{Val}}{\text{Val} + 2500})$ | $r_{\text{Global}} = \min(99.99\%, \frac{\text{Val}}{\text{Val} + 5000})$ | **<span style="color:red">明顯下降 ▼</span>**<br>分母常數由 2,500 翻倍至 5,000，且設定 99.99% 上限，全局減傷率普降 0.5%~1.1%。 |
| **BOSS傷害減傷** | $r_{\text{Boss}} = 1 - \frac{0.95}{1 + (\text{Val} / 4000)^{1.4}}$ | $r_{\text{Boss}} = 1 - \frac{0.99}{1 + (\text{Val} / 10000)^{1.35}}$ | **<span style="color:red">微幅下降 ▼</span>**<br>分母基數 $B$ 由 4,000 提升至 10,000，抗性次方與係數微調，減傷率微降 0.16%~0.55%。 |
| **黃玉 (Topaz) 生命寶石** | 10級黃玉提供 `+10,880 HP` | 10級黃玉提供 `+12,000 HP` | **<span style="color:blue">數值上升 ▲</span>**<br>單顆提升 +1,120 HP，10 顆累計提升 +11,200 基礎 HP，經太古與轉生倍率放大後顯著提升。 |
| **堇青石 (Iolite) 法力寶石** | 10級堇青石提供 `+7,200 MP` | 10級堇青石提供 `+4,800 MP` | **<span style="color:red">數值下降 ▼</span>**<br>單顆下調 -2,400 MP，10 顆累計減少 -24,000 基礎 MP，法力值有所收縮。 |
| **4轉威能節點優化** | 5 個無效技能加成節點（無讀取點） | 改為武技穿透 (+1600%)、法術穿透 (+1600%)、不屈意志 (+30%)、點金 (+50%)、智慧 (+50%) | **<span style="color:blue">機制升級 ▲</span>**<br>解決舊節點無效問題，全面提升穿透、抗控與養成收益。 |
| **封魔塔 BOSS 數值體系** | 統一共用單一倍率曲線 | NPC 表 1~50 關獨立逐列配置生命、攻擊、防禦倍率與動作速度 | **<span style="color:blue">體驗優化 ▲</span>**<br>高塔關卡階梯平滑化，BOSS 出手節奏與模型動作完整對齊。 |

---

## 一、情境一：純太古裝備（Lv.600，無寶石、無威能）

### 1.1 生命值 (HP) 極大值分佈與差異
| 裝備階級 | 1轉 | 2轉 | 3轉 | 4轉 | 5轉 | 6轉 | 7轉 | 8轉 | 9轉 | 10轉 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| R0 普通 | 96.29 萬 | 160.48 萬 | 224.68 萬 | 320.97 萬 | 449.36 萬 | 577.74 萬 | 706.13 萬 | 962.91 萬 | 1219.68 萬 | 1604.85 萬 |
| R1 精良 | 1868.00 萬 | 3113.33 萬 | 4358.67 萬 | 6226.67 萬 | 8717.34 萬 | 1.12 億 | 1.37 億 | 1.87 億 | 2.37 億 | 3.11 億 |
| R2 稀有 | 3196.22 萬 | 5327.03 萬 | 7457.84 萬 | 1.07 億 | 1.49 億 | 1.92 億 | 2.34 億 | 3.20 億 | 4.05 億 | 5.33 億 |
| R3 獨特 | 7012.74 萬 | 1.17 億 | 1.64 億 | 2.34 億 | 3.27 億 | 4.21 億 | 5.14 億 | 7.01 億 | 8.88 億 | 11.69 億 |
| R4 史詩 | 1.40 億 | 2.33 億 | 3.26 億 | 4.66 億 | 6.52 億 | 8.39 億 | 10.25 億 | 13.98 億 | 17.71 億 | 23.30 億 |
| R5 傳說 | 2.16 億 | 3.60 億 | 5.04 億 | 7.20 億 | 10.08 億 | 12.96 億 | 15.84 億 | 21.60 億 | 27.36 億 | 36.00 億 |
| R6 神話 | 3.61 億 | 6.02 億 | 8.43 億 | 12.04 億 | 16.86 億 | 21.68 億 | 26.50 億 | 36.13 億 | 45.77 億 | 60.22 億 |
| R7 創世 | 5.44 億 | 9.06 億 | 12.69 億 | 18.13 億 | 25.38 億 | 32.63 億 | 39.88 億 | 54.38 億 | 68.88 億 | 90.63 億 |
| R8 神鑄神話 | 7.63 億 | 12.72 億 | 17.81 億 | 25.45 億 | 35.63 億 | 45.81 億 | 55.99 億 | 76.34 億 | 96.70 億 | 127.24 億 |
| R9 神鑄創世 | 12.12 億 | 20.20 億 | 28.28 億 | 40.41 億 | 56.57 億 | 72.73 億 | 88.89 億 | 121.22 億 | 153.54 億 | 202.03 億 |
| R10 混沌 | 21.45 億 | 35.75 億 | 50.05 億 | 71.50 億 | 100.10 億 | 128.69 億 | 157.29 億 | 214.49 億 | 271.69 億 | 357.48 億 |
| R11 神鑄混沌 | 44.13 億 | 73.55 億 | 102.97 億 | 147.11 億 | 205.95 億 | 264.79 億 | 323.64 億 | 441.32 億 | 559.01 億 | 735.53 億 |

### 1.2 法力值 (MP) 極大值分佈與差異
| 裝備階級 | 1轉 | 2轉 | 3轉 | 4轉 | 5轉 | 6轉 | 7轉 | 8轉 | 9轉 | 10轉 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| R0 普通 | 16.36 萬 | 27.27 萬 | 38.18 萬 | 54.54 萬 | 76.36 萬 | 98.18 萬 | 119.99 萬 | 163.63 萬 | 207.26 萬 | 272.71 萬 |
| R1 精良 | 28.45 萬 | 47.41 萬 | 66.37 萬 | 94.82 萬 | 132.75 萬 | 170.67 萬 | 208.60 萬 | 284.46 萬 | 360.31 萬 | 474.10 萬 |
| R2 稀有 | 37.72 萬 | 62.87 萬 | 88.02 萬 | 125.75 萬 | 176.05 萬 | 226.35 萬 | 276.65 萬 | 377.24 萬 | 477.84 萬 | 628.74 萬 |
| R3 獨特 | 52.56 萬 | 87.61 萬 | 122.65 萬 | 175.22 萬 | 245.30 萬 | 315.39 萬 | 385.47 萬 | 525.64 萬 | 665.82 萬 | 876.08 萬 |
| R4 史詩 | 74.83 萬 | 124.71 萬 | 174.60 萬 | 249.43 萬 | 349.20 萬 | 448.97 萬 | 548.74 萬 | 748.28 萬 | 947.82 萬 | 1247.13 萬 |
| R5 傳說 | 93.38 萬 | 155.64 萬 | 217.90 萬 | 311.28 萬 | 435.79 萬 | 560.30 萬 | 684.82 萬 | 933.84 萬 | 1182.86 萬 | 1556.40 萬 |
| R6 神話 | 121.21 萬 | 202.02 萬 | 282.83 萬 | 404.05 萬 | 565.66 萬 | 727.28 萬 | 888.90 萬 | 1212.14 萬 | 1535.37 萬 | 2020.23 萬 |
| R7 創世 | 149.04 萬 | 248.41 萬 | 347.77 萬 | 496.81 萬 | 695.54 萬 | 894.26 萬 | 1092.99 萬 | 1490.44 萬 | 1887.89 萬 | 2484.06 萬 |
| R8 神鑄神話 | 176.87 萬 | 294.79 萬 | 412.70 萬 | 589.58 萬 | 825.41 萬 | 1061.24 萬 | 1297.07 萬 | 1768.73 萬 | 2240.40 萬 | 2947.89 萬 |
| R9 神鑄創世 | 223.26 萬 | 372.09 萬 | 520.93 萬 | 744.18 萬 | 1041.86 萬 | 1339.53 萬 | 1637.21 萬 | 2232.55 萬 | 2827.90 萬 | 3720.93 萬 |
| R10 混沌 | 297.47 萬 | 495.78 萬 | 694.09 萬 | 991.56 萬 | 1388.18 萬 | 1784.80 萬 | 2181.43 萬 | 2974.67 萬 | 3767.92 萬 | 4957.79 萬 |
| R11 神鑄混沌 | 427.34 萬 | 712.23 萬 | 997.12 萬 | 1424.46 萬 | 1994.25 萬 | 2564.03 萬 | 3133.82 萬 | 4273.39 萬 | 5412.96 萬 | 7122.31 萬 |

### 1.3 四維主屬性（力量 Str）極大值分佈與差異
> **說明**：四維屬性（力量、敏捷、智力、體質）基礎點數（Lv.1000 均為 2,003 點）、單件詞條成長、全套 13 部位與轉生倍率完全相同，故以力量為代表基準，其餘三種屬性數值與本表完全一致。純太古裝備下四維詞條未受本次公式更動影響，維持<span style="color:gray">持平</span>。

| 裝備階級 | 1轉 | 2轉 | 3轉 | 4轉 | 5轉 | 6轉 | 7轉 | 8轉 | 9轉 | 10轉 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| R0 普通 | 2.58 萬 | 4.30 萬 | 6.02 萬 | 8.60 萬 | 12.04 萬 | 15.48 萬 | 18.92 萬 | 25.81 萬 | 32.69 萬 | 43.01 萬 |
| R1 精良 | 3.72 萬 | 6.20 萬 | 8.68 萬 | 12.40 萬 | 17.36 萬 | 22.32 萬 | 27.29 萬 | 37.21 萬 | 47.13 萬 | 62.01 萬 |
| R2 稀有 | 4.86 萬 | 8.10 萬 | 11.34 萬 | 16.20 萬 | 22.68 萬 | 29.16 萬 | 35.65 萬 | 48.61 萬 | 61.57 萬 | 81.01 萬 |
| R3 獨特 | 6.68 萬 | 11.14 萬 | 15.60 萬 | 22.28 萬 | 31.20 萬 | 40.11 萬 | 49.02 萬 | 66.85 萬 | 84.68 萬 | 111.42 萬 |
| R4 史詩 | 9.42 萬 | 15.70 萬 | 21.98 萬 | 31.40 萬 | 43.96 萬 | 56.53 萬 | 69.09 萬 | 94.21 萬 | 119.33 萬 | 157.02 萬 |
| R5 傳說 | 11.70 萬 | 19.50 萬 | 27.30 萬 | 39.00 萬 | 54.61 萬 | 70.21 萬 | 85.81 萬 | 117.01 萬 | 148.22 萬 | 195.02 萬 |
| R6 神話 | 15.12 萬 | 25.20 萬 | 35.28 萬 | 50.41 萬 | 70.57 萬 | 90.73 萬 | 110.89 萬 | 151.22 萬 | 191.54 萬 | 252.03 萬 |
| R7 創世 | 18.54 萬 | 30.90 萬 | 43.26 萬 | 61.81 萬 | 86.53 萬 | 111.25 萬 | 135.97 萬 | 185.42 萬 | 234.86 萬 | 309.03 萬 |
| R8 神鑄神話 | 21.96 萬 | 36.60 萬 | 51.24 萬 | 73.21 萬 | 102.49 萬 | 131.77 萬 | 161.06 萬 | 219.62 萬 | 278.19 萬 | 366.04 萬 |
| R9 神鑄創世 | 27.66 萬 | 46.10 萬 | 64.55 萬 | 92.21 萬 | 129.09 萬 | 165.97 萬 | 202.86 萬 | 276.62 萬 | 350.39 萬 | 461.04 萬 |
| R10 混沌 | 36.78 萬 | 61.31 萬 | 85.83 萬 | 122.61 萬 | 171.65 萬 | 220.70 萬 | 269.74 萬 | 367.83 萬 | 465.92 萬 | 613.05 萬 |
| R11 神鑄混沌 | 52.74 萬 | 87.91 萬 | 123.07 萬 | 175.81 萬 | 246.14 萬 | 316.47 萬 | 386.79 萬 | 527.44 萬 | 668.09 萬 | 879.07 萬 |

### 1.4 物理防禦 (Def) 極大值分佈與差異（1轉至 10轉）
| 裝備階級 | 1轉 | 2轉 | 3轉 | 4轉 | 5轉 | 6轉 | 7轉 | 8轉 | 9轉 | 10轉 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| R0 普通 | 3.38 萬 | 5.49 萬 | 8.83 萬 | 15.07 萬 | 26.68 萬 | 48.11 萬 | 89.20 萬 | 171.38 萬 | 332.21 萬 | 652.09 萬 |
| R1 精良 | 60.99 萬 | 99.37 萬 | 158.20 萬 | 266.91 萬 | 466.39 萬 | 829.48 萬 | 1519.81 萬 | 2900.47 萬 | 5590.07 萬 | 1.09 億 |
| R2 稀有 | 103.77 萬 | 169.00 萬 | 269.76 萬 | 456.42 萬 | 800.04 萬 | 1427.88 萬 | 2624.15 萬 | 5016.69 萬 | 9682.97 萬 | 1.90 億 |
| R3 獨特 | 273.73 萬 | 448.63 萬 | 691.79 萬 | 1124.79 萬 | 1884.13 萬 | 3189.54 萬 | 5587.07 萬 | 1.04 億 | 1.95 億 | 3.77 億 |
| R4 史詩 | 623.03 萬 | 1023.14 萬 | 1560.40 萬 | 2503.46 萬 | 4126.64 萬 | 6847.08 萬 | 1.18 億 | 2.16 億 | 4.02 億 | 7.69 億 |
| R5 傳說 | 962.92 萬 | 1581.21 萬 | 2412.33 萬 | 3871.86 萬 | 6385.45 萬 | 1.06 億 | 1.82 億 | 3.35 億 | 6.23 億 | 11.93 億 |
| R6 神話 | 1610.13 萬 | 2643.86 萬 | 4034.79 萬 | 6478.39 萬 | 1.07 億 | 1.78 億 | 3.05 億 | 5.61 億 | 10.45 億 | 20.00 億 |
| R7 創世 | 2423.26 萬 | 3978.89 萬 | 6073.40 萬 | 9754.05 萬 | 1.61 億 | 2.68 億 | 4.60 億 | 8.46 億 | 15.76 億 | 30.17 億 |
| R8 神鑄神話 | 3401.60 萬 | 5585.13 萬 | 8526.36 萬 | 1.37 億 | 2.26 億 | 3.76 億 | 6.47 億 | 11.89 億 | 22.16 億 | 42.41 億 |
| R9 神鑄創世 | 5400.39 萬 | 8866.73 萬 | 1.35 億 | 2.18 億 | 3.59 億 | 5.97 億 | 10.28 億 | 18.90 億 | 35.23 億 | 67.43 億 |
| R10 混沌 | 9555.35 萬 | 1.57 億 | 2.40 億 | 3.85 億 | 6.36 億 | 10.57 億 | 18.21 億 | 33.48 億 | 62.42 億 | 119.49 億 |
| R11 神鑄混沌 | 1.97 億 | 3.23 億 | 4.93 億 | 7.92 億 | 13.09 億 | 21.77 億 | 37.50 億 | 68.95 億 | 128.57 億 | 246.16 億 |

### 1.5 各類減傷極大值與對應屬性數值對照表（以 10轉 頂峰為基準，對戰 Lv.650 敵人）
| 裝備階級 | 物理防禦減傷 (物防值) | 魔法防禦減傷 (魔防值) | 物理抗性減傷 (物抗值) | 魔法抗性減傷 (魔抗值) | 元素抗性減傷 (全抗值) | 全局減傷 (減傷值) | BOSS減傷 (BOSS減傷值) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| R0 普通 | 99.984667%<br><span style="color:blue">▲ +1.121739%</span><br>(652.09 萬) | 99.984608%<br><span style="color:blue">▲ +1.126013%</span><br>(649.59 萬) | 80.821014%<br><span style="color:gray">持平</span><br>(4,805) | 80.821014%<br><span style="color:gray">持平</span><br>(4,805) | 58.965258%<br><span style="color:gray">持平</span><br>(2,189) | 64.828362%<br><span style="color:red">▼ -13.833297%</span><br>(9,216) | 66.960263%<br><span style="color:red">▼ -21.713003%</span><br>(1.67 萬) |
| R1 精良 | 99.999085%<br><span style="color:blue">▲ +0.067635%</span><br>(1.09 億) | 99.999073%<br><span style="color:blue">▲ +0.068572%</span><br>(1.08 億) | 88.084288%<br><span style="color:gray">持平</span><br>(7,206) | 88.084288%<br><span style="color:gray">持平</span><br>(7,206) | 71.385650%<br><span style="color:gray">持平</span><br>(3,284) | 73.438164%<br><span style="color:red">▼ -11.246962%</span><br>(1.38 萬) | 77.766200%<br><span style="color:red">▼ -15.466355%</span><br>(2.50 萬) |
| R2 稀有 | 99.999472%<br><span style="color:blue">▲ +0.039022%</span><br>(1.90 億) | 99.999465%<br><span style="color:blue">▲ +0.039538%</span><br>(1.87 億) | 91.689447%<br><span style="color:gray">持平</span><br>(9,609) | 91.689447%<br><span style="color:gray">持平</span><br>(9,609) | 78.744251%<br><span style="color:gray">持平</span><br>(4,377) | 78.661659%<br><span style="color:red">▼ -9.394905%</span><br>(1.84 萬) | 83.745689%<br><span style="color:red">▼ -11.620521%</span><br>(3.34 萬) |
| R3 獨特 | 99.999734%<br><span style="color:blue">▲ +0.019646%</span><br>(3.77 億) | 99.999731%<br><span style="color:blue">▲ +0.019886%</span><br>(3.72 億) | 94.635089%<br><span style="color:gray">持平</span><br>(1.35 萬) | 94.635089%<br><span style="color:gray">持平</span><br>(1.35 萬) | 85.512636%<br><span style="color:gray">持平</span><br>(6,128) | 83.767815%<br><span style="color:red">▼ -7.399199%</span><br>(2.58 萬) | 89.021136%<br><span style="color:red">▼ -8.031669%</span><br>(4.67 萬) |
| R4 史詩 | 99.999870%<br><span style="color:blue">▲ +0.009623%</span><br>(7.69 億) | 99.999866%<br><span style="color:blue">▲ +0.009905%</span><br>(7.47 億) | 96.669965%<br><span style="color:gray">持平</span><br>(1.92 萬) | 96.669965%<br><span style="color:gray">持平</span><br>(1.92 萬) | 90.647174%<br><span style="color:gray">持平</span><br>(8,755) | 88.053996%<br><span style="color:red">▼ -5.593571%</span><br>(3.69 萬) | 92.916829%<br><span style="color:red">▼ -5.272439%</span><br>(6.68 萬) |
| R5 傳說 | 99.999916%<br><span style="color:blue">▲ +0.006205%</span><br>(11.93 億) | 99.999914%<br><span style="color:blue">▲ +0.006386%</span><br>(11.59 億) | 97.540397%<br><span style="color:gray">持平</span><br>(2.40 萬) | 97.540397%<br><span style="color:gray">持平</span><br>(2.40 萬) | 92.970286%<br><span style="color:gray">持平</span><br>(1.09 萬) | 90.209708%<br><span style="color:red">▼ -4.643188%</span><br>(4.61 萬) | 94.659474%<br><span style="color:red">▼ -4.008736%</span><br>(8.35 萬) |
| R6 神話 | 99.999950%<br><span style="color:blue">▲ +0.003699%</span><br>(20.00 億) | 99.999949%<br><span style="color:blue">▲ +0.003806%</span><br>(19.44 億) | 98.282791%<br><span style="color:gray">持平</span><br>(3.12 萬) | 98.282791%<br><span style="color:gray">持平</span><br>(3.12 萬) | 95.018235%<br><span style="color:gray">持平</span><br>(1.42 萬) | 92.294177%<br><span style="color:red">▼ -3.698513%</span><br>(5.99 萬) | 96.191199%<br><span style="color:red">▼ -2.882456%</span><br>(10.85 萬) |
| R7 創世 | 99.999967%<br><span style="color:blue">▲ +0.002453%</span><br>(30.17 億) | 99.999966%<br><span style="color:blue">▲ +0.002524%</span><br>(29.32 億) | 98.710071%<br><span style="color:gray">持平</span><br>(3.84 萬) | 98.710071%<br><span style="color:gray">持平</span><br>(3.84 萬) | 96.224808%<br><span style="color:gray">持平</span><br>(1.75 萬) | 93.647567%<br><span style="color:red">▼ -3.072024%</span><br>(7.37 萬) | 97.094792%<br><span style="color:red">▼ -2.210791%</span><br>(13.35 萬) |
| R8 神鑄神話 | 99.999976%<br><span style="color:blue">▲ +0.001745%</span><br>(42.41 億) | 99.999976%<br><span style="color:blue">▲ +0.001795%</span><br>(41.22 億) | 98.982943%<br><span style="color:gray">持平</span><br>(4.56 萬) | 98.982943%<br><span style="color:gray">持平</span><br>(4.56 萬) | 97.006766%<br><span style="color:gray">持平</span><br>(2.08 萬) | 94.596581%<br><span style="color:red">▼ -2.626690%</span><br>(8.75 萬) | 97.682306%<br><span style="color:red">▼ -1.770931%</span><br>(15.86 萬) |
| R9 神鑄創世 | 99.999985%<br><span style="color:blue">▲ +0.001097%</span><br>(67.43 億) | 99.999985%<br><span style="color:blue">▲ +0.001129%</span><br>(65.55 億) | 99.264471%<br><span style="color:gray">持平</span><br>(5.77 萬) | 99.264471%<br><span style="color:gray">持平</span><br>(5.77 萬) | 97.822595%<br><span style="color:gray">持平</span><br>(2.63 萬) | 95.673431%<br><span style="color:red">▼ -2.115452%</span><br>(11.06 萬) | 98.298436%<br><span style="color:red">▼ -1.306691%</span><br>(20.03 萬) |
| R10 混沌 | 99.999992%<br><span style="color:blue">▲ +0.000619%</span><br>(119.49 億) | 99.999991%<br><span style="color:blue">▲ +0.000637%</span><br>(116.16 億) | 99.507051%<br><span style="color:gray">持平</span><br>(7.69 萬) | 99.507051%<br><span style="color:gray">持平</span><br>(7.69 萬) | 98.533334%<br><span style="color:gray">持平</span><br>(3.50 萬) | 96.719591%<br><span style="color:red">▼ -1.612853%</span><br>(14.74 萬) | 98.839616%<br><span style="color:red">▼ -0.896049%</span><br>(26.71 萬) |
| R11 神鑄混沌 | 99.999996%<br><span style="color:blue">▲ +0.000301%</span><br>(246.16 億) | 99.999996%<br><span style="color:blue">▲ +0.000309%</span><br>(239.32 億) | 99.702802%<br><span style="color:gray">持平</span><br>(11.05 萬) | 99.702802%<br><span style="color:gray">持平</span><br>(11.05 萬) | 99.112114%<br><span style="color:gray">持平</span><br>(5.03 萬) | 97.694939%<br><span style="color:red">▼ -1.139092%</span><br>(21.19 萬) | 99.285828%<br><span style="color:red">▼ -0.554958%</span><br>(38.39 萬) |


---

## 二、情境二：上述情況 + 鑲嵌 10 個 10 級頂級寶石

在 600 級裝備基礎上，鑲入 10 顆 10 級專屬寶石（生命鑲 10 顆黃玉、法力鑲 10 顆堇青石、防禦鑲 10 顆鑽石、抗性鑲 10 顆孔雀石/全抗寶石）。

### 2.1 生命值 (HP) 極大值分佈與差異
| 裝備階級 | 1轉 | 2轉 | 3轉 | 4轉 | 5轉 | 6轉 | 7轉 | 8轉 | 9轉 | 10轉 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| R0 普通 | 114.29 萬<br><span style="color:blue">▲ +1.68 萬</span> | 190.48 萬<br><span style="color:blue">▲ +2.80 萬</span> | 266.68 萬<br><span style="color:blue">▲ +3.92 萬</span> | 380.97 萬<br><span style="color:blue">▲ +5.60 萬</span> | 533.36 萬<br><span style="color:blue">▲ +7.84 萬</span> | 685.74 萬<br><span style="color:blue">▲ +10.08 萬</span> | 838.13 萬<br><span style="color:blue">▲ +12.32 萬</span> | 1142.91 萬<br><span style="color:blue">▲ +16.80 萬</span> | 1447.68 萬<br><span style="color:blue">▲ +21.28 萬</span> | 1904.85 萬<br><span style="color:blue">▲ +28.00 萬</span> |
| R1 精良 | 2109.63 萬<br><span style="color:blue">▲ +22.55 萬</span> | 3516.05 萬<br><span style="color:blue">▲ +37.59 萬</span> | 4922.48 萬<br><span style="color:blue">▲ +52.62 萬</span> | 7032.11 萬<br><span style="color:blue">▲ +75.17 萬</span> | 9844.95 萬<br><span style="color:blue">▲ +105.24 萬</span> | 1.27 億<br><span style="color:blue">▲ +135.31 萬</span> | 1.55 億<br><span style="color:blue">▲ +165.38 萬</span> | 2.11 億<br><span style="color:blue">▲ +225.52 萬</span> | 2.67 億<br><span style="color:blue">▲ +285.66 萬</span> | 3.52 億<br><span style="color:blue">▲ +375.87 萬</span> |
| R2 稀有 | 3512.30 萬<br><span style="color:blue">▲ +29.50 萬</span> | 5853.83 萬<br><span style="color:blue">▲ +49.17 萬</span> | 8195.36 萬<br><span style="color:blue">▲ +68.84 萬</span> | 1.17 億<br><span style="color:blue">▲ +98.34 萬</span> | 1.64 億<br><span style="color:blue">▲ +137.67 萬</span> | 2.11 億<br><span style="color:blue">▲ +177.00 萬</span> | 2.58 億<br><span style="color:blue">▲ +216.34 萬</span> | 3.51 億<br><span style="color:blue">▲ +295.01 萬</span> | 4.45 億<br><span style="color:blue">▲ +373.68 萬</span> | 5.85 億<br><span style="color:blue">▲ +491.68 萬</span> |
| R3 獨特 | 7448.20 萬<br><span style="color:blue">▲ +40.64 萬</span> | 1.24 億<br><span style="color:blue">▲ +67.74 萬</span> | 1.74 億<br><span style="color:blue">▲ +94.83 萬</span> | 2.48 億<br><span style="color:blue">▲ +135.48 萬</span> | 3.48 億<br><span style="color:blue">▲ +189.67 萬</span> | 4.47 億<br><span style="color:blue">▲ +243.86 萬</span> | 5.46 億<br><span style="color:blue">▲ +298.05 萬</span> | 7.45 億<br><span style="color:blue">▲ +406.43 萬</span> | 9.43 億<br><span style="color:blue">▲ +514.81 萬</span> | 12.41 億<br><span style="color:blue">▲ +677.38 萬</span> |
| R4 史詩 | 1.46 億<br><span style="color:blue">▲ +57.34 萬</span> | 2.43 億<br><span style="color:blue">▲ +95.56 萬</span> | 3.40 億<br><span style="color:blue">▲ +133.78 萬</span> | 4.86 億<br><span style="color:blue">▲ +191.12 萬</span> | 6.81 億<br><span style="color:blue">▲ +267.56 萬</span> | 8.76 億<br><span style="color:blue">▲ +344.01 萬</span> | 10.70 億<br><span style="color:blue">▲ +420.46 萬</span> | 14.59 億<br><span style="color:blue">▲ +573.35 萬</span> | 18.48 億<br><span style="color:blue">▲ +726.24 萬</span> | 24.32 億<br><span style="color:blue">▲ +955.58 萬</span> |
| R5 傳說 | 2.24 億<br><span style="color:blue">▲ +71.25 萬</span> | 3.73 億<br><span style="color:blue">▲ +118.74 萬</span> | 5.22 億<br><span style="color:blue">▲ +166.24 萬</span> | 7.45 億<br><span style="color:blue">▲ +237.48 萬</span> | 10.44 億<br><span style="color:blue">▲ +332.48 萬</span> | 13.42 億<br><span style="color:blue">▲ +427.47 萬</span> | 16.40 億<br><span style="color:blue">▲ +522.47 萬</span> | 22.36 億<br><span style="color:blue">▲ +712.45 萬</span> | 28.33 億<br><span style="color:blue">▲ +902.44 萬</span> | 37.27 億<br><span style="color:blue">▲ +1187.42 萬</span> |
| R6 神話 | 3.71 億<br><span style="color:blue">▲ +92.12 萬</span> | 6.19 億<br><span style="color:blue">▲ +153.53 萬</span> | 8.66 億<br><span style="color:blue">▲ +214.94 萬</span> | 12.37 億<br><span style="color:blue">▲ +307.06 萬</span> | 17.32 億<br><span style="color:blue">▲ +429.88 萬</span> | 22.27 億<br><span style="color:blue">▲ +552.71 萬</span> | 27.22 億<br><span style="color:blue">▲ +675.53 萬</span> | 37.12 億<br><span style="color:blue">▲ +921.18 萬</span> | 47.02 億<br><span style="color:blue">▲ +1166.82 萬</span> | 61.87 億<br><span style="color:blue">▲ +1535.30 萬</span> |
| R7 創世 | 5.56 億<br><span style="color:blue">▲ +112.98 萬</span> | 9.26 億<br><span style="color:blue">▲ +188.29 萬</span> | 12.97 億<br><span style="color:blue">▲ +263.61 萬</span> | 18.53 億<br><span style="color:blue">▲ +376.59 萬</span> | 25.94 億<br><span style="color:blue">▲ +527.22 萬</span> | 33.35 億<br><span style="color:blue">▲ +677.86 萬</span> | 40.76 億<br><span style="color:blue">▲ +828.50 萬</span> | 55.59 億<br><span style="color:blue">▲ +1129.77 萬</span> | 70.41 億<br><span style="color:blue">▲ +1431.04 萬</span> | 92.65 億<br><span style="color:blue">▲ +1882.94 萬</span> |
| R8 神鑄神話 | 7.78 億<br><span style="color:blue">▲ +133.85 萬</span> | 12.96 億<br><span style="color:blue">▲ +223.08 萬</span> | 18.15 億<br><span style="color:blue">▲ +312.31 萬</span> | 25.93 億<br><span style="color:blue">▲ +446.16 萬</span> | 36.30 億<br><span style="color:blue">▲ +624.63 萬</span> | 46.67 億<br><span style="color:blue">▲ +803.09 萬</span> | 57.04 億<br><span style="color:blue">▲ +981.56 萬</span> | 77.78 億<br><span style="color:blue">▲ +1338.49 萬</span> | 98.52 億<br><span style="color:blue">▲ +1695.42 萬</span> | 129.63 億<br><span style="color:blue">▲ +2230.82 萬</span> |
| R9 神鑄創世 | 12.30 億<br><span style="color:blue">▲ +168.63 萬</span> | 20.50 億<br><span style="color:blue">▲ +281.05 萬</span> | 28.71 億<br><span style="color:blue">▲ +393.47 萬</span> | 41.01 億<br><span style="color:blue">▲ +562.11 萬</span> | 57.41 億<br><span style="color:blue">▲ +786.95 萬</span> | 73.81 億<br><span style="color:blue">▲ +1011.79 萬</span> | 90.22 億<br><span style="color:blue">▲ +1236.63 萬</span> | 123.02 億<br><span style="color:blue">▲ +1686.32 萬</span> | 155.83 億<br><span style="color:blue">▲ +2136.00 萬</span> | 205.04 億<br><span style="color:blue">▲ +2810.53 萬</span> |
| R10 混沌 | 21.69 億<br><span style="color:blue">▲ +224.29 萬</span> | 36.15 億<br><span style="color:blue">▲ +373.81 萬</span> | 50.61 億<br><span style="color:blue">▲ +523.34 萬</span> | 72.30 億<br><span style="color:blue">▲ +747.62 萬</span> | 101.22 億<br><span style="color:blue">▲ +1046.67 萬</span> | 130.14 億<br><span style="color:blue">▲ +1345.72 萬</span> | 159.05 億<br><span style="color:blue">▲ +1644.77 萬</span> | 216.89 億<br><span style="color:blue">▲ +2242.87 萬</span> | 274.73 億<br><span style="color:blue">▲ +2840.97 萬</span> | 361.49 億<br><span style="color:blue">▲ +3738.11 萬</span> |
| R11 神鑄混沌 | 44.48 億<br><span style="color:blue">▲ +321.67 萬</span> | 74.13 億<br><span style="color:blue">▲ +536.12 萬</span> | 103.78 億<br><span style="color:blue">▲ +750.57 萬</span> | 148.26 億<br><span style="color:blue">▲ +1072.24 萬</span> | 207.56 億<br><span style="color:blue">▲ +1501.14 萬</span> | 266.86 億<br><span style="color:blue">▲ +1930.04 萬</span> | 326.16 億<br><span style="color:blue">▲ +2358.94 萬</span> | 444.77 億<br><span style="color:blue">▲ +3216.73 萬</span> | 563.37 億<br><span style="color:blue">▲ +4074.52 萬</span> | 741.28 億<br><span style="color:blue">▲ +5361.22 萬</span> |

### 2.2 法力值 (MP) 極大值分佈與差異
| 裝備階級 | 1轉 | 2轉 | 3轉 | 4轉 | 5轉 | 6轉 | 7轉 | 8轉 | 9轉 | 10轉 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| R0 普通 | 23.56 萬<br><span style="color:red">▼ -3.60 萬</span> | 39.27 萬<br><span style="color:red">▼ -6.00 萬</span> | 54.98 萬<br><span style="color:red">▼ -8.40 萬</span> | 78.54 萬<br><span style="color:red">▼ -12.00 萬</span> | 109.96 萬<br><span style="color:red">▼ -16.80 萬</span> | 141.38 萬<br><span style="color:red">▼ -21.60 萬</span> | 172.79 萬<br><span style="color:red">▼ -26.40 萬</span> | 235.63 萬<br><span style="color:red">▼ -36.00 萬</span> | 298.46 萬<br><span style="color:red">▼ -45.60 萬</span> | 392.71 萬<br><span style="color:red">▼ -60.00 萬</span> |
| R1 精良 | 35.65 萬<br><span style="color:red">▼ -3.60 萬</span> | 59.41 萬<br><span style="color:red">▼ -6.00 萬</span> | 83.17 萬<br><span style="color:red">▼ -8.40 萬</span> | 118.82 萬<br><span style="color:red">▼ -12.00 萬</span> | 166.35 萬<br><span style="color:red">▼ -16.80 萬</span> | 213.87 萬<br><span style="color:red">▼ -21.60 萬</span> | 261.40 萬<br><span style="color:red">▼ -26.40 萬</span> | 356.46 萬<br><span style="color:red">▼ -36.00 萬</span> | 451.51 萬<br><span style="color:red">▼ -45.60 萬</span> | 594.10 萬<br><span style="color:red">▼ -60.00 萬</span> |
| R2 稀有 | 44.92 萬<br><span style="color:red">▼ -3.60 萬</span> | 74.87 萬<br><span style="color:red">▼ -6.00 萬</span> | 104.82 萬<br><span style="color:red">▼ -8.40 萬</span> | 149.75 萬<br><span style="color:red">▼ -12.00 萬</span> | 209.65 萬<br><span style="color:red">▼ -16.80 萬</span> | 269.55 萬<br><span style="color:red">▼ -21.60 萬</span> | 329.45 萬<br><span style="color:red">▼ -26.40 萬</span> | 449.24 萬<br><span style="color:red">▼ -36.00 萬</span> | 569.04 萬<br><span style="color:red">▼ -45.60 萬</span> | 748.74 萬<br><span style="color:red">▼ -60.00 萬</span> |
| R3 獨特 | 59.76 萬<br><span style="color:red">▼ -3.60 萬</span> | 99.61 萬<br><span style="color:red">▼ -6.00 萬</span> | 139.45 萬<br><span style="color:red">▼ -8.40 萬</span> | 199.22 萬<br><span style="color:red">▼ -12.00 萬</span> | 278.90 萬<br><span style="color:red">▼ -16.80 萬</span> | 358.59 萬<br><span style="color:red">▼ -21.60 萬</span> | 438.27 萬<br><span style="color:red">▼ -26.40 萬</span> | 597.64 萬<br><span style="color:red">▼ -36.00 萬</span> | 757.02 萬<br><span style="color:red">▼ -45.60 萬</span> | 996.08 萬<br><span style="color:red">▼ -60.00 萬</span> |
| R4 史詩 | 82.03 萬<br><span style="color:red">▼ -3.60 萬</span> | 136.71 萬<br><span style="color:red">▼ -6.00 萬</span> | 191.40 萬<br><span style="color:red">▼ -8.40 萬</span> | 273.43 萬<br><span style="color:red">▼ -12.00 萬</span> | 382.80 萬<br><span style="color:red">▼ -16.80 萬</span> | 492.17 萬<br><span style="color:red">▼ -21.60 萬</span> | 601.54 萬<br><span style="color:red">▼ -26.40 萬</span> | 820.28 萬<br><span style="color:red">▼ -36.00 萬</span> | 1039.02 萬<br><span style="color:red">▼ -45.60 萬</span> | 1367.13 萬<br><span style="color:red">▼ -60.00 萬</span> |
| R5 傳說 | 100.58 萬<br><span style="color:red">▼ -3.60 萬</span> | 167.64 萬<br><span style="color:red">▼ -6.00 萬</span> | 234.70 萬<br><span style="color:red">▼ -8.40 萬</span> | 335.28 萬<br><span style="color:red">▼ -12.00 萬</span> | 469.39 萬<br><span style="color:red">▼ -16.80 萬</span> | 603.50 萬<br><span style="color:red">▼ -21.60 萬</span> | 737.62 萬<br><span style="color:red">▼ -26.40 萬</span> | 1005.84 萬<br><span style="color:red">▼ -36.00 萬</span> | 1274.06 萬<br><span style="color:red">▼ -45.60 萬</span> | 1676.40 萬<br><span style="color:red">▼ -60.00 萬</span> |
| R6 神話 | 128.41 萬<br><span style="color:red">▼ -3.60 萬</span> | 214.02 萬<br><span style="color:red">▼ -6.00 萬</span> | 299.63 萬<br><span style="color:red">▼ -8.40 萬</span> | 428.05 萬<br><span style="color:red">▼ -12.00 萬</span> | 599.26 萬<br><span style="color:red">▼ -16.80 萬</span> | 770.48 萬<br><span style="color:red">▼ -21.60 萬</span> | 941.70 萬<br><span style="color:red">▼ -26.40 萬</span> | 1284.14 萬<br><span style="color:red">▼ -36.00 萬</span> | 1626.57 萬<br><span style="color:red">▼ -45.60 萬</span> | 2140.23 萬<br><span style="color:red">▼ -60.00 萬</span> |
| R7 創世 | 156.24 萬<br><span style="color:red">▼ -3.60 萬</span> | 260.41 萬<br><span style="color:red">▼ -6.00 萬</span> | 364.57 萬<br><span style="color:red">▼ -8.40 萬</span> | 520.81 萬<br><span style="color:red">▼ -12.00 萬</span> | 729.14 萬<br><span style="color:red">▼ -16.80 萬</span> | 937.46 萬<br><span style="color:red">▼ -21.60 萬</span> | 1145.79 萬<br><span style="color:red">▼ -26.40 萬</span> | 1562.44 萬<br><span style="color:red">▼ -36.00 萬</span> | 1979.09 萬<br><span style="color:red">▼ -45.60 萬</span> | 2604.06 萬<br><span style="color:red">▼ -60.00 萬</span> |
| R8 神鑄神話 | 184.07 萬<br><span style="color:red">▼ -3.60 萬</span> | 306.79 萬<br><span style="color:red">▼ -6.00 萬</span> | 429.50 萬<br><span style="color:red">▼ -8.40 萬</span> | 613.58 萬<br><span style="color:red">▼ -12.00 萬</span> | 859.01 萬<br><span style="color:red">▼ -16.80 萬</span> | 1104.44 萬<br><span style="color:red">▼ -21.60 萬</span> | 1349.87 萬<br><span style="color:red">▼ -26.40 萬</span> | 1840.73 萬<br><span style="color:red">▼ -36.00 萬</span> | 2331.60 萬<br><span style="color:red">▼ -45.60 萬</span> | 3067.89 萬<br><span style="color:red">▼ -60.00 萬</span> |
| R9 神鑄創世 | 230.46 萬<br><span style="color:red">▼ -3.60 萬</span> | 384.09 萬<br><span style="color:red">▼ -6.00 萬</span> | 537.73 萬<br><span style="color:red">▼ -8.40 萬</span> | 768.18 萬<br><span style="color:red">▼ -12.00 萬</span> | 1075.46 萬<br><span style="color:red">▼ -16.80 萬</span> | 1382.73 萬<br><span style="color:red">▼ -21.60 萬</span> | 1690.01 萬<br><span style="color:red">▼ -26.40 萬</span> | 2304.55 萬<br><span style="color:red">▼ -36.00 萬</span> | 2919.10 萬<br><span style="color:red">▼ -45.60 萬</span> | 3840.93 萬<br><span style="color:red">▼ -60.00 萬</span> |
| R10 混沌 | 304.67 萬<br><span style="color:red">▼ -3.60 萬</span> | 507.78 萬<br><span style="color:red">▼ -6.00 萬</span> | 710.89 萬<br><span style="color:red">▼ -8.40 萬</span> | 1015.56 萬<br><span style="color:red">▼ -12.00 萬</span> | 1421.78 萬<br><span style="color:red">▼ -16.80 萬</span> | 1828.00 萬<br><span style="color:red">▼ -21.60 萬</span> | 2234.23 萬<br><span style="color:red">▼ -26.40 萬</span> | 3046.67 萬<br><span style="color:red">▼ -36.00 萬</span> | 3859.12 萬<br><span style="color:red">▼ -45.60 萬</span> | 5077.79 萬<br><span style="color:red">▼ -60.00 萬</span> |
| R11 神鑄混沌 | 434.54 萬<br><span style="color:red">▼ -3.60 萬</span> | 724.23 萬<br><span style="color:red">▼ -6.00 萬</span> | 1013.92 萬<br><span style="color:red">▼ -8.40 萬</span> | 1448.46 萬<br><span style="color:red">▼ -12.00 萬</span> | 2027.85 萬<br><span style="color:red">▼ -16.80 萬</span> | 2607.23 萬<br><span style="color:red">▼ -21.60 萬</span> | 3186.62 萬<br><span style="color:red">▼ -26.40 萬</span> | 4345.39 萬<br><span style="color:red">▼ -36.00 萬</span> | 5504.16 萬<br><span style="color:red">▼ -45.60 萬</span> | 7242.31 萬<br><span style="color:red">▼ -60.00 萬</span> |

### 2.3 四維主屬性（力量 Str）極大值分佈與差異
> **說明**：寶石系統中無專屬四維主屬性寶石，故數值與情境一完全一致（維持<span style="color:gray">持平</span>）。

| 裝備階級 | 1轉 | 2轉 | 3轉 | 4轉 | 5轉 | 6轉 | 7轉 | 8轉 | 9轉 | 10轉 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| R0 普通 | 2.58 萬 | 4.30 萬 | 6.02 萬 | 8.60 萬 | 12.04 萬 | 15.48 萬 | 18.92 萬 | 25.81 萬 | 32.69 萬 | 43.01 萬 |
| R1 精良 | 3.72 萬 | 6.20 萬 | 8.68 萬 | 12.40 萬 | 17.36 萬 | 22.32 萬 | 27.29 萬 | 37.21 萬 | 47.13 萬 | 62.01 萬 |
| R2 稀有 | 4.86 萬 | 8.10 萬 | 11.34 萬 | 16.20 萬 | 22.68 萬 | 29.16 萬 | 35.65 萬 | 48.61 萬 | 61.57 萬 | 81.01 萬 |
| R3 獨特 | 6.68 萬 | 11.14 萬 | 15.60 萬 | 22.28 萬 | 31.20 萬 | 40.11 萬 | 49.02 萬 | 66.85 萬 | 84.68 萬 | 111.42 萬 |
| R4 史詩 | 9.42 萬 | 15.70 萬 | 21.98 萬 | 31.40 萬 | 43.96 萬 | 56.53 萬 | 69.09 萬 | 94.21 萬 | 119.33 萬 | 157.02 萬 |
| R5 傳說 | 11.70 萬 | 19.50 萬 | 27.30 萬 | 39.00 萬 | 54.61 萬 | 70.21 萬 | 85.81 萬 | 117.01 萬 | 148.22 萬 | 195.02 萬 |
| R6 神話 | 15.12 萬 | 25.20 萬 | 35.28 萬 | 50.41 萬 | 70.57 萬 | 90.73 萬 | 110.89 萬 | 151.22 萬 | 191.54 萬 | 252.03 萬 |
| R7 創世 | 18.54 萬 | 30.90 萬 | 43.26 萬 | 61.81 萬 | 86.53 萬 | 111.25 萬 | 135.97 萬 | 185.42 萬 | 234.86 萬 | 309.03 萬 |
| R8 神鑄神話 | 21.96 萬 | 36.60 萬 | 51.24 萬 | 73.21 萬 | 102.49 萬 | 131.77 萬 | 161.06 萬 | 219.62 萬 | 278.19 萬 | 366.04 萬 |
| R9 神鑄創世 | 27.66 萬 | 46.10 萬 | 64.55 萬 | 92.21 萬 | 129.09 萬 | 165.97 萬 | 202.86 萬 | 276.62 萬 | 350.39 萬 | 461.04 萬 |
| R10 混沌 | 36.78 萬 | 61.31 萬 | 85.83 萬 | 122.61 萬 | 171.65 萬 | 220.70 萬 | 269.74 萬 | 367.83 萬 | 465.92 萬 | 613.05 萬 |
| R11 神鑄混沌 | 52.74 萬 | 87.91 萬 | 123.07 萬 | 175.81 萬 | 246.14 萬 | 316.47 萬 | 386.79 萬 | 527.44 萬 | 668.09 萬 | 879.07 萬 |

### 2.4 物理防禦 (Def) 極大值分佈與差異（1轉至 10轉）
| 裝備階級 | 1轉 | 2轉 | 3轉 | 4轉 | 5轉 | 6轉 | 7轉 | 8轉 | 9轉 | 10轉 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| R0 普通 | 7.38 萬 | 11.89 萬 | 20.03 萬 | 35.87 萬 | 66.67 萬 | 126.51 萬 | 244.40 萬 | 480.18 萬 | 948.21 萬 | 1882.49 萬 |
| R1 精良 | 105.37 萬 | 170.38 萬 | 282.48 萬 | 497.70 萬 | 910.23 萬 | 1699.41 萬 | 3241.91 萬 | 6326.92 萬 | 1.24 億 | 2.46 億 |
| R2 稀有 | 161.59 萬 | 261.52 萬 | 431.66 萬 | 757.10 萬 | 1378.28 萬 | 2561.23 萬 | 4867.72 萬 | 9480.71 萬 | 1.86 億 | 3.67 億 |
| R3 獨特 | 353.09 萬 | 575.61 萬 | 914.00 萬 | 1537.46 萬 | 2677.73 萬 | 4744.99 萬 | 8666.23 萬 | 1.65 億 | 3.18 億 | 6.21 億 |
| R4 史詩 | 734.68 萬 | 1201.77 萬 | 1873.02 萬 | 3084.03 萬 | 5243.12 萬 | 9035.39 萬 | 1.61 億 | 3.02 億 | 5.74 億 | 11.12 億 |
| R5 傳說 | 1101.51 萬 | 1802.96 萬 | 2800.39 萬 | 4592.54 萬 | 7771.37 萬 | 1.33 億 | 2.36 億 | 4.42 億 | 8.37 億 | 16.19 億 |
| R6 神話 | 1789.08 萬 | 2930.17 萬 | 4535.83 萬 | 7408.90 萬 | 1.25 億 | 2.13 億 | 3.75 億 | 6.99 億 | 13.21 億 | 25.51 億 |
| R7 創世 | 2642.59 萬 | 4329.81 萬 | 6687.52 萬 | 1.09 億 | 1.83 億 | 3.11 億 | 5.45 億 | 10.15 億 | 19.14 億 | 36.92 億 |
| R8 神鑄神話 | 3661.28 萬 | 6000.62 萬 | 9253.46 萬 | 1.50 億 | 2.52 億 | 4.27 億 | 7.48 億 | 13.89 億 | 26.16 億 | 50.40 億 |
| R9 神鑄創世 | 5727.36 萬 | 9389.89 萬 | 1.45 億 | 2.35 億 | 3.92 億 | 6.61 億 | 11.55 億 | 21.42 億 | 40.26 億 | 77.49 億 |
| R10 混沌 | 9990.00 萬 | 1.64 億 | 2.52 億 | 4.08 億 | 6.79 億 | 11.43 億 | 19.90 億 | 36.83 億 | 69.11 億 | 132.86 億 |
| R11 神鑄混沌 | 2.03 億 | 3.33 億 | 5.10 億 | 8.25 億 | 13.71 億 | 22.99 億 | 39.91 億 | 73.76 億 | 138.16 億 | 265.33 億 |

### 2.5 各類減傷極大值與對應屬性數值對照表（以 10轉 頂峰為基準，對戰 Lv.650 敵人）
| 裝備階級 | 物理防禦減傷 (物防值) | 魔法防禦減傷 (魔防值) | 物理抗性減傷 (物抗值) | 魔法抗性減傷 (魔抗值) | 元素抗性減傷 (全抗值) | 全局減傷 (減傷值) | BOSS減傷 (BOSS減傷值) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| R0 普通 | 99.994688%<br><span style="color:blue">▲ +0.391516%</span><br>(1882.49 萬) | 99.994681%<br><span style="color:blue">▲ +0.392035%</span><br>(1879.98 萬) | 88.398494%<br><span style="color:gray">持平</span><br>(7,365) | 88.398494%<br><span style="color:gray">持平</span><br>(7,365) | 83.162791%<br><span style="color:gray">持平</span><br>(5,389) | 64.828362%<br><span style="color:red">▼ -13.833297%</span><br>(9,216) | 66.960263%<br><span style="color:red">▼ -21.713003%</span><br>(1.67 萬) |
| R1 精良 | 99.999593%<br><span style="color:blue">▲ +0.030089%</span><br>(2.46 億) | 99.999591%<br><span style="color:blue">▲ +0.030273%</span><br>(2.44 億) | 91.860560%<br><span style="color:gray">持平</span><br>(9,766) | 91.860560%<br><span style="color:gray">持平</span><br>(9,766) | 86.455350%<br><span style="color:gray">持平</span><br>(6,484) | 73.438164%<br><span style="color:red">▼ -11.246962%</span><br>(1.38 萬) | 77.766200%<br><span style="color:red">▼ -15.466355%</span><br>(2.50 萬) |
| R2 稀有 | 99.999728%<br><span style="color:blue">▲ +0.020136%</span><br>(3.67 億) | 99.999726%<br><span style="color:blue">▲ +0.020272%</span><br>(3.65 億) | 93.878652%<br><span style="color:gray">持平</span><br>(1.22 萬) | 93.878652%<br><span style="color:gray">持平</span><br>(1.22 萬) | 88.797285%<br><span style="color:gray">持平</span><br>(7,577) | 78.661659%<br><span style="color:red">▼ -9.394905%</span><br>(1.84 萬) | 83.745689%<br><span style="color:red">▼ -11.620521%</span><br>(3.34 萬) |
| R3 獨特 | 99.999839%<br><span style="color:blue">▲ +0.011920%</span><br>(6.21 億) | 99.999838%<br><span style="color:blue">▲ +0.012009%</span><br>(6.16 億) | 95.744208%<br><span style="color:gray">持平</span><br>(1.60 萬) | 95.744208%<br><span style="color:gray">持平</span><br>(1.60 萬) | 91.369582%<br><span style="color:gray">持平</span><br>(9,328) | 83.767815%<br><span style="color:red">▼ -7.399199%</span><br>(2.58 萬) | 89.021136%<br><span style="color:red">▼ -8.031669%</span><br>(4.67 萬) |
| R4 史詩 | 99.999910%<br><span style="color:blue">▲ +0.006652%</span><br>(11.12 億) | 99.999908%<br><span style="color:blue">▲ +0.006786%</span><br>(10.90 億) | 97.188984%<br><span style="color:gray">持平</span><br>(2.18 萬) | 97.188984%<br><span style="color:gray">持平</span><br>(2.18 萬) | 93.735120%<br><span style="color:gray">持平</span><br>(1.20 萬) | 88.053996%<br><span style="color:red">▼ -5.593571%</span><br>(3.69 萬) | 92.916829%<br><span style="color:red">▼ -5.272439%</span><br>(6.68 萬) |
| R5 傳說 | 99.999938%<br><span style="color:blue">▲ +0.004571%</span><br>(16.19 億) | 99.999937%<br><span style="color:blue">▲ +0.004668%</span><br>(15.85 億) | 97.858177%<br><span style="color:gray">持平</span><br>(2.66 萬) | 97.858177%<br><span style="color:gray">持平</span><br>(2.66 萬) | 94.979187%<br><span style="color:gray">持平</span><br>(1.41 萬) | 90.209708%<br><span style="color:red">▼ -4.643188%</span><br>(4.61 萬) | 94.659474%<br><span style="color:red">▼ -4.008736%</span><br>(8.35 萬) |
| R6 神話 | 99.999961%<br><span style="color:blue">▲ +0.002901%</span><br>(25.51 億) | 99.999960%<br><span style="color:blue">▲ +0.002966%</span><br>(24.94 億) | 98.459229%<br><span style="color:gray">持平</span><br>(3.38 萬) | 98.459229%<br><span style="color:gray">持平</span><br>(3.38 萬) | 96.200794%<br><span style="color:gray">持平</span><br>(1.74 萬) | 92.294177%<br><span style="color:red">▼ -3.698513%</span><br>(5.99 萬) | 96.191199%<br><span style="color:red">▼ -2.882456%</span><br>(10.85 萬) |
| R7 創世 | 99.999973%<br><span style="color:blue">▲ +0.002005%</span><br>(36.92 億) | 99.999972%<br><span style="color:blue">▲ +0.002052%</span><br>(36.07 億) | 98.820036%<br><span style="color:gray">持平</span><br>(4.10 萬) | 98.820036%<br><span style="color:gray">持平</span><br>(4.10 萬) | 96.990392%<br><span style="color:gray">持平</span><br>(2.07 萬) | 93.647567%<br><span style="color:red">▼ -3.072024%</span><br>(7.37 萬) | 97.094792%<br><span style="color:red">▼ -2.210791%</span><br>(13.35 萬) |
| R8 神鑄神話 | 99.999980%<br><span style="color:blue">▲ +0.001468%</span><br>(50.40 億) | 99.999980%<br><span style="color:blue">▲ +0.001504%</span><br>(49.21 億) | 99.057013%<br><span style="color:gray">持平</span><br>(4.82 萬) | 99.057013%<br><span style="color:gray">持平</span><br>(4.82 萬) | 97.536257%<br><span style="color:gray">持平</span><br>(2.40 萬) | 94.596581%<br><span style="color:red">▼ -2.626690%</span><br>(8.75 萬) | 97.682306%<br><span style="color:red">▼ -1.770931%</span><br>(15.86 萬) |
| R9 神鑄創世 | 99.999987%<br><span style="color:blue">▲ +0.000955%</span><br>(77.49 億) | 99.999987%<br><span style="color:blue">▲ +0.000979%</span><br>(75.61 億) | 99.307560%<br><span style="color:gray">持平</span><br>(6.02 萬) | 99.307560%<br><span style="color:gray">持平</span><br>(6.02 萬) | 98.139980%<br><span style="color:gray">持平</span><br>(2.95 萬) | 95.673431%<br><span style="color:red">▼ -2.115452%</span><br>(11.06 萬) | 98.298436%<br><span style="color:red">▼ -1.306691%</span><br>(20.03 萬) |
| R10 混沌 | 99.999992%<br><span style="color:blue">▲ +0.000557%</span><br>(132.86 億) | 99.999992%<br><span style="color:blue">▲ +0.000571%</span><br>(129.53 億) | 99.529040%<br><span style="color:gray">持平</span><br>(7.94 萬) | 99.529040%<br><span style="color:gray">持平</span><br>(7.94 萬) | 98.700016%<br><span style="color:gray">持平</span><br>(3.82 萬) | 96.719591%<br><span style="color:red">▼ -1.612853%</span><br>(14.74 萬) | 98.839616%<br><span style="color:red">▼ -0.896049%</span><br>(26.71 萬) |
| R11 神鑄混沌 | 99.999996%<br><span style="color:blue">▲ +0.000279%</span><br>(265.33 億) | 99.999996%<br><span style="color:blue">▲ +0.000286%</span><br>(258.48 億) | 99.712152%<br><span style="color:gray">持平</span><br>(11.31 萬) | 99.712152%<br><span style="color:gray">持平</span><br>(11.31 萬) | 99.184881%<br><span style="color:gray">持平</span><br>(5.35 萬) | 97.694939%<br><span style="color:red">▼ -1.139092%</span><br>(21.19 萬) | 99.285828%<br><span style="color:red">▼ -0.554958%</span><br>(38.39 萬) |


---

## 三、情境三：上述情況 + 轉生天堂威能全滿

解鎖各轉生階數的天堂威能樹：【生命洪流】（生命額外 +37.5% 獨立乘區）、【萬象壁壘】（全抗額外 +100%）、【絕對偏折】（全局減傷總值 +100%）與【屠龍聖鎧】（BOSS 減傷抗性 +150%）。四維主屬性享有 1轉【力量淬鍊】（+25%）與 10轉【力量超昇】（+62.5%）的強大獨立增幅。

### 3.1 生命值 (HP) 極大值分佈與差異
| 裝備階級 | 1轉 | 2轉 | 3轉 | 4轉 | 5轉 | 6轉 | 7轉 | 8轉 | 9轉 | 10轉 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| R0 普通 | 117.23 萬<br><span style="color:blue">▲ +1.68 萬</span> | 268.66 萬<br><span style="color:blue">▲ +3.85 萬</span> | 376.12 萬<br><span style="color:blue">▲ +5.39 萬</span> | 537.32 萬<br><span style="color:blue">▲ +7.70 萬</span> | 752.25 萬<br><span style="color:blue">▲ +10.78 萬</span> | 967.18 萬<br><span style="color:blue">▲ +13.86 萬</span> | 1182.11 萬<br><span style="color:blue">▲ +16.94 萬</span> | 1611.96 萬<br><span style="color:blue">▲ +23.10 萬</span> | 2041.82 萬<br><span style="color:blue">▲ +29.26 萬</span> | 3113.03 萬<br><span style="color:blue">▲ +62.56 萬</span> |
| R1 精良 | 2163.86 萬<br><span style="color:blue">▲ +22.55 萬</span> | 4958.84 萬<br><span style="color:blue">▲ +51.68 萬</span> | 6942.38 萬<br><span style="color:blue">▲ +72.36 萬</span> | 9917.69 萬<br><span style="color:blue">▲ +103.36 萬</span> | 1.39 億<br><span style="color:blue">▲ +144.71 萬</span> | 1.79 億<br><span style="color:blue">▲ +186.06 萬</span> | 2.18 億<br><span style="color:blue">▲ +227.40 萬</span> | 2.98 億<br><span style="color:blue">▲ +310.09 萬</span> | 3.77 億<br><span style="color:blue">▲ +392.79 萬</span> | 5.62 億<br><span style="color:blue">▲ +839.84 萬</span> |
| R2 稀有 | 3602.51 萬<br><span style="color:blue">▲ +29.50 萬</span> | 8255.75 萬<br><span style="color:blue">▲ +67.61 萬</span> | 1.16 億<br><span style="color:blue">▲ +94.65 萬</span> | 1.65 億<br><span style="color:blue">▲ +135.21 萬</span> | 2.31 億<br><span style="color:blue">▲ +189.30 萬</span> | 2.97 億<br><span style="color:blue">▲ +243.38 萬</span> | 3.63 億<br><span style="color:blue">▲ +297.47 萬</span> | 4.95 億<br><span style="color:blue">▲ +405.64 萬</span> | 6.27 億<br><span style="color:blue">▲ +513.81 萬</span> | 9.23 億<br><span style="color:blue">▲ +1098.60 萬</span> |
| R3 獨特 | 7852.48 萬<br><span style="color:blue">▲ +40.64 萬</span> | 1.80 億<br><span style="color:blue">▲ +93.14 萬</span> | 2.52 億<br><span style="color:blue">▲ +130.39 萬</span> | 3.60 億<br><span style="color:blue">▲ +186.28 萬</span> | 5.04 億<br><span style="color:blue">▲ +260.79 萬</span> | 6.48 億<br><span style="color:blue">▲ +335.30 萬</span> | 7.92 億<br><span style="color:blue">▲ +409.81 萬</span> | 10.80 億<br><span style="color:blue">▲ +558.84 萬</span> | 13.68 億<br><span style="color:blue">▲ +707.86 萬</span> | 20.94 億<br><span style="color:blue">▲ +1513.51 萬</span> |
| R4 史詩 | 1.54 億<br><span style="color:blue">▲ +57.34 萬</span> | 3.53 億<br><span style="color:blue">▲ +131.39 萬</span> | 4.94 億<br><span style="color:blue">▲ +183.95 萬</span> | 7.06 億<br><span style="color:blue">▲ +262.79 萬</span> | 9.88 億<br><span style="color:blue">▲ +367.90 萬</span> | 12.70 億<br><span style="color:blue">▲ +473.01 萬</span> | 15.52 億<br><span style="color:blue">▲ +578.13 萬</span> | 21.17 億<br><span style="color:blue">▲ +788.36 萬</span> | 26.81 億<br><span style="color:blue">▲ +998.59 萬</span> | 40.77 億<br><span style="color:blue">▲ +2135.13 萬</span> |
| R5 傳說 | 2.36 億<br><span style="color:blue">▲ +71.25 萬</span> | 5.41 億<br><span style="color:blue">▲ +163.27 萬</span> | 7.57 億<br><span style="color:blue">▲ +228.58 萬</span> | 10.82 億<br><span style="color:blue">▲ +326.54 萬</span> | 15.15 億<br><span style="color:blue">▲ +457.16 萬</span> | 19.47 億<br><span style="color:blue">▲ +587.77 萬</span> | 23.80 億<br><span style="color:blue">▲ +718.39 萬</span> | 32.46 億<br><span style="color:blue">▲ +979.62 萬</span> | 41.11 億<br><span style="color:blue">▲ +1240.86 萬</span> | 62.29 億<br><span style="color:blue">▲ +2653.15 萬</span> |
| R6 神話 | 3.92 億<br><span style="color:blue">▲ +92.12 萬</span> | 8.98 億<br><span style="color:blue">▲ +211.10 萬</span> | 12.57 億<br><span style="color:blue">▲ +295.54 萬</span> | 17.96 億<br><span style="color:blue">▲ +422.21 萬</span> | 25.15 億<br><span style="color:blue">▲ +591.09 萬</span> | 32.33 億<br><span style="color:blue">▲ +759.97 萬</span> | 39.52 億<br><span style="color:blue">▲ +928.85 萬</span> | 53.89 億<br><span style="color:blue">▲ +1266.62 萬</span> | 68.26 億<br><span style="color:blue">▲ +1604.38 萬</span> | 103.11 億<br><span style="color:blue">▲ +3430.43 萬</span> |
| R7 創世 | 5.87 億<br><span style="color:blue">▲ +112.98 萬</span> | 13.45 億<br><span style="color:blue">▲ +258.90 萬</span> | 18.83 億<br><span style="color:blue">▲ +362.47 萬</span> | 26.91 億<br><span style="color:blue">▲ +517.81 萬</span> | 37.67 億<br><span style="color:blue">▲ +724.93 萬</span> | 48.43 億<br><span style="color:blue">▲ +932.06 萬</span> | 59.19 億<br><span style="color:blue">▲ +1139.18 萬</span> | 80.72 億<br><span style="color:blue">▲ +1553.43 萬</span> | 102.24 億<br><span style="color:blue">▲ +1967.68 萬</span> | 154.13 億<br><span style="color:blue">▲ +4207.20 萬</span> |
| R8 神鑄神話 | 8.22 億<br><span style="color:blue">▲ +133.85 萬</span> | 18.83 億<br><span style="color:blue">▲ +306.74 萬</span> | 26.36 億<br><span style="color:blue">▲ +429.43 萬</span> | 37.65 億<br><span style="color:blue">▲ +613.47 萬</span> | 52.71 億<br><span style="color:blue">▲ +858.86 萬</span> | 67.78 億<br><span style="color:blue">▲ +1104.25 萬</span> | 82.84 億<br><span style="color:blue">▲ +1349.64 萬</span> | 112.96 億<br><span style="color:blue">▲ +1840.42 萬</span> | 143.08 億<br><span style="color:blue">▲ +2331.20 萬</span> | 215.38 億<br><span style="color:blue">▲ +4984.48 萬</span> |
| R9 神鑄創世 | 13.00 億<br><span style="color:blue">▲ +168.63 萬</span> | 29.78 億<br><span style="color:blue">▲ +386.45 萬</span> | 41.70 億<br><span style="color:blue">▲ +541.03 萬</span> | 59.57 億<br><span style="color:blue">▲ +772.90 萬</span> | 83.39 億<br><span style="color:blue">▲ +1082.05 萬</span> | 107.22 億<br><span style="color:blue">▲ +1391.21 萬</span> | 131.05 億<br><span style="color:blue">▲ +1700.37 萬</span> | 178.70 億<br><span style="color:blue">▲ +2318.69 萬</span> | 226.35 億<br><span style="color:blue">▲ +2937.00 萬</span> | 340.19 億<br><span style="color:blue">▲ +6279.77 萬</span> |
| R10 混沌 | 22.92 億<br><span style="color:blue">▲ +224.29 萬</span> | 52.52 億<br><span style="color:blue">▲ +513.99 萬</span> | 73.53 億<br><span style="color:blue">▲ +719.59 萬</span> | 105.04 億<br><span style="color:blue">▲ +1027.98 萬</span> | 147.05 億<br><span style="color:blue">▲ +1439.17 萬</span> | 189.06 億<br><span style="color:blue">▲ +1850.37 萬</span> | 231.08 億<br><span style="color:blue">▲ +2261.56 萬</span> | 315.11 億<br><span style="color:blue">▲ +3083.94 萬</span> | 399.14 億<br><span style="color:blue">▲ +3906.33 萬</span> | 598.96 億<br><span style="color:blue">▲ +8352.34 萬</span> |
| R11 神鑄混沌 | 47.00 億<br><span style="color:blue">▲ +321.67 萬</span> | 107.71 億<br><span style="color:blue">▲ +737.17 萬</span> | 150.80 億<br><span style="color:blue">▲ +1032.03 萬</span> | 215.42 億<br><span style="color:blue">▲ +1474.33 萬</span> | 301.59 億<br><span style="color:blue">▲ +2064.07 萬</span> | 387.76 億<br><span style="color:blue">▲ +2653.80 萬</span> | 473.93 億<br><span style="color:blue">▲ +3243.54 萬</span> | 646.27 億<br><span style="color:blue">▲ +4423.00 萬</span> | 818.61 億<br><span style="color:blue">▲ +5602.47 萬</span> | 1226.70 億<br><span style="color:blue">▲ +1.20 億</span> |

### 3.2 法力值 (MP) 極大值分佈與差異
| 裝備階級 | 1轉 | 2轉 | 3轉 | 4轉 | 5轉 | 6轉 | 7轉 | 8轉 | 9轉 | 10轉 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| R0 普通 | 24.15 萬<br><span style="color:red">▼ -3.60 萬</span> | 40.25 萬<br><span style="color:red">▼ -6.00 萬</span> | 56.35 萬<br><span style="color:red">▼ -8.40 萬</span> | 80.50 萬<br><span style="color:red">▼ -12.00 萬</span> | 112.71 萬<br><span style="color:red">▼ -16.80 萬</span> | 144.91 萬<br><span style="color:red">▼ -21.60 萬</span> | 177.11 萬<br><span style="color:red">▼ -26.40 萬</span> | 241.51 萬<br><span style="color:red">▼ -36.00 萬</span> | 305.92 萬<br><span style="color:red">▼ -45.60 萬</span> | 502.05 萬<br><span style="color:red">▼ -97.50 萬</span> |
| R1 精良 | 37.51 萬<br><span style="color:red">▼ -3.60 萬</span> | 62.51 萬<br><span style="color:red">▼ -6.00 萬</span> | 87.51 萬<br><span style="color:red">▼ -8.40 萬</span> | 125.02 萬<br><span style="color:red">▼ -12.00 萬</span> | 175.03 萬<br><span style="color:red">▼ -16.80 萬</span> | 225.04 萬<br><span style="color:red">▼ -21.60 萬</span> | 275.04 萬<br><span style="color:red">▼ -26.40 萬</span> | 375.06 萬<br><span style="color:red">▼ -36.00 萬</span> | 475.08 萬<br><span style="color:red">▼ -45.60 萬</span> | 777.62 萬<br><span style="color:red">▼ -97.50 萬</span> |
| R2 稀有 | 47.36 萬<br><span style="color:red">▼ -3.60 萬</span> | 78.93 萬<br><span style="color:red">▼ -6.00 萬</span> | 110.50 萬<br><span style="color:red">▼ -8.40 萬</span> | 157.85 萬<br><span style="color:red">▼ -12.00 萬</span> | 220.99 萬<br><span style="color:red">▼ -16.80 萬</span> | 284.13 萬<br><span style="color:red">▼ -21.60 萬</span> | 347.27 萬<br><span style="color:red">▼ -26.40 萬</span> | 473.55 萬<br><span style="color:red">▼ -36.00 萬</span> | 599.83 萬<br><span style="color:red">▼ -45.60 萬</span> | 965.53 萬<br><span style="color:red">▼ -97.50 萬</span> |
| R3 獨特 | 63.11 萬<br><span style="color:red">▼ -3.60 萬</span> | 105.18 萬<br><span style="color:red">▼ -6.00 萬</span> | 147.25 萬<br><span style="color:red">▼ -8.40 萬</span> | 210.36 萬<br><span style="color:red">▼ -12.00 萬</span> | 294.50 萬<br><span style="color:red">▼ -16.80 萬</span> | 378.64 萬<br><span style="color:red">▼ -21.60 萬</span> | 462.78 萬<br><span style="color:red">▼ -26.40 萬</span> | 631.07 萬<br><span style="color:red">▼ -36.00 萬</span> | 799.35 萬<br><span style="color:red">▼ -45.60 萬</span> | 1266.05 萬<br><span style="color:red">▼ -97.50 萬</span> |
| R4 史詩 | 86.74 萬<br><span style="color:red">▼ -3.60 萬</span> | 144.56 萬<br><span style="color:red">▼ -6.00 萬</span> | 202.39 萬<br><span style="color:red">▼ -8.40 萬</span> | 289.13 萬<br><span style="color:red">▼ -12.00 萬</span> | 404.78 萬<br><span style="color:red">▼ -16.80 萬</span> | 520.43 萬<br><span style="color:red">▼ -21.60 萬</span> | 636.08 萬<br><span style="color:red">▼ -26.40 萬</span> | 867.38 萬<br><span style="color:red">▼ -36.00 萬</span> | 1098.68 萬<br><span style="color:red">▼ -45.60 萬</span> | 1716.90 萬<br><span style="color:red">▼ -97.50 萬</span> |
| R5 傳說 | 106.44 萬<br><span style="color:red">▼ -3.60 萬</span> | 177.39 萬<br><span style="color:red">▼ -6.00 萬</span> | 248.35 萬<br><span style="color:red">▼ -8.40 萬</span> | 354.78 萬<br><span style="color:red">▼ -12.00 萬</span> | 496.70 萬<br><span style="color:red">▼ -16.80 萬</span> | 638.61 萬<br><span style="color:red">▼ -21.60 萬</span> | 780.52 萬<br><span style="color:red">▼ -26.40 萬</span> | 1064.35 萬<br><span style="color:red">▼ -36.00 萬</span> | 1348.18 萬<br><span style="color:red">▼ -45.60 萬</span> | 2092.71 萬<br><span style="color:red">▼ -97.50 萬</span> |
| R6 神話 | 135.97 萬<br><span style="color:red">▼ -3.60 萬</span> | 226.63 萬<br><span style="color:red">▼ -6.00 萬</span> | 317.27 萬<br><span style="color:red">▼ -8.40 萬</span> | 453.25 萬<br><span style="color:red">▼ -12.00 萬</span> | 634.55 萬<br><span style="color:red">▼ -16.80 萬</span> | 815.85 萬<br><span style="color:red">▼ -21.60 萬</span> | 997.15 萬<br><span style="color:red">▼ -26.40 萬</span> | 1359.75 萬<br><span style="color:red">▼ -36.00 萬</span> | 1722.35 萬<br><span style="color:red">▼ -45.60 萬</span> | 2656.30 萬<br><span style="color:red">▼ -97.50 萬</span> |
| R7 創世 | 165.52 萬<br><span style="color:red">▼ -3.60 萬</span> | 275.86 萬<br><span style="color:red">▼ -6.00 萬</span> | 386.20 萬<br><span style="color:red">▼ -8.40 萬</span> | 551.72 萬<br><span style="color:red">▼ -12.00 萬</span> | 772.40 萬<br><span style="color:red">▼ -16.80 萬</span> | 993.09 萬<br><span style="color:red">▼ -21.60 萬</span> | 1213.78 萬<br><span style="color:red">▼ -26.40 萬</span> | 1655.15 萬<br><span style="color:red">▼ -36.00 萬</span> | 2096.52 萬<br><span style="color:red">▼ -45.60 萬</span> | 3219.89 萬<br><span style="color:red">▼ -97.50 萬</span> |
| R8 神鑄神話 | 195.05 萬<br><span style="color:red">▼ -3.60 萬</span> | 325.09 萬<br><span style="color:red">▼ -6.00 萬</span> | 455.13 萬<br><span style="color:red">▼ -8.40 萬</span> | 650.18 萬<br><span style="color:red">▼ -12.00 萬</span> | 910.26 萬<br><span style="color:red">▼ -16.80 萬</span> | 1170.33 萬<br><span style="color:red">▼ -21.60 萬</span> | 1430.40 萬<br><span style="color:red">▼ -26.40 萬</span> | 1950.55 萬<br><span style="color:red">▼ -36.00 萬</span> | 2470.70 萬<br><span style="color:red">▼ -45.60 萬</span> | 3783.48 萬<br><span style="color:red">▼ -97.50 萬</span> |
| R9 神鑄創世 | 244.29 萬<br><span style="color:red">▼ -3.60 萬</span> | 407.14 萬<br><span style="color:red">▼ -6.00 萬</span> | 570.00 萬<br><span style="color:red">▼ -8.40 萬</span> | 814.29 萬<br><span style="color:red">▼ -12.00 萬</span> | 1140.01 萬<br><span style="color:red">▼ -16.80 萬</span> | 1465.72 萬<br><span style="color:red">▼ -21.60 萬</span> | 1791.44 萬<br><span style="color:red">▼ -26.40 萬</span> | 2442.87 萬<br><span style="color:red">▼ -36.00 萬</span> | 3094.30 萬<br><span style="color:red">▼ -45.60 萬</span> | 4722.76 萬<br><span style="color:red">▼ -97.50 萬</span> |
| R10 混沌 | 323.06 萬<br><span style="color:red">▼ -3.60 萬</span> | 538.43 萬<br><span style="color:red">▼ -6.00 萬</span> | 753.80 萬<br><span style="color:red">▼ -8.40 萬</span> | 1076.86 萬<br><span style="color:red">▼ -12.00 萬</span> | 1507.61 萬<br><span style="color:red">▼ -16.80 萬</span> | 1938.35 萬<br><span style="color:red">▼ -21.60 萬</span> | 2369.10 萬<br><span style="color:red">▼ -26.40 萬</span> | 3230.59 萬<br><span style="color:red">▼ -36.00 萬</span> | 4092.08 萬<br><span style="color:red">▼ -45.60 萬</span> | 6225.63 萬<br><span style="color:red">▼ -97.50 萬</span> |
| R11 神鑄混沌 | 460.91 萬<br><span style="color:red">▼ -3.60 萬</span> | 768.18 萬<br><span style="color:red">▼ -6.00 萬</span> | 1075.46 萬<br><span style="color:red">▼ -8.40 萬</span> | 1536.37 萬<br><span style="color:red">▼ -12.00 萬</span> | 2150.92 萬<br><span style="color:red">▼ -16.80 萬</span> | 2765.46 萬<br><span style="color:red">▼ -21.60 萬</span> | 3380.01 萬<br><span style="color:red">▼ -26.40 萬</span> | 4609.11 萬<br><span style="color:red">▼ -36.00 萬</span> | 5838.20 萬<br><span style="color:red">▼ -45.60 萬</span> | 8855.67 萬<br><span style="color:red">▼ -97.50 萬</span> |

### 3.3 四維主屬性（力量 Str）極大值分佈與差異
> **說明**：天堂威能 1轉提供【力量淬鍊】（+25%），10轉額外疊加【力量超昇】（+62.5%），合計提供高達 +87.5% 的獨立主屬性增幅。敏捷、智力、體質享有完全相同之威能節點加成。

| 裝備階級 | 1轉 | 2轉 | 3轉 | 4轉 | 5轉 | 6轉 | 7轉 | 8轉 | 9轉 | 10轉 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| R0 普通 | 3.23 萬 | 5.38 萬 | 7.53 萬 | 10.75 萬 | 15.05 萬 | 19.35 萬 | 23.66 萬 | 32.26 萬 | 40.86 萬 | 80.64 萬 |
| R1 精良 | 4.65 萬 | 7.75 萬 | 10.85 萬 | 15.50 萬 | 21.70 萬 | 27.91 萬 | 34.11 萬 | 46.51 萬 | 58.91 萬 | 116.27 萬 |
| R2 稀有 | 6.08 萬 | 10.13 萬 | 14.18 萬 | 20.25 萬 | 28.35 萬 | 36.46 萬 | 44.56 萬 | 60.76 萬 | 76.96 萬 | 151.90 萬 |
| R3 獨特 | 8.36 萬 | 13.93 萬 | 19.50 萬 | 27.85 萬 | 39.00 萬 | 50.14 萬 | 61.28 萬 | 83.56 萬 | 105.85 萬 | 208.90 萬 |
| R4 史詩 | 11.78 萬 | 19.63 萬 | 27.48 萬 | 39.25 萬 | 54.96 萬 | 70.66 萬 | 86.36 萬 | 117.76 萬 | 149.17 萬 | 294.41 萬 |
| R5 傳說 | 14.63 萬 | 24.38 萬 | 34.13 萬 | 48.76 萬 | 68.26 萬 | 87.76 萬 | 107.26 萬 | 146.27 萬 | 185.27 萬 | 365.67 萬 |
| R6 神話 | 18.90 萬 | 31.50 萬 | 44.10 萬 | 63.01 萬 | 88.21 萬 | 113.41 萬 | 138.61 萬 | 189.02 萬 | 239.42 萬 | 472.55 萬 |
| R7 創世 | 23.18 萬 | 38.63 萬 | 54.08 萬 | 77.26 萬 | 108.16 萬 | 139.06 萬 | 169.97 萬 | 231.77 萬 | 293.58 萬 | 579.43 萬 |
| R8 神鑄神話 | 27.45 萬 | 45.75 萬 | 64.06 萬 | 91.51 萬 | 128.11 萬 | 164.72 萬 | 201.32 萬 | 274.53 萬 | 347.73 萬 | 686.31 萬 |
| R9 神鑄創世 | 34.58 萬 | 57.63 萬 | 80.68 萬 | 115.26 萬 | 161.36 萬 | 207.47 萬 | 253.57 萬 | 345.78 萬 | 437.99 萬 | 864.45 萬 |
| R10 混沌 | 45.98 萬 | 76.63 萬 | 107.28 萬 | 153.26 萬 | 214.57 萬 | 275.87 萬 | 337.18 萬 | 459.79 萬 | 582.40 萬 | 1149.47 萬 |
| R11 神鑄混沌 | 65.93 萬 | 109.88 萬 | 153.84 萬 | 219.77 萬 | 307.68 萬 | 395.58 萬 | 483.49 萬 | 659.30 萬 | 835.12 萬 | 1648.26 萬 |

### 3.4 物理防禦 (Def) 極大值分佈與差異（1轉至 10轉）
| 裝備階級 | 1轉 | 2轉 | 3轉 | 4轉 | 5轉 | 6轉 | 7轉 | 8轉 | 9轉 | 10轉 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| R0 普通 | 9.63 萬 | 15.55 萬 | 33.81 萬 | 60.09 萬 | 110.86 萬 | 208.81 萬 | 401.10 萬 | 785.69 萬 | 1547.67 萬 | 4340.13 萬 |
| R1 精良 | 140.12 萬 | 226.99 萬 | 484.52 萬 | 845.19 萬 | 1530.10 萬 | 2827.09 萬 | 5348.23 萬 | 1.04 億 | 2.03 億 | 5.45 億 |
| R2 稀有 | 215.92 萬 | 350.11 萬 | 743.70 萬 | 1290.64 萬 | 2324.19 萬 | 4270.62 萬 | 8042.80 萬 | 1.56 億 | 3.04 億 | 7.88 億 |
| R3 獨特 | 491.35 萬 | 802.82 萬 | 1636.88 萬 | 2714.98 萬 | 4654.57 萬 | 8100.52 萬 | 1.46 億 | 2.75 億 | 5.24 億 | 12.94 億 |
| R4 史詩 | 1041.61 萬 | 1707.65 萬 | 3417.54 萬 | 5545.67 萬 | 9267.82 萬 | 1.56 億 | 2.73 億 | 5.07 億 | 9.53 億 | 22.50 億 |
| R5 傳說 | 1566.95 萬 | 2570.46 萬 | 5127.16 萬 | 8286.47 萬 | 1.38 億 | 2.31 億 | 4.02 億 | 7.42 億 | 13.91 億 | 32.08 億 |
| R6 神話 | 2553.46 萬 | 4191.24 萬 | 8332.65 萬 | 1.34 億 | 2.22 億 | 3.70 億 | 6.39 億 | 11.77 億 | 21.99 億 | 49.45 億 |
| R7 創世 | 3779.85 萬 | 6206.61 萬 | 1.23 億 | 1.98 億 | 3.26 億 | 5.42 億 | 9.32 億 | 17.12 億 | 31.89 億 | 70.45 億 |
| R8 神鑄神話 | 5244.97 萬 | 8614.72 萬 | 1.71 億 | 2.73 億 | 4.50 億 | 7.46 億 | 12.79 億 | 23.44 億 | 43.60 億 | 95.08 億 |
| R9 神鑄創世 | 8219.18 萬 | 1.35 億 | 2.67 億 | 4.27 億 | 7.01 億 | 11.57 億 | 19.78 億 | 36.19 億 | 67.17 億 | 144.18 億 |
| R10 混沌 | 1.44 億 | 2.36 億 | 4.66 億 | 7.43 億 | 12.17 億 | 20.03 億 | 34.12 億 | 62.29 億 | 115.39 億 | 243.69 億 |
| R11 神鑄混沌 | 2.92 億 | 4.80 億 | 9.46 億 | 15.07 億 | 24.61 億 | 40.37 億 | 68.53 億 | 124.87 億 | 230.86 億 | 479.83 億 |

### 3.5 各類減傷極大值與對應屬性數值對照表（以 10轉 頂峰為基準，對戰 Lv.650 敵人）
| 裝備階級 | 物理防禦減傷 (物防值) | 魔法防禦減傷 (魔防值) | 物理抗性減傷 (物抗值) | 魔法抗性減傷 (魔抗值) | 元素抗性減傷 (全抗值) | 全局減傷 (減傷值) | BOSS減傷 (BOSS減傷值) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| R0 普通 | 99.997696%<br><span style="color:blue">▲ +0.170204%</span><br>(4340.13 萬) | 99.997692%<br><span style="color:blue">▲ +0.170503%</span><br>(4332.50 萬) | 95.626524%<br><span style="color:gray">持平</span><br>(1.57 萬) | 95.626524%<br><span style="color:gray">持平</span><br>(1.57 萬) | 95.263767%<br><span style="color:gray">持平</span><br>(1.48 萬) | 78.661659%<br><span style="color:red">▼ -9.394905%</span><br>(1.84 萬) | 87.433425%<br><span style="color:red">▼ -9.130014%</span><br>(4.17 萬) |
| R1 精良 | 99.999816%<br><span style="color:blue">▲ +0.013587%</span><br>(5.45 億) | 99.999815%<br><span style="color:blue">▲ +0.013702%</span><br>(5.40 億) | 96.821540%<br><span style="color:gray">持平</span><br>(1.99 萬) | 96.821540%<br><span style="color:gray">持平</span><br>(1.99 萬) | 96.062036%<br><span style="color:gray">持平</span><br>(1.70 萬) | 84.685126%<br><span style="color:red">▼ -7.022450%</span><br>(2.76 萬) | 92.322783%<br><span style="color:red">▼ -5.699041%</span><br>(6.26 萬) |
| R2 稀有 | 99.999873%<br><span style="color:blue">▲ +0.009387%</span><br>(7.88 億) | 99.999872%<br><span style="color:blue">▲ +0.009477%</span><br>(7.81 億) | 97.550564%<br><span style="color:gray">持平</span><br>(2.41 萬) | 97.550564%<br><span style="color:gray">持平</span><br>(2.41 萬) | 96.655114%<br><span style="color:gray">持平</span><br>(1.92 萬) | 88.056564%<br><span style="color:red">▼ -5.592455%</span><br>(3.69 萬) | 94.659801%<br><span style="color:red">▼ -4.008497%</span><br>(8.35 萬) |
| R3 獨特 | 99.999923%<br><span style="color:blue">▲ +0.005716%</span><br>(12.94 億) | 99.999922%<br><span style="color:blue">▲ +0.005778%</span><br>(12.81 億) | 98.251541%<br><span style="color:gray">持平</span><br>(3.08 萬) | 98.251541%<br><span style="color:gray">持平</span><br>(3.08 萬) | 97.336260%<br><span style="color:gray">持平</span><br>(2.27 萬) | 91.167014%<br><span style="color:red">▼ -4.212426%</span><br>(5.16 萬) | 96.541072%<br><span style="color:red">▼ -2.623053%</span><br>(11.68 萬) |
| R4 史詩 | 99.999956%<br><span style="color:blue">▲ +0.003289%</span><br>(22.50 億) | 99.999954%<br><span style="color:blue">▲ +0.003390%</span><br>(21.83 億) | 98.816675%<br><span style="color:gray">持平</span><br>(4.09 萬) | 98.816675%<br><span style="color:gray">持平</span><br>(4.09 萬) | 97.996503%<br><span style="color:gray">持平</span><br>(2.79 萬) | 93.647567%<br><span style="color:red">▼ -3.072024%</span><br>(7.37 萬) | 97.834082%<br><span style="color:red">▼ -1.656865%</span><br>(16.69 萬) |
| R5 傳說 | 99.999969%<br><span style="color:blue">▲ +0.002307%</span><br>(32.08 億) | 99.999968%<br><span style="color:blue">▲ +0.002383%</span><br>(31.05 億) | 99.086519%<br><span style="color:gray">持平</span><br>(4.93 萬) | 99.086519%<br><span style="color:gray">持平</span><br>(4.93 萬) | 98.359680%<br><span style="color:gray">持平</span><br>(3.23 萬) | 94.852896%<br><span style="color:red">▼ -2.505571%</span><br>(9.21 萬) | 98.388169%<br><span style="color:red">▼ -1.238802%</span><br>(20.86 萬) |
| R6 神話 | 99.999980%<br><span style="color:blue">▲ +0.001497%</span><br>(49.45 億) | 99.999979%<br><span style="color:blue">▲ +0.001550%</span><br>(47.73 億) | 99.334113%<br><span style="color:gray">持平</span><br>(6.19 萬) | 99.334113%<br><span style="color:gray">持平</span><br>(6.19 萬) | 98.729226%<br><span style="color:gray">持平</span><br>(3.89 萬) | 95.992691%<br><span style="color:red">▼ -1.962688%</span><br>(11.98 萬) | 98.863439%<br><span style="color:red">▼ -0.877902%</span><br>(27.12 萬) |
| R7 創世 | 99.999986%<br><span style="color:blue">▲ +0.001050%</span><br>(70.45 億) | 99.999985%<br><span style="color:blue">▲ +0.001090%</span><br>(67.87 億) | 99.485476%<br><span style="color:gray">持平</span><br>(7.45 萬) | 99.485476%<br><span style="color:gray">持平</span><br>(7.45 萬) | 98.976030%<br><span style="color:gray">持平</span><br>(4.54 萬) | 96.719591%<br><span style="color:red">▼ -1.612853%</span><br>(14.74 萬) | 99.138810%<br><span style="color:red">▼ -0.667635%</span><br>(33.38 萬) |
| R8 神鑄神話 | 99.999989%<br><span style="color:blue">▲ +0.000778%</span><br>(95.08 億) | 99.999989%<br><span style="color:blue">▲ +0.000809%</span><br>(91.46 億) | 99.586159%<br><span style="color:gray">持平</span><br>(8.72 萬) | 99.586159%<br><span style="color:gray">持平</span><br>(8.72 萬) | 99.150852%<br><span style="color:gray">持平</span><br>(5.20 萬) | 97.223271%<br><span style="color:red">▼ -1.368817%</span><br>(17.51 萬) | 99.315909%<br><span style="color:red">▼ -0.531863%</span><br>(39.64 萬) |
| R9 神鑄創世 | 99.999993%<br><span style="color:blue">▲ +0.000513%</span><br>(144.18 億) | 99.999993%<br><span style="color:blue">▲ +0.000535%</span><br>(138.43 億) | 99.693833%<br><span style="color:gray">持平</span><br>(10.82 萬) | 99.693833%<br><span style="color:gray">持平</span><br>(10.82 萬) | 99.348756%<br><span style="color:gray">持平</span><br>(6.29 萬) | 97.788883%<br><span style="color:red">▼ -1.093200%</span><br>(22.11 萬) | 99.500012%<br><span style="color:red">▼ -0.390177%</span><br>(50.07 萬) |
| R10 混沌 | 99.999996%<br><span style="color:blue">▲ +0.000304%</span><br>(243.69 億) | 99.999996%<br><span style="color:blue">▲ +0.000317%</span><br>(233.54 億) | 99.790201%<br><span style="color:gray">持平</span><br>(14.18 萬) | 99.790201%<br><span style="color:gray">持平</span><br>(14.18 萬) | 99.537250%<br><span style="color:gray">持平</span><br>(8.04 萬) | 98.332444%<br><span style="color:red">▼ -0.826768%</span><br>(29.48 萬) | 99.660366%<br><span style="color:red">▼ -0.266197%</span><br>(66.76 萬) |
| R11 神鑄混沌 | 99.999998%<br><span style="color:blue">▲ +0.000154%</span><br>(479.83 億) | 99.999998%<br><span style="color:blue">▲ +0.000161%</span><br>(458.97 億) | 99.870850%<br><span style="color:gray">持平</span><br>(20.07 萬) | 99.870850%<br><span style="color:gray">持平</span><br>(20.07 萬) | 99.704966%<br><span style="color:gray">持平</span><br>(11.11 萬) | 98.834031%<br><span style="color:red">▼ -0.579566%</span><br>(42.38 萬) | 99.791641%<br><span style="color:red">▼ -0.164163%</span><br>(95.97 萬) |


---

## 四、核心案例深度對照解析：以「R11 神鑄混沌」為例

對照情境二 10轉巔峰 **R11 神鑄混沌** 核心數值與減傷機制演進：

### 4.1 物理防禦減傷演進
- **角色的物理防禦值 (Def)**：
  - 數值：`26,532,926,686` (265.33 億)
  - **屬性變更**：<span style="color:gray">持平（未變動）</span>
- **物理防禦減傷率**：
  - 舊版 V1 公式（常數 75,000）：$r_{\text{Def}} = \frac{265.33\text{億}}{265.33\text{億} + 75,000} = \mathbf{99.999717\%}$
  - 現行最新公式（等級差常數觸及下限 1,000）：$r_{\text{Def}} = \frac{265.33\text{億}}{265.33\text{億} + 1,000} = \mathbf{99.999996\%}$
  - **減傷率差異**：**<span style="color:blue">▲ +0.000279%</span>**
- **殘留穿透率變化**：
  - 舊版 V1 殘留承傷率：`0.000283%`（**2.83 ppm**）
  - 現行最新殘留承傷率：`0.000004%`（**0.038 ppm**）
  - **防禦穿透殘留傷害被進一步壓縮了整整 75 倍！**

### 4.2 該狀態下全減傷維度差異總表
| 減傷類型 | 舊版基準 (V1) | 現行最新版 (V2/V3) | 數值差異 (現行 - 舊版) | 對應底層數值 | 殘留承傷率 (1 - r) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **物理防禦** | 99.999717% | 99.999996% | **<span style="color:blue">▲ +0.000279%</span>** | 265.33 億 | 0.000004% (0.038 ppm) |
| **魔法防禦** | 99.999710% | 99.999996% | **<span style="color:blue">▲ +0.000286%</span>** | 258.48 億 | 0.000004% (0.039 ppm) |
| **物理抗性** | 99.712152% | 99.712152% | <span style="color:gray">持平 (0.000000%)</span> | 11.31 萬 | 0.287848% |
| **魔法抗性** | 99.712152% | 99.712152% | <span style="color:gray">持平 (0.000000%)</span> | 11.31 萬 | 0.287848% |
| **元素全抗** | 99.184881% | 99.184881% | <span style="color:gray">持平 (0.000000%)</span> | 5.35 萬 | 0.815119% |
| **全局減傷** | 98.834031% | 97.694939% | **<span style="color:red">▼ -1.139092%</span>** | 21.19 萬 | 2.305061% |
| **BOSS減傷** | 99.840786% | 99.285828% | **<span style="color:red">▼ -0.554958%</span>** | 38.39 萬 | 0.714172% |
| **四維主屬性** | 879.07 萬 | 879.07 萬 | <span style="color:gray">持平 (0 點)</span> | 879.07 萬 | 派生攻防血量基底 |
| **生命值** | 740.74 億 | 741.28 億 | **<span style="color:blue">▲ +5361.22 萬</span>** | - | - |
| **法力值** | 7302.32 萬 | 7242.32 萬 | **<span style="color:red">▼ -60.00 萬</span>** | - | - |

---

## 五、實戰多層獨立減傷疊乘穿透試算（對戰 Lv.650 永恒神域 BOSS）

以情境三（10轉 R11 神鑄混沌 + 滿寶石 + 滿威能）面對 Lv.650 永恒神域 BOSS 攻擊為例：

### 5.1 各層減傷之精確殘留穿透率 ($1 - r$)
| 減傷屏障層 | 舊版基準 (V1) 殘留率 | 現行最新版 殘留率 | 變化說明 |
| :--- | :--- | :--- | :--- |
| **物理防禦** | $1.563 \times 10^{-6}$ (1.56 ppm) | **$2.084 \times 10^{-8}$ (0.021 ppm)** | **<span style="color:blue">穿透率大幅縮小 75 倍 ▲</span>** |
| **物理抗性** | $1.292 \times 10^{-3}$ | **$1.292 \times 10^{-3}$** | <span style="color:gray">持平</span> |
| **全局減傷** | $5.864 \times 10^{-3}$ | **$1.166 \times 10^{-2}$** | **<span style="color:red">穿透率微幅放大 1.99 倍 ▼</span>** |
| **BOSS減傷** | $4.420 \times 10^{-4}$ | **$2.084 \times 10^{-3}$** | **<span style="color:red">穿透率微幅放大 4.71 倍 ▼</span>** |

### 5.2 四層獨立乘算後的總承傷率
- **舊版 (V1) 總穿透率**：
  $$\text{TotalPen}_{\text{V1}} \approx 5.228 \times 10^{-15}$$
- **現行最新版 總穿透率**：
  $$\begin{aligned}
  \text{TotalPen}_{\text{最新}} &= (2.084 \times 10^{-8}) \times (1.292 \times 10^{-3}) \times (1.166 \times 10^{-2}) \times (2.084 \times 10^{-3}) \\
  &\approx 6.541 \times 10^{-16}
  \end{aligned}$$
- **總承傷綜合結論**：  
  雖然全局減傷與 BOSS 減傷的分母基數上調導致這兩層減傷率微降，但由於**防禦減傷改為等級差機制後，滿級角色碾壓怪物使防禦分母直接縮小 75 倍**，整體四層連乘後的總穿透率反而**由 $5.23 \times 10^{-15}$ 進一步縮小至 $6.54 \times 10^{-16}$（防禦屏障強度整體提升約 8 倍）**！

### 5.3 實戰 BOSS 攻擊穿透試算對比
| 敵方原始攻擊傷害 | 舊版實質殘留傷害 | 現行最新版實質殘留傷害 | 遊戲最終結算對比 |
| :--- | :--- | :--- | :--- |
| **100 萬** ($10^6$) | $5.23 \times 10^{-9}$ 點 | **$6.54 \times 10^{-10}$ 點** | **1 點 vs 1 點**（系統最低保底） |
| **1 億** ($10^8$) | $5.23 \times 10^{-7}$ 點 | **$6.54 \times 10^{-8}$ 點** | **1 點 vs 1 點**（系統最低保底） |
| **1 兆** ($10^{12}$) | $0.00523$ 點 | **$0.00065$ 點** | **1 點 vs 1 點**（系統最低保底） |
| **100 兆** ($10^{14}$) | $0.523$ 點 | **$0.0654$ 點** | **1 點 vs 1 點**（系統最低保底） |
| **10,000 兆** ($10^{16}$) | $52.28$ 點 | **$6.54$ 點** | **52 點 vs 7 點** (穿透傷害下降 **<span style="color:blue">87.5%</span>**) |

在面對高達 **10,000 兆** 的天花板級毀滅傷害時，舊版受到 52 點傷害，現行版本僅受到 7 點傷害。而玩家生命值更從 1225.50 億微增至 **1226.70 億**，生存體系變得更加固若金湯。
