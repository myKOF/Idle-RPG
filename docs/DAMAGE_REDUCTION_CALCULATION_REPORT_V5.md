# Damage Reduction Calculation Report V5 (2026-11-10 18:25:00)

> **報告版本**：V5（轉生定值底數修正與防禦常數擴大對照總表）  
> **基準對照組**：第四版報告 [`docs/DAMAGE_REDUCTION_CALCULATION_REPORT_V4.md`](file:///d:/MyGame/Idle-RPG/antigravity/docs/DAMAGE_REDUCTION_CALCULATION_REPORT_V4.md) 與第三版報告 [`docs/DAMAGE_REDUCTION_CALCULATION_REPORT_V3.md`](file:///d:/MyGame/Idle-RPG/antigravity/docs/DAMAGE_REDUCTION_CALCULATION_REPORT_V3.md)  
> **計算基準設定**：
> - **裝備等級**：**Lv.600**（全套 13 部位，詞條全太古滿 roll，品質係數覆蓋 R0～R11）。
> - **受測對象等級**：**Lv.650**（對標永恒神殿 Stage 600 地圖怪與 BOSS 標準等級，含魔物威能滿級加成）。
> - **角色狀態**：Lv.1000 滿級角色，轉生覆蓋 1轉至 10轉。
> - **視覺標示規範**：
>   - 數值與減傷率**上升**以 **<span style="color:blue">藍色（▲ +數值）</span>** 標示。
>   - 數值與減傷率**下降**以 **<span style="color:red">紅色（▼ -數值）</span>** 標示。
>   - 數值維持不變以 **<span style="color:gray">持平</span>** 標示。
>   - 各類減傷率精確列出至小數點後 6 位，並在每格標註對應之**底層屬性數值**。
>   - 本 V5 版本完整納入最新 Commit `2cc24876`「減傷平衡」之核心改動。

---

## 本次公式更新與平衡參數重大異動對照

本次平衡更新（Commit `2cc24876`「減傷平衡」）重點解決了前版中「轉生指數暴衝（1轉到10轉定值放大 512 倍）」與「頂級減傷過度飽和」的問題，進行了以下深度調整：

| 調整項目 | 前版 (V4) 公式與參數 | 現行最新版 (V5) 公式與參數 | 變動方向與機制影響 |
| :--- | :--- | :--- | :--- |
| **轉生定值強化指數底數** | $c = 2$（定值強化 $= 0.5 \\times 2^n$）<br>10轉定值加成係數為 $\\mathbf{512}$ 倍 | $c = \\mathbf{1.5}$（定值強化 $= 0.5 \\times 1.5^n$）<br>10轉定值加成係數為 $\\mathbf{28.83}$ 倍 | **<span style="color:red">數值理性收斂 ▼</span>**<br>轉生定值強化底數下修，10轉定值加成倍率從 513 縮減至 29.83（減少 94.2%）。10轉/1轉總防禦增幅由 **87 倍暴衝** 收斂至平滑健康的 **7.12 倍**！ |
| **防禦減傷率分母常數** | $a = 50,000, b = 100, c = 1,000$<br>等級差 -350 時常數為 $15,000$ | $a = \\mathbf{100,000}, b = 100, c = 1,000$<br>等級差 -350 時常數為 $\\mathbf{65,000}$ | **<span style="color:red">防禦穿透擴大 ▼</span>**<br>分母常數相較 V4 的 15,000 **擴大 4.33 倍**（相較 V3 的 1,000 擴大 65 倍）！使防禦穿透殘留承傷率由 0.643 ppm 提升至 35.54 ppm，確立真實受擊打擊感。 |
| **物理總防禦整體規模** | 10轉 R11 純裝備 105.55 億<br>10轉 R11 滿威能 233.38 億 | 10轉 R11 純裝備 **8.29 億**<br>10轉 R11 滿威能 **18.29 億** | **<span style="color:red">防禦整體下修 92% ▼</span>**<br>物防與魔防告別百億虛高膨脹，回歸到數億至十億級的健康合理數值水準。 |
| **永恒神殿 650 級 BOSS 傷害對標** | 示意對標階梯（以 $10^{16}$ 萬兆為頂點） | 嚴格納入永恒神殿真實原始攻擊力：<br>小怪普攻 $1.29 \\times 10^{16}$、BOSS普攻 $5.18 \\times 10^{16}$、暴擊 $1.55 \\times 10^{17}$、技能爆發 $2.59 \\times 10^{17}$ | **<span style="color:blue">真實對標實裝 ▲</span>**<br>實測證實 650 級 BOSS 普攻即達 5.18 萬兆、爆發達 25.9 萬兆，打在滿配玩家身上實質扣血 **5.8 萬 ～ 28.9 萬**，完美擺脫 1 點強制保底。 |
| **生命與法力上限** | hpFlat/hpPct 與 mpFlat 維持 V4 平衡值 | 維持現行 V4 最新數值 | **<span style="color:gray">持平</span>** |
| **四維主屬性矩陣** | 力量成長維持 V4 平衡值 | 維持現行 V4 最新數值 | **<span style="color:gray">持平</span>** |

---

## 一、情境一：純太古裝備（Lv.600，無寶石、無威能）

### 1.1 生命值 (HP) 極大值分佈
| 裝備階級 | 1轉 | 2轉 | 3轉 | 4轉 | 5轉 | 6轉 | 7轉 | 8轉 | 9轉 | 10轉 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| R0 普通 | 33.81 萬 | 56.35 萬 | 78.89 萬 | 112.70 萬 | 157.78 萬 | 202.86 萬 | 247.94 萬 | 338.10 萬 | 428.25 萬 | 563.49 萬 |
| R1 精良 | 353.13 萬 | 588.56 萬 | 823.98 萬 | 1177.11 萬 | 1647.96 萬 | 2118.80 萬 | 2589.65 萬 | 3531.34 萬 | 4473.03 萬 | 5885.56 萬 |
| R2 稀有 | 587.33 萬 | 978.89 萬 | 1370.45 萬 | 1957.78 萬 | 2740.90 萬 | 3524.01 萬 | 4307.12 萬 | 5873.35 萬 | 7439.58 萬 | 9788.92 萬 |
| R3 獨特 | 1339.84 萬 | 2233.06 萬 | 3126.29 萬 | 4466.13 萬 | 6252.58 萬 | 8039.03 萬 | 9825.48 萬 | 1.34 億 | 1.70 億 | 2.23 億 |
| R4 史詩 | 2624.11 萬 | 4373.52 萬 | 6122.93 萬 | 8747.04 萬 | 1.22 億 | 1.57 億 | 1.92 億 | 2.62 億 | 3.32 億 | 4.37 億 |
| R5 傳說 | 4020.97 萬 | 6701.62 萬 | 9382.26 萬 | 1.34 億 | 1.88 億 | 2.41 億 | 2.95 億 | 4.02 億 | 5.09 億 | 6.70 億 |
| R6 神話 | 6673.02 萬 | 1.11 億 | 1.56 億 | 2.22 億 | 3.11 億 | 4.00 億 | 4.89 億 | 6.67 億 | 8.45 億 | 11.12 億 |
| R7 創世 | 9993.18 萬 | 1.67 億 | 2.33 億 | 3.33 億 | 4.66 億 | 6.00 億 | 7.33 億 | 9.99 億 | 12.66 億 | 16.66 億 |
| R8 神鑄神話 | 1.40 億 | 2.33 億 | 3.26 億 | 4.66 億 | 6.52 億 | 8.39 億 | 10.25 億 | 13.98 億 | 17.71 億 | 23.30 億 |
| R9 神鑄創世 | 2.21 億 | 3.69 億 | 5.16 億 | 7.37 億 | 10.32 億 | 13.27 億 | 16.22 億 | 22.11 億 | 28.01 億 | 36.86 億 |
| R10 混沌 | 3.90 億 | 6.50 億 | 9.10 億 | 12.99 億 | 18.19 億 | 23.39 億 | 28.59 億 | 38.98 億 | 49.38 億 | 64.97 億 |
| R11 神鑄混沌 | 7.99 億 | 13.32 億 | 18.65 億 | 26.65 億 | 37.31 億 | 47.96 億 | 58.62 億 | 79.94 億 | 101.26 億 | 133.23 億 |

### 1.2 法力值 (MP) 極大值分佈
| 裝備階級 | 1轉 | 2轉 | 3轉 | 4轉 | 5轉 | 6轉 | 7轉 | 8轉 | 9轉 | 10轉 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| R0 普通 | 8.50 萬 | 14.17 萬 | 19.84 萬 | 28.35 萬 | 39.68 萬 | 51.02 萬 | 62.36 萬 | 85.04 萬 | 107.71 萬 | 141.73 萬 |
| R1 精良 | 13.76 萬 | 22.94 萬 | 32.11 萬 | 45.87 萬 | 64.22 萬 | 82.57 萬 | 100.92 萬 | 137.62 萬 | 174.32 萬 | 229.37 萬 |
| R2 稀有 | 18.14 萬 | 30.24 萬 | 42.34 萬 | 60.48 萬 | 84.67 萬 | 108.86 萬 | 133.06 萬 | 181.44 萬 | 229.82 萬 | 302.40 萬 |
| R3 獨特 | 33.01 萬 | 55.02 萬 | 77.03 萬 | 110.04 萬 | 154.06 萬 | 198.08 萬 | 242.10 萬 | 330.13 萬 | 418.16 萬 | 550.22 萬 |
| R4 史詩 | 46.90 萬 | 78.16 萬 | 109.43 萬 | 156.32 萬 | 218.85 萬 | 281.38 萬 | 343.91 萬 | 468.97 萬 | 594.03 萬 | 781.62 萬 |
| R5 傳說 | 58.47 萬 | 97.45 萬 | 136.43 萬 | 194.89 萬 | 272.85 萬 | 350.81 萬 | 428.76 萬 | 584.68 萬 | 740.59 萬 | 974.46 萬 |
| R6 神話 | 75.82 萬 | 126.37 萬 | 176.92 萬 | 252.74 萬 | 353.84 萬 | 454.94 萬 | 556.04 萬 | 758.23 萬 | 960.43 萬 | 1263.72 萬 |
| R7 創世 | 93.18 萬 | 155.30 萬 | 217.42 萬 | 310.60 萬 | 434.84 萬 | 559.07 萬 | 683.31 萬 | 931.79 萬 | 1180.27 萬 | 1552.98 萬 |
| R8 神鑄神話 | 110.53 萬 | 184.22 萬 | 257.91 萬 | 368.45 萬 | 515.83 萬 | 663.21 萬 | 810.59 萬 | 1105.35 萬 | 1400.11 萬 | 1842.24 萬 |
| R9 神鑄創世 | 139.46 萬 | 232.43 萬 | 325.41 萬 | 464.87 萬 | 650.82 萬 | 836.76 萬 | 1022.71 萬 | 1394.61 萬 | 1766.50 萬 | 2324.34 萬 |
| R10 混沌 | 185.74 萬 | 309.57 萬 | 433.40 萬 | 619.14 萬 | 866.80 萬 | 1114.45 萬 | 1362.11 萬 | 1857.42 萬 | 2352.74 萬 | 3095.70 萬 |
| R11 神鑄混沌 | 266.74 萬 | 444.56 萬 | 622.38 萬 | 889.12 萬 | 1244.76 萬 | 1600.41 萬 | 1956.06 萬 | 2667.35 萬 | 3378.64 萬 | 4445.58 萬 |

### 1.3 四維主屬性（力量 Str）極大值分佈
| 裝備階級 | 1轉 | 2轉 | 3轉 | 4轉 | 5轉 | 6轉 | 7轉 | 8轉 | 9轉 | 10轉 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| R0 普通 | 2.58 萬 | 4.30 萬 | 6.02 萬 | 8.60 萬 | 12.04 萬 | 15.48 萬 | 18.92 萬 | 25.81 萬 | 32.69 萬 | 43.01 萬 |
| R1 精良 | 3.72 萬 | 6.20 萬 | 8.68 萬 | 12.40 萬 | 17.36 萬 | 22.32 萬 | 27.29 萬 | 37.21 萬 | 47.13 萬 | 62.01 萬 |
| R2 稀有 | 4.86 萬 | 8.10 萬 | 11.34 萬 | 16.20 萬 | 22.68 萬 | 29.16 萬 | 35.65 萬 | 48.61 萬 | 61.57 萬 | 81.01 萬 |
| R3 獨特 | 6.68 萬 | 11.14 萬 | 15.60 萬 | 22.28 萬 | 31.20 萬 | 40.11 萬 | 49.02 萬 | 66.85 萬 | 84.68 萬 | 111.42 萬 |
| R4 史詩 | 9.42 萬 | 15.70 萬 | 21.98 萬 | 31.40 萬 | 43.97 萬 | 56.53 萬 | 69.09 萬 | 94.21 萬 | 119.33 萬 | 157.02 萬 |
| R5 傳說 | 11.70 萬 | 19.50 萬 | 27.30 萬 | 39.00 萬 | 54.61 萬 | 70.21 萬 | 85.81 萬 | 117.01 萬 | 148.22 萬 | 195.02 萬 |
| R6 神話 | 15.12 萬 | 25.20 萬 | 35.28 萬 | 50.41 萬 | 70.57 萬 | 90.73 萬 | 110.89 萬 | 151.22 萬 | 191.54 萬 | 252.03 萬 |
| R7 創世 | 18.54 萬 | 30.90 萬 | 43.26 萬 | 61.81 萬 | 86.53 萬 | 111.25 萬 | 135.97 萬 | 185.42 萬 | 234.86 萬 | 309.03 萬 |
| R8 神鑄神話 | 21.96 萬 | 36.60 萬 | 51.24 萬 | 73.21 萬 | 102.49 萬 | 131.77 萬 | 161.05 萬 | 219.62 萬 | 278.19 萬 | 366.03 萬 |
| R9 神鑄創世 | 27.66 萬 | 46.10 萬 | 64.55 萬 | 92.21 萬 | 129.09 萬 | 165.97 萬 | 202.86 萬 | 276.62 萬 | 350.39 萬 | 461.04 萬 |
| R10 混沌 | 36.78 萬 | 61.31 萬 | 85.83 萬 | 122.61 萬 | 171.65 萬 | 220.70 萬 | 269.74 萬 | 367.83 萬 | 465.92 萬 | 613.05 萬 |
| R11 神鑄混沌 | 52.74 萬 | 87.91 萬 | 123.07 萬 | 175.81 萬 | 246.14 萬 | 316.47 萬 | 386.79 萬 | 527.44 萬 | 668.09 萬 | 879.07 萬 |

### 1.4 物理防禦 (Def) 極大值分佈與差異（1轉至 10轉）
| 裝備階級 | 1轉 | 2轉 | 3轉 | 4轉 | 5轉 | 6轉 | 7轉 | 8轉 | 9轉 | 10轉 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| R0 普通 | 4.23 萬<br><span style="color:red">▼ -1,682</span> | 5.09 萬<br><span style="color:red">▼ -2.04 萬</span> | 6.08 萬<br><span style="color:red">▼ -4.37 萬</span> | 7.26 萬<br><span style="color:red">▼ -8.76 萬</span> | 8.73 萬<br><span style="color:red">▼ -16.27 萬</span> | 10.61 萬<br><span style="color:red">▼ -28.04 萬</span> | 13.14 萬<br><span style="color:red">▼ -48.53 萬</span> | 16.63 萬<br><span style="color:red">▼ -91.07 萬</span> | 21.55 萬<br><span style="color:red">▼ -169.61 萬</span> | 28.63 萬<br><span style="color:red">▼ -325.15 萬</span> |
| R1 精良 | 58.71 萬<br><span style="color:red">▼ -2.40 萬</span> | 70.70 萬<br><span style="color:red">▼ -28.36 萬</span> | 84.48 萬<br><span style="color:red">▼ -60.90 萬</span> | 100.95 萬<br><span style="color:red">▼ -122.27 萬</span> | 121.47 萬<br><span style="color:red">▼ -227.86 萬</span> | 148.04 萬<br><span style="color:red">▼ -394.35 萬</span> | 183.72 萬<br><span style="color:red">▼ -685.63 萬</span> | 233.03 萬<br><span style="color:red">▼ -1290.24 萬</span> | 302.81 萬<br><span style="color:red">▼ -2409.98 萬</span> | 403.29 萬<br><span style="color:red">▼ -4629.38 萬</span> |
| R2 稀有 | 100.10 萬<br><span style="color:red">▼ -4.14 萬</span> | 120.54 萬<br><span style="color:red">▼ -48.36 萬</span> | 144.07 萬<br><span style="color:red">▼ -103.98 萬</span> | 172.26 萬<br><span style="color:red">▼ -209.01 萬</span> | 207.43 萬<br><span style="color:red">▼ -390.09 萬</span> | 253.07 萬<br><span style="color:red">▼ -676.60 萬</span> | 314.42 萬<br><span style="color:red">▼ -1179.21 萬</span> | 399.32 萬<br><span style="color:red">▼ -2222.24 萬</span> | 519.55 萬<br><span style="color:red">▼ -4157.16 萬</span> | 692.79 萬<br><span style="color:red">▼ -7993.87 萬</span> |
| R3 獨特 | 189.14 萬<br><span style="color:red">▼ -7.91 萬</span> | 227.76 萬<br><span style="color:red">▼ -91.41 萬</span> | 272.31 萬<br><span style="color:red">▼ -196.72 萬</span> | 325.76 萬<br><span style="color:red">▼ -395.80 萬</span> | 392.55 萬<br><span style="color:red">▼ -739.69 萬</span> | 479.35 萬<br><span style="color:red">▼ -1285.50 萬</span> | 596.17 萬<br><span style="color:red">▼ -2245.16 萬</span> | 758.03 萬<br><span style="color:red">▼ -4236.25 萬</span> | 987.44 萬<br><span style="color:red">▼ -7935.24 萬</span> | 1318.18 萬<br><span style="color:red">▼ -1.53 億</span> |
| R4 史詩 | 375.38 萬<br><span style="color:red">▼ -15.82 萬</span> | 452.04 萬<br><span style="color:red">▼ -181.41 萬</span> | 540.56 萬<br><span style="color:red">▼ -390.76 萬</span> | 646.88 萬<br><span style="color:red">▼ -786.85 萬</span> | 779.89 萬<br><span style="color:red">▼ -1472.03 萬</span> | 952.94 萬<br><span style="color:red">▼ -2562.06 萬</span> | 1186.05 萬<br><span style="color:red">▼ -4481.83 萬</span> | 1509.25 萬<br><span style="color:red">▼ -8464.40 萬</span> | 1967.58 萬<br><span style="color:red">▼ -1.58 億</span> | 2628.62 萬<br><span style="color:red">▼ -3.06 億</span> |
| R5 傳說 | 578.84 萬<br><span style="color:red">▼ -24.49 萬</span> | 697.05 萬<br><span style="color:red">▼ -279.78 萬</span> | 833.64 萬<br><span style="color:red">▼ -602.85 萬</span> | 997.78 萬<br><span style="color:red">▼ -1214.36 萬</span> | 1203.25 萬<br><span style="color:red">▼ -2272.86 萬</span> | 1470.72 萬<br><span style="color:red">▼ -3958.66 萬</span> | 1831.19 萬<br><span style="color:red">▼ -6930.08 萬</span> | 2331.15 萬<br><span style="color:red">▼ -1.31 億</span> | 3040.35 萬<br><span style="color:red">▼ -2.46 億</span> | 4063.42 萬<br><span style="color:red">▼ -4.73 億</span> |
| R6 神話 | 966.33 萬<br><span style="color:red">▼ -41.03 萬</span> | 1163.70 萬<br><span style="color:red">▼ -467.07 萬</span> | 1391.84 萬<br><span style="color:red">▼ -1006.81 萬</span> | 1666.14 萬<br><span style="color:red">▼ -2028.81 萬</span> | 2009.69 萬<br><span style="color:red">▼ -3798.93 萬</span> | 2457.10 萬<br><span style="color:red">▼ -6621.00 萬</span> | 3060.31 萬<br><span style="color:red">▼ -1.16 億</span> | 3897.20 萬<br><span style="color:red">▼ -2.19 億</span> | 5084.64 萬<br><span style="color:red">▼ -4.11 億</span> | 6797.88 萬<br><span style="color:red">▼ -7.93 億</span> |
| R7 創世 | 1452.57 萬<br><span style="color:red">▼ -61.82 萬</span> | 1749.26 萬<br><span style="color:red">▼ -702.10 萬</span> | 2092.32 萬<br><span style="color:red">▼ -1513.80 萬</span> | 2504.91 萬<br><span style="color:red">▼ -3051.12 萬</span> | 3021.82 萬<br><span style="color:red">▼ -5714.80 萬</span> | 3695.20 萬<br><span style="color:red">▼ -1.00 億</span> | 4603.29 萬<br><span style="color:red">▼ -1.75 億</span> | 5863.43 萬<br><span style="color:red">▼ -3.30 億</span> | 7651.65 萬<br><span style="color:red">▼ -6.19 億</span> | 1.02 億<br><span style="color:red">▼ -11.95 億</span> |
| R8 神鑄神話 | 2037.54 萬<br><span style="color:red">▼ -86.84 萬</span> | 2453.73 萬<br><span style="color:red">▼ -984.88 萬</span> | 2935.05 萬<br><span style="color:red">▼ -2123.84 萬</span> | 3514.07 萬<br><span style="color:red">▼ -4281.28 萬</span> | 4239.63 萬<br><span style="color:red">▼ -8060.37 萬</span> | 5185.01 萬<br><span style="color:red">▼ -1.40 億</span> | 6460.11 萬<br><span style="color:red">▼ -2.45 億</span> | 8229.80 萬<br><span style="color:red">▼ -4.64 億</span> | 1.07 億<br><span style="color:red">▼ -8.71 億</span> | 1.44 億<br><span style="color:red">▼ -16.78 億</span> |
| R9 神鑄創世 | 3231.93 萬<br><span style="color:red">▼ -137.99 萬</span> | 3892.12 萬<br><span style="color:red">▼ -1562.24 萬</span> | 4655.79 萬<br><span style="color:red">▼ -3369.49 萬</span> | 5574.71 萬<br><span style="color:red">▼ -6825.29 萬</span> | 6726.48 萬<br><span style="color:red">▼ -1.28 億</span> | 8227.54 萬<br><span style="color:red">▼ -2.22 億</span> | 1.03 億<br><span style="color:red">▼ -3.89 億</span> | 1.31 億<br><span style="color:red">▼ -7.36 億</span> | 1.71 億<br><span style="color:red">▼ -13.83 億</span> | 2.28 億<br><span style="color:red">▼ -26.67 億</span> |
| R10 混沌 | 5713.49 萬<br><span style="color:red">▼ -244.34 萬</span> | 6880.62 萬<br><span style="color:red">▼ -2761.83 萬</span> | 8231.01 萬<br><span style="color:red">▼ -5968.99 萬</span> | 9856.28 萬<br><span style="color:red">▼ -1.20 億</span> | 1.19 億<br><span style="color:red">▼ -2.25 億</span> | 1.45 億<br><span style="color:red">▼ -3.93 億</span> | 1.81 億<br><span style="color:red">▼ -6.90 億</span> | 2.31 億<br><span style="color:red">▼ -13.04 億</span> | 3.02 億<br><span style="color:red">▼ -24.49 億</span> | 4.04 億<br><span style="color:red">▼ -47.22 億</span> |
| R11 神鑄混沌 | 1.17 億<br><span style="color:red">▼ -503.22 萬</span> | 1.41 億<br><span style="color:red">▼ -5713.54 萬</span> | 1.69 億<br><span style="color:red">▼ -1.23 億</span> | 2.02 億<br><span style="color:red">▼ -2.48 億</span> | 2.44 億<br><span style="color:red">▼ -4.64 億</span> | 2.98 億<br><span style="color:red">▼ -8.10 億</span> | 3.72 億<br><span style="color:red">▼ -14.20 億</span> | 4.74 億<br><span style="color:red">▼ -26.85 億</span> | 6.20 億<br><span style="color:red">▼ -50.43 億</span> | 8.29 億<br><span style="color:red">▼ -97.26 億</span> |

### 1.5 各類減傷極大值與對應屬性數值對照表（以 10轉 頂峰為基準，對戰 Lv.650 敵人）
| 裝備階級 | 物理防禦減傷 (物防值) | 魔法防禦減傷 (魔防值) | 物理抗性減傷 (物抗值) | 魔法抗性減傷 (魔抗值) | 元素抗性減傷 (全抗值) | 全局減傷 (減傷值) | BOSS減傷 (BOSS減傷值) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| R0 普通 | 81.495979%<br><span style="color:red">▼ 18.081819%</span><br>(28.63 萬) | 80.952660%<br><span style="color:red">▼ 18.609892%</span><br>(27.63 萬) | 99.961924%<br><span style="color:gray">持平</span><br>(4,804) | 99.961924%<br><span style="color:gray">持平</span><br>(4,804) | 99.885624%<br><span style="color:gray">持平</span><br>(2,189) | 64.822995%<br><span style="color:gray">持平</span><br>(9,214) | 66.965932%<br><span style="color:gray">持平</span><br>(1.67 萬) |
| R1 精良 | 98.413812%<br><span style="color:red">▼ 1.556392%</span><br>(403.29 萬) | 98.357227%<br><span style="color:red">▼ 1.611896%</span><br>(389.17 萬) | 99.978413%<br><span style="color:gray">持平</span><br>(7,206) | 99.978413%<br><span style="color:gray">持平</span><br>(7,206) | 99.935132%<br><span style="color:gray">持平</span><br>(3,283) | 73.433572%<br><span style="color:gray">持平</span><br>(1.38 萬) | 77.763203%<br><span style="color:gray">持平</span><br>(2.50 萬) |
| R2 稀有 | 99.070489%<br><span style="color:red">▼ 0.912247%</span><br>(692.79 萬) | 99.037100%<br><span style="color:red">▼ 0.945009%</span><br>(668.54 萬) | 99.985568%<br><span style="color:gray">持平</span><br>(9,609) | 99.985568%<br><span style="color:gray">持平</span><br>(9,609) | 99.956627%<br><span style="color:gray">持平</span><br>(4,377) | 78.657708%<br><span style="color:gray">持平</span><br>(1.84 萬) | 83.744792%<br><span style="color:gray">持平</span><br>(3.34 萬) |
| R3 獨特 | 99.509314%<br><span style="color:red">▼ 0.481651%</span><br>(1318.18 萬) | 99.491608%<br><span style="color:red">▼ 0.499029%</span><br>(1272.04 萬) | 99.990989%<br><span style="color:gray">持平</span><br>(1.35 萬) | 99.990989%<br><span style="color:gray">持平</span><br>(1.35 萬) | 99.972916%<br><span style="color:gray">持平</span><br>(6,128) | 83.765563%<br><span style="color:gray">持平</span><br>(2.58 萬) | 89.020943%<br><span style="color:gray">持平</span><br>(4.67 萬) |
| R4 史詩 | 99.753332%<br><span style="color:red">▼ 0.242150%</span><br>(2628.62 萬) | 99.744408%<br><span style="color:red">▼ 0.250910%</span><br>(2536.62 萬) | 99.994531%<br><span style="color:gray">持平</span><br>(1.92 萬) | 99.994531%<br><span style="color:gray">持平</span><br>(1.92 萬) | 99.983560%<br><span style="color:gray">持平</span><br>(8,755) | 88.054088%<br><span style="color:gray">持平</span><br>(3.69 萬) | 92.916395%<br><span style="color:gray">持平</span><br>(6.68 萬) |
| R5 傳說 | 99.840292%<br><span style="color:red">▼ 0.156790%</span><br>(4063.42 萬) | 99.834509%<br><span style="color:red">▼ 0.162467%</span><br>(3921.20 萬) | 99.995998%<br><span style="color:gray">持平</span><br>(2.40 萬) | 99.995998%<br><span style="color:gray">持平</span><br>(2.40 萬) | 99.987971%<br><span style="color:gray">持平</span><br>(1.09 萬) | 90.209354%<br><span style="color:gray">持平</span><br>(4.61 萬) | 94.659468%<br><span style="color:gray">持平</span><br>(8.35 萬) |
| R6 神話 | 99.904473%<br><span style="color:red">▼ 0.093785%</span><br>(6797.88 萬) | 99.901012%<br><span style="color:red">▼ 0.097183%</span><br>(6559.96 萬) | 99.997228%<br><span style="color:gray">持平</span><br>(3.12 萬) | 99.997228%<br><span style="color:gray">持平</span><br>(3.12 萬) | 99.991668%<br><span style="color:gray">持平</span><br>(1.42 萬) | 92.294641%<br><span style="color:gray">持平</span><br>(5.99 萬) | 96.191049%<br><span style="color:gray">持平</span><br>(10.85 萬) |
| R7 創世 | 99.936514%<br><span style="color:red">▼ 0.062329%</span><br>(1.02 億) | 99.934213%<br><span style="color:red">▼ 0.064589%</span><br>(9873.88 萬) | 99.997928%<br><span style="color:gray">持平</span><br>(3.84 萬) | 99.997928%<br><span style="color:gray">持平</span><br>(3.84 萬) | 99.993770%<br><span style="color:gray">持平</span><br>(1.75 萬) | 93.647619%<br><span style="color:gray">持平</span><br>(7.37 萬) | 97.094834%<br><span style="color:gray">持平</span><br>(13.35 萬) |
| R8 神鑄神話 | 99.954774%<br><span style="color:red">▼ 0.044403%</span><br>(1.44 億) | 99.953134%<br><span style="color:red">▼ 0.046013%</span><br>(1.39 億) | 99.998371%<br><span style="color:gray">持平</span><br>(4.56 萬) | 99.998371%<br><span style="color:gray">持平</span><br>(4.56 萬) | 99.995102%<br><span style="color:gray">持平</span><br>(2.08 萬) | 94.596429%<br><span style="color:gray">持平</span><br>(8.75 萬) | 97.682273%<br><span style="color:gray">持平</span><br>(15.86 萬) |
| R9 神鑄創世 | 99.971513%<br><span style="color:red">▼ 0.027969%</span><br>(2.28 億) | 99.970480%<br><span style="color:red">▼ 0.028983%</span><br>(2.20 億) | 99.998825%<br><span style="color:gray">持平</span><br>(5.77 萬) | 99.998825%<br><span style="color:gray">持平</span><br>(5.77 萬) | 99.996468%<br><span style="color:gray">持平</span><br>(2.63 萬) | 95.673467%<br><span style="color:gray">持平</span><br>(11.06 萬) | 98.298416%<br><span style="color:gray">持平</span><br>(20.03 萬) |
| R10 混沌 | 99.983900%<br><span style="color:red">▼ 0.015807%</span><br>(4.04 億) | 99.983316%<br><span style="color:red">▼ 0.016381%</span><br>(3.90 億) | 99.999215%<br><span style="color:gray">持平</span><br>(7.69 萬) | 99.999215%<br><span style="color:gray">持平</span><br>(7.69 萬) | 99.997639%<br><span style="color:gray">持平</span><br>(3.50 萬) | 96.719618%<br><span style="color:gray">持平</span><br>(14.74 萬) | 98.839633%<br><span style="color:gray">持平</span><br>(26.71 萬) |
| R11 神鑄混沌 | 99.992163%<br><span style="color:red">▼ 0.007695%</span><br>(8.29 億) | 99.991879%<br><span style="color:red">▼ 0.007974%</span><br>(8.00 億) | 99.999527%<br><span style="color:gray">持平</span><br>(11.05 萬) | 99.999527%<br><span style="color:gray">持平</span><br>(11.05 萬) | 99.998580%<br><span style="color:gray">持平</span><br>(5.03 萬) | 97.694983%<br><span style="color:gray">持平</span><br>(21.19 萬) | 99.285831%<br><span style="color:gray">持平</span><br>(38.39 萬) |

---

## 二、情境二：上述情況 + 鑲嵌 10 個 10 級頂級寶石

### 2.1 生命值 (HP) 極大值分佈
| 裝備階級 | 1轉 | 2轉 | 3轉 | 4轉 | 5轉 | 6轉 | 7轉 | 8轉 | 9轉 | 10轉 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| R0 普通 | 45.81 萬 | 76.35 萬 | 106.89 萬 | 152.70 萬 | 213.78 萬 | 274.86 萬 | 335.94 萬 | 458.10 萬 | 580.25 萬 | 763.49 萬 |
| R1 精良 | 442.00 萬 | 736.67 萬 | 1031.33 萬 | 1473.33 萬 | 2062.66 萬 | 2652.00 萬 | 3241.33 萬 | 4420.00 萬 | 5598.66 萬 | 7366.66 萬 |
| R2 稀有 | 701.82 萬 | 1169.70 萬 | 1637.59 萬 | 2339.41 萬 | 3275.17 萬 | 4210.94 萬 | 5146.70 萬 | 7018.23 萬 | 8889.75 萬 | 1.17 億 |
| R3 獨特 | 1495.32 萬 | 2492.20 萬 | 3489.08 萬 | 4984.40 萬 | 6978.16 萬 | 8971.93 萬 | 1.10 億 | 1.50 億 | 1.89 億 | 2.49 億 |
| R4 史詩 | 2841.09 萬 | 4735.14 萬 | 6629.20 萬 | 9470.29 萬 | 1.33 億 | 1.70 億 | 2.08 億 | 2.84 億 | 3.60 億 | 4.74 億 |
| R5 傳說 | 4289.19 萬 | 7148.65 萬 | 1.00 億 | 1.43 億 | 2.00 億 | 2.57 億 | 3.15 億 | 4.29 億 | 5.43 億 | 7.15 億 |
| R6 神話 | 7018.10 萬 | 1.17 億 | 1.64 億 | 2.34 億 | 3.28 億 | 4.21 億 | 5.15 億 | 7.02 億 | 8.89 億 | 11.70 億 |
| R7 創世 | 1.04 億 | 1.74 億 | 2.43 億 | 3.47 億 | 4.86 億 | 6.25 億 | 7.64 億 | 10.42 億 | 13.19 億 | 17.36 億 |
| R8 神鑄神話 | 1.45 億 | 2.41 億 | 3.38 億 | 4.83 億 | 6.76 億 | 8.69 億 | 10.62 億 | 14.48 億 | 18.34 億 | 24.13 億 |
| R9 神鑄創世 | 2.27 億 | 3.79 億 | 5.31 億 | 7.58 億 | 10.61 億 | 13.64 億 | 16.68 億 | 22.74 億 | 28.80 億 | 37.90 億 |
| R10 混沌 | 3.98 億 | 6.64 億 | 9.29 億 | 13.27 億 | 18.58 億 | 23.89 億 | 29.20 億 | 39.82 億 | 50.43 億 | 66.36 億 |
| R11 神鑄混沌 | 8.11 億 | 13.52 億 | 18.93 億 | 27.04 億 | 37.86 億 | 48.68 億 | 59.50 億 | 81.13 億 | 102.77 億 | 135.22 億 |

### 2.2 法力值 (MP) 極大值分佈
| 裝備階級 | 1轉 | 2轉 | 3轉 | 4轉 | 5轉 | 6轉 | 7轉 | 8轉 | 9轉 | 10轉 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| R0 普通 | 13.30 萬 | 22.17 萬 | 31.04 萬 | 44.35 萬 | 62.08 萬 | 79.82 萬 | 97.56 萬 | 133.04 萬 | 168.51 萬 | 221.73 萬 |
| R1 精良 | 18.56 萬 | 30.94 萬 | 43.31 萬 | 61.87 萬 | 86.62 萬 | 111.37 萬 | 136.12 萬 | 185.62 萬 | 235.12 萬 | 309.37 萬 |
| R2 稀有 | 22.94 萬 | 38.24 萬 | 53.54 萬 | 76.48 萬 | 107.07 萬 | 137.66 萬 | 168.26 萬 | 229.44 萬 | 290.62 萬 | 382.40 萬 |
| R3 獨特 | 37.81 萬 | 63.02 萬 | 88.23 萬 | 126.04 萬 | 176.46 萬 | 226.88 萬 | 277.30 萬 | 378.13 萬 | 478.96 萬 | 630.22 萬 |
| R4 史詩 | 51.70 萬 | 86.16 萬 | 120.63 萬 | 172.32 萬 | 241.25 萬 | 310.18 萬 | 379.11 萬 | 516.97 萬 | 654.83 萬 | 861.62 萬 |
| R5 傳說 | 63.27 萬 | 105.45 萬 | 147.63 萬 | 210.89 萬 | 295.25 萬 | 379.61 萬 | 463.96 萬 | 632.68 萬 | 801.39 萬 | 1054.46 萬 |
| R6 神話 | 80.62 萬 | 134.37 萬 | 188.12 萬 | 268.74 萬 | 376.24 萬 | 483.74 萬 | 591.24 萬 | 806.23 萬 | 1021.23 萬 | 1343.72 萬 |
| R7 創世 | 97.98 萬 | 163.30 萬 | 228.62 萬 | 326.60 萬 | 457.24 萬 | 587.87 萬 | 718.51 萬 | 979.79 萬 | 1241.07 萬 | 1632.98 萬 |
| R8 神鑄神話 | 115.33 萬 | 192.22 萬 | 269.11 萬 | 384.45 萬 | 538.23 萬 | 692.01 萬 | 845.79 萬 | 1153.35 萬 | 1460.91 萬 | 1922.24 萬 |
| R9 神鑄創世 | 144.26 萬 | 240.43 萬 | 336.61 萬 | 480.87 萬 | 673.22 萬 | 865.56 萬 | 1057.91 萬 | 1442.61 萬 | 1827.30 萬 | 2404.34 萬 |
| R10 混沌 | 190.54 萬 | 317.57 萬 | 444.60 萬 | 635.14 萬 | 889.20 萬 | 1143.25 萬 | 1397.31 萬 | 1905.42 萬 | 2413.54 萬 | 3175.70 萬 |
| R11 神鑄混沌 | 271.54 萬 | 452.56 萬 | 633.58 萬 | 905.12 萬 | 1267.16 萬 | 1629.21 萬 | 1991.26 萬 | 2715.35 萬 | 3439.44 萬 | 4525.58 萬 |

### 2.3 四維主屬性（力量 Str）極大值分佈
| 裝備階級 | 1轉 | 2轉 | 3轉 | 4轉 | 5轉 | 6轉 | 7轉 | 8轉 | 9轉 | 10轉 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| R0 普通 | 2.58 萬 | 4.30 萬 | 6.02 萬 | 8.60 萬 | 12.04 萬 | 15.48 萬 | 18.92 萬 | 25.81 萬 | 32.69 萬 | 43.01 萬 |
| R1 精良 | 3.72 萬 | 6.20 萬 | 8.68 萬 | 12.40 萬 | 17.36 萬 | 22.32 萬 | 27.29 萬 | 37.21 萬 | 47.13 萬 | 62.01 萬 |
| R2 稀有 | 4.86 萬 | 8.10 萬 | 11.34 萬 | 16.20 萬 | 22.68 萬 | 29.16 萬 | 35.65 萬 | 48.61 萬 | 61.57 萬 | 81.01 萬 |
| R3 獨特 | 6.68 萬 | 11.14 萬 | 15.60 萬 | 22.28 萬 | 31.20 萬 | 40.11 萬 | 49.02 萬 | 66.85 萬 | 84.68 萬 | 111.42 萬 |
| R4 史詩 | 9.42 萬 | 15.70 萬 | 21.98 萬 | 31.40 萬 | 43.97 萬 | 56.53 萬 | 69.09 萬 | 94.21 萬 | 119.33 萬 | 157.02 萬 |
| R5 傳說 | 11.70 萬 | 19.50 萬 | 27.30 萬 | 39.00 萬 | 54.61 萬 | 70.21 萬 | 85.81 萬 | 117.01 萬 | 148.22 萬 | 195.02 萬 |
| R6 神話 | 15.12 萬 | 25.20 萬 | 35.28 萬 | 50.41 萬 | 70.57 萬 | 90.73 萬 | 110.89 萬 | 151.22 萬 | 191.54 萬 | 252.03 萬 |
| R7 創世 | 18.54 萬 | 30.90 萬 | 43.26 萬 | 61.81 萬 | 86.53 萬 | 111.25 萬 | 135.97 萬 | 185.42 萬 | 234.86 萬 | 309.03 萬 |
| R8 神鑄神話 | 21.96 萬 | 36.60 萬 | 51.24 萬 | 73.21 萬 | 102.49 萬 | 131.77 萬 | 161.05 萬 | 219.62 萬 | 278.19 萬 | 366.03 萬 |
| R9 神鑄創世 | 27.66 萬 | 46.10 萬 | 64.55 萬 | 92.21 萬 | 129.09 萬 | 165.97 萬 | 202.86 萬 | 276.62 萬 | 350.39 萬 | 461.04 萬 |
| R10 混沌 | 36.78 萬 | 61.31 萬 | 85.83 萬 | 122.61 萬 | 171.65 萬 | 220.70 萬 | 269.74 萬 | 367.83 萬 | 465.92 萬 | 613.05 萬 |
| R11 神鑄混沌 | 52.74 萬 | 87.91 萬 | 123.07 萬 | 175.81 萬 | 246.14 萬 | 316.47 萬 | 386.79 萬 | 527.44 萬 | 668.09 萬 | 879.07 萬 |

### 2.4 物理防禦 (Def) 極大值分佈與差異（1轉至 10轉）
| 裝備階級 | 1轉 | 2轉 | 3轉 | 4轉 | 5轉 | 6轉 | 7轉 | 8轉 | 9轉 | 10轉 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| R0 普通 | 7.03 萬<br><span style="color:red">▼ -5,682</span> | 8.49 萬<br><span style="color:red">▼ -3.44 萬</span> | 10.38 萬<br><span style="color:red">▼ -8.07 萬</span> | 12.91 萬<br><span style="color:red">▼ -17.51 萬</span> | 16.40 萬<br><span style="color:red">▼ -35.80 萬</span> | 21.33 萬<br><span style="color:red">▼ -70.12 萬</span> | 28.41 萬<br><span style="color:red">▼ -137.26 萬</span> | 38.73 萬<br><span style="color:red">▼ -275.37 萬</span> | 53.90 萬<br><span style="color:red">▼ -548.46 萬</span> | 76.36 萬<br><span style="color:red">▼ -1098.22 萬</span> |
| R1 精良 | 85.41 萬<br><span style="color:red">▼ -6.23 萬</span> | 103.12 萬<br><span style="color:red">▼ -41.73 萬</span> | 125.49 萬<br><span style="color:red">▼ -96.21 萬</span> | 154.88 萬<br><span style="color:red">▼ -205.72 萬</span> | 194.78 萬<br><span style="color:red">▼ -414.04 萬</span> | 250.44 萬<br><span style="color:red">▼ -795.66 萬</span> | 329.76 萬<br><span style="color:red">▼ -1531.75 萬</span> | 444.56 萬<br><span style="color:red">▼ -3047.76 萬</span> | 612.57 萬<br><span style="color:red">▼ -6023.06 萬</span> | 860.42 萬<br><span style="color:red">▼ -1.20 億</span> |
| R2 稀有 | 134.77 萬<br><span style="color:red">▼ -9.11 萬</span> | 162.63 萬<br><span style="color:red">▼ -65.73 萬</span> | 197.33 萬<br><span style="color:red">▼ -149.82 萬</span> | 242.28 萬<br><span style="color:red">▼ -317.35 萬</span> | 302.62 萬<br><span style="color:red">▼ -631.81 萬</span> | 386.02 萬<br><span style="color:red">▼ -1197.67 萬</span> | 504.02 萬<br><span style="color:red">▼ -2277.83 萬</span> | 673.93 萬<br><span style="color:red">▼ -4504.23 萬</span> | 921.70 萬<br><span style="color:red">▼ -8848.40 萬</span> | 1286.25 萬<br><span style="color:red">▼ -1.76 億</span> |
| R3 獨特 | 236.58 萬<br><span style="color:red">▼ -14.68 萬</span> | 285.36 萬<br><span style="color:red">▼ -115.13 萬</span> | 345.16 萬<br><span style="color:red">▼ -259.40 萬</span> | 421.47 萬<br><span style="color:red">▼ -544.04 萬</span> | 522.55 萬<br><span style="color:red">▼ -1070.49 萬</span> | 660.80 萬<br><span style="color:red">▼ -1998.56 萬</span> | 854.79 萬<br><span style="color:red">▼ -3748.44 萬</span> | 1132.39 萬<br><span style="color:red">▼ -7358.58 萬</span> | 1535.41 萬<br><span style="color:red">▼ -1.44 億</span> | 2126.55 萬<br><span style="color:red">▼ -2.84 億</span> |
| R4 史詩 | 441.95 萬<br><span style="color:red">▼ -25.32 萬</span> | 532.87 萬<br><span style="color:red">▼ -214.69 萬</span> | 642.78 萬<br><span style="color:red">▼ -478.72 萬</span> | 781.18 萬<br><span style="color:red">▼ -994.89 萬</span> | 962.31 萬<br><span style="color:red">▼ -1936.24 萬</span> | 1207.53 萬<br><span style="color:red">▼ -3562.70 萬</span> | 1548.90 萬<br><span style="color:red">▼ -6591.41 萬</span> | 2034.47 萬<br><span style="color:red">▼ -1.29 億</span> | 2736.36 萬<br><span style="color:red">▼ -2.49 億</span> | 3762.73 萬<br><span style="color:red">▼ -4.89 億</span> |
| R5 傳說 | 661.34 萬<br><span style="color:red">▼ -36.29 萬</span> | 797.24 萬<br><span style="color:red">▼ -321.03 萬</span> | 960.35 萬<br><span style="color:red">▼ -711.87 萬</span> | 1164.29 萬<br><span style="color:red">▼ -1472.17 萬</span> | 1429.45 萬<br><span style="color:red">▼ -2848.15 萬</span> | 1786.47 萬<br><span style="color:red">▼ -5198.75 萬</span> | 2281.26 萬<br><span style="color:red">▼ -9518.74 萬</span> | 2982.72 萬<br><span style="color:red">▼ -1.85 億</span> | 3994.16 萬<br><span style="color:red">▼ -3.57 億</span> | 5470.60 萬<br><span style="color:red">▼ -7.01 億</span> |
| R6 神話 | 1072.74 萬<br><span style="color:red">▼ -56.24 萬</span> | 1292.92 萬<br><span style="color:red">▼ -520.28 萬</span> | 1555.27 萬<br><span style="color:red">▼ -1147.44 萬</span> | 1880.88 萬<br><span style="color:red">▼ -2361.37 萬</span> | 2301.40 萬<br><span style="color:red">▼ -4541.00 萬</span> | 2864.27 萬<br><span style="color:red">▼ -8235.73 萬</span> | 3640.66 萬<br><span style="color:red">▼ -1.50 億</span> | 4737.34 萬<br><span style="color:red">▼ -2.90 億</span> | 6314.45 萬<br><span style="color:red">▼ -5.56 億</span> | 8612.21 萬<br><span style="color:red">▼ -10.87 億</span> |
| R7 創世 | 1582.90 萬<br><span style="color:red">▼ -80.43 萬</span> | 1907.52 萬<br><span style="color:red">▼ -767.27 萬</span> | 2292.47 萬<br><span style="color:red">▼ -1686.02 萬</span> | 2767.90 萬<br><span style="color:red">▼ -3458.40 萬</span> | 3379.06 萬<br><span style="color:red">▼ -6620.94 萬</span> | 4193.81 萬<br><span style="color:red">▼ -1.19 億</span> | 5313.94 萬<br><span style="color:red">▼ -2.16 億</span> | 6892.16 萬<br><span style="color:red">▼ -4.16 億</span> | 9157.49 萬<br><span style="color:red">▼ -7.96 億</span> | 1.25 億<br><span style="color:red">▼ -15.54 億</span> |
| R8 神鑄神話 | 2191.79 萬<br><span style="color:red">▼ -108.87 萬</span> | 2641.04 萬<br><span style="color:red">▼ -1061.99 萬</span> | 3171.93 萬<br><span style="color:red">▼ -2327.65 萬</span> | 3825.31 萬<br><span style="color:red">▼ -4763.29 萬</span> | 4662.39 萬<br><span style="color:red">▼ -9137.61 萬</span> | 5775.05 萬<br><span style="color:red">▼ -1.63 億</span> | 7301.07 萬<br><span style="color:red">▼ -2.94 億</span> | 9447.12 萬<br><span style="color:red">▼ -5.66 億</span> | 1.25 億<br><span style="color:red">▼ -10.80 億</span> | 1.70 億<br><span style="color:red">▼ -21.04 億</span> |
| R9 神鑄創世 | 3426.03 萬<br><span style="color:red">▼ -165.72 萬</span> | 4127.81 萬<br><span style="color:red">▼ -1659.29 萬</span> | 4953.88 萬<br><span style="color:red">▼ -3625.96 萬</span> | 5966.38 萬<br><span style="color:red">▼ -7433.62 萬</span> | 7258.53 萬<br><span style="color:red">▼ -1.40 億</span> | 8970.16 萬<br><span style="color:red">▼ -2.51 億</span> | 1.13 億<br><span style="color:red">▼ -4.51 億</span> | 1.46 億<br><span style="color:red">▼ -8.64 億</span> | 1.93 億<br><span style="color:red">▼ -16.46 億</span> | 2.61 億<br><span style="color:red">▼ -32.03 億</span> |
| R10 混沌 | 5971.35 萬<br><span style="color:red">▼ -281.18 萬</span> | 7193.73 萬<br><span style="color:red">▼ -2906.27 萬</span> | 8627.01 萬<br><span style="color:red">▼ -6272.99 萬</span> | 1.04 億<br><span style="color:red">▼ -1.28 億</span> | 1.26 億<br><span style="color:red">▼ -2.43 億</span> | 1.55 億<br><span style="color:red">▼ -4.32 億</span> | 1.95 億<br><span style="color:red">▼ -7.71 億</span> | 2.51 億<br><span style="color:red">▼ -14.74 億</span> | 3.32 億<br><span style="color:red">▼ -27.98 億</span> | 4.48 億<br><span style="color:red">▼ -54.34 億</span> |
| R11 神鑄混沌 | 1.21 億<br><span style="color:red">▼ -555.89 萬</span> | 1.46 億<br><span style="color:red">▼ -5871.48 萬</span> | 1.75 億<br><span style="color:red">▼ -1.27 億</span> | 2.11 億<br><span style="color:red">▼ -2.58 億</span> | 2.55 億<br><span style="color:red">▼ -4.89 億</span> | 3.14 億<br><span style="color:red">▼ -8.63 億</span> | 3.94 億<br><span style="color:red">▼ -15.35 億</span> | 5.05 億<br><span style="color:red">▼ -29.27 億</span> | 6.64 億<br><span style="color:red">▼ -55.42 億</span> | 8.94 億<br><span style="color:red">▼ -107.44 億</span> |

### 2.5 各類減傷極大值與對應屬性數值對照表（以 10轉 頂峰為基準，對戰 Lv.650 敵人）
| 裝備階級 | 物理防禦減傷 (物防值) | 魔法防禦減傷 (魔防值) | 物理抗性減傷 (物抗值) | 魔法抗性減傷 (魔抗值) | 元素抗性減傷 (全抗值) | 全局減傷 (減傷值) | BOSS減傷 (BOSS減傷值) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| R0 普通 | 92.155405%<br><span style="color:red">▼ 7.717053%</span><br>(76.36 萬) | 91.893948%<br><span style="color:red">▼ 7.973890%</span><br>(73.69 萬) | 99.961924%<br><span style="color:gray">持平</span><br>(4,804) | 99.961924%<br><span style="color:gray">持平</span><br>(4,804) | 99.958385%<br><span style="color:gray">持平</span><br>(4,509) | 64.822995%<br><span style="color:gray">持平</span><br>(9,214) | 66.965932%<br><span style="color:gray">持平</span><br>(1.67 萬) |
| R1 精良 | 99.250218%<br><span style="color:red">▼ 0.738155%</span><br>(860.42 萬) | 99.223235%<br><span style="color:red">▼ 0.764717%</span><br>(830.30 萬) | 99.978413%<br><span style="color:gray">持平</span><br>(7,206) | 99.978413%<br><span style="color:gray">持平</span><br>(7,206) | 99.969297%<br><span style="color:gray">持平</span><br>(5,603) | 73.433572%<br><span style="color:gray">持平</span><br>(1.38 萬) | 77.763203%<br><span style="color:gray">持平</span><br>(2.50 萬) |
| R2 稀有 | 99.497198%<br><span style="color:red">▼ 0.494867%</span><br>(1286.25 萬) | 99.479056%<br><span style="color:red">▼ 0.512720%</span><br>(1241.24 萬) | 99.985568%<br><span style="color:gray">持平</span><br>(9,609) | 99.985568%<br><span style="color:gray">持平</span><br>(9,609) | 99.976081%<br><span style="color:gray">持平</span><br>(6,697) | 78.657708%<br><span style="color:gray">持平</span><br>(1.84 萬) | 83.744792%<br><span style="color:gray">持平</span><br>(3.34 萬) |
| R3 獨特 | 99.695273%<br><span style="color:red">▼ 0.299810%</span><br>(2126.55 萬) | 99.684255%<br><span style="color:red">▼ 0.310649%</span><br>(2052.13 萬) | 99.990989%<br><span style="color:gray">持平</span><br>(1.35 萬) | 99.990989%<br><span style="color:gray">持平</span><br>(1.35 萬) | 99.982720%<br><span style="color:gray">持平</span><br>(8,448) | 83.765563%<br><span style="color:gray">持平</span><br>(2.58 萬) | 89.020943%<br><span style="color:gray">持平</span><br>(4.67 萬) |
| R4 史詩 | 99.827551%<br><span style="color:red">▼ 0.169603%</span><br>(3762.73 萬) | 99.821308%<br><span style="color:red">▼ 0.175743%</span><br>(3631.03 萬) | 99.994531%<br><span style="color:gray">持平</span><br>(1.92 萬) | 99.994531%<br><span style="color:gray">持平</span><br>(1.92 萬) | 99.988170%<br><span style="color:gray">持平</span><br>(1.11 萬) | 88.054088%<br><span style="color:gray">持平</span><br>(3.69 萬) | 92.916395%<br><span style="color:gray">持平</span><br>(6.68 萬) |
| R5 傳說 | 99.881324%<br><span style="color:red">▼ 0.116692%</span><br>(5470.60 萬) | 99.877025%<br><span style="color:red">▼ 0.120919%</span><br>(5279.13 萬) | 99.995998%<br><span style="color:gray">持平</span><br>(2.40 萬) | 99.995998%<br><span style="color:gray">持平</span><br>(2.40 萬) | 99.990809%<br><span style="color:gray">持平</span><br>(1.33 萬) | 90.209354%<br><span style="color:gray">持平</span><br>(4.61 萬) | 94.659468%<br><span style="color:gray">持平</span><br>(8.35 萬) |
| R6 神話 | 99.924583%<br><span style="color:red">▼ 0.074139%</span><br>(8612.21 萬) | 99.921849%<br><span style="color:red">▼ 0.076825%</span><br>(8310.78 萬) | 99.997228%<br><span style="color:gray">持平</span><br>(3.12 萬) | 99.997228%<br><span style="color:gray">持平</span><br>(3.12 萬) | 99.993256%<br><span style="color:gray">持平</span><br>(1.65 萬) | 92.294641%<br><span style="color:gray">持平</span><br>(5.99 萬) | 96.191049%<br><span style="color:gray">持平</span><br>(10.85 萬) |
| R7 創世 | 99.947833%<br><span style="color:red">▼ 0.051274%</span><br>(1.25 億) | 99.945942%<br><span style="color:red">▼ 0.053132%</span><br>(1.20 億) | 99.997928%<br><span style="color:gray">持平</span><br>(3.84 萬) | 99.997928%<br><span style="color:gray">持平</span><br>(3.84 萬) | 99.994766%<br><span style="color:gray">持平</span><br>(1.98 萬) | 93.647619%<br><span style="color:gray">持平</span><br>(7.37 萬) | 97.094834%<br><span style="color:gray">持平</span><br>(13.35 萬) |
| R8 神鑄神話 | 99.961767%<br><span style="color:red">▼ 0.037574%</span><br>(1.70 億) | 99.960381%<br><span style="color:red">▼ 0.038936%</span><br>(1.64 億) | 99.998371%<br><span style="color:gray">持平</span><br>(4.56 萬) | 99.998371%<br><span style="color:gray">持平</span><br>(4.56 萬) | 99.995776%<br><span style="color:gray">持平</span><br>(2.31 萬) | 94.596429%<br><span style="color:gray">持平</span><br>(8.75 萬) | 97.682273%<br><span style="color:gray">持平</span><br>(15.86 萬) |
| R9 神鑄創世 | 99.975121%<br><span style="color:red">▼ 0.024446%</span><br>(2.61 億) | 99.974219%<br><span style="color:red">▼ 0.025332%</span><br>(2.52 億) | 99.998825%<br><span style="color:gray">持平</span><br>(5.77 萬) | 99.998825%<br><span style="color:gray">持平</span><br>(5.77 萬) | 99.996863%<br><span style="color:gray">持平</span><br>(2.86 萬) | 95.673467%<br><span style="color:gray">持平</span><br>(11.06 萬) | 98.298416%<br><span style="color:gray">持平</span><br>(20.03 萬) |
| R10 混沌 | 99.985481%<br><span style="color:red">▼ 0.014264%</span><br>(4.48 億) | 99.984954%<br><span style="color:red">▼ 0.014781%</span><br>(4.32 億) | 99.999215%<br><span style="color:gray">持平</span><br>(7.69 萬) | 99.999215%<br><span style="color:gray">持平</span><br>(7.69 萬) | 99.997842%<br><span style="color:gray">持平</span><br>(3.73 萬) | 96.719618%<br><span style="color:gray">持平</span><br>(14.74 萬) | 98.839633%<br><span style="color:gray">持平</span><br>(26.71 萬) |
| R11 神鑄混沌 | 99.992733%<br><span style="color:red">▼ 0.007138%</span><br>(8.94 億) | 99.992470%<br><span style="color:red">▼ 0.007397%</span><br>(8.63 億) | 99.999527%<br><span style="color:gray">持平</span><br>(11.05 萬) | 99.999527%<br><span style="color:gray">持平</span><br>(11.05 萬) | 99.998666%<br><span style="color:gray">持平</span><br>(5.27 萬) | 97.694983%<br><span style="color:gray">持平</span><br>(21.19 萬) | 99.285831%<br><span style="color:gray">持平</span><br>(38.39 萬) |

---

## 三、情境三：上述情況 + 轉生天堂威能全滿

### 3.1 生命值 (HP) 極大值分佈
| 裝備階級 | 1轉 | 2轉 | 3轉 | 4轉 | 5轉 | 6轉 | 7轉 | 8轉 | 9轉 | 10轉 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| R0 普通 | 65.01 萬 | 108.35 萬 | 151.69 萬 | 216.71 萬 | 303.39 萬 | 390.07 萬 | 476.75 萬 | 650.12 萬 | 823.48 萬 | 1167.85 萬 |
| R1 精良 | 628.32 萬 | 1047.20 萬 | 1466.07 萬 | 2094.39 萬 | 2932.15 萬 | 3769.90 萬 | 4607.66 萬 | 6283.17 萬 | 7958.69 萬 | 1.13 億 |
| R2 稀有 | 998.69 萬 | 1664.49 萬 | 2330.29 萬 | 3328.98 萬 | 4660.57 萬 | 5992.17 萬 | 7323.76 萬 | 9986.95 萬 | 1.27 億 | 1.80 億 |
| R3 獨特 | 2204.94 萬 | 3674.90 萬 | 5144.85 萬 | 7349.79 萬 | 1.03 億 | 1.32 億 | 1.62 億 | 2.20 億 | 2.79 億 | 4.30 億 |
| R4 史詩 | 4199.28 萬 | 6998.79 萬 | 9798.31 萬 | 1.40 億 | 1.96 億 | 2.52 億 | 3.08 億 | 4.20 億 | 5.32 億 | 8.22 億 |
| R5 傳說 | 6347.16 萬 | 1.06 億 | 1.48 億 | 2.12 億 | 2.96 億 | 3.81 億 | 4.65 億 | 6.35 億 | 8.04 億 | 12.45 億 |
| R6 神話 | 1.04 億 | 1.73 億 | 2.43 億 | 3.47 億 | 4.85 億 | 6.24 億 | 7.62 億 | 10.40 億 | 13.17 億 | 20.44 億 |
| R7 創世 | 1.54 億 | 2.57 億 | 3.60 億 | 5.15 億 | 7.21 億 | 9.26 億 | 11.32 億 | 15.44 億 | 19.56 億 | 30.40 億 |
| R8 神鑄神話 | 2.15 億 | 3.58 億 | 5.01 億 | 7.16 億 | 10.02 億 | 12.89 億 | 15.75 億 | 21.48 億 | 27.21 億 | 42.34 億 |
| R9 神鑄創世 | 3.38 億 | 5.63 億 | 7.88 億 | 11.25 億 | 15.75 億 | 20.25 億 | 24.75 億 | 33.75 億 | 42.75 億 | 66.60 億 |
| R10 混沌 | 5.91 億 | 9.86 億 | 13.80 億 | 19.71 億 | 27.59 億 | 35.48 億 | 43.36 億 | 59.13 億 | 74.90 億 | 116.81 億 |
| R11 神鑄混沌 | 12.06 億 | 20.09 億 | 28.13 億 | 40.18 億 | 56.26 億 | 72.33 億 | 88.40 億 | 120.55 億 | 152.70 億 | 238.39 億 |

### 3.2 法力值 (MP) 極大值分佈
| 裝備階級 | 1轉 | 2轉 | 3轉 | 4轉 | 5轉 | 6轉 | 7轉 | 8轉 | 9轉 | 10轉 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| R0 普通 | 13.89 萬 | 23.15 萬 | 32.42 萬 | 46.31 萬 | 64.83 萬 | 83.35 萬 | 101.88 萬 | 138.92 萬 | 175.97 萬 | 256.07 萬 |
| R1 精良 | 19.37 萬 | 32.28 萬 | 45.20 萬 | 64.57 萬 | 90.39 萬 | 116.22 萬 | 142.05 萬 | 193.70 萬 | 245.35 萬 | 356.50 萬 |
| R2 稀有 | 23.97 萬 | 39.95 萬 | 55.93 萬 | 79.90 萬 | 111.87 萬 | 143.83 萬 | 175.79 萬 | 239.71 萬 | 303.64 萬 | 442.32 萬 |
| R3 獨特 | 41.16 萬 | 68.59 萬 | 96.03 萬 | 137.18 萬 | 192.06 萬 | 246.93 萬 | 301.81 萬 | 411.55 萬 | 521.30 萬 | 825.19 萬 |
| R4 史詩 | 56.41 萬 | 94.01 萬 | 131.62 萬 | 188.03 萬 | 263.24 萬 | 338.45 萬 | 413.66 萬 | 564.08 萬 | 714.50 萬 | 1136.41 萬 |
| R5 傳說 | 69.12 萬 | 115.20 萬 | 161.28 萬 | 230.40 萬 | 322.55 萬 | 414.71 萬 | 506.87 萬 | 691.19 萬 | 875.50 萬 | 1395.75 萬 |
| R6 神話 | 88.18 萬 | 146.97 萬 | 205.76 萬 | 293.95 萬 | 411.53 萬 | 529.11 萬 | 646.68 萬 | 881.84 萬 | 1117.00 萬 | 1784.77 萬 |
| R7 創世 | 107.25 萬 | 178.75 萬 | 250.25 萬 | 357.50 萬 | 500.50 萬 | 643.50 萬 | 786.50 萬 | 1072.50 萬 | 1358.50 萬 | 2173.79 萬 |
| R8 神鑄神話 | 126.32 萬 | 210.53 萬 | 294.74 萬 | 421.05 萬 | 589.47 萬 | 757.89 萬 | 926.31 萬 | 1263.16 萬 | 1600.00 萬 | 2562.80 萬 |
| R9 神鑄創世 | 158.09 萬 | 263.49 萬 | 368.88 萬 | 526.97 萬 | 737.76 萬 | 948.55 萬 | 1159.34 萬 | 1580.92 萬 | 2002.50 萬 | 3211.17 萬 |
| R10 混沌 | 208.93 萬 | 348.22 萬 | 487.51 萬 | 696.45 萬 | 975.02 萬 | 1253.60 萬 | 1532.18 萬 | 2089.34 萬 | 2646.49 萬 | 4248.54 萬 |
| R11 神鑄混沌 | 297.91 萬 | 496.51 萬 | 695.12 萬 | 993.02 萬 | 1390.23 萬 | 1787.44 萬 | 2184.65 萬 | 2979.07 萬 | 3773.49 萬 | 6063.96 萬 |

### 3.3 四維主屬性（力量 Str）極大值分佈
| 裝備階級 | 1轉 | 2轉 | 3轉 | 4轉 | 5轉 | 6轉 | 7轉 | 8轉 | 9轉 | 10轉 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| R0 普通 | 3.23 萬 | 5.38 萬 | 7.53 萬 | 10.75 萬 | 15.05 萬 | 19.35 萬 | 23.66 萬 | 32.26 萬 | 40.86 萬 | 80.64 萬 |
| R1 精良 | 4.65 萬 | 7.75 萬 | 10.85 萬 | 15.50 萬 | 21.70 萬 | 27.91 萬 | 34.11 萬 | 46.51 萬 | 58.91 萬 | 116.27 萬 |
| R2 稀有 | 6.08 萬 | 10.13 萬 | 14.18 萬 | 20.25 萬 | 28.35 萬 | 36.46 萬 | 44.56 萬 | 60.76 萬 | 76.96 萬 | 151.90 萬 |
| R3 獨特 | 8.36 萬 | 13.93 萬 | 19.50 萬 | 27.85 萬 | 39.00 萬 | 50.14 萬 | 61.28 萬 | 83.56 萬 | 105.84 萬 | 208.90 萬 |
| R4 史詩 | 11.78 萬 | 19.63 萬 | 27.48 萬 | 39.25 萬 | 54.96 萬 | 70.66 萬 | 86.36 萬 | 117.76 萬 | 149.17 萬 | 294.41 萬 |
| R5 傳說 | 14.63 萬 | 24.38 萬 | 34.13 萬 | 48.76 萬 | 68.26 萬 | 87.76 萬 | 107.26 萬 | 146.27 萬 | 185.27 萬 | 365.67 萬 |
| R6 神話 | 18.90 萬 | 31.50 萬 | 44.10 萬 | 63.01 萬 | 88.21 萬 | 113.41 萬 | 138.61 萬 | 189.02 萬 | 239.42 萬 | 472.55 萬 |
| R7 創世 | 23.18 萬 | 38.63 萬 | 54.08 萬 | 77.26 萬 | 108.16 萬 | 139.06 萬 | 169.97 萬 | 231.77 萬 | 293.58 萬 | 579.43 萬 |
| R8 神鑄神話 | 27.45 萬 | 45.75 萬 | 64.06 萬 | 91.51 萬 | 128.11 萬 | 164.72 萬 | 201.32 萬 | 274.53 萬 | 347.73 萬 | 686.31 萬 |
| R9 神鑄創世 | 34.58 萬 | 57.63 萬 | 80.68 萬 | 115.26 萬 | 161.36 萬 | 207.47 萬 | 253.57 萬 | 345.78 萬 | 437.99 萬 | 864.45 萬 |
| R10 混沌 | 45.98 萬 | 76.63 萬 | 107.28 萬 | 153.26 萬 | 214.57 萬 | 275.87 萬 | 337.18 萬 | 459.79 萬 | 582.40 萬 | 1149.47 萬 |
| R11 神鑄混沌 | 65.93 萬 | 109.88 萬 | 153.84 萬 | 219.77 萬 | 307.67 萬 | 395.58 萬 | 483.49 萬 | 659.30 萬 | 835.12 萬 | 1648.26 萬 |

### 3.4 物理防禦 (Def) 極大值分佈與差異（1轉至 10轉）
| 裝備階級 | 1轉 | 2轉 | 3轉 | 4轉 | 5轉 | 6轉 | 7轉 | 8轉 | 9轉 | 10轉 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| R0 普通 | 14.12 萬<br><span style="color:red">▼ -1.07 萬</span> | 17.05 萬<br><span style="color:red">▼ -6.96 萬</span> | 20.79 萬<br><span style="color:red">▼ -15.98 萬</span> | 25.72 萬<br><span style="color:red">▼ -34.14 萬</span> | 32.45 萬<br><span style="color:red">▼ -68.74 萬</span> | 41.89 萬<br><span style="color:red">▼ -132.24 萬</span> | 55.38 萬<br><span style="color:red">▼ -254.89 萬</span> | 74.95 萬<br><span style="color:red">▼ -507.62 萬</span> | 103.63 萬<br><span style="color:red">▼ -1004.09 萬</span> | 146.00 萬<br><span style="color:red">▼ -2063.05 萬</span> |
| R1 精良 | 174.00 萬<br><span style="color:red">▼ -11.77 萬</span> | 209.98 萬<br><span style="color:red">▼ -85.38 萬</span> | 254.78 萬<br><span style="color:red">▼ -192.91 萬</span> | 312.82 萬<br><span style="color:red">▼ -406.11 萬</span> | 390.71 萬<br><span style="color:red">▼ -803.82 萬</span> | 498.39 萬<br><span style="color:red">▼ -1513.62 萬</span> | 650.74 萬<br><span style="color:red">▼ -2862.52 萬</span> | 870.10 萬<br><span style="color:red">▼ -5645.65 萬</span> | 1189.97 萬<br><span style="color:red">▼ -1.11 億</span> | 1660.61 萬<br><span style="color:red">▼ -2.27 億</span> |
| R2 稀有 | 276.82 萬<br><span style="color:red">▼ -17.38 萬</span> | 333.92 萬<br><span style="color:red">▼ -135.73 萬</span> | 404.06 萬<br><span style="color:red">▼ -303.07 萬</span> | 493.75 萬<br><span style="color:red">▼ -631.65 萬</span> | 612.77 萬<br><span style="color:red">▼ -1235.74 萬</span> | 775.79 萬<br><span style="color:red">▼ -2292.13 萬</span> | 1004.80 萬<br><span style="color:red">▼ -4275.12 萬</span> | 1332.80 萬<br><span style="color:red">▼ -8371.11 萬</span> | 1809.28 萬<br><span style="color:red">▼ -1.63 億</span> | 2508.49 萬<br><span style="color:red">▼ -3.36 億</span> |
| R3 獨特 | 490.05 萬<br><span style="color:red">▼ -28.31 萬</span> | 590.90 萬<br><span style="color:red">▼ -239.96 萬</span> | 712.97 萬<br><span style="color:red">▼ -529.58 萬</span> | 866.88 萬<br><span style="color:red">▼ -1092.38 萬</span> | 1068.56 萬<br><span style="color:red">▼ -2110.80 萬</span> | 1341.89 萬<br><span style="color:red">▼ -3851.01 萬</span> | 1722.69 萬<br><span style="color:red">▼ -7070.64 萬</span> | 2264.69 萬<br><span style="color:red">▼ -1.37 億</span> | 3048.51 萬<br><span style="color:red">▼ -2.65 億</span> | 4195.05 萬<br><span style="color:red">▼ -5.47 億</span> |
| R4 史詩 | 922.27 萬<br><span style="color:red">▼ -49.26 萬</span> | 1111.65 萬<br><span style="color:red">▼ -451.11 萬</span> | 1337.97 萬<br><span style="color:red">▼ -985.36 萬</span> | 1619.72 萬<br><span style="color:red">▼ -2013.83 萬</span> | 1984.59 萬<br><span style="color:red">▼ -3847.49 萬</span> | 2474.15 萬<br><span style="color:red">▼ -6911.25 萬</span> | 3150.75 萬<br><span style="color:red">▼ -1.24 億</span> | 4107.91 萬<br><span style="color:red">▼ -2.41 億</span> | 5485.90 萬<br><span style="color:red">▼ -4.60 億</span> | 7495.14 萬<br><span style="color:red">▼ -9.52 億</span> |
| R5 傳說 | 1385.45 萬<br><span style="color:red">▼ -70.91 萬</span> | 1669.63 萬<br><span style="color:red">▼ -677.27 萬</span> | 2006.99 萬<br><span style="color:red">▼ -1471.52 萬</span> | 2424.13 萬<br><span style="color:red">▼ -2992.85 萬</span> | 2960.94 萬<br><span style="color:red">▼ -5683.51 萬</span> | 3677.24 萬<br><span style="color:red">▼ -1.01 億</span> | 4662.78 萬<br><span style="color:red">▼ -1.81 億</span> | 6052.18 萬<br><span style="color:red">▼ -3.47 億</span> | 8047.38 萬<br><span style="color:red">▼ -6.63 億</span> | 1.10 億<br><span style="color:red">▼ -13.70 億</span> |
| R6 神話 | 2255.76 萬<br><span style="color:red">▼ -110.55 萬</span> | 2717.97 萬<br><span style="color:red">▼ -1102.12 萬</span> | 3263.09 萬<br><span style="color:red">▼ -2382.01 萬</span> | 3932.58 萬<br><span style="color:red">▼ -4821.24 萬</span> | 4788.62 萬<br><span style="color:red">▼ -9111.38 萬</span> | 5924.50 萬<br><span style="color:red">▼ -1.61 億</span> | 7480.12 萬<br><span style="color:red">▼ -2.85 億</span> | 9665.37 萬<br><span style="color:red">▼ -5.44 億</span> | 1.28 億<br><span style="color:red">▼ -10.32 億</span> | 1.73 億<br><span style="color:red">▼ -21.37 億</span> |
| R7 創世 | 3336.69 萬<br><span style="color:red">▼ -158.81 萬</span> | 4019.91 萬<br><span style="color:red">▼ -1629.75 萬</span> | 4822.24 萬<br><span style="color:red">▼ -3510.06 萬</span> | 5803.22 萬<br><span style="color:red">▼ -7096.78 萬</span> | 7052.18 萬<br><span style="color:red">▼ -1.33 億</span> | 8703.13 萬<br><span style="color:red">▼ -2.34 億</span> | 1.10 億<br><span style="color:red">▼ -4.12 億</span> | 1.41 億<br><span style="color:red">▼ -7.85 億</span> | 1.86 億<br><span style="color:red">▼ -14.81 億</span> | 2.52 億<br><span style="color:red">▼ -30.69 億</span> |
| R8 神鑄神話 | 4628.36 萬<br><span style="color:red">▼ -215.58 萬</span> | 5575.59 萬<br><span style="color:red">▼ -2260.02 萬</span> | 6684.51 萬<br><span style="color:red">▼ -4815.49 萬</span> | 8035.94 萬<br><span style="color:red">▼ -9764.06 萬</span> | 9751.17 萬<br><span style="color:red">▼ -1.83 億</span> | 1.20 億<br><span style="color:red">▼ -3.20 億</span> | 1.51 億<br><span style="color:red">▼ -5.63 億</span> | 1.94 億<br><span style="color:red">▼ -10.67 億</span> | 2.55 億<br><span style="color:red">▼ -20.10 億</span> | 3.45 億<br><span style="color:red">▼ -41.66 億</span> |
| R9 神鑄創世 | 7249.23 萬<br><span style="color:red">▼ -329.32 萬</span> | 8732.01 萬<br><span style="color:red">▼ -3567.99 萬</span> | 1.05 億<br><span style="color:red">▼ -7538.22 萬</span> | 1.26 億<br><span style="color:red">▼ -1.52 億</span> | 1.52 億<br><span style="color:red">▼ -2.84 億</span> | 1.87 億<br><span style="color:red">▼ -4.95 億</span> | 2.34 億<br><span style="color:red">▼ -8.65 億</span> | 3.01 億<br><span style="color:red">▼ -16.34 億</span> | 3.95 億<br><span style="color:red">▼ -30.68 億</span> | 5.31 億<br><span style="color:red">▼ -63.65 億</span> |
| R10 混沌 | 1.26 億<br><span style="color:red">▼ -560.92 萬</span> | 1.52 億<br><span style="color:red">▼ -6177.01 萬</span> | 1.82 億<br><span style="color:red">▼ -1.33 億</span> | 2.19 億<br><span style="color:red">▼ -2.64 億</span> | 2.64 億<br><span style="color:red">▼ -4.93 億</span> | 3.24 億<br><span style="color:red">▼ -8.52 億</span> | 4.06 億<br><span style="color:red">▼ -14.82 億</span> | 5.19 億<br><span style="color:red">▼ -27.92 億</span> | 6.80 億<br><span style="color:red">▼ -52.22 億</span> | 9.13 億<br><span style="color:red">▼ -108.41 億</span> |
| R11 神鑄混沌 | 2.57 億<br><span style="color:red">▼ -1112.91 萬</span> | 3.09 億<br><span style="color:red">▼ -1.26 億</span> | 3.70 億<br><span style="color:red">▼ -2.68 億</span> | 4.44 億<br><span style="color:red">▼ -5.35 億</span> | 5.36 億<br><span style="color:red">▼ -9.92 億</span> | 6.56 億<br><span style="color:red">▼ -17.09 億</span> | 8.19 億<br><span style="color:red">▼ -29.57 億</span> | 10.44 億<br><span style="color:red">▼ -55.55 億</span> | 13.66 億<br><span style="color:red">▼ -103.54 億</span> | 18.29 億<br><span style="color:red">▼ -215.09 億</span> |

### 3.5 各類減傷極大值與對應屬性數值對照表（以 10轉 頂峰為基準，對戰 Lv.650 敵人）
| 裝備階級 | 物理防禦減傷 (物防值) | 魔法防禦減傷 (魔防值) | 物理抗性減傷 (物抗值) | 魔法抗性減傷 (魔抗值) | 元素抗性減傷 (全抗值) | 全局減傷 (減傷值) | BOSS減傷 (BOSS減傷值) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| R0 普通 | 95.737733%<br><span style="color:red">▼ 4.194411%</span><br>(146.00 萬) | 95.589961%<br><span style="color:red">▼ 4.339723%</span><br>(140.89 萬) | 99.982944%<br><span style="color:gray">持平</span><br>(8,528) | 99.982944%<br><span style="color:gray">持平</span><br>(8,528) | 99.976081%<br><span style="color:gray">持平</span><br>(6,697) | 78.657708%<br><span style="color:gray">持平</span><br>(1.84 萬) | 87.436251%<br><span style="color:gray">持平</span><br>(4.17 萬) |
| R1 精良 | 99.610105%<br><span style="color:red">▼ 0.383748%</span><br>(1660.61 萬) | 99.596021%<br><span style="color:red">▼ 0.397609%</span><br>(1602.49 萬) | 99.990331%<br><span style="color:gray">持平</span><br>(1.28 萬) | 99.990331%<br><span style="color:gray">持平</span><br>(1.28 萬) | 99.983899%<br><span style="color:gray">持平</span><br>(8,886) | 84.682073%<br><span style="color:gray">持平</span><br>(2.76 萬) | 92.321552%<br><span style="color:gray">持平</span><br>(6.26 萬) |
| R2 稀有 | 99.741550%<br><span style="color:red">▼ 0.254295%</span><br>(2508.49 萬) | 99.732201%<br><span style="color:red">▼ 0.263493%</span><br>(2420.69 萬) | 99.993536%<br><span style="color:gray">持平</span><br>(1.71 萬) | 99.993536%<br><span style="color:gray">持平</span><br>(1.71 萬) | 99.988170%<br><span style="color:gray">持平</span><br>(1.11 萬) | 88.054088%<br><span style="color:gray">持平</span><br>(3.69 萬) | 94.659468%<br><span style="color:gray">持平</span><br>(8.35 萬) |
| R3 獨特 | 99.845295%<br><span style="color:red">▼ 0.152158%</span><br>(4195.05 萬) | 99.839693%<br><span style="color:red">▼ 0.157668%</span><br>(4048.22 萬) | 99.995964%<br><span style="color:gray">持平</span><br>(2.39 萬) | 99.995964%<br><span style="color:gray">持平</span><br>(2.39 萬) | 99.991947%<br><span style="color:gray">持平</span><br>(1.46 萬) | 91.165680%<br><span style="color:gray">持平</span><br>(5.16 萬) | 96.541006%<br><span style="color:gray">持平</span><br>(11.68 萬) |
| R4 史詩 | 99.913352%<br><span style="color:red">▼ 0.085187%</span><br>(7495.14 萬) | 99.910212%<br><span style="color:red">▼ 0.088274%</span><br>(7232.81 萬) | 99.997551%<br><span style="color:gray">持平</span><br>(3.41 萬) | 99.997551%<br><span style="color:gray">持平</span><br>(3.41 萬) | 99.994766%<br><span style="color:gray">持平</span><br>(1.98 萬) | 93.647619%<br><span style="color:gray">持平</span><br>(7.37 萬) | 97.833943%<br><span style="color:gray">持平</span><br>(16.69 萬) |
| R5 傳說 | 99.940681%<br><span style="color:red">▼ 0.058305%</span><br>(1.10 億) | 99.938531%<br><span style="color:red">▼ 0.060418%</span><br>(1.06 億) | 99.998208%<br><span style="color:gray">持平</span><br>(4.26 萬) | 99.998208%<br><span style="color:gray">持平</span><br>(4.26 萬) | 99.996041%<br><span style="color:gray">持平</span><br>(2.42 萬) | 94.852700%<br><span style="color:gray">持平</span><br>(9.21 萬) | 98.388167%<br><span style="color:gray">持平</span><br>(20.86 萬) |
| R6 神話 | 99.962531%<br><span style="color:red">▼ 0.036819%</span><br>(1.73 億) | 99.961173%<br><span style="color:red">▼ 0.038154%</span><br>(1.67 億) | 99.998759%<br><span style="color:gray">持平</span><br>(5.54 萬) | 99.998759%<br><span style="color:gray">持平</span><br>(5.54 萬) | 99.997171%<br><span style="color:gray">持平</span><br>(3.08 萬) | 95.992941%<br><span style="color:gray">持平</span><br>(11.98 萬) | 98.863392%<br><span style="color:gray">持平</span><br>(27.12 萬) |
| R7 創世 | 99.974193%<br><span style="color:red">▼ 0.025355%</span><br>(2.52 億) | 99.973257%<br><span style="color:red">▼ 0.026275%</span><br>(2.43 億) | 99.999072%<br><span style="color:gray">持平</span><br>(6.82 萬) | 99.999072%<br><span style="color:gray">持平</span><br>(6.82 萬) | 99.997842%<br><span style="color:gray">持平</span><br>(3.73 萬) | 96.719618%<br><span style="color:gray">持平</span><br>(14.74 萬) | 99.138822%<br><span style="color:gray">持平</span><br>(33.38 萬) |
| R8 神鑄神話 | 99.981141%<br><span style="color:red">▼ 0.018527%</span><br>(3.45 億) | 99.980457%<br><span style="color:red">▼ 0.019199%</span><br>(3.33 億) | 99.999270%<br><span style="color:gray">持平</span><br>(8.10 萬) | 99.999270%<br><span style="color:gray">持平</span><br>(8.10 萬) | 99.998280%<br><span style="color:gray">持平</span><br>(4.39 萬) | 97.223191%<br><span style="color:gray">持平</span><br>(17.51 萬) | 99.315899%<br><span style="color:gray">持平</span><br>(39.64 萬) |
| R9 神鑄創世 | 99.987770%<br><span style="color:red">▼ 0.012013%</span><br>(5.31 億) | 99.987326%<br><span style="color:red">▼ 0.012448%</span><br>(5.13 億) | 99.999474%<br><span style="color:gray">持平</span><br>(10.23 萬) | 99.999474%<br><span style="color:gray">持平</span><br>(10.23 萬) | 99.998740%<br><span style="color:gray">持平</span><br>(5.48 萬) | 97.788902%<br><span style="color:gray">持平</span><br>(22.11 萬) | 99.500006%<br><span style="color:gray">持平</span><br>(50.07 萬) |
| R10 混沌 | 99.992883%<br><span style="color:red">▼ 0.006989%</span><br>(9.13 億) | 99.992625%<br><span style="color:red">▼ 0.007242%</span><br>(8.81 億) | 99.999648%<br><span style="color:gray">持平</span><br>(13.64 萬) | 99.999648%<br><span style="color:gray">持平</span><br>(13.64 萬) | 99.999145%<br><span style="color:gray">持平</span><br>(7.24 萬) | 98.332458%<br><span style="color:gray">持平</span><br>(29.48 萬) | 99.660372%<br><span style="color:gray">持平</span><br>(66.76 萬) |
| R11 神鑄混沌 | 99.996447%<br><span style="color:red">▼ 0.003489%</span><br>(18.29 億) | 99.996318%<br><span style="color:red">▼ 0.003616%</span><br>(17.65 億) | 99.999788%<br><span style="color:gray">持平</span><br>(19.61 萬) | 99.999788%<br><span style="color:gray">持平</span><br>(19.61 萬) | 99.999479%<br><span style="color:gray">持平</span><br>(10.30 萬) | 98.834054%<br><span style="color:gray">持平</span><br>(42.38 萬) | 99.791642%<br><span style="color:gray">持平</span><br>(95.97 萬) |

---

## 四、核心案例深度對照解析：以「R11 神鑄混沌」為例

以情境二（10轉 R11 神鑄混沌 + 滿寶石）為基準，展示本次平衡修改的數值變動：

### 4.1 物理防禦減傷演進
- **底層物理防禦數值**：
  - 前版 V4 數值：`11,638,011,578` (116.38 億)
  - 現行 V5 數值：`894,000,000` (**8.94 億**)
  - **屬性變更**：**<span style="color:red">▼ -107.44 億 (-92.3%)</span>**
- **物理防禦減傷率**：
  - 前版 V4 公式（常數 15,000）：$r_{\text{Def}} = \frac{116.38\text{億}}{116.38\text{億} + 15,000} = \mathbf{99.999871\%}$
  - 現行 V5 公式（常數 65,000）：$r_{\text{Def}} = \frac{8.94\text{億}}{8.94\text{億} + 65,000} = \mathbf{99.992731\%}$
  - **減傷率差異**：**<span style="color:red">▼ -0.007140%</span>**
- **殘留穿透率變化**：
  - 前版 V4 殘留承傷率：`0.000129%`（**1.289 ppm**）
  - 現行 V5 殘留承傷率：`0.007269%`（**72.69 ppm**）
  - **防禦穿透殘留傷害擴大約 56.4 倍，徹底終結了以往過於死板的免傷屏障。**

### 4.2 該狀態下全減傷維度差異總表
| 減傷類型 | 前版基準 (V4) | 現行最新版 (V5) | 數值差異 (現行 - 前版) | 對應底層數值 | 殘留承傷率 (1 - r) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **物理防禦** | 99.999871% | 99.992731% | **<span style="color:red">▼ -0.007140%</span>** | 8.94 億 | 0.007269% (72.69 ppm) |
| **魔法防禦** | 99.999871% | 99.992469% | **<span style="color:red">▼ -0.007402%</span>** | 8.63 億 | 0.007531% (75.31 ppm) |
| **物理抗性** | 99.712152% | 99.712152% | <span style="color:gray">持平 (0.000000%)</span> | 11.31 萬 | 0.287848% |
| **魔法抗性** | 99.712152% | 99.712152% | <span style="color:gray">持平 (0.000000%)</span> | 11.31 萬 | 0.287848% |
| **元素全抗** | 99.184881% | 99.184881% | <span style="color:gray">持平 (0.000000%)</span> | 5.35 萬 | 0.815119% |
| **全局減傷** | 97.694939% | 97.694939% | <span style="color:gray">持平 (0.000000%)</span> | 21.19 萬 | 2.305061% |
| **BOSS減傷** | 99.285828% | 99.285828% | <span style="color:gray">持平 (0.000000%)</span> | 38.39 萬 | 0.714172% |
| **四維主屬性** | 879.07 萬 | 879.07 萬 | <span style="color:gray">持平 (0 點)</span> | 879.07 萬 | 派生攻防血量基底 |
| **生命值** | 135.22 億 | 135.22 億 | <span style="color:gray">持平 (0 點)</span> | - | - |
| **法力值** | 4525.58 萬 | 4525.58 萬 | <span style="color:gray">持平 (0 點)</span> | - | - |

---

## 五、實戰多層獨立減傷疊乘穿透試算（對戰 Lv.650 永恒神殿 BOSS）

以情境三（10轉 R11 神鑄混沌 + 滿寶石 + 滿威能，物防 **18.29 億**）面對 Lv.650 永恒神殿 BOSS 攻擊為例：

### 5.1 各層減傷之精確殘留穿透率 ($1 - r$)
| 減傷屏障層 | 前版基準 (V4) 殘留率 | 現行最新版 (V5) 殘留率 | 變化說明 |
| :--- | :--- | :--- | :--- |
| **物理防禦** | $6.427 \times 10^{-7}$ (0.643 ppm) | **$3.554 \times 10^{-5}$ (35.54 ppm)** | **<span style="color:red">穿透率放大 55.3 倍 ▼</span>** |
| **物理抗性** | $1.292 \times 10^{-3}$ | **$1.292 \times 10^{-3}$** | <span style="color:gray">持平</span> |
| **全局減傷** | $1.166 \times 10^{-2}$ | **$1.166 \times 10^{-2}$** | <span style="color:gray">持平</span> |
| **BOSS減傷** | $2.084 \times 10^{-3}$ | **$2.084 \times 10^{-3}$** | <span style="color:gray">持平</span> |

### 5.2 四層獨立乘算後的總承傷率
- **前版 (V4) 總穿透率**：
  $$\text{TotalPen}_{\text{V4}} \approx 2.018 \times 10^{-14}$$
- **現行最新版 (V5) 總穿透率**：
  $$\begin{aligned}
  \text{TotalPen}_{\text{V5}} &= (3.554 \times 10^{-5}) \times (1.292 \times 10^{-3}) \times (1.166 \times 10^{-2}) \times (2.084 \times 10^{-3}) \\
  &\approx \mathbf{1.115 \times 10^{-12}}
  \end{aligned}$$
- **總承傷綜合結論**：  
  由於轉生定值底數下修為 1.5 且分母常數擴大至 65,000，總穿透率由 $2.02 \times 10^{-14}$ 適度提升至 $1.12 \times 10^{-12}$（放大約 55.3 倍）。防護體系依舊堅實，但徹底打破過往幾近完全免疫、永遠跳 1 點保底的數值僵局。

### 5.3 實戰 BOSS 攻擊穿透試算對比（含永恒神殿 650 級真實攻擊力）
| 敵方出手招式與原始攻擊傷害 | 前版 (V4) 實質殘留傷害 | 現行最新版 (V5) 實質殘留傷害 | 實戰戰鬥節奏與反饋對比 |
| :--- | :--- | :--- | :--- |
| **100 萬** ($10^6$) | $2.02 \times 10^{-8}$ 點 | **$1.12 \times 10^{-6}$ 點** | **1 點 vs 1 點**（系統最低保底） |
| **1 億** ($10^8$) | $2.02 \times 10^{-6}$ 點 | **$1.12 \times 10^{-4}$ 點** | **1 點 vs 1 點**（系統最低保底） |
| **1 兆** ($10^{12}$) | $0.0202$ 點 | **$1.12$ 點** | **1 點 vs 1 點**（剛好跨越最低保底門檻） |
| **10,000 兆** ($10^{16}$) | $201.8$ 點 | **$11,152$ 點** | **202 點 vs 1.1 萬點**（具備實質打擊反饋） |
| **650 級普通怪普攻** ($1.294 \times 10^{16}$) | $261.1$ 點 | **$14,431$ 點** (約 1.4 萬) | 清怪時有清晰可見的輕微受傷跳字 |
| **650 級 BOSS 常規普攻** ($5.176 \times 10^{16}$) | $1,044.5$ 點 | **$57,724$ 點** (約 5.8 萬) | **打擊感確立**，不再是尷尬的 1 點保底 |
| **650 級 BOSS 普攻暴擊** ($1.553 \times 10^{17}$) | $3,133.5$ 點 | **$173,193$ 點** (約 17.3 萬) | 承受 BOSS 重擊時跳出六位數明確反饋 |
| **650 級 BOSS 技能爆發** ($2.588 \times 10^{17}$) | $5,222.5$ 點 | **$288,618$ 點** (約 28.9 萬) | **強烈首領威壓**，破防近 30 萬！ |
| **狂暴/極限特化 BOSS** ($1.000 \times 10^{18}$) | $20,180$ 點 | **$1,115,200$ 點** (約 111.5 萬) | 深度考驗玩家護盾厚度與每秒秒回能力 |

面對永恒神殿 650 級 BOSS 高達 **26 萬兆** 的極限技能爆發時，玩家所受傷害由前版的 5,222 點調整至 **28.9 萬點**。相對於玩家此時的 **238.39 億** 生命值與每秒數百萬的回血效率而言，生存完全無虞，同時徹底告別「打小怪扣 1 點、打神級 BOSS 也扣 1 點」的假打感，正式邁入真實、沉浸且符合 ARPG 頂級戰鬥預期的健康數值生態！
