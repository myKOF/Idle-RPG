'use strict';
/* ============ 符文真言：資料表（符文 33 種、符文真言 65 組）============
   本檔只放資料與純查表函式，不碰 G、不寫狀態（共載檔規則）。
   執行邏輯（鑲嵌判定、屬性聚合、觸發引擎）→ js/runeword.js；兩支同時載入於主執行緒與 Worker。

   ---- 玩法（參考暗黑 2 的符文真言）----
   1. 符文是獨立的素材（G.player.runes = { 符文id: 數量 }），鑲在裝備專屬的「符文孔」裡（it.runes，
      孔數依稀有度，雙手武器再加孔，最多到 RUNE_SETTINGS.maxSlots），與寶石的鑲孔（it.sockets）完全分開。
      符文孔取代了原本的附魔欄位（附魔功能已關閉，見 data.js ENCHANT_ENABLED）。
   2. 把「指定的符文、依指定順序」鑲進「連續的符文孔」，且裝備類型符合 → 該裝備成為符文真言裝備。
      符文真言是**當場判定**的衍生狀態（不存檔）：拆下任何一顆符文就失效，換回順序又恢復。
   3. 符文孔數由稀有度決定（RARITIES[i].runeSlots，配置表 game_parameters「表-稀有度」的參數g）；
      雙手武器在有符文孔的稀有度上再加 RUNE_SETTINGS.twoHandBonusSlots（加法，不是倍數）。
      配方的符文數受孔數限制：一般裝備放得下的配方任何裝備都能用，比一般裝備最多孔數還長的配方只給雙手武器。
      難度因此不靠孔數，而靠符文本身的階數與取得難度。
   4. 每顆符文單獨鑲著也有加成（武器／防具各一條），符文真言生效時兩者並存。

   ---- 數值口徑（單一權威）----
   符文（RUNES 的 w／a）的數值＝ 詞條可能範圍的下限 × mult × 雙手倍率：
     下限＝ affixBaseValue(詞條, 裝備等級, 稀有度) × 80%（就是裝備詳情提示「可能出現的詞條 [下限 ~ 上限]」的下限）；
     雙手武器的詞條本身 ×2，符文跟著 ×2。倍率 1 ＝ 一條詞條的下限值。
   符文真言（RUNEWORDS）stats 的數值＝ 同一個下限（基礎值）× mult，不乘雙手倍率。因此隨裝備等級與稀有度自動成長，
     與詞條系統同源，不另建第二套數值（AI_RULES §7）。mult 可為負數（＝代價）。
   fx／procs 的數字是固定值（不隨稀有度成長）——它們是機制，不是屬性。

   ---- 強度分級（tier）與品質 ----
     品質沿用裝備品質的名稱與顏色（RUNEWORD_TIER_RARITY，白＝普通、綠＝精良、藍＝稀有、紫＝史詩、橘＝傳說）。
     目前只有 4 級，所以對應 普通／精良／史詩／傳說（藍色的「稀有」留空，之後要加第 5 級時可補）：
     1 普通      2~3 符文，最高階 ≤ 10　屬性包為主，附一點小機制
     2 精良      3~4 符文，最高階 11～16　屬性包＋一個真正有感的機制
     3 史詩      3~4 符文，最高階 17～23　多重機制，定位明確
     4 傳說      3~5 符文，最高階 24～33　改寫技能／生存／節奏規則，附代價或高門檻；
                 **每組至少帶一個傳奇特效（legend）**，且 23 個主技能（SKILLS2 的群組）各有一組帶它的傳奇特效，
                 所以傳說級不得少於 23 組（tests/runeword-data.test.cjs 會擋）；每個主技能最多 2 組。

   ---- 「已激活」記錄（圖鑑隱藏機制；js/runeword.js §2）----
   每組符文真言要「成形過一次」才會在圖鑑與符文庫顯示配方與效果（G.player.runewordSeen，隨存檔）；
   在那之前只顯示名稱、品質、需要的孔數、適用裝備與風味文字，其餘用問號。內測版可以用符文頁的開關全部攤開。
   符文孔數有上限，長度不是難度來源；難度來自配方裡最高階那顆符文有多稀有（見 RUNE_SETTINGS.drop）。
   符文數的分佈：2 顆 11 組、3 顆 30 組、4 顆 18 組、5 顆 6 組（3 顆最多，其餘兩端少，避免 2 與 4 佔掉九成）。
   ============================================================ */

/* ---- 符文（33 種，由低到高）----
   w＝武器類（主手、雙手）鑲入時的加成；a＝防具、飾品、副手鑲入時的加成。
   [詞條鍵, mult]；詞條鍵必須是 AFFIX_POOL 的鍵（all_lock 的鎖定詞條不可用）。 */
