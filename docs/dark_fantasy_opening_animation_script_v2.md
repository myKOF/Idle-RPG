# 黑暗史詩開頭動畫腳本（第二版：含旁白與動態設定）

## 總體視覺與風格設定
* **美術風格**：暗黑破壞神式黑暗哥德美學、低彩度、黃沙漫天、神聖之光與邪惡冥火交織。
* **音效基調**：低沉宏大的交響樂伴隨末日鐘聲，夾雜著悲鳴與雷鳴。
* **鏡頭節奏**：由遠至近，從宏觀世界崩壞過渡至微觀主角覺醒。

---

## 分鏡、旁白與 Agent 動態執行指令

### 【第 01 - 06 秒】神界崩壞與惡魔入侵
* **旁白（低沉滄桑的男中音）**：「當永恒的聖殿崩塌，秩序的曙光被無情撕裂……」
* **動態畫面設定**：
  * **天空/背景**：金碧輝煌的天界浮島背景需有碎塊剝落、漂浮微粒下墜的動態；黑色的地獄裂隙呈現脈動式擴張，周圍伴隨閃電與紫黑色能量粒子特效。
  * **裝飾物件**：天界巨大的白色/金色旗幟在狂亂的虛空風暴中劇烈撕裂、燃燒並化為灰燼。
* **Agent 執行指令**：
  ```json
  {
    "scene": "heaven_collapse",
    "duration_seconds": 6,
    "camera": "pan_down_from_sky",
    "dynamic_elements": {
      "sky_background": "shattering_floating_islands_with_falling_debris",
      "portal": "pulsing_dark_rift_with_lightning",
      "flags": "tearing_and_burning_golden_banners"
    },
    "visual_elements": ["shattering_golden_palace", "swarming_demons"],
    "lighting": "dark_crimson_and_gold_glow"
  }
  ```

### 【第 06 - 13 秒】天使殞落人間
* **旁白**：「傲慢的審判墜落凡塵，榮耀化為焦土。」
* **動態畫面設定**：
  * **人物動態**：主角天使（對應遊戲造型）在空中展現生動的掙扎姿態——身軀因重創而痙攣、面容痛苦，雙翼原本優美的羽毛不斷剝落並燃燒著殘存烈焰，戰甲在高速墜落中摩擦出火花。
  * **天空/背景**：雲層被流星般的白金尾跡高速劃破，周遭空間呈現扭曲的動態模糊。
* **Agent 執行指令**：
  ```json
  {
    "scene": "angel_fall",
    "duration_seconds": 7,
    "camera": "fast_tracking_shot_following_meteor",
    "dynamic_elements": {
      "character_animation": "struggling_in_midair_with_spasms_and_flapping_damaged_wings",
      "wings": "shedding_burning_feathers_trail",
      "sky_background": "high_speed_motion_blur_clouds"
    },
    "visual_elements": ["wounded_angel", "crashing_into_ground"],
    "lighting": "blinding_white_trail_fading_to_dust"
  }
  ```

### 【第 13 - 21 秒】人間屍橫遍野與遺跡對比
* **旁白**：「迎接我們的，是萬物的寂滅與無盡的荒涼。」
* **動態畫面設定**：
  * **背景/物件動態**：黃沙大地上的沙塵暴以緩慢但壓抑的頻率吹拂，殘破的石拱門遺跡旁，懸掛的殘破破布與骷髏身上的碎布隨風飄動。
  * **地面環境**：遠處偶有幽冥鬼火（鬼火粒子飄浮閃爍），地上乾枯的植被與白骨在風中微微晃動。
* **Agent 執行指令**：
  ```json
  {
    "scene": "desolate_human_world",
    "duration_seconds": 8,
    "camera": "slow_dolly_forward",
    "dynamic_elements": {
      "background_environment": "rolling_dust_storms_and_drifting_sand",
      "decorations": "tattered_rags_and_skeletons_swaying_in_wind",
      "particles": "floating_wisps_of_ghost_fire"
    },
    "visual_elements": ["scattered_skeletons", "ruined_stone_arch", "bleak_desert"],
    "lighting": "gloomy_desaturated_yellow_and_shadow"
  }
  ```

### 【第 21 - 30 秒】重拾聖光與踏上征程
* **旁白**：「但只要神聖之火未熄，流血的雙足，終將踏上復仇與救贖的征程。」
* **動態畫面設定**：
  * **人物動態**：天使倒在黃沙中，手指微微顫抖（細膩的物理抓地動作），隨後雙眼猛然張開，射出堅定白光。他以雙手撐地，肌肉緊繃地緩步站起，甩開殘破披風，有力地握緊武器。
  * **背景過渡**：鏡頭推向角色背後，周遭惡魔幽靈逼近，畫面順暢過渡到遊戲實際操作介面與 UI。
* **Agent 執行指令**：
  ```json
  {
    "scene": "rise_and_quest",
    "duration_seconds": 9,
    "camera": "push_out_to_gameplay_perspective",
    "dynamic_elements": {
      "character_animation": "fingers_twitching_eyes_opening_steadily_pushing_up_to_feet",
      "weapon_action": "firmly_gripping_weapon_with_sparking_sacred_light",
      "transition": "seamless_fade_to_ui_hud"
    },
    "visual_elements": ["angel_hand_sparking_sacred_light", "standing_up_resolute"],
    "lighting": "burst_of_hopeful_white_light_cutting_through_darkness"
  }
  ```

---

## 💡 開發者銜接建議：
透過上述設定，Agent 可以利用粒子特效、布料模擬（旗幟與披風動態）以及人物骨骼動畫（掙扎、起身、握拳），在不依賴高成本 3D 渲染的情況下，營造出張力十足的暗黑系動態開頭動畫！