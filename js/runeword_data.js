'use strict';
/* ============ 符文之語：資料表（符文 33 種、符文之語 56 組）============
   本檔只放資料與純查表函式，不碰 G、不寫狀態（共載檔規則）。
   執行邏輯（鑲嵌判定、屬性聚合、觸發引擎）→ js/runeword.js；兩支同時載入於主執行緒與 Worker。

   ---- 玩法（參考暗黑 2 的符文之語）----
   1. 符文是獨立的素材（G.player.runes = { 符文id: 數量 }），鑲在裝備的鑲孔裡，與寶石共用同一排鑲孔。
   2. 把「指定的符文、依指定順序」鑲進「連續的鑲孔」，且裝備類型符合 → 該裝備成為符文之語裝備。
      符文之語是**當場判定**的衍生狀態（不存檔）：拆下任何一顆符文就失效，換回順序又恢復。
   3. 鑲孔數由稀有度決定（獨特 2、史詩 3、傳說 4、神話 5、創世以上 6~7；雙手武器 ×1.75），
      所以 2 符文要獨特以上、4 符文要傳說以上、6 符文要創世以上。
   4. 每顆符文單獨鑲著也有加成（武器／防具各一條），符文之語生效時兩者並存。

   ---- 數值口徑（單一權威）----
   所有 stats 的數值＝ affixBaseValue(詞條, 裝備等級, 稀有度) × mult：
     即「該裝備上一條滿刻度中位數詞條」的 mult 倍。因此隨裝備等級與稀有度自動成長，
     與詞條系統同源，不另建第二套數值（AI_RULES §7）。mult 可為負數（＝代價）。
   fx／procs 的數字是固定值（不隨稀有度成長）——它們是機制，不是屬性。

   ---- 強度分級（tier）----
     1 普通      2~3 符文　屬性包為主，附一點小機制
     2 強力      3~4 符文　屬性包＋一個真正有感的機制
     3 非常強力  4~5 符文　多重機制，定位明確
     4 極度特殊  5~6 符文　改寫技能／生存／節奏規則，附代價或高門檻
   ============================================================ */

/* ---- 符文（33 種，由低到高）----
   w＝武器類（主手、雙手）鑲入時的加成；a＝防具、飾品、副手鑲入時的加成。
   [詞條鍵, mult]；詞條鍵必須是 AFFIX_POOL 的鍵（all_lock 的鎖定詞條不可用）。 */