var RUNES = [
  { id: 'r01', name: '微光', w: ['hit', 1], a: ['evasion', 0.3], flavor: '黑暗裡最先亮起的一點微光，指引落點，也教人閃身而過。' },
  { id: 'r02', name: '餘燼', w: ['atkFlat', 1], a: ['defFlat', 0.3], flavor: '火熄之後仍未冷去的餘燼，餘溫裡藏著再燃的力量。' },
  { id: 'r03', name: '霜痕', w: ['elemDmgIce', 0.3], a: ['resIce', 0.15], flavor: '霜在石上留下的細痕，一碰便是刺骨的寒意。' },
  { id: 'r04', name: '風語', w: ['aspd', 0.3], a: ['evasion', 0.35], flavor: '風的聲息稍縱即逝，發出嘆息之悲鳴。' },
  { id: 'r05', name: '巖心', w: ['pPen', 0.06], a: ['defPct', 0.29], flavor: '埋在山腹最深處的石心，千年不碎，也能穿透一切。' },
  { id: 'r06', name: '毒牙', w: ['elemDmgPoison', 0.29], a: ['resPoison', 0.14], flavor: '蛇牙上的一滴毒，無聲，卻比刀更準。' },
  { id: 'r07', name: '雷鳴', w: ['elemDmgLightning', 0.28], a: ['resLightning', 0.14], flavor: '遠方的悶雷滾過天際，下一瞬便落在腳邊。' },
  { id: 'r08', name: '暗影', w: ['lifesteal', 0.33], a: ['hpRegen', 0.33], flavor: '影子貼著傷口低語，它拿走的，總會以別的方式還回來。' },
  { id: 'r09', name: '聖輝', w: ['elemDmgLight', 0.28], a: ['resLight', 0.14], flavor: '清晨第一道穿雲的光，照亮之處，黑暗無處容身。' },
  { id: 'r10', name: '血誓', w: ['atkPct', 0.32], a: ['hpPct', 0.32], flavor: '以血立下的誓言，不收回，也不能背棄。' },
  { id: 'r11', name: '鋼魄', w: ['critDmg', 0.36], a: ['pRes', 0.09], flavor: '千錘百鍊的鋼，折不彎，亦藏著致命的鋒芒。' },
  { id: 'r12', name: '靈泉', w: ['matkPct', 0.31], a: ['mpFlat', 0.4], flavor: '山間不竭的靈泉，一掬便潤澤乾涸的心神。' },
  { id: 'r13', name: '疾影', w: ['critRate', 0.35], a: ['hit', 0.39], flavor: '快到只剩殘影，旁人看見時，一切已成定局。' },
  { id: 'r14', name: '磐石', w: ['eliteDmg', 0.34], a: ['blockRate', 0.38], flavor: '立在洪流中央的巨岩，任它如何沖刷，不退半步。' },
  { id: 'r15', name: '曙光', w: ['mPen', 0.06], a: ['mRes', 0.08], flavor: '長夜將盡時的一線曙光，刺破最厚的迷障。' },
  { id: 'r16', name: '夜幕', w: ['elemDmgDark', 0.33], a: ['resDark', 0.17], flavor: '夜幕降下，所有未說出口的恐懼都在其中蠕動。' },
  { id: 'r17', name: '烈陽', w: ['elemDmgFire', 0.33], a: ['resFire', 0.16], flavor: '正午的烈陽毫不留情，所到之處皆成焦土。' },
  { id: 'r18', name: '寒月', w: ['cdr', 0.36], a: ['mdefPct', 0.36], flavor: '寒月高懸，時間在它的清輝下緩緩凝滯。' },
  { id: 'r19', name: '驚蟄', w: ['aspd', 0.39], a: ['tenacity', 0.39], flavor: '春雷一響，蟄伏的萬物同時驚醒。' },
  { id: 'r20', name: '嵐', w: ['elemDmgWind', 0.39], a: ['resWind', 0.19], flavor: '山間升起的嵐氣，輕柔地纏上來，又在轉身間化為利刃。' },
  { id: 'r21', name: '蒼穹', w: ['bossDmg', 0.42], a: ['shieldEff', 0.42], flavor: '穹頂之上的目光，俯視一切傲慢的巨影。' },
  { id: 'r22', name: '厚土', w: ['elemDmgEarth', 0.41], a: ['hpPct', 0.45], flavor: '大地沉默地承載萬物，也沉默地回報。' },
  { id: 'r23', name: '熔岩', w: ['atkPct', 0.48], a: ['globalDmgRed', 0.4], flavor: '地底湧出的熔岩，緩慢，卻吞沒前路上的一切。' },
  { id: 'r24', name: '冰魄', w: ['critDmg', 0.5], a: ['resAll', 0.22], flavor: '萬年玄冰中凝成的魂魄，連時間都被它凍結。' },
  { id: 'r25', name: '雷霆', w: ['matkPct', 0.49], a: ['blockDmgRed', 0.49], flavor: '天怒所化的雷霆，一道便足以裁決。' },
  { id: 'r26', name: '虛空', w: ['aoeDmg', 0.52], a: ['ccRed', 0.42], flavor: '注視虛空太久，虛空也在注視著你。' },
  { id: 'r27', name: '星辰', w: ['critRate', 0.54], a: ['luck', 0.54], flavor: '夜空裡每一顆星都是一次機緣，抬頭，便能撞見自己的那一顆。' },
  { id: 'r28', name: '命運', w: ['normalDmg', 0.57], a: ['evasion', 0.57], flavor: '命運之線纏繞所有人，唯有敢於撥動它的人，才看得見盡頭。' },
  { id: 'r29', name: '輪迴', w: ['lifesteal', 0.59], a: ['hpRegen', 0.59], flavor: '生滅不息，終點即是起點，傷口在輪迴中癒合。' },
  { id: 'r30', name: '永恆', w: ['atkPct', 0.61], a: ['hpPct', 0.61], flavor: '在時間之外靜止的片刻，沒有終結，也沒有退讓。' },
  { id: 'r31', name: '混沌', w: ['matkPct', 0.63], a: ['resAll', 0.28], flavor: '萬物未成形之前的原初混沌，秩序在其中碎裂重組。' },
  { id: 'r32', name: '創生', w: ['critDmg', 0.67], a: ['shieldEff', 0.61], flavor: '第一縷光與第一聲息的源頭，一切由此而起。' },
  { id: 'r33', name: '終焉', w: ['bossDmg', 0.75], a: ['globalDmgRed', 0.54], flavor: '所有故事的最後一頁，闔上之後，再無下文。' }
];

/* 符文字形：Unicode 符文區塊（長老弗薩克 24 個＋盎格魯撒克遜補 9 個），純文字字元、不是素材圖。 */
var RUNE_GLYPHS = ['ᚠ', 'ᚢ', 'ᚦ', 'ᚨ', 'ᚱ', 'ᚲ', 'ᚷ', 'ᚹ', 'ᚺ', 'ᚾ', 'ᛁ', 'ᛃ', 'ᛇ', 'ᛈ', 'ᛉ', 'ᛊ', 'ᛏ',
  'ᛒ', 'ᛖ', 'ᛗ', 'ᛚ', 'ᛜ', 'ᛞ', 'ᛟ', 'ᚪ', 'ᚫ', 'ᚣ', 'ᛠ', 'ᛡ', 'ᛢ', 'ᛣ', 'ᛤ', 'ᛥ'];
var RUNE_TIER_COLORS = ['#9aa5b1', '#4ade80', '#38bdf8', '#c084fc', '#fb923c', '#f5c542'];   // 每 6 階一個色帶
var RUNE_BY_ID = (function () {
  var m = {};
  for (var i = 0; i < RUNES.length; i++) {
    RUNES[i].tier = i + 1;
    RUNES[i].glyph = RUNE_GLYPHS[i];
    RUNES[i].color = RUNE_TIER_COLORS[Math.min(RUNE_TIER_COLORS.length - 1, Math.floor(i / 6))];
    m[RUNES[i].id] = RUNES[i];
  }
  return m;
})();

