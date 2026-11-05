# 黑暗史詩開頭動畫腳本（約 30 秒）

## 總體視覺與風格設定
* **美術風格**：暗黑破壞神式黑暗哥德美學、低彩度、黃沙漫天、神聖之光與邪惡冥火交織。
* **音效基調**：低沉宏大的交響樂伴隨末日鐘聲，夾雜著悲鳴與雷鳴。
* **鏡頭節奏**：由遠至近，從宏觀世界崩壞過渡至微觀主角覺醒。

---

## 分鏡與 Agent 執行指令

### 【第 01 - 06 秒】神界崩壞與惡魔入侵
* **畫面描述**：
  * **鏡頭**：極遠景（Extreme Long Shot），俯瞰金碧輝煌但正逐漸碎裂的天界浮島。
  * **動作**：巨大的金色神殿崩塌，神聖的穹頂被黑色的地獄裂隙撕裂。無數燃燒著烈焰的惡魔從裂縫中蜂擁而出，將代表秩序的聖光無情吞噬。
* **Agent 執行指令**：
  ```json
  {
    "scene": "heaven_collapse",
    "duration_seconds": 6,
    "camera": "pan_down_from_sky",
    "visual_elements": ["shattering_golden_palace", "hell_portal_opening", "swarming_demons"],
    "lighting": "dark_crimson_and_gold_glow"
  }
  ```

### 【第 06 - 13 秒】天使殞落人間
* **畫面描述**：
  * **鏡頭**：中景拉近（Medium Close-up），追隨一道耀眼的白金流星劃破天際。
  * **動作**：一位身披破損戰甲的天使（對應遊戲中的角色造型）被暗黑魔爪擊中，雙翼燃燒著殘存的羽芒，如斷線風箏般筆直墜向塵土飛揚的大地。
* **Agent 執行指令**：
  ```json
  {
    "scene": "angel_fall",
    "duration_seconds": 7,
    "camera": "fast_tracking_shot_following_meteor",
    "visual_elements": ["wounded_angel_with_burning_wings", "desperate_expression", "crashing_into_ground"],
    "lighting": "blinding_white_trail_fading_to_dust"
  }
  ```

### 【第 13 - 21 秒】人間屍橫遍野與遺跡對比
* **畫面描述**：
  * **鏡頭**：平視推鏡（Push-in Shot），掠過荒涼的黃沙大地與殘破的石拱門遺跡。
  * **動作**：地面上屍橫遍野、白骨枯槁（呼應你遊戲截圖中的遺骸與荒蕪沙漠）。四周燃燒著點點幽冥鬼火，空氣中瀰漫著絕望與死寂。
* **Agent 執行指令**：
  ```json
  {
    "scene": "desolate_human_world",
    "duration_seconds": 8,
    "camera": "slow_dolly_forward",
    "visual_elements": ["scattered_skeletons", "ruined_stone_arch", "smoldering_debris", "bleak_desert"],
    "lighting": "gloomy_desaturated_yellow_and_shadow"
  }
  ```

### 【第 21 - 30 秒】重拾聖光與踏上征程
* **畫面描述**：
  * **鏡頭**：特寫轉全景（Close-up to Wide Shot），從倒地的天使手部特寫拉開。
  * **動作**：墜落受傷的天使緩緩睜開雙眼，掌心迸發出微弱但堅定的聖光。他撐起身體，拾起武器，轉身面向前方步步逼近的幽靈惡魔。鏡頭定格並無縫銜接至遊戲實際畫面與 UI 介面。
* **Agent 執行指令**：
  ```json
  {
    "scene": "rise_and_quest",
    "duration_seconds": 9,
    "camera": "push_out_to_gameplay_perspective",
    "visual_elements": ["angel_hand_sparking_sacred_light", "standing_up_resolute", "transition_to_ui_hud"],
    "lighting": "burst_of_hopeful_white_light_cutting_through_darkness"
  }
  ```

---

## 開發者銜接建議：
在動畫最後的第 30 秒，當天使拿起武器站起時，可以直接淡入（Fade in）目前的遊戲介面（血球、藍球、技能列與地圖標示），讓玩家無縫從「觀看者」切換為「操作者」，瞬間點燃戰鬥意志！