var RUNES = [
  { id: 'r01', name: '微光', w: ['hit', 0.6],              a: ['evasion', 0.6] },
  { id: 'r02', name: '餘燼', w: ['atkFlat', 0.6],          a: ['defFlat', 0.6] },
  { id: 'r03', name: '霜痕', w: ['elemDmgIce', 0.6],       a: ['resIce', 0.3] },
  { id: 'r04', name: '風語', w: ['aspd', 0.6],             a: ['evasion', 0.7] },
  { id: 'r05', name: '巖心', w: ['pPen', 0.12],            a: ['defPct', 0.6] },
  { id: 'r06', name: '毒牙', w: ['elemDmgPoison', 0.6],    a: ['resPoison', 0.3] },
  { id: 'r07', name: '雷鳴', w: ['elemDmgLightning', 0.6], a: ['resLightning', 0.3] },
  { id: 'r08', name: '暗影', w: ['lifesteal', 0.7],        a: ['hpRegen', 0.7] },
  { id: 'r09', name: '聖輝', w: ['elemDmgLight', 0.6],     a: ['resLight', 0.3] },
  { id: 'r10', name: '血誓', w: ['atkPct', 0.7],           a: ['hpPct', 0.7] },
  { id: 'r11', name: '鋼魄', w: ['critDmg', 0.8],          a: ['pRes', 0.2] },
  { id: 'r12', name: '靈泉', w: ['matkPct', 0.7],          a: ['mpFlat', 0.9] },
  { id: 'r13', name: '疾影', w: ['critRate', 0.8],         a: ['hit', 0.9] },
  { id: 'r14', name: '磐石', w: ['eliteDmg', 0.8],         a: ['blockRate', 0.9] },
  { id: 'r15', name: '曙光', w: ['mPen', 0.15],            a: ['mRes', 0.2] },
  { id: 'r16', name: '夜幕', w: ['elemDmgDark', 0.8],      a: ['resDark', 0.4] },
  { id: 'r17', name: '烈陽', w: ['elemDmgFire', 0.8],      a: ['resFire', 0.4] },
  { id: 'r18', name: '寒月', w: ['cdr', 0.9],              a: ['mdefPct', 0.9] },
  { id: 'r19', name: '驚蟄', w: ['aspd', 1.0],             a: ['tenacity', 1.0] },
  { id: 'r20', name: '嵐',   w: ['elemDmgWind', 1.0],      a: ['resWind', 0.5] },
  { id: 'r21', name: '蒼穹', w: ['bossDmg', 1.1],          a: ['shieldEff', 1.1] },
  { id: 'r22', name: '厚土', w: ['elemDmgEarth', 1.1],     a: ['hpPct', 1.2] },
  { id: 'r23', name: '熔岩', w: ['atkPct', 1.3],           a: ['globalDmgRed', 1.1] },
  { id: 'r24', name: '冰魄', w: ['critDmg', 1.4],          a: ['resAll', 0.6] },
  { id: 'r25', name: '雷霆', w: ['matkPct', 1.4],          a: ['blockDmgRed', 1.4] },
  { id: 'r26', name: '虛空', w: ['aoeDmg', 1.5],           a: ['ccRed', 1.2] },
  { id: 'r27', name: '星辰', w: ['critRate', 1.6],         a: ['luck', 1.6] },
  { id: 'r28', name: '命運', w: ['normalDmg', 1.7],        a: ['evasion', 1.7] },
  { id: 'r29', name: '輪迴', w: ['lifesteal', 1.8],        a: ['hpRegen', 1.8] },
  { id: 'r30', name: '永恆', w: ['atkPct', 1.9],           a: ['hpPct', 1.9] },
  { id: 'r31', name: '混沌', w: ['matkPct', 2.0],          a: ['resAll', 0.9] },
  { id: 'r32', name: '創生', w: ['critDmg', 2.2],          a: ['shieldEff', 2.0] },
  { id: 'r33', name: '終焉', w: ['bossDmg', 2.5],          a: ['globalDmgRed', 1.8] }
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

/* 合成：同種符文 RUNE_COMPOSE_COUNT 顆 → 下一階 1 顆；RUNE_COMPOSE_MAX_TIER 以上只能靠掉落。 */
var RUNE_COMPOSE_COUNT = 3;
var RUNE_COMPOSE_MAX_TIER = 20;       // 能合成到第幾階（第 21 階起只掉落）
var RUNE_DISMANTLE_YIELD = 2;         // 拆解 1 顆 → 低一階符文 N 顆（比合成吃虧：3 → 1 → 2）

/* 掉落（野外擊殺／封魔塔 BOSS）。機率與階數分佈都是這裡的具名常數，
   公式 runeDropTierMax／rollRuneTier 在 js/runeword.js。 */
var RUNE_DROP = {
  basePct: 1.2,             // 野外每次擊殺的基礎掉落率（%），再乘掉寶率／地圖倍率／敵種倍率
  towerBossPct: 35,         // 封魔塔通關時的基礎機率（%）
  tierSpread: 0.62,         // 階數分佈：最高階 38%、次高階 ~23%、…（越小越集中在高階）
  progressPerTier: 4.6      // 進度（地圖序號＋關卡比例）每 1 對應的最高階增量
};

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
var RW_PROC_TRIGGERS = ['hit', 'crit', 'kill', 'hurt', 'block', 'cast', 'tick', 'lowhp'];
var RW_ACTS = ['dmg', 'heal', 'shield', 'mana', 'buff', 'buffRandom', 'stun', 'slow', 'dot', 'cdr',
  'refresh', 'recast', 'castRandom', 'invuln', 'execute', 'cleanse'];

/* ---- 符文之語 ----
   runes  鑲入順序（符文 id，可重複）
   bases  允許的裝備（RW_BASE_TOKENS 或武器類型鍵），多項為「或」
   stats  [[詞條鍵, mult], …]
   passives  並入既有被動表（st.passives）的數值：thorns／smite／undying／sunder／trueDmg／omniDrain…
   legend    借用既有「傳奇特效」（PASSIVE_POOL 的鍵）——不受該特效原本的武器類型限制，
             但仍需要配戴對應的技能才有感（例如飛刀系要有飛刀技能）。
   fx / procs 見上方詞彙；flavor 為一句風味文字。 */
var RUNEWORDS = [
  /* ===== 第一級　普通（2~3 符文）===== */
  { id: 'rw_firstcry', name: '初啼', tier: 1, runes: ['r01', 'r02'], bases: ['mainHand'],
    stats: [['atkFlat', 2.0], ['matkFlat', 2.0], ['hit', 1.0]],
    flavor: '第一聲啼鳴，劃破長夜的寂靜。' },
  { id: 'rw_nightwatch', name: '守夜', tier: 1, runes: ['r02', 'r05'], bases: ['chest'],
    stats: [['defFlat', 2.5], ['hpFlat', 2.5], ['hpRegen', 1.0]],
    flavor: '燈火不滅，守夜人便不眠。' },
  { id: 'rw_frostwhisper', name: '霜語', tier: 1, runes: ['r03', 'r04'], bases: ['caster'],
    stats: [['matkFlat', 2.5], ['elemDmgIce', 1.5]],
    procs: [{ on: 'hit', chance: 10, acts: [{ act: 'slow', sec: 2 }] }],
    flavor: '寒風低語，敵人的腳步便慢了下來。' },
  { id: 'rw_windwalk', name: '行雲', tier: 1, runes: ['r04', 'r01', 'r13'], bases: ['boots'],
    stats: [['evasion', 2.0], ['hpFlat', 2.0], ['hit', 1.0]],
    flavor: '步履如雲，不留痕跡。' },
  { id: 'rw_stoneskin', name: '石膚', tier: 1, runes: ['r05', 'r11'], bases: ['shoulder', 'legs'],
    stats: [['defPct', 1.5], ['hpPct', 1.2], ['pRes', 0.8]], passives: { thorns: 3 },
    flavor: '皮膚堅如岩層，觸碰者必受其傷。' },
  { id: 'rw_viperkiss', name: '蛇吻', tier: 1, runes: ['r06', 'r08'], bases: ['sword1h', 'dagger1h', 'magicSword1h'],
    stats: [['atkPct', 1.2], ['elemDmgPoison', 1.5], ['critRate', 1.0]],
    procs: [{ on: 'hit', chance: 15, acts: [{ act: 'dot', pct: 60, sec: 4, name: 'poison' }] }],
    flavor: '毒蛇的一吻，慢慢收走對手的生命。' },
  { id: 'rw_minorthunder', name: '輕雷', tier: 1, runes: ['r07', 'r04'], bases: ['oneHand'],
    stats: [['matkPct', 1.5], ['elemDmgLightning', 2.0]],
    procs: [{ on: 'hit', chance: 8, acts: [{ act: 'dmg', pct: 90, elem: 'lightning', to: 'target' }] }],
    flavor: '一聲輕雷，落在不經意的地方。' },
  { id: 'rw_lightguard', name: '聖光之守', tier: 1, runes: ['r09', 'r12'], bases: ['helmet'],
    stats: [['mpFlat', 2.0], ['resLight', 1.5], ['hpPct', 1.0]], fx: { killManaPct: 1 },
    flavor: '以聖光為冠，心神澄明。' },
  { id: 'rw_bloodring', name: '血誓之環', tier: 1, runes: ['r10', 'r08'], bases: ['ring'],
    stats: [['lifesteal', 2.0], ['atkPct', 1.0], ['hit', 1.0]], fx: { killHealPct: 1 },
    flavor: '以血起誓，生者共飲。' },
  { id: 'rw_steelheart', name: '鋼心', tier: 1, runes: ['r11', 'r05'], bases: ['belt'],
    stats: [['hpPct', 1.5], ['defPct', 1.5], ['tenacity', 1.0]],
    flavor: '腰繫鋼索，心不動搖。' },
  { id: 'rw_springflow', name: '泉湧', tier: 1, runes: ['r01', 'r02', 'r12'], bases: ['amulet'],
    stats: [['mpRegen', 2.0], ['hpRegen', 2.0], ['mpFlat', 1.5]], fx: { killManaPct: 2 },
    flavor: '源源不絕，如山間清泉。' },
  { id: 'rw_scavenger', name: '拾荒者', tier: 1, runes: ['r01', 'r13'], bases: ['jewelry'],
    stats: [['goldBonus', 2.0], ['xpBonus', 1.5], ['loot', 1.2]], fx: { runeFindPct: 8 },
    flavor: '連廢墟裡的一粒塵埃，也要翻過三遍。' },
  { id: 'rw_breaker', name: '破軍', tier: 1, runes: ['r02', 'r10', 'r11'], bases: ['twoHand'],
    stats: [['atkPct', 1.5], ['critDmg', 1.5], ['pPen', 0.2]],
    flavor: '重兵一落，軍陣自潰。' },
  { id: 'rw_burnstar', name: '燃星', tier: 1, runes: ['r02', 'r09', 'r12'], bases: ['caster'],
    stats: [['matkPct', 1.5], ['elemDmgFire', 1.5], ['mpFlat', 1.5]],
    procs: [{ on: 'cast', chance: 15, acts: [{ act: 'mana', pctMax: 12 }] }],
    flavor: '星火燎原，施法者的靈感湧現。' },

  /* ===== 第二級　強力（3~4 符文）===== */
  { id: 'rw_galeblade', name: '疾風烈刃', tier: 2, runes: ['r13', 'r04', 'r19'], bases: ['sword1h', 'dagger1h', 'magicSword1h'],
    stats: [['aspd', 2.5], ['critRate', 1.5], ['atkPct', 1.5]], fx: { aspdMult: 8 },
    flavor: '快過風的刃，連風聲都追不上。' },
  { id: 'rw_thundergod', name: '雷神之怒', tier: 2, runes: ['r07', 'r10', 'r11', 'r15'], bases: ['mainHand'],
    stats: [['atkPct', 1.5], ['elemDmgLightning', 2.5], ['critDmg', 1.5]],
    procs: [{ on: 'hit', chance: 15, acts: [{ act: 'dmg', pct: 120, elem: 'lightning', to: 'all' }] }],
    flavor: '神怒所至，雷霆不擇敵我之外。' },
  { id: 'rw_winterherald', name: '凜冬使者', tier: 2, runes: ['r03', 'r03', 'r18'], bases: ['caster'],
    stats: [['matkPct', 2.0], ['elemDmgIce', 3.0], ['cdr', 1.0]], fx: { dmgCtrlPct: 15 },
    procs: [{ on: 'hit', chance: 20, acts: [{ act: 'stun', sec: 1.5 }] }],
    flavor: '冬天來了，所過之處萬物凝結。' },
  { id: 'rw_bloodgulp', name: '血飲者', tier: 2, runes: ['r10', 'r08', 'r10', 'r15'], bases: ['mainHand'],
    stats: [['lifesteal', 3.0], ['atkPct', 2.0], ['critRate', 1.0]], fx: { killHealPct: 3, dmgSelfLowPct: 25 },
    flavor: '越是瀕死，越是渴血。' },
  { id: 'rw_unmoving', name: '不動山', tier: 2, runes: ['r05', 'r14', 'r11'], bases: ['chest'],
    stats: [['hpPct', 3.0], ['defPct', 3.0], ['pRes', 1.0]], fx: { maxHitPct: 40 },
    flavor: '任憑千鈞一擊，山自巍然。' },
  { id: 'rw_shadowstep', name: '影步', tier: 2, runes: ['r08', 'r13', 'r16'], bases: ['boots', 'legs'],
    stats: [['evasion', 3.5], ['hit', 2.0], ['hpPct', 1.5]],
    procs: [{ on: 'hurt', chance: 15, cd: 10, acts: [{ act: 'invuln', sec: 1 }] }],
    flavor: '一步踏入影中，攻擊落了空。' },
  { id: 'rw_dawncrown', name: '旭日之冠', tier: 2, runes: ['r15', 'r09', 'r17', 'r12'], bases: ['helmet'],
    stats: [['hpPct', 2.0], ['mpFlat', 3.0], ['resAll', 1.0]],
    procs: [{ on: 'tick', every: 10, acts: [{ act: 'heal', pctMax: 8 }, { act: 'mana', pctMax: 8 }] }],
    flavor: '戴上旭日，每一刻都是黎明。' },
  { id: 'rw_poisoncloud', name: '毒雲', tier: 2, runes: ['r06', 'r06', 'r08', 'r16'], bases: ['caster'],
    stats: [['matkPct', 2.0], ['elemDmgPoison', 3.0], ['mPen', 0.3]],
    procs: [{ on: 'cast', chance: 25, acts: [{ act: 'dot', pct: 60, sec: 4, name: 'poison', to: 'all' }] }],
    flavor: '施法之後，毒霧久久不散。' },
  { id: 'rw_awakening', name: '驚蟄', tier: 2, runes: ['r19', 'r13', 'r07'], bases: ['gloves'],
    stats: [['aspd', 3.0], ['critRate', 2.0], ['atkPct', 1.5]],
    procs: [{ on: 'crit', acts: [{ act: 'buff', sid: 'aspdUp', val: 12, sec: 3, max: 3 }] }],
    flavor: '一聲春雷，萬蟲驚動。' },
  { id: 'rw_ironoath', name: '重甲鐵誓', tier: 2, runes: ['r14', 'r05', 'r11', 'r10'], bases: ['shoulder'],
    stats: [['hpPct', 2.5], ['defPct', 2.0], ['pRes', 1.0]], passives: { thorns: 12 },
    procs: [{ on: 'hurt', chance: 20, cd: 3, acts: [{ act: 'dmg', pct: 100, type: 'phys', to: 'attacker' }] }],
    flavor: '以鐵起誓，傷我者必以鐵還之。' },
  { id: 'rw_gambler', name: '賭徒之戒', tier: 2, runes: ['r01', 'r13', 'r16', 'r19'], bases: ['ring'],
    stats: [['luck', 3.0], ['critRate', 2.0], ['critDmg', 2.5], ['loot', 2.0]], fx: { runeFindPct: 15 },
    flavor: '全押。贏了拿走一切，輸了也不過一場好戲。' },
  { id: 'rw_guardian', name: '守護者之盾', tier: 2, runes: ['r14', 'r11', 'r05', 'r15'], bases: ['shield'],
    stats: [['blockRate', 3.0], ['blockDmgRed', 3.0], ['hpPct', 2.0]],
    procs: [{ on: 'block', chance: 40, acts: [{ act: 'dmg', pct: 200, type: 'phys', to: 'attacker' }] }],
    flavor: '盾不是為了後退，是為了把力量還給對方。' },
  { id: 'rw_arcaneecho', name: '奧術迴響', tier: 2, runes: ['r12', 'r19', 'r12', 'r09'], bases: ['focus', 'spellbook', 'orb'],
    stats: [['matkPct', 3.0], ['mpFlat', 3.0], ['cdr', 2.0]],
    procs: [{ on: 'cast', chance: 20, acts: [{ act: 'cdr', sec: 1.5 }] }],
    flavor: '咒語落下之後，還在空氣裡迴盪。' },
  { id: 'rw_smith', name: '鐵匠之魂', tier: 2, runes: ['r12', 'r11', 'r14'], bases: ['amulet'],
    stats: [['gemEff', 3.0], ['affixCap', 2.0], ['enhanceSuccess', 3.0]],
    flavor: '鎚聲不絕，鋼與靈魂同鍛。' },

  /* ===== 第三級　非常強力（4~5 符文）===== */
  { id: 'rw_apocalypse', name: '天啟', tier: 3, runes: ['r10', 'r17', 'r21', 'r23', 'r25'], bases: ['mainHand'],
    stats: [['atkPct', 3.0], ['matkPct', 3.0], ['critDmg', 3.0], ['bossDmg', 3.0]], fx: { dmgPct: 18, aspdMult: 10 },
    flavor: '號角響起，審判降臨。' },
  { id: 'rw_soulcleaver', name: '斷魂', tier: 3, runes: ['r10', 'r11', 'r23', 'r19', 'r26'], bases: ['twoHand'],
    stats: [['atkPct', 4.0], ['critDmg', 4.0], ['eliteDmg', 3.0], ['pPen', 0.5]], fx: { dmgLoHpPct: 60 },
    procs: [{ on: 'hit', chance: 8, acts: [{ act: 'execute', hpBelow: 15 }] }],
    flavor: '一刀兩斷，魂亦分離。' },
  { id: 'rw_chainstorm', name: '連環雷暴', tier: 3, runes: ['r07', 'r25', 'r07', 'r20', 'r13'], bases: ['caster'],
    stats: [['matkPct', 4.0], ['elemDmgLightning', 4.0], ['elemDmgWind', 3.0], ['mPen', 0.5]],
    procs: [
      { on: 'crit', acts: [{ act: 'dmg', pct: 150, elem: 'lightning', to: 'all' }] },
      { on: 'cast', chance: 25, acts: [{ act: 'dmg', pct: 100, elem: 'lightning', to: 'rand', n: 3 }] }
    ],
    flavor: '雷與風相纏，一環扣一環。' },
  { id: 'rw_timewarden', name: '時之守望', tier: 3, runes: ['r18', 'r27', 'r18', 'r12'], bases: ['focus', 'spellbook', 'orb'],
    stats: [['cdr', 4.0], ['matkPct', 3.0], ['mpRegen', 3.0], ['hpPct', 2.0]], fx: { cdPct: 20 },
    procs: [{ on: 'kill', acts: [{ act: 'cdr', sec: 1 }] }],
    flavor: '守望者拾起墜落的時間，替你多留一點。' },
  { id: 'rw_lastbreath', name: '絕境', tier: 3, runes: ['r14', 'r22', 'r11', 'r25'], bases: ['chest'],
    stats: [['hpPct', 4.0], ['defPct', 3.5], ['mdefPct', 3.5], ['globalDmgRed', 2.0]],
    procs: [{ on: 'lowhp', below: 30, cd: 90, acts: [{ act: 'invuln', sec: 3 }, { act: 'heal', pctMax: 30 }, { act: 'cleanse' }] }],
    flavor: '退無可退之處，才是真正的開始。' },
  { id: 'rw_swarmhunter', name: '群獵', tier: 3, runes: ['r13', 'r19', 'r04', 'r23', 'r16'], bases: ['mainHand'],
    stats: [['aspd', 3.5], ['atkPct', 3.0], ['critRate', 2.5], ['aoeDmg', 2.0]], fx: { dmgPerFoePct: 6, splashPct: 40 },
    flavor: '獸群越多，獵人越是興奮。' },
  { id: 'rw_assassin', name: '影殺', tier: 3, runes: ['r08', 'r16', 'r13', 'r26'], bases: ['dagger1h'],
    stats: [['critRate', 3.5], ['critDmg', 4.0], ['atkPct', 3.0], ['evasion', 2.0]], fx: { dmgHiHpPct: 30 },
    legend: ['knifeShadowblade', 'knifeChain'],
    flavor: '刀影分裂成雙，雙影各自找到了喉嚨。' },
  { id: 'rw_manafountain', name: '魔泉', tier: 3, runes: ['r12', 'r12', 'r18', 'r21'], bases: ['helmet', 'amulet'],
    stats: [['mpFlat', 4.0], ['mpRegen', 4.0], ['matkPct', 2.5]], fx: { manaCostRedPct: 40, killManaPct: 3 },
    flavor: '魔力不是用完的，是流過的。' },
  { id: 'rw_thornedfury', name: '荊棘之怒', tier: 3, runes: ['r14', 'r05', 'r23', 'r22', 'r11'], bases: ['chest', 'shield'],
    stats: [['hpPct', 3.5], ['defPct', 3.5], ['pRes', 2.0]], passives: { thorns: 35 },
    procs: [{ on: 'hurt', chance: 25, cd: 2, acts: [{ act: 'dmg', pct: 150, type: 'phys', to: 'all' }] }],
    flavor: '怒意生出荊棘，連空氣都帶刺。' },
  { id: 'rw_bossbane', name: '弒王者', tier: 3, runes: ['r21', 'r10', 'r27', 'r11'], bases: ['mainHand'],
    stats: [['bossDmg', 5.0], ['eliteDmg', 4.0], ['atkPct', 2.5], ['matkPct', 2.5]], fx: { dmgHiHpPct: 40, dmgSoloPct: 40 },
    flavor: '王座再高，也有人要把它拆了。' },
  { id: 'rw_vitalpact', name: '生命契約', tier: 3, runes: ['r10', 'r08', 'r22', 'r10', 'r22'], bases: ['jewelry'],
    stats: [['hpPct', 4.0], ['lifesteal', 4.0], ['hpRegen', 4.0]], fx: { killHealPct: 6, dmgSelfFullPct: 25 },
    flavor: '契約的對價是活著，且活得很好。' },
  { id: 'rw_shieldwall', name: '護盾牆', tier: 3, runes: ['r21', 'r14', 'r21', 'r26'], bases: ['chest', 'shoulder', 'helmet'],
    stats: [['shieldEff', 5.0], ['hpPct', 3.0], ['globalDmgRed', 2.5]],
    procs: [{ on: 'tick', every: 8, acts: [{ act: 'shield', pctMax: 20, sec: 8 }] }],
    flavor: '牆起，風止。' },
  { id: 'rw_elemental', name: '元素之環', tier: 3, runes: ['r03', 'r17', 'r07', 'r06', 'r20'], bases: ['ring'],
    stats: [['elemDmgFire', 1.8], ['elemDmgIce', 1.8], ['elemDmgLightning', 1.8], ['elemDmgWind', 1.8], ['elemDmgPoison', 1.8]],
    fx: { dmgPct: 10 },
    flavor: '五元素各執一角，在指尖上取得平衡。' },
  { id: 'rw_blitz', name: '閃擊', tier: 3, runes: ['r13', 'r19', 'r27', 'r04'], bases: ['mainHand'],
    stats: [['aspd', 4.0], ['critRate', 3.0], ['hit', 2.0]], fx: { aspdMult: 15 },
    procs: [{ on: 'hit', every: 6, acts: [{ act: 'castRandom' }] }],
    flavor: '揮刀太快，連技能都被牽著走。' },

  /* ===== 第四級　極度特殊（5~6 符文；改寫規則，常附代價）===== */
  { id: 'rw_reincarnation', name: '輪迴', tier: 4, runes: ['r29', 'r30', 'r28', 'r33', 'r32'], bases: ['chest'],
    stats: [['hpPct', 4.0], ['defPct', 4.0], ['mdefPct', 4.0]],
    fx: { reviveHpPct: 60, reviveCdSec: 180, reviveInvulnSec: 3, reviveDmgPct: 60, reviveDmgSec: 10, reviveRefresh: 1 },
    flavor: '死亡只是下一次輪迴的開場白。' },
  { id: 'rw_timeloop', name: '時之沙', tier: 4, runes: ['r28', 'r29', 'r26', 'r30', 'r27'], bases: ['amulet'],
    stats: [['cdr', 5.0], ['mpRegen', 5.0], ['matkPct', 3.0]], fx: { cdPct: 45, maxHpPct: -20 },
    procs: [{ on: 'cast', chance: 25, acts: [{ act: 'recast' }] }],
    flavor: '沙漏倒過來了。代價是你的生命，也在一起流。' },
  { id: 'rw_bloodmoon', name: '血月', tier: 4, runes: ['r10', 'r23', 'r31', 'r16', 'r33'], bases: ['mainHand'],
    stats: [['atkPct', 4.0], ['matkPct', 4.0], ['critDmg', 4.0], ['lifesteal', 3.0]],
    fx: { dmgPct: 80, selfDrainPct: 2, killHealPct: 8, maxHpPct: -30 },
    flavor: '血月當空，誰先流盡誰先倒下。' },
  { id: 'rw_arsenal', name: '武庫', tier: 4, runes: ['r19', 'r13', 'r20', 'r27', 'r31'], bases: ['mainHand'],
    stats: [['aspd', 3.0], ['atkPct', 3.0], ['matkPct', 3.0]], fx: { skillDmgPct: 40 },
    procs: [
      { on: 'hit', every: 4, acts: [{ act: 'castRandom' }] },
      { on: 'cast', chance: 15, acts: [{ act: 'recast' }] }
    ],
    flavor: '每一次揮擊，都從武器庫裡抽出另一招。' },
  { id: 'rw_thunderemperor', name: '雷帝', tier: 4, runes: ['r25', 'r07', 'r25', 'r26', 'r20', 'r27'], bases: ['caster'],
    stats: [['matkPct', 5.0], ['elemDmgLightning', 6.0], ['critRate', 3.0]], fx: { dmgCtrlPct: 40 },
    procs: [
      { on: 'tick', every: 1.2, acts: [{ act: 'dmg', pct: 200, elem: 'lightning', to: 'rand', n: 3 }] },
      { on: 'crit', acts: [{ act: 'stun', sec: 1, to: 'all' }] }
    ],
    flavor: '帝王不需親自出手，雷霆自會代勞。' },
  { id: 'rw_lonewolf', name: '孤狼', tier: 4, runes: ['r22', 'r21', 'r23', 'r26', 'r28'], bases: ['mainHand'],
    stats: [['critDmg', 5.0], ['atkPct', 4.0], ['bossDmg', 4.0]], fx: { dmgSoloPct: 150, dmgHiHpPct: 50, cdPct: 15 },
    flavor: '孤狼只獵王者。獵物以外，一概不理。' },
  { id: 'rw_starfall', name: '星墜', tier: 4, runes: ['r27', 'r26', 'r25', 'r17', 'r24', 'r28'], bases: ['staff2h'],
    stats: [['matkPct', 6.0], ['elemDmgFire', 4.0], ['elemDmgIce', 4.0], ['mPen', 0.6]],
    procs: [{ on: 'tick', every: 3, acts: [{ act: 'dmg', pct: 220, elem: 'random', to: 'rand', n: 5 }] }],
    flavor: '夜空翻面，群星墜落成雨。' },
  { id: 'rw_chaoslord', name: '混沌之主', tier: 4, runes: ['r31', 'r26', 'r28', 'r29', 'r30'], bases: ['jewelry'],
    stats: [['resAll', 3.0], ['luck', 4.0], ['critRate', 3.0]], fx: { skillDmgPct: 25 },
    procs: [{ on: 'cast', acts: [{ act: 'buffRandom', sec: 8, from: [
      { sid: 'atkUp', val: 25 }, { sid: 'aspdUp', val: 25 }, { sid: 'critDmgUp', val: 60 },
      { sid: 'defUp', val: 40 }, { sid: 'evasionUp', val: 30 }, { sid: 'allDmgUp', val: 20 }] }] }],
    flavor: '混沌不問因果，每一次施法都是一場賭局。' },
  { id: 'rw_dragonslayer', name: '屠龍者', tier: 4, runes: ['r21', 'r23', 'r27', 'r30', 'r33'], bases: ['twoHand'],
    stats: [['atkPct', 5.0], ['bossDmg', 8.0], ['critDmg', 4.0], ['pPen', 0.8]], fx: { dmgHiHpPct: 60, dmgPct: 40 },
    procs: [{ on: 'crit', chance: 25, acts: [{ act: 'dmg', pct: 300, type: 'phys', to: 'target' }] }],
    flavor: '巨龍的鱗片，就是為了被一劍貫穿而生。' },
  { id: 'rw_immortalbody', name: '不朽之軀', tier: 4, runes: ['r30', 'r33', 'r29', 'r32', 'r26'], bases: ['armor'],
    stats: [['hpPct', 5.0], ['globalDmgRed', 3.0], ['resAll', 3.0]], fx: { maxHitPct: 15, dmgPct: -20 },
    procs: [{ on: 'lowhp', below: 40, cd: 60, acts: [{ act: 'shield', pctMax: 40, sec: 6 }, { act: 'invuln', sec: 2 }] }],
    flavor: '以出手的力量，換不會倒下的身軀。' },
  { id: 'rw_legion', name: '萬軍', tier: 4, runes: ['r19', 'r27', 'r20', 'r31', 'r13', 'r26'], bases: ['greatsword2h', 'axe2h'],
    stats: [['atkPct', 4.0], ['aspd', 4.0], ['aoeDmg', 4.0]], fx: { splashPct: 120, dmgPerFoePct: 10 },
    legend: ['skyrendSlash', 'gatheringVortex'],
    flavor: '一人成軍，一劍橫掃萬軍。' },
  { id: 'rw_bladedancer', name: '劍舞者', tier: 4, runes: ['r13', 'r19', 'r20', 'r31', 'r27'], bases: ['twoHand'],
    stats: [['aspd', 3.0], ['critRate', 3.0], ['atkPct', 3.0]], fx: { aspdMult: 15 },
    legend: ['danceTwinBlades', 'danceThousandCuts', 'danceUnyielding'],
    flavor: '舞到最後一步時，才知道這是一場不能停的舞。' },
  { id: 'rw_voidwalker', name: '虛空行者', tier: 4, runes: ['r26', 'r33', 'r26', 'r31', 'r29'], bases: ['boots'],
    stats: [['evasion', 6.0], ['hit', 4.0], ['hpPct', 3.0]], fx: { dmgPct: 25 },
    procs: [{ on: 'hurt', chance: 30, cd: 4, acts: [
      { act: 'invuln', sec: 1.5 }, { act: 'dmg', pct: 150, elem: 'dark', to: 'all' }] }],
    flavor: '走進虛空的人，被攻擊的永遠是上一個位置。' },
  { id: 'rw_genesis', name: '創世紀', tier: 4, runes: ['r28', 'r29', 'r30', 'r31', 'r32', 'r33'], bases: ['any'],
    stats: [['atkPct', 3.0], ['matkPct', 3.0], ['elemDmgFire', 1.5], ['elemDmgIce', 1.5], ['elemDmgLightning', 1.5],
      ['elemDmgPoison', 1.5], ['elemDmgLight', 1.5], ['elemDmgDark', 1.5], ['elemDmgEarth', 1.5], ['elemDmgWind', 1.5]],
    fx: { dmgPct: 50, cdPct: 20, aspdMult: 15, manaCostRedPct: 30 },
    flavor: '最後一顆符文落下時，世界從頭開始。' }
];

var RUNEWORD_BY_ID = (function () {
  var m = {};
  for (var i = 0; i < RUNEWORDS.length; i++) m[RUNEWORDS[i].id] = RUNEWORDS[i];
  return m;
})();

var RUNEWORD_TIER_NAMES = ['', '普通', '強力', '非常強力', '極度特殊'];
var RUNEWORD_TIER_COLORS = ['', '#9aa5b1', '#4ade80', '#c084fc', '#fb923c'];

/* 符文名稱（含階數）。未知 id 回傳 id 本身，避免畫面上出現 undefined。 */
function runeName(id) {
  var r = RUNE_BY_ID[id];
  return r ? r.name : String(id);
}
function runeLabel(id) { return runeName(id) + '符文'; }