/* ---- 全域設定（配置表 Runes 的「設定」列；寫回時整塊重建，順序即表內順序）----
   maxSlots       符文孔數的硬上限（符文真言最多幾顆符文）。各稀有度的孔數不在這裡：在 game_parameters「表-稀有度」的參數g（寫回 RARITIES.runeSlots）
   twoHandBonusSlots  雙手武器額外多幾個符文孔（加法；0＝與一般裝備相同；只加在本來就有符文孔的稀有度上）。
                  最多孔稀有度的孔數＋此值不得超過 maxSlots
   erase          抹除已刻印符文的費用（符文不退還、孔恢復為空）：每階單價（scrapPerTier 裝備碎片／essencePerTier 附魔精華／goldPerTier 金幣；0＝不收這種幣）
                  × 符文階數 × 裝備稀有度倍率（RARITIES.mult），無條件進位
   composeCount   合成：同種符文幾顆 → 下一階 1 顆
   composeMaxTier 能合成到第幾階（更高階只能靠掉落）
   dismantleYield 拆解 1 顆 → 低一階符文幾顆；必須小於 composeCount。≥2 會讓一顆高階符文拆出指數倍的低階符文、把低階稀有度整個破壞，
                  所以預設 1（高階符文可以降階頂替較低階的需求，但不會變多）
   statScale      全域縮放：符文與符文真言的 stats 一律乘此值（平衡用旋鈕）
   drop           掉落（野外擊殺／封魔塔 BOSS）；公式 runeDropTierMax／rollRuneTier 在 js/runeword.js
     basePct          野外每次擊殺的基礎掉落率（%），再乘掉寶率／地圖倍率（1～24 倍）／敵種倍率
     towerBossPct     封魔塔通關時的基礎機率（%）
     tierSpread       階數稀有度：第 t+1 階的出現機率是第 t 階的這個倍數（0~1，越小高階越稀有）。
                      P(階 t) ∝ tierSpread^(t-1)，t 只能到「進度解鎖的最高階」；所以階越高越稀有，
                      取得難度只由階數決定（不會因為解鎖了更高階，舊階就變難拿）
     progressPerTier  進度（地圖序號＋關卡比例）每 1 對應的最高階增量（解鎖速度，不影響稀有度）

   ---- 取得難度的設計目標（估算：node tools/rw_econ_probe.cjs；docs/RUNEWORD_DESIGN.md 有表）----
   以「每小時 3000 次擊殺、掉寶加成使基礎率 ×2」估算，湊齊配方（含合成與降階頂替）約需：
     第 1 級 ≲ 2 小時、第 2 級 2～8 小時、第 3 級 10～50 小時、第 4 級 30～150 小時。
   配方的難度只看「最高階那顆符文」：第 1 級最高階 ≤ 10、第 2 級 11～16、第 3 級 17～23、第 4 級 24～33。 */
var RUNE_SETTINGS = {
  maxSlots: 5,
  twoHandBonusSlots: 1,
  erase: { scrapPerTier: 15, essencePerTier: 1, goldPerTier: 0 },
  composeCount: 3,
  composeMaxTier: 20,
  dismantleYield: 1,
  statScale: 1,
  drop: { basePct: 0.3, towerBossPct: 35, tierSpread: 0.74, progressPerTier: 4.6 }
};
/* 既有程式使用的具名常數：全部由上面的設定衍生（唯一來源），不要在別處另寫數字。 */
var RUNE_MAX_SLOTS = RUNE_SETTINGS.maxSlots;
var RUNE_COMPOSE_COUNT = RUNE_SETTINGS.composeCount;
var RUNE_COMPOSE_MAX_TIER = RUNE_SETTINGS.composeMaxTier;   // 第 composeMaxTier + 1 階起只掉落
var RUNE_DISMANTLE_YIELD = RUNE_SETTINGS.dismantleYield;
var RUNE_DROP = RUNE_SETTINGS.drop;

/* ---- 裝備類型標記（bases）----
   any 任意；裝備欄位類型（weapon/helmet/…）；armor 八件防具；jewelry 戒指＋項鍊；
   mainHand 主手與雙手武器；twoHand／oneHand／offHand 武器分類（WEAPON_TYPES.cat）；
   melee 近戰武器；caster 施法類（魔杖、雙手法杖與副手法器／魔法書／水晶球）；
   其餘為武器類型鍵（sword1h、dagger1h、shield…）。 */
var RW_MELEE_TYPES = ['sword1h', 'dagger1h', 'magicSword1h', 'greatsword2h', 'axe2h', 'magicSword2h'];
var RW_CASTER_TYPES = ['wand1h', 'staff2h', 'focus', 'spellbook', 'orb'];
var RW_ARMOR_SLOTS = ['helmet', 'shoulder', 'chest', 'belt', 'gloves', 'wrist', 'legs', 'boots'];
var RW_JEWELRY_SLOTS = ['ring', 'amulet'];
var RW_BASE_TOKENS = ['any', 'armor', 'jewelry', 'mainHand', 'twoHand', 'oneHand', 'offHand', 'melee', 'caster'];

/* ---- 效果詞彙 ----
   fx（靜態，數字相加）：下列鍵之外的鍵一律視為拼字錯誤（tests/runeword-data.test.cjs 會擋）。
   procs（事件觸發）：on ∈ RW_PROC_TRIGGERS；acts[].act ∈ RW_ACTS。 */
var RW_FX_KEYS = [
  'dmgPct', 'skillDmgPct', 'basicDmgPct', 'aspdMult', 'cdPct', 'manaCostRedPct', 'maxHitPct', 'maxHpPct',
  'dmgHiHpPct', 'dmgLoHpPct', 'dmgSoloPct', 'dmgPerFoePct', 'dmgSelfFullPct', 'dmgSelfLowPct', 'dmgCtrlPct',
  'killHealPct', 'killManaPct', 'runeFindPct', 'selfDrainPct', 'splashPct',
  'reviveHpPct', 'reviveCdSec', 'reviveInvulnSec', 'reviveDmgPct', 'reviveDmgSec', 'reviveRefresh'
];
/* passives（並入既有被動表 st.passives 的數值）：只能用這些鍵。 */
var RW_PASSIVE_KEYS = ['thorns', 'smite', 'undying', 'sunder', 'trueDmg', 'omniDrain', 'soulEater', 'annihilate', 'sanctuary', 'godWrath'];
var RW_PROC_TRIGGERS = ['hit', 'crit', 'kill', 'hurt', 'block', 'cast', 'tick', 'lowhp'];
var RW_ACTS = ['dmg', 'heal', 'shield', 'mana', 'buff', 'buffRandom', 'stun', 'slow', 'dot', 'cdr',
  'refresh', 'recast', 'castRandom', 'invuln', 'execute', 'cleanse'];

/* ---- 符文真言 ----
   runes  鑲入順序（符文 id，可重複）
   bases  允許的裝備（RW_BASE_TOKENS 或武器類型鍵），多項為「或」
   stats  [[詞條鍵, mult], …]
   passives  並入既有被動表（st.passives）的數值：thorns／smite／undying／sunder／trueDmg／omniDrain…
   legend    借用既有「傳奇特效」（PASSIVE_POOL 的鍵）——不受該特效原本的武器類型限制，
             但仍需要配戴對應的技能才有感（例如飛刀系要有飛刀技能）。
   fx / procs 見上方詞彙；flavor 為一句風味文字。 */
var RUNEWORDS = [
  /* ===== 第一級　普通 ===== */
  { id: 'rw_firstcry', name: '初啼', tier: 1, runes: ['r01', 'r02'], bases: ['mainHand'],
    stats: [['atkFlat', 1], ['matkFlat', 1], ['hit', 0.5]],
    flavor: '第一聲啼鳴，劃破長夜的寂靜。' },
  { id: 'rw_nightwatch', name: '守夜', tier: 1, runes: ['r02', 'r05'], bases: ['chest'],
    stats: [['defFlat', 1.25], ['hpFlat', 1.25], ['hpRegen', 0.5]],
    flavor: '燈火不滅，守夜人便不眠。' },
  { id: 'rw_frostwhisper', name: '霜語', tier: 1, runes: ['r03', 'r04'], bases: ['caster'],
    stats: [['matkFlat', 1.25], ['elemDmgIce', 0.75]],
    procs: [{ on: 'hit', chance: 10, acts: [{ act: 'slow', sec: 2 }] }],
    flavor: '寒風低語，敵人的腳步便慢了下來。' },
  { id: 'rw_windwalk', name: '行雲', tier: 1, runes: ['r04', 'r01', 'r08'], bases: ['boots'],
    stats: [['evasion', 1], ['hpFlat', 1], ['hit', 0.5]],
    flavor: '步履如雲，不留痕跡。' },
  { id: 'rw_stoneskin', name: '石膚', tier: 1, runes: ['r05', 'r03'], bases: ['shoulder', 'legs'],
    stats: [['defPct', 0.75], ['hpPct', 0.6], ['pRes', 0.4]],
    passives: { thorns: 3 },
    flavor: '皮膚堅如岩層，觸碰者必受其傷。' },
  { id: 'rw_viperkiss', name: '蛇吻', tier: 1, runes: ['r06', 'r08'], bases: ['sword1h', 'dagger1h', 'magicSword1h'],
    stats: [['atkPct', 0.6], ['elemDmgPoison', 0.75], ['critRate', 0.5]],
    procs: [{ on: 'hit', chance: 15, acts: [{ act: 'dot', pct: 60, sec: 4, name: 'poison' }] }],
    flavor: '毒蛇的一吻，慢慢收走對手的生命。' },
  { id: 'rw_minorthunder', name: '輕雷', tier: 1, runes: ['r07', 'r04'], bases: ['oneHand'],
    stats: [['matkPct', 0.75], ['elemDmgLightning', 1]],
    procs: [{ on: 'hit', chance: 8, acts: [{ act: 'dmg', pct: 90, elem: 'lightning', to: 'target' }] }],
    flavor: '一聲輕雷，落在不經意的地方。' },
  { id: 'rw_lightguard', name: '聖光之守', tier: 1, runes: ['r01', 'r09'], bases: ['helmet'],
    stats: [['mpFlat', 1], ['resLight', 0.75], ['hpPct', 0.5]],
    fx: { killManaPct: 1 },
    flavor: '以聖光為冠，心神澄明。' },
  { id: 'rw_bloodring', name: '血誓之環', tier: 1, runes: ['r10', 'r08'], bases: ['ring'],
    stats: [['lifesteal', 1], ['atkPct', 0.5], ['hit', 0.5]],
    fx: { killHealPct: 1 },
    flavor: '以血起誓，生者共飲。' },
  { id: 'rw_steelheart', name: '鋼心', tier: 1, runes: ['r05', 'r10'], bases: ['belt'],
    stats: [['hpPct', 0.75], ['defPct', 0.75], ['tenacity', 0.5]],
    flavor: '腰繫鋼索，心不動搖。' },
  { id: 'rw_springflow', name: '泉湧', tier: 1, runes: ['r01', 'r02', 'r08'], bases: ['amulet'],
    stats: [['mpRegen', 1], ['hpRegen', 1], ['mpFlat', 0.75]],
    fx: { killManaPct: 2 },
    flavor: '源源不絕，如山間清泉。' },
  { id: 'rw_scavenger', name: '拾荒者', tier: 1, runes: ['r01', 'r04'], bases: ['jewelry'],
    stats: [['goldBonus', 1], ['xpBonus', 0.75], ['loot', 0.6]],
    fx: { runeFindPct: 8 },
    flavor: '連廢墟裡的一粒塵埃，也要翻過三遍。' },
  { id: 'rw_breaker', name: '破軍', tier: 1, runes: ['r02', 'r10', 'r05'], bases: ['twoHand'],
    stats: [['atkPct', 0.6], ['critDmg', 0.6], ['pPen', 0.1]],
    flavor: '重兵一落，軍陣自潰。' },
  { id: 'rw_burnstar', name: '燃星', tier: 1, runes: ['r02', 'r09'], bases: ['caster'],
    stats: [['matkPct', 0.75], ['elemDmgFire', 0.75], ['mpFlat', 0.75]],
    procs: [{ on: 'cast', chance: 15, acts: [{ act: 'mana', pctMax: 12 }] }],
    flavor: '星火燎原，施法者的靈感湧現。' },

  /* ===== 第二級　精良 ===== */
  { id: 'rw_galeblade', name: '疾風烈刃', tier: 2, runes: ['r04', 'r13', 'r14'], bases: ['sword1h', 'dagger1h', 'magicSword1h'],
    stats: [['aspd', 1.08], ['critRate', 0.65], ['atkPct', 0.65]],
    fx: { aspdMult: 8 },
    flavor: '快過風的刃，連風聲都追不上。' },
  { id: 'rw_thundergod', name: '雷神之怒', tier: 2, runes: ['r07', 'r10', 'r11', 'r16'], bases: ['mainHand'],
    stats: [['atkPct', 0.65], ['elemDmgLightning', 1.08], ['critDmg', 0.65]],
    procs: [{ on: 'hit', chance: 15, acts: [{ act: 'dmg', pct: 120, elem: 'lightning', to: 'all' }] }],
    flavor: '神怒所至，雷霆不擇敵我之外。' },
  { id: 'rw_winterherald', name: '凜冬使者', tier: 2, runes: ['r03', 'r03', 'r12'], bases: ['caster'],
    stats: [['matkPct', 0.87], ['elemDmgIce', 1.3], ['cdr', 0.43]],
    fx: { dmgCtrlPct: 15 },
    procs: [{ on: 'hit', chance: 20, acts: [{ act: 'stun', sec: 1.5 }] }],
    flavor: '冬天來了，所過之處萬物凝結。' },
  { id: 'rw_bloodgulp', name: '血飲者', tier: 2, runes: ['r10', 'r08', 'r13'], bases: ['mainHand'],
    stats: [['lifesteal', 1.3], ['atkPct', 0.87], ['critRate', 0.43]],
    fx: { killHealPct: 3, dmgSelfLowPct: 25 },
    flavor: '越是瀕死，越是渴血。' },
  { id: 'rw_unmoving', name: '不動山', tier: 2, runes: ['r05', 'r14', 'r11'], bases: ['chest'],
    stats: [['hpPct', 1.3], ['defPct', 1.3], ['pRes', 0.43]],
    fx: { maxHitPct: 40 },
    flavor: '任憑千鈞一擊，山自巍然。' },
  { id: 'rw_shadowstep', name: '影步', tier: 2, runes: ['r08', 'r13', 'r16'], bases: ['boots', 'legs'],
    stats: [['evasion', 1.52], ['hit', 0.87], ['hpPct', 0.65]],
    procs: [{ on: 'hurt', chance: 15, cd: 10, acts: [{ act: 'invuln', sec: 1 }] }],
    flavor: '一步踏入影中，攻擊落了空。' },
  { id: 'rw_dawncrown', name: '旭日之冠', tier: 2, runes: ['r15', 'r09', 'r12'], bases: ['helmet'],
    stats: [['hpPct', 0.87], ['mpFlat', 1.3], ['resAll', 0.43]],
    procs: [{ on: 'tick', every: 10, acts: [{ act: 'heal', pctMax: 8 }, { act: 'mana', pctMax: 8 }] }],
    flavor: '戴上旭日，每一刻都是黎明。' },
  { id: 'rw_poisoncloud', name: '毒雲', tier: 2, runes: ['r06', 'r06', 'r12'], bases: ['caster'],
    stats: [['matkPct', 0.87], ['elemDmgPoison', 1.3], ['mPen', 0.13]],
    procs: [{ on: 'cast', chance: 25, acts: [{ act: 'dot', pct: 60, sec: 4, name: 'poison', to: 'all' }] }],
    flavor: '施法之後，毒霧久久不散。' },
  { id: 'rw_awakening', name: '驚蟄', tier: 2, runes: ['r04', 'r07', 'r13'], bases: ['gloves'],
    stats: [['aspd', 1.3], ['critRate', 0.87], ['atkPct', 0.65]],
    procs: [{ on: 'crit', acts: [{ act: 'buff', sid: 'aspdUp', val: 12, sec: 3, max: 3 }] }],
    flavor: '一聲春雷，萬蟲驚動。' },
  { id: 'rw_ironoath', name: '重甲鐵誓', tier: 2, runes: ['r14', 'r11', 'r10'], bases: ['shoulder'],
    stats: [['hpPct', 1.08], ['defPct', 0.87], ['pRes', 0.43]],
    passives: { thorns: 12 },
    procs: [{ on: 'hurt', chance: 20, cd: 3, acts: [{ act: 'dmg', pct: 100, type: 'phys', to: 'attacker' }] }],
    flavor: '以鐵起誓，傷我者必以鐵還之。' },
  { id: 'rw_gambler', name: '賭徒之戒', tier: 2, runes: ['r01', 'r13', 'r16', 'r11'], bases: ['ring'],
    stats: [['luck', 1.3], ['critRate', 0.87], ['critDmg', 1.08], ['loot', 0.87]],
    fx: { runeFindPct: 15 },
    flavor: '全押。贏了拿走一切，輸了也不過一場好戲。' },
  { id: 'rw_guardian', name: '守護者之盾', tier: 2, runes: ['r14', 'r11', 'r05', 'r15'], bases: ['shield'],
    stats: [['blockRate', 1.3], ['blockDmgRed', 1.3], ['hpPct', 0.87]],
    procs: [{ on: 'block', chance: 40, acts: [{ act: 'dmg', pct: 200, type: 'phys', to: 'attacker' }] }],
    flavor: '盾不是為了後退，是為了把力量還給對方。' },
  { id: 'rw_arcaneecho', name: '奧術迴響', tier: 2, runes: ['r12', 'r15', 'r12', 'r09'], bases: ['focus', 'spellbook', 'orb'],
    stats: [['matkPct', 1.3], ['mpFlat', 1.3], ['cdr', 0.87]],
    procs: [{ on: 'cast', chance: 20, acts: [{ act: 'cdr', sec: 1.5 }] }],
    flavor: '咒語落下之後，還在空氣裡迴盪。' },
  { id: 'rw_smith', name: '鐵匠之魂', tier: 2, runes: ['r12', 'r11', 'r14'], bases: ['amulet'],
    stats: [['gemEff', 1.3], ['affixCap', 0.87], ['enhanceSuccess', 1.3]],
    flavor: '鎚聲不絕，鋼與靈魂同鍛。' },

  /* ===== 第三級　史詩 ===== */
  { id: 'rw_apocalypse', name: '天啟', tier: 3, runes: ['r10', 'r11', 'r21', 'r23'], bases: ['mainHand'],
    stats: [['atkPct', 1.1], ['matkPct', 1.1], ['critDmg', 1.1], ['bossDmg', 1.1]],
    fx: { dmgPct: 18, aspdMult: 10 },
    flavor: '號角響起，審判降臨。' },
  { id: 'rw_soulcleaver', name: '斷魂', tier: 3, runes: ['r11', 'r20', 'r22'], bases: ['twoHand'],
    stats: [['atkPct', 1.47], ['critDmg', 1.47], ['eliteDmg', 1.1], ['pPen', 0.18]],
    fx: { dmgLoHpPct: 60 },
    procs: [{ on: 'hit', chance: 8, acts: [{ act: 'execute', hpBelow: 15 }] }],
    flavor: '一刀兩斷，魂亦分離。' },
  { id: 'rw_chainstorm', name: '連環雷暴', tier: 3, runes: ['r07', 'r13', 'r07', 'r17'], bases: ['caster'],
    stats: [['matkPct', 1.1], ['elemDmgLightning', 1.1], ['elemDmgWind', 0.73], ['mPen', 0.18]],
    procs: [{ on: 'crit', chance: 30, acts: [{ act: 'dmg', pct: 120, elem: 'lightning', to: 'all' }] }, { on: 'cast', chance: 25, acts: [{ act: 'dmg', pct: 100, elem: 'lightning', to: 'rand', n: 3 }] }],
    flavor: '雷與風相纏，一環扣一環。' },
  { id: 'rw_timewarden', name: '時之守望', tier: 3, runes: ['r18', 'r20', 'r18', 'r12'], bases: ['focus', 'spellbook', 'orb'],
    stats: [['cdr', 1.47], ['matkPct', 1.1], ['mpRegen', 1.1], ['hpPct', 0.73]],
    fx: { cdPct: 20 },
    procs: [{ on: 'kill', acts: [{ act: 'cdr', sec: 1 }] }],
    flavor: '守望者拾起墜落的時間，替你多留一點。' },
  { id: 'rw_lastbreath', name: '絕境', tier: 3, runes: ['r14', 'r22', 'r18'], bases: ['chest'],
    stats: [['hpPct', 1.47], ['defPct', 1.28], ['mdefPct', 1.28], ['globalDmgRed', 0.73]],
    procs: [{ on: 'lowhp', below: 30, cd: 90, acts: [{ act: 'invuln', sec: 3 }, { act: 'heal', pctMax: 30 }, { act: 'cleanse' }] }],
    flavor: '退無可退之處，才是真正的開始。' },
  { id: 'rw_swarmhunter', name: '群獵', tier: 3, runes: ['r13', 'r19', 'r23', 'r16'], bases: ['mainHand'],
    stats: [['aspd', 0.92], ['atkPct', 0.92], ['critRate', 0.55], ['aoeDmg', 0.73]],
    fx: { dmgPerFoePct: 5, splashPct: 20 },
    flavor: '獸群越多，獵人越是興奮。' },
  { id: 'rw_assassin', name: '影殺', tier: 3, runes: ['r08', 'r16', 'r13', 'r22'], bases: ['dagger1h'],
    stats: [['critRate', 0.55], ['critDmg', 0.73], ['atkPct', 0.73], ['evasion', 0.55]],
    fx: { dmgHiHpPct: 20 },
    legend: ['knifeShadowblade', 'knifeChain'],
    flavor: '刀影分裂成雙，雙影各自找到了喉嚨。' },
  { id: 'rw_manafountain', name: '魔泉', tier: 3, runes: ['r12', 'r18', 'r21'], bases: ['helmet', 'amulet'],
    stats: [['mpFlat', 1.47], ['mpRegen', 1.47], ['matkPct', 0.92]],
    fx: { manaCostRedPct: 40, killManaPct: 3 },
    flavor: '魔力不是用完的，是流過的。' },
  { id: 'rw_thornedfury', name: '荊棘之怒', tier: 3, runes: ['r14', 'r23', 'r22', 'r11'], bases: ['chest', 'shield'],
    stats: [['hpPct', 1.28], ['defPct', 1.28], ['pRes', 0.73]],
    passives: { thorns: 35 },
    procs: [{ on: 'hurt', chance: 25, cd: 2, acts: [{ act: 'dmg', pct: 150, type: 'phys', to: 'all' }] }],
    flavor: '怒意生出荊棘，連空氣都帶刺。' },
  { id: 'rw_bossbane', name: '弒王者', tier: 3, runes: ['r21', 'r10', 'r11'], bases: ['mainHand'],
    stats: [['bossDmg', 1.83], ['eliteDmg', 1.47], ['atkPct', 0.92], ['matkPct', 0.92]],
    fx: { dmgHiHpPct: 40, dmgSoloPct: 40 },
    flavor: '王座再高，也有人要把它拆了。' },
  { id: 'rw_vitalpact', name: '生命契約', tier: 3, runes: ['r10', 'r08', 'r22'], bases: ['jewelry'],
    stats: [['hpPct', 1.47], ['lifesteal', 1.47], ['hpRegen', 1.47]],
    fx: { killHealPct: 6, dmgSelfFullPct: 25 },
    flavor: '契約的對價是活著，且活得很好。' },
  { id: 'rw_shieldwall', name: '護盾牆', tier: 3, runes: ['r21', 'r14', 'r21', 'r22'], bases: ['chest', 'shoulder', 'helmet'],
    stats: [['shieldEff', 1.83], ['hpPct', 1.1], ['globalDmgRed', 0.92]],
    procs: [{ on: 'tick', every: 8, acts: [{ act: 'shield', pctMax: 20, sec: 8 }] }],
    flavor: '牆起，風止。' },
  { id: 'rw_elemental', name: '元素之環', tier: 3, runes: ['r03', 'r17', 'r20'], bases: ['ring'],
    stats: [['elemDmgFire', 0.66], ['elemDmgIce', 0.66], ['elemDmgLightning', 0.66], ['elemDmgWind', 0.66], ['elemDmgPoison', 0.66]],
    fx: { dmgPct: 10 },
    flavor: '五元素各執一角，在指尖上取得平衡。' },
  { id: 'rw_blitz', name: '閃擊', tier: 3, runes: ['r13', 'r19', 'r04'], bases: ['mainHand'],
    stats: [['aspd', 1.47], ['critRate', 1.1], ['hit', 0.73]],
    fx: { aspdMult: 15 },
    procs: [{ on: 'hit', every: 6, acts: [{ act: 'castRandom' }] }],
    flavor: '揮刀太快，連技能都被牽著走。' },

  /* ===== 第四級　傳說 ===== */
  { id: 'rw_quake', name: '地裂', tier: 4, runes: ['r05', 'r14', 'r22', 'r25', 'r27'], bases: ['twoHand'],
    stats: [['atkPct', 1.2], ['eliteDmg', 0.9], ['pPen', 0.18], ['critDmg', 0.9]],
    fx: { dmgHiHpPct: 30 },
    procs: [{ on: 'hit', chance: 8, acts: [{ act: 'dmg', pct: 220, type: 'phys', to: 'all' }] }],
    legend: ['rockEarthHeart'],
    flavor: '大地在刀下裂開，裂縫一路追著敵人。' },
  { id: 'rw_galeeye', name: '風暴之眼', tier: 4, runes: ['r04', 'r19', 'r20', 'r26', 'r28'], bases: ['twoHand'],
    stats: [['aspd', 1.35], ['critRate', 1.05], ['atkPct', 1.05], ['aoeDmg', 0.75]],
    fx: { aspdMult: 18 },
    procs: [{ on: 'crit', acts: [{ act: 'buff', sid: 'aspdUp', val: 12, sec: 4, max: 4 }] }],
    legend: ['stormbarrierCore'],
    flavor: '風暴中央最安靜，刀卻最快。' },
  { id: 'rw_bloodrite', name: '血祭', tier: 4, runes: ['r10', 'r08', 'r22', 'r24', 'r26'], bases: ['twoHand'],
    stats: [['atkPct', 1.35], ['lifesteal', 1.35], ['critDmg', 1.35], ['hpPct', 0.9]],
    fx: { killHealPct: 8, dmgSelfLowPct: 60, dmgPct: 30 },
    legend: ['bloodVenomRite'],
    flavor: '以血為祭，戰場上的每一滴都算數。' },
  { id: 'rw_reincarnation', name: '輪迴', tier: 4, runes: ['r28', 'r29', 'r30', 'r32'], bases: ['chest'],
    stats: [['hpPct', 1.2], ['defPct', 1.2], ['mdefPct', 1.2]],
    fx: { reviveHpPct: 60, reviveCdSec: 180, reviveInvulnSec: 3, reviveDmgPct: 60, reviveDmgSec: 10, reviveRefresh: 1 },
    legend: ['counterOath'],
    flavor: '死亡只是下一次輪迴的開場白。' },
  { id: 'rw_timeloop', name: '時之沙', tier: 4, runes: ['r26', 'r29', 'r30'], bases: ['amulet'],
    stats: [['cdr', 1.5], ['mpRegen', 1.5], ['matkPct', 0.9]],
    fx: { cdPct: 45, maxHpPct: -20 },
    procs: [{ on: 'cast', chance: 25, acts: [{ act: 'recast' }] }],
    legend: ['vacuumFlux'],
    flavor: '沙漏倒過來了。代價是你的生命，也在一起流。' },
  { id: 'rw_bloodmoon', name: '血月', tier: 4, runes: ['r16', 'r23', 'r25', 'r28'], bases: ['mainHand'],
    stats: [['atkPct', 0.9], ['matkPct', 0.9], ['critDmg', 0.9], ['lifesteal', 0.6]],
    fx: { dmgPct: 60, selfDrainPct: 2, killHealPct: 8, maxHpPct: -30 },
    legend: ['rageBurnBlood'],
    flavor: '血月當空，誰先流盡誰先倒下。' },
  { id: 'rw_arsenal', name: '武庫', tier: 4, runes: ['r20', 'r26', 'r27'], bases: ['mainHand'],
    stats: [['aspd', 0.9], ['atkPct', 0.9], ['matkPct', 0.9]],
    fx: { skillDmgPct: 40 },
    procs: [{ on: 'hit', every: 4, acts: [{ act: 'castRandom' }] }, { on: 'cast', chance: 15, acts: [{ act: 'recast' }] }],
    legend: ['knifeSplitter'],
    flavor: '每一次揮擊，都從武器庫裡抽出另一招。' },
  { id: 'rw_thunderemperor', name: '雷帝', tier: 4, runes: ['r25', 'r07', 'r26', 'r32'], bases: ['caster'],
    stats: [['matkPct', 0.9], ['elemDmgLightning', 1.05], ['critRate', 0.6]],
    fx: { dmgCtrlPct: 10 },
    procs: [{ on: 'tick', every: 3, acts: [{ act: 'dmg', pct: 120, elem: 'lightning', to: 'rand', n: 3 }] }, { on: 'crit', acts: [{ act: 'stun', sec: 1, to: 'all' }] }],
    legend: ['chainlightningOverload'],
    flavor: '帝王不需親自出手，雷霆自會代勞。' },
  { id: 'rw_lonewolf', name: '孤狼', tier: 4, runes: ['r21', 'r25', 'r27'], bases: ['mainHand'],
    stats: [['critDmg', 1.05], ['atkPct', 0.9], ['bossDmg', 1.05]],
    fx: { dmgSoloPct: 80, dmgHiHpPct: 40, cdPct: 15 },
    legend: ['sunpiercerLance'],
    flavor: '孤狼只獵王者。獵物以外，一概不理。' },
  { id: 'rw_starfall', name: '星墜', tier: 4, runes: ['r26', 'r24', 'r27', 'r29'], bases: ['staff2h'],
    stats: [['matkPct', 1.05], ['elemDmgFire', 0.75], ['elemDmgIce', 0.75], ['mPen', 0.18]],
    procs: [{ on: 'tick', every: 3, acts: [{ act: 'dmg', pct: 150, elem: 'random', to: 'rand', n: 5 }] }],
    legend: ['fireballBurst'],
    flavor: '夜空翻面，群星墜落成雨。' },
  { id: 'rw_chaoslord', name: '混沌之主', tier: 4, runes: ['r26', 'r30', 'r31'], bases: ['jewelry'],
    stats: [['resAll', 0.9], ['luck', 1.2], ['critRate', 0.9]],
    fx: { skillDmgPct: 25 },
    procs: [{ on: 'cast', acts: [{ act: 'buffRandom', sec: 8, from: [{ sid: 'atkUp', val: 25 }, { sid: 'aspdUp', val: 25 }, { sid: 'critDmgUp', val: 60 }, { sid: 'defUp', val: 40 }, { sid: 'evasionUp', val: 30 }, { sid: 'allDmgUp', val: 20 }] }] }],
    legend: ['mireCorrupt'],
    flavor: '混沌不問因果，每一次施法都是一場賭局。' },
  { id: 'rw_dragonslayer', name: '屠龍者', tier: 4, runes: ['r27', 'r30', 'r31'], bases: ['twoHand'],
    stats: [['atkPct', 0.75], ['bossDmg', 1.5], ['critDmg', 0.75], ['pPen', 0.24]],
    fx: { dmgHiHpPct: 50, dmgPct: 25 },
    procs: [{ on: 'crit', chance: 20, acts: [{ act: 'dmg', pct: 250, type: 'phys', to: 'target' }] }],
    legend: ['galeExecute'],
    flavor: '巨龍的鱗片，就是為了被一劍貫穿而生。' },
  { id: 'rw_immortalbody', name: '不朽之軀', tier: 4, runes: ['r30', 'r33', 'r29', 'r32'], bases: ['armor'],
    stats: [['hpPct', 1.5], ['globalDmgRed', 0.9], ['resAll', 0.9]],
    fx: { maxHitPct: 15, dmgPct: -20 },
    procs: [{ on: 'lowhp', below: 40, cd: 60, acts: [{ act: 'shield', pctMax: 40, sec: 6 }, { act: 'invuln', sec: 2 }] }],
    legend: ['earthguardUndyingWill'],
    flavor: '以出手的力量，換不會倒下的身軀。' },
  { id: 'rw_legion', name: '萬軍', tier: 4, runes: ['r20', 'r26', 'r28', 'r30'], bases: ['greatsword2h', 'axe2h'],
    stats: [['atkPct', 0.9], ['aspd', 0.9], ['aoeDmg', 0.6]],
    fx: { splashPct: 50, dmgPerFoePct: 6 },
    legend: ['skyrendSlash'],
    flavor: '一人成軍，一劍橫掃萬軍。' },
  { id: 'rw_bladedancer', name: '劍舞者', tier: 4, runes: ['r19', 'r24', 'r26'], bases: ['twoHand'],
    stats: [['aspd', 0.9], ['critRate', 0.9], ['atkPct', 0.9]],
    fx: { aspdMult: 15 },
    legend: ['danceThousandCuts'],
    flavor: '舞到最後一步時，才知道這是一場不能停的舞。' },
  { id: 'rw_voidwalker', name: '虛空行者', tier: 4, runes: ['r26', 'r28', 'r29'], bases: ['boots'],
    stats: [['evasion', 1.8], ['hit', 1.2], ['hpPct', 0.9]],
    fx: { dmgPct: 25 },
    procs: [{ on: 'hurt', chance: 30, cd: 4, acts: [{ act: 'invuln', sec: 1.5 }, { act: 'dmg', pct: 150, elem: 'dark', to: 'all' }] }],
    legend: ['windbladeVoidCut'],
    flavor: '走進虛空的人，被攻擊的永遠是上一個位置。' },
  { id: 'rw_genesis', name: '創世紀', tier: 4, runes: ['r30', 'r31', 'r32', 'r33'], bases: ['any'],
    stats: [['atkPct', 0.9], ['matkPct', 0.9], ['elemDmgFire', 0.45], ['elemDmgIce', 0.45], ['elemDmgLightning', 0.45], ['elemDmgPoison', 0.45], ['elemDmgLight', 0.45], ['elemDmgDark', 0.45], ['elemDmgEarth', 0.45], ['elemDmgWind', 0.45]],
    fx: { dmgPct: 50, cdPct: 20, aspdMult: 15, manaCostRedPct: 30 },
    legend: ['firepillarResonance'],
    flavor: '最後一顆符文落下時，世界從頭開始。' },
  { id: 'rw_worldend', name: '滅世', tier: 4, runes: ['r23', 'r26', 'r28', 'r30', 'r31'], bases: ['twoHand'],
    stats: [['atkPct', 1.05], ['critDmg', 1.05], ['bossDmg', 1.05], ['aoeDmg', 0.6]],
    fx: { dmgPct: 18, splashPct: 15 },
    procs: [{ on: 'crit', chance: 10, acts: [{ act: 'dmg', pct: 250, type: 'phys', to: 'all' }] }],
    legend: ['thunderorbFallCount'],
    flavor: '舉刀之時，終局已定。' },
  { id: 'rw_stargate', name: '星門', tier: 4, runes: ['r20', 'r25', 'r27', 'r29', 'r30'], bases: ['staff2h'],
    stats: [['matkPct', 1.5], ['elemDmgLightning', 0.75], ['elemDmgWind', 0.75], ['cdr', 1.05], ['mPen', 0.18]],
    fx: { cdPct: 25, skillDmgPct: 40 },
    procs: [{ on: 'cast', chance: 20, acts: [{ act: 'recast' }] }],
    legend: ['thunderstrikeRebirth'],
    flavor: '星門開啟，咒語在兩端同時落下。' },
  { id: 'rw_divinewrath', name: '神罰', tier: 4, runes: ['r21', 'r24', 'r29', 'r31', 'r33'], bases: ['twoHand'],
    stats: [['atkPct', 0.9], ['bossDmg', 1.5], ['elemDmgLight', 0.9], ['critRate', 0.6]],
    passives: { smite: 20 },
    fx: { dmgHiHpPct: 40 },
    procs: [{ on: 'crit', chance: 15, acts: [{ act: 'dmg', pct: 350, elem: 'light', to: 'target' }] }],
    legend: ['firehuntHunter'],
    flavor: '審判不問理由，只問罪行。' },
  { id: 'rw_permafrost', name: '永凍', tier: 4, runes: ['r18', 'r24', 'r30'], bases: ['caster'],
    stats: [['matkPct', 1.35], ['elemDmgIce', 1.5], ['cdr', 0.9]],
    fx: { dmgCtrlPct: 45 },
    procs: [{ on: 'hit', chance: 15, acts: [{ act: 'stun', sec: 1.5 }] }],
    legend: ['frostnovaWinterFrost'],
    flavor: '時間在這裡結了冰，連呼吸都慢了下來。' },
  { id: 'rw_glacier', name: '冰川', tier: 4, runes: ['r03', 'r25', 'r28'], bases: ['caster'],
    stats: [['matkPct', 1.05], ['elemDmgIce', 0.9], ['critDmg', 0.9], ['bossDmg', 0.9]],
    fx: { dmgHiHpPct: 40, dmgCtrlPct: 20 },
    procs: [{ on: 'crit', chance: 25, acts: [{ act: 'dmg', pct: 200, elem: 'ice', to: 'target' }] }],
    legend: ['icearrowDeepFreeze'],
    flavor: '冰川緩慢，但它走過的地方什麼都不剩。' },
  { id: 'rw_tidecall', name: '潮汐', tier: 4, runes: ['r08', 'r12', 'r30'], bases: ['jewelry'],
    stats: [['mpRegen', 1.5], ['hpRegen', 1.5], ['matkPct', 0.9], ['cdr', 0.9]],
    fx: { killManaPct: 4, manaCostRedPct: 25 },
    procs: [{ on: 'tick', every: 6, acts: [{ act: 'heal', pctMax: 6 }, { act: 'mana', pctMax: 10 }] }],
    legend: ['waterballTornado'],
    flavor: '潮來潮去，每一次都帶走疲憊、留下力量。' }
];

var RUNEWORD_BY_ID = (function () {
  var m = {};
  for (var i = 0; i < RUNEWORDS.length; i++) m[RUNEWORDS[i].id] = RUNEWORDS[i];
  return m;
})();

/* 符文真言的品質：級距（tier 1~4）→ 裝備稀有度索引（RARITIES），名稱與顏色直接讀 RARITIES，不另寫一份。
   RARITIES 在 data.js；沒載入時（單獨載入本檔的工具）退回同一組寫死值。 */
var RUNEWORD_TIER_RARITY = [-1, 0, 1, 4, 5];   // 普通、精良、史詩、傳說
var RUNEWORD_TIER_FALLBACK = [['', ''], ['普通', '#9aa5b1'], ['精良', '#4ade80'], ['史詩', '#c084fc'], ['傳說', '#fb923c']];
var RUNEWORD_TIER_NAMES = RUNEWORD_TIER_RARITY.map(function (ri, t) {
  return (ri >= 0 && typeof RARITIES !== 'undefined' && RARITIES[ri]) ? RARITIES[ri].name : RUNEWORD_TIER_FALLBACK[t][0];
});
var RUNEWORD_TIER_COLORS = RUNEWORD_TIER_RARITY.map(function (ri, t) {
  return (ri >= 0 && typeof RARITIES !== 'undefined' && RARITIES[ri]) ? RARITIES[ri].color : RUNEWORD_TIER_FALLBACK[t][1];
});

/* 符文石圖：images/runes/stone-<符文id>.png（160×160 透明背景，33 張）。
   由 tools/rune-stones 程序化繪製（高度圖＋光照，符文刻進石面）；256px 原圖與產生器收在素材庫
   claude-authored/rune-stones。換圖時 +1 RUNE_STONE_VER（圖檔沒有版本字尾，靠查詢字串破快取）。 */
var RUNE_STONE_VER = 1;
function runeStoneSrc(id) { return 'images/runes/stone-' + id + '.png?v=' + RUNE_STONE_VER; }

/* 符文名稱（含階數）。未知 id 回傳 id 本身，避免畫面上出現 undefined。 */
function runeName(id) {
  var r = RUNE_BY_ID[id];
  return r ? r.name : String(id);
}
function runeLabel(id) { return runeName(id) + '符文'; }
