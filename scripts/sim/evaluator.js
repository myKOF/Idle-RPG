'use strict';
/* ============ 邊際效益評估器（StrategyOptimizer） ============

   這一層回答一個問題，而且只回答這一個：

       「把下一單位預算投到哪裡，戰力增幅最大？」

   ---- 為什麼它不住在策略沙箱裡 ----

   策略層（scripts/sim/policy.js）拿不到 G、拿不到 FIELD、拿不到任何遊戲函式，
   那是刻意的能力剝奪。要算「這條詞條值多少 DPS」就必須讀遊戲的傷害公式，
   兩條路都是死的：

     A. 在策略沙箱裡重寫一份傷害公式 → 參數表（config/Excel）一改就靜靜失真，
        而且不會有任何錯誤訊息，只會看到 AI 開始做蠢決策。
        docs/SIM_HARNESS.md 記過三次同類型的事故，全都是「抄了第二份」造成的。
     B. 把 G / FIELD 開放給策略 → 隔離就沒了，scripts/test_policy_isolation.js 的
        12 項反證會全數失守。

   所以走第三條：本檔跑在**引擎的 vm context**（看得到 G、FIELD 與全部遊戲函式），
   把結果算成**純資料**，再經 panels.eval 交給策略沙箱。策略仍然只做一件事——
   在一堆數字裡挑最大的那個。誰比較強是遊戲說的，不是策略說的。

   ---- 為什麼它不住在 js/ 裡 ----

   放進 js/worker/sim.worker.js 的 buildPanel 也能達到同樣效果，但那份程式碼會
   跟著正式版出貨給真人玩家，而這裡的東西只有 AI 模擬器用得到。harness 專用的
   東西留在 harness。

   ---- 這裡唯一被允許做的事 ----

   **組合**遊戲的函式，不得**複製**它們的內容。
   底下每一處算式都只由遊戲函式串接而成（defReduction / penIgnoreRatio /
   computeStats / affixBaseValue …）。唯二的例外是「命中率夾值」與「暴擊期望值」
   這兩個係數，見 MODEL_NOTES —— 它們在遊戲裡是內嵌在 resolveHit 的字面值，
   沒有具名函式可呼叫，所以只能宣告在這裡並公開揭露。

   ---- 這個模型算得準嗎？不準，而且不需要準 ----

   本模型只算普攻，不含技能、連擊、範圍攻擊。docs/SIM_HARNESS.md 量過：
   只算普攻會低估實際輸出約 5 倍。

   這對 ROI **完全無害**——ROI 是比值（ΔDPS ÷ DPS），常數倍率會約掉。
   但對「還要幾秒才殺得死」是致命的，所以絕對時間一律走 calibrate()：
   拿遊戲自己量到的 currentDps() 去校正模型的尺度。模型負責「對屬性的敏感度」，
   遊戲負責「絕對值」，各做各擅長的事。 */

/* ---- 模型係數：全部來自遊戲，但遊戲沒有把它們包成函式 ----
   每一項都註明出處。改遊戲時這幾行是唯一需要人工同步的地方，
   tests/sim-evaluator.test.cjs 有哨兵盯著（比對 resolveHit 原始碼裡的字面值）。 */
var MODEL_NOTES = {
  hitMin: 5,      // js/formula.js resolveHit：clamp(攻擊者命中 − 防守者閃避, 5, 100)
  hitMax: 100,
  /* 強度值取區間中點＝基準值本身（strengthMult(500) === 1.0）。
     用滿值會系統性高估所有候選，用最低值會系統性低估；取中點才是期望值，
     而 ROI 比的是期望值。 */
  probeRollRatio: 0.5
};

/* 規劃結果的快取（見 buildEvalPanel 結尾的說明）。以遊戲時鐘 GT 為鍵，
   不是真實時間——真實時間會讓同 seed 在不同機器上命中不同的快取。 */
var evalPlanCache = null;

/* 六大屬性。不寫死清單——遊戲的 ELEMENTS 才是唯一來源。 */
function evalElements() {
  return (typeof ELEMENTS !== 'undefined' && ELEMENTS) ? ELEMENTS : [];
}

/* ---- 對手側寫 ----
   評估要有對象。沒有對象的「戰力」是沒有意義的數字：同一套裝備打普通怪和打
   BOSS 的瓶頸完全不同（BOSS 閃避高 → 命中的邊際效益暴增；菁英血厚 → 傷害為王）。

   取當前正在打的那一隻。沒有在打（剛死、正在換關）就回 null，
   呼叫端據此回報 unknown——「還不知道」與「已達標」是兩件不同的事。 */
function evalFoe() {
  var m = (typeof FIELD !== 'undefined' && FIELD) ? FIELD.monster : null;
  if (!m || !(m.maxHp > 0)) return null;
  return {
    level: m.level || 1,
    maxHp: m.maxHp,
    hp: m.hp,
    atk: m.atk || 0,
    def: m.def || 0,
    mdef: (m.mdef === undefined || m.mdef === null) ? (m.def || 0) * 0.75 : m.mdef,
    dodge: m.dodge || 0,
    hit: (m.hit === undefined || m.hit === null) ? 100 : m.hit,
    aspd: m.aspd || 1,
    magic: !!m.magic,
    resist: m.resist || {},
    kind: m.isBoss ? 'boss' : (m.elite ? 'elite' : 'normal')
  };
}

/* ---- 我方對這個對手的每擊期望傷害 ----

   結構與 js/formula.js 的 resolveHit 逐段對齊，差別只有兩處，且都是刻意的：
     1. 命中／暴擊由「擲骰」換成「期望值」——評估不能消耗亂數，
        消耗了就會讓同 seed 的兩次跑分岔，決定論一破所有比對都失效
     2. 不含技能與連擊（見檔頭：ROI 是比值，常數倍率會約掉）

   每一段的減免都呼叫遊戲的函式，沒有一行是自己算的。 */
function evalHitDamage(st, foe) {
  var lv = st.level || 1;
  var dmg = 0;

  /* 物理段：破甲／穿透 → 防禦減免 → 物理抗性。玩家的 dmgType 恆為 'both'
     （js/combat.js playerAtkCfg），所以物理與魔法兩段都要算。 */
  var pIgnore = penIgnoreRatio(st.pPen || 0);
  var pDef = (foe.def || 0) * penDefMultiplier(pIgnore);
  var pDmg = (st.atk || 0) * (1 - defReduction(pDef, lv)) * penOverflowDmgMultiplier(pIgnore);
  pDmg *= 1 - physicalResistanceReduction(0, lv);   // 野怪沒有物理抗性欄位，留著讓公式對齊
  dmg += pDmg;

  var mIgnore = penIgnoreRatio(st.mPen || 0);
  var mDef = (foe.mdef || 0) * penDefMultiplier(mIgnore);
  var mDmg = (st.matk || 0) * (1 - defReduction(mDef, lv)) * penOverflowDmgMultiplier(mIgnore);
  mDmg *= 1 - magicResistanceReduction(0, lv);
  dmg += mDmg;

  /* 元素附加段。101 級以後的寶石偏好序是「一半爆傷、一半六大屬性傷害加成」
     （player_strategy.md），不算這一段的話那整個分段的 ROI 會被算成 0，
     策略就永遠不會去換元素寶石。 */
  var els = evalElements();
  for (var i = 0; i < els.length; i++) {
    var e = els[i];
    var ea = (st.elemAtk && st.elemAtk[e]) || 0;
    if (!ea) continue;
    var part = ea * elementalResistanceMultiplier(foe.resist || {}, e, lv);
    var up = (st.elemDmgPct && st.elemDmgPct[e]) || 0;
    dmg += part * (1 + up / 100);
  }

  /* 暴擊期望值。critDmg 是「暴擊時的總倍率%」（150 ＝ 1.5 倍），
     所以期望倍率 = 1 + p × (critDmg/100 − 1)。 */
  var p = Math.min(100, Math.max(0, st.critRate || 0)) / 100;
  dmg *= 1 + p * ((st.critDmg || 100) / 100 - 1);

  /* 敵種加成與總傷加成。BOSS 傷害詞條只有打 BOSS 時才有價值——
     不分敵種的話，AI 會在刷普通怪時把預算堆到 bossDmg 上。 */
  var byKind = { normal: st.normalDmg, elite: st.eliteDmg, boss: st.bossDmg };
  dmg *= 1 + ((byKind[foe.kind] || 0) / 100);
  dmg *= 1 + ((st.totalDmgPct || 0) / 100);

  return dmg;
}

/* 有效命中率。夾值一定要套：命中 100 − 閃避 103 的實際結果是 5%，不是 −3%，
   不套的話「再補 3 點命中就好」這種錯誤結論會直接出現在 ROI 排序裡。 */
function evalHitChance(selfHit, foeDodge) {
  var v = (selfHit || 0) - (foeDodge || 0);
  if (v < MODEL_NOTES.hitMin) v = MODEL_NOTES.hitMin;
  if (v > MODEL_NOTES.hitMax) v = MODEL_NOTES.hitMax;
  return v / 100;
}

/* ---- 承傷側：每一點敵方原始攻擊力，實際會扣掉我多少血 ----
   EHP ＝ 生命 ÷ 這個比例，單位是「敵方原始攻擊力」。
   這樣定義的好處是它對生命、防禦、抗性、格擋、減傷**全部**單調遞增，
   任何一項的邊際效益都量得出來，不必替每一種防禦屬性各寫一條規則。 */
function evalIncomingRatio(st, foe) {
  var lv = foe.level || 1;
  var raw = 1;   // 以「敵方 1 點攻擊力」為單位

  if (foe.magic) {
    raw *= 1 - defReduction(st.mdef || 0, lv);
    raw *= 1 - magicResistanceReduction(st.mRes || 0, lv);
  } else {
    raw *= 1 - defReduction(st.def || 0, lv);
    raw *= 1 - physicalResistanceReduction(st.pRes || 0, lv);
  }

  /* 全域減傷與敵種減傷。player_strategy.md 的「被秒殺就補對應屬性抗性」
     要靠這一段才量得出來——沒有它，抗性詞條的 ROI 恆為 0。 */
  raw *= 1 - (st.globalDmgRed || 0) / 100;
  var redByKind = { normal: st.normalDmgRed, elite: st.eliteDmgRed, boss: st.bossDmgRed };
  raw *= 1 - ((redByKind[foe.kind] || 0) / 100);

  /* 格擋是機率性的，取期望值。 */
  var blockP = Math.min(100, Math.max(0, st.blockRate || 0)) / 100;
  raw *= 1 - blockP * ((st.blockDmgRed || 0) / 100);

  return Math.max(0, raw);
}

/* ---- 戰力純量 ----
   offense：對當前對手的每秒期望傷害（模型尺度，非絕對值，見檔頭）
   ehp    ：能吃下多少「敵方原始攻擊力」

   這兩個數字本身沒有意義，有意義的是它們的**比值變化**。 */
function evalPower(st, foe) {
  var perHit = evalHitDamage(st, foe);
  var acc = evalHitChance(st.hit, foe.dodge);
  var offense = perHit * acc * (st.aspd || 1);

  var incoming = evalIncomingRatio(st, foe);
  var ehp = incoming > 0 ? (st.hp || 0) / incoming : Infinity;

  return { offense: offense, ehp: ehp };
}

/* ---- 絕對時間：用遊戲量到的 DPS 校正模型尺度 ----

   模型只算普攻，實測會低估約 5 倍（docs/SIM_HARNESS.md）。要判斷
   「打得完嗎」就必須有絕對時間，所以拿遊戲自己的 currentDps()（js/combat.js:584，
   最近 10 秒的實際傷害總和）去除以模型 DPS，得到一個尺度因子。

   ⚠️ currentDps() 是**視窗量測**，剛進場或剛換關時可能是 0。那時回 null 而不是 1——
   「還沒量到」不等於「模型剛好準」，硬給 1 會讓 timeToKill 系統性樂觀 5 倍，
   而那正是敗因診斷最不能出錯的地方。 */
function evalCalibration(st, foe) {
  if (typeof currentDps !== 'function') return null;
  var measured = currentDps();
  if (!(measured > 0)) return null;
  var modelled = evalPower(st, foe).offense;
  if (!(modelled > 0)) return null;
  return measured / modelled;
}

/* ---- 戰鬥側寫：這一場是打不動，還是撐不住？----

   player_strategy.md 的敗因歸因需要兩個時間：
     timeToKill  以當前輸出，把這隻怪的**剩餘血量**打完要幾秒
     timeToDie   以對手輸出，把我的**現有血量＋護盾**打完要幾秒

   兩者相比就是診斷：
     timeToKill > timeToDie   → 撐不住（EHP_TOO_LOW）
     timeToKill 超過 BOSS 時限 → 打不完（DPS_TIMEOUT）

   ⚠️ 一律回報 unknown 而不是猜。校正拿不到、對手不存在、輸出為零——
   任何一項缺席就沒有結論。策略對 unknown 的處置是「不改變行為」，
   對「已達標」的處置是「把預算挪去別處」，兩者差很多。 */
function evalCombatProfile(st, foe, cal) {
  if (!foe) return { known: false };
  var fp = (typeof FIELD !== 'undefined' && FIELD) ? FIELD.player : null;

  var offense = evalPower(st, foe).offense;
  var realDps = (cal !== null && offense > 0) ? offense * cal : null;
  var timeToKill = (realDps > 0) ? foe.hp / realDps : null;

  /* 對手的每秒輸出。命中率同樣要套夾值——閃避堆滿的角色 timeToDie 會差好幾倍。 */
  var foeAcc = evalHitChance(foe.hit, st.evasion);
  var foeDps = foe.atk * evalIncomingRatio(st, foe) * foeAcc * (foe.aspd || 1);
  var myHp = fp ? ((fp.hp || 0) + (fp.shield || 0)) : (st.hp || 0);
  var timeToDie = (foeDps > 0) ? myHp / foeDps : null;

  var cause = null;
  if (timeToKill !== null && timeToDie !== null) {
    cause = (timeToDie < timeToKill) ? 'EHP_TOO_LOW' : 'DPS_TIMEOUT';
  }

  return {
    known: timeToKill !== null && timeToDie !== null,
    kind: foe.kind,
    timeToKill: timeToKill,
    timeToDie: timeToDie,
    /* 餘裕比：>1 代表殺得死，<1 代表會先倒。策略拿它當連續量使用，
       比「會不會贏」的布林值好用——它分得出「差一點」與「差很遠」。 */
    margin: (timeToKill > 0 && timeToDie !== null) ? timeToDie / timeToKill : null,
    cause: cause,
    calibration: cal
  };
}

/* ============ 邊際效益：一單位預算換到多少戰力 ============

   ---- 為什麼用「合成一件裝備再問遊戲」而不是自己微分 ----

   要算「多一條物攻% 詞條值多少 DPS」，直覺作法是對 st.atk 做數值微分。
   但 st.atk 是 atkFlat / atkPct / str / 天賦 / 傳奇特效層層疊出來的，
   要把一條 atkPct 詞條換算成 Δatk 就得複製 computeStats 的聚合順序——
   又是一份會過期的副本。

   改成：複製一份身上裝備，在某個部位**多掛一條該詞條**，
   然後呼叫遊戲的 computeStats(override)。差值就是遊戲說的答案，
   聚合順序、乘區位置、上限夾值全都由遊戲自己處理。

   成本：每個候選詞條一次 computeStats。13 個部位 × 各 4~7 條詞條的聚合，
   實測遠低於一次 simStep，而決策點只有每 15 秒一次。 */

/* 造一條「期望強度」的詞條。roll 取區間中點，見 MODEL_NOTES.probeRollRatio。 */
function evalProbeAffix(key) {
  return {
    key: key,
    roll: Math.round(STRENGTH_ROLL_MAX * MODEL_NOTES.probeRollRatio),
    ancient: false
  };
}

/* 淺複製整套裝備，並把指定部位換成 replacement（null＝卸下）。
   ⚠️ 一定要複製到 affixes 陣列這一層：computeStats 不會改它，但我們自己要 push，
   直接改到 G.equipment 上那件就是把探針寫進了真實存檔。 */
function evalEquipmentWith(slotKey, replacement) {
  var out = {};
  var eq = (typeof G !== 'undefined' && G) ? (G.equipment || {}) : {};
  for (var i = 0; i < SLOT_LIST.length; i++) {
    var s = SLOT_LIST[i];
    out[s] = (s === slotKey) ? replacement : eq[s];
  }

  /* ---- 雙手武器會佔掉副手 ----

     遊戲穿上雙手武器時會把副手卸下（js/player.js），所以「主手放雙手武器 +
     副手還留著一把」是一個**遊戲裡不存在的狀態**。不處理的話 computeStats 會把
     兩邊的詞條都加進去，那件雙手武器的評估會憑空多出一整個部位的戰力，
     於是 AI 會換上它、實際卻掉了副手——而帳面上看起來是「換了之後變弱了」，
     完全對不上任何一條規則。

     兩個方向都要處理：換上雙手武器時清空副手；主手已經是雙手武器時，
     副手的候選一律不評估（evalSlotUpgrades 會提前跳過）。 */
  if (typeof isTwoHandItem === 'function' && out.weapon && isTwoHandItem(out.weapon)) {
    out.weapon2 = null;
  }
  return out;
}

/* ---- 探針一律用複本，絕不把真實物品交給遊戲函式 ----

   ⚠️ 這一支不是防禦性程式，是一個實際踩到的坑。

   itemScore() 內部會呼叫 itemEnchants()，而那支函式帶著一段舊格式正規化：
   把 { enchant: null } 就地改寫成 { enchants: [] } 並刪掉 enchant
   （js/item.js）。語意完全相同，但**存檔的位元組不同**。

   於是「觀測一下背包」這個純讀取的動作會讓存檔雜湊改變——
   有跑評估器與沒跑評估器的兩場，同 seed 卻得到不同的雜湊。
   決定論一破，scripts/verify_equivalence.js、cross_check、所有 A/B 比對全部失效，
   而症狀只是一串對不上的雜湊，完全看不出來是誰動的。

   身上那套不需要保護：getStats() 每一拍都在跑，早就正規化過了。
   會出事的只有背包——只有評估器會去讀它。 */
function evalSafeItem(item) {
  if (!item) return item;
  var clone = {};
  for (var k in item) clone[k] = item[k];
  /* 附魔正規化的目標欄位：兩個都帶過去，itemEnchants 改寫的是複本。 */
  clone.affixes = (item.affixes || []).slice();
  if (item.sockets) clone.sockets = item.sockets.slice();
  /* 詞條缺 roll 時 ensureAffixRoll 會就地改寫該條詞條物件（寫 roll、刪 val）。
     遊戲產生的裝備一定有 roll，但 GM 塞的與舊存檔沒有——只在真的缺的時候才複製，
     免得每個決策點白白複製幾千個詞條物件。 */
  for (var i = 0; i < clone.affixes.length; i++) {
    var a = clone.affixes[i];
    if (a && (a.roll === undefined || a.roll === null)) {
      var ac = {};
      for (var ak in a) ac[ak] = a[ak];
      clone.affixes[i] = ac;
    }
  }
  return clone;
}

/* 在某件裝備上「多一條詞條」的複本。 */
function evalItemPlusAffix(item, key) {
  if (!item) return null;
  var clone = {};
  for (var k in item) clone[k] = item[k];
  clone.affixes = (item.affixes || []).slice();
  clone.affixes.push(evalProbeAffix(key));
  return clone;
}

/* 在某件裝備上「把第 idx 條換成 key」的複本。洗煉的 ROI 要用這個——
   洗煉是**替換**不是新增，用新增去估會系統性高估（把被洗掉那條的價值當成免費）。 */
function evalItemSwapAffix(item, idx, key) {
  if (!item || !item.affixes || !item.affixes[idx]) return null;
  var clone = {};
  for (var k in item) clone[k] = item[k];
  clone.affixes = item.affixes.slice();
  clone.affixes[idx] = evalProbeAffix(key);
  return clone;
}

/* ---- 詞條 ROI 表 ----

   對每個候選詞條，回報「在最適合的部位加一條，戰力增加百分之幾」。

   為什麼要挑部位而不是固定一個：同一條詞條在不同部位的價值不同（裝等、品質、
   強化倍率都不一樣），而且遊戲規定每條詞條只能出現在特定部位
   （AFFIX_POOL 的 slots）。挑不出合法部位的詞條回 null，讓它自然退出排序。

   回傳的是**百分比增幅**而不是絕對值：策略要比較的是「這一單位預算投哪裡最划算」，
   而攻擊與防禦的絕對值單位不同，不化成比例就沒得比。這正是
   player_strategy.md v2.0 說的「計算 1 單位預算投入各詞條時對 DPS/EHP 的實際增幅百分比」。 */
function evalAffixRoi(keys, foe, base) {
  var out = {};
  if (!foe || !base) return out;
  var eq = (typeof G !== 'undefined' && G) ? (G.equipment || {}) : {};

  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var def = (typeof AFFIX_POOL !== 'undefined') ? AFFIX_POOL[key] : null;
    if (!def) { out[key] = null; continue; }

    /* ---- 先挑宿主部位，再精算一次 ----

       ⚠️ 這裡本來是「每個合法部位各精算一次，取最好的」。實測那樣做整個面板
       要 74 ms，而 20 小時 × 決策每 5 秒＝ 14,400 次，等於替一場 11 分鐘的模擬
       多加 18 分鐘——效能不是小事，它會直接決定這套機制能不能開著跑。

       改成先用**不花 computeStats 的**條件挑出最好的宿主，再精算那一個。
       宿主的好壞由裝等、品質、強化倍率決定（詞條數值 =
       (base + base×每級成長×(裝等−1)) × 品質倍率 × 強化倍率，js/item.js affixValue），
       這三項都直接讀得到，不必問 computeStats。

       挑錯宿主的代價只是 ROI 被低估一點點，挑對的機率很高——
       而它把每個詞條的成本從「合法部位數次」壓成「一次」。 */
    var host = null, hostRank = -1;
    for (var s = 0; s < SLOT_LIST.length; s++) {
      var slotKey = SLOT_LIST[s];
      var it = eq[slotKey];
      if (!it) continue;
      /* 部位合法性由遊戲的 AFFIX_POOL.slots 說了算。抄第二份清單這件事
         docs/SIM_HARNESS.md 記過：375 次洗煉一條都沒出來，而且毫無徵兆。 */
      if (def.slots && def.slots.indexOf(it.slot) < 0) continue;
      if (def.minR !== undefined && def.minR !== null && (it.rarity || 0) < def.minR) continue;
      /* 詞條數值的三個乘數，全部由遊戲的函式給。 */
      var rank = affixBaseValue(key, it.level || 1, it.rarity || 0) * upgradeMult(it);
      if (rank > hostRank) { hostRank = rank; host = slotKey; }
    }
    if (!host) { out[key] = null; continue; }

    var probe = evalItemPlusAffix(eq[host], key);
    var st2 = computeStats(evalEquipmentWith(host, probe));
    var p2 = evalPower(st2, foe);
    out[key] = {
      slotKey: host,
      dOffPct: base.offense > 0 ? (p2.offense / base.offense - 1) * 100 : 0,
      dEhpPct: (base.ehp > 0 && isFinite(base.ehp)) ? (p2.ehp / base.ehp - 1) * 100 : 0
    };
  }
  return out;
}

/* ---- 身上每一條詞條現在值多少 ----

   洗煉是**替換**，不是新增：要洗出好詞條就得先犧牲一條。所以「該洗哪一條」
   問的不是「哪條詞條最好」，而是「哪條詞條**最不值錢**」。

   舊策略的作法是「洗掉第一條不在保留清單裡的」（policy_interpreter.js
   rerollForDeficit 的 victim 挑法），理由寫得很誠實：「策略層沒有評價詞條好壞的能力」。
   現在有了——把該條詞條拿掉，問遊戲戰力掉多少。

   ⚠️ 太古位置不列入。太古詞條洗煉必為滿值且永遠維持太古（js/item.js
   rerollSingleAffix），是可累積的永久投資；把它當犧牲品會把投資洗掉。
   要不要保留仍由策略的 keepAncient 決定，這裡只是不推薦。 */
function evalEquippedAffixValue(foe, base, slotKeys) {
  var out = {};
  if (!foe || !base || !slotKeys || !slotKeys.length) return out;
  var eq = (typeof G !== 'undefined' && G) ? (G.equipment || {}) : {};

  /* ⚠️ 只探洗煉規則真的會用到的部位，不是全身 13 個。

     全身探一遍是 13 × 平均 4 條＝約 52 次 computeStats，實測讓整個面板從
     20 ms 變成 30 ms，而 rerollByRoi 每次只讀**一個**部位（ROI 第一名建議的宿主）。
     多算的 12 個部位一次都沒被讀過。 */
  for (var s = 0; s < slotKeys.length; s++) {
    var slotKey = slotKeys[s];
    var it = eq[slotKey];
    if (!it || !it.affixes || !it.affixes.length) continue;

    var list = [];
    for (var i = 0; i < it.affixes.length; i++) {
      var a = it.affixes[i];
      if (!a || !a.key) continue;

      /* 拿掉這一條的複本。用「移除」而不是「換成別的」，因為要量的是
         這一條**本身**的貢獻，不是它與某個替代品的差額。 */
      var clone = {};
      for (var k in it) clone[k] = it[k];
      clone.affixes = it.affixes.slice();
      clone.affixes.splice(i, 1);

      var st2 = computeStats(evalEquipmentWith(slotKey, clone));
      var p2 = evalPower(st2, foe);
      var lossOff = base.offense > 0 ? (1 - p2.offense / base.offense) * 100 : 0;
      var lossEhp = (base.ehp > 0 && isFinite(base.ehp)) ? (1 - p2.ehp / base.ehp) * 100 : 0;

      list.push({
        key: a.key,
        index: i,
        ancient: !!a.ancient,
        /* 拿掉它，戰力掉幾個百分點。愈小＝愈不值錢＝愈適合當犧牲品。 */
        lossOffPct: lossOff,
        lossEhpPct: lossEhp
      });
    }
    if (list.length) out[slotKey] = list;
  }
  return out;
}

/* ---- 換裝 ROI ----

   ⚠️ 這一支是本次改造裡收益最大的一項，理由值得寫清楚。

   舊的換裝規則（policy_interpreter.js 的 bestPerSlot）用的是字典序
   [品質, 裝等, 太古數, 評分]，**品質排第一**。實測後果：

     20 小時 × 10 個 seed，有 5 個 seed 最後全身 13 件都是「R4 史詩、裝等 1」，
     物攻 334，等級 54，卡在關卡 42 動不了。

   因為詞條數值 =（base + base × 每級成長 × (裝等−1)）× 品質倍率，
   而遊戲的掉落分段是 equipmentTierLevel：關卡 1~49 掉裝等 1、50~99 掉裝等 50。
   實測同一條 atkFlat 在 R4：裝等 1 是 12.0，裝等 50 是 335.4（**×28**）；
   而同樣裝等 1 下 R2 → R5 只有 7.0 → 16.0（×2.3）。

   **品質排在裝等前面，等於用一個 ×2.3 的因子去否決一個 ×28 的因子。**

   改成直接問遊戲：把候選穿上去，computeStats 出來的戰力是升還是降。
   品質不再有否決權，但它的價值（插槽數、詞條數、附魔欄）會如實反映在戰力裡——
   R5 比 R4 多一個插槽、多一條詞條，那些在 computeStats 裡本來就算得到。

   ---- 兩件事仍然不能只看戰力 ----

   1. **插槽是換不回來的**。低品質裝的插槽少，換上去之後身上的寶石會被擠出來。
      所以插槽數變少時要求更高的戰力增幅（socketPenalty），而不是直接禁止。
   2. **強化等級會歸零**。換裝時 +16 的投資一起蒸發。所以把「重建強化」的成本
      折算成一個門檻（upgradeGuard），差距不夠大就不換。

   兩者都是**有界**的懲罰，不是否決。docs/SIM_HARNESS.md 記過教訓：
   任何「條件不滿足就永久改變行為」的規則都會變成死鎖。 */
function evalSlotUpgrades(foe, base, cfg) {
  cfg = cfg || {};
  var out = {};
  if (!foe || !base) return out;

  var topN = (typeof cfg.candidatesPerSlot === 'number') ? cfg.candidatesPerSlot : 2;
  var socketPenalty = (typeof cfg.socketPenaltyPct === 'number') ? cfg.socketPenaltyPct : 8;
  var upgradeGuard = (typeof cfg.upgradeGuardPctPerLevel === 'number') ? cfg.upgradeGuardPctPerLevel : 0.5;

  var eq = (typeof G !== 'undefined' && G) ? (G.equipment || {}) : {};
  var inv = (typeof G !== 'undefined' && G && Array.isArray(G.inventory)) ? G.inventory : [];

  /* ---- 粗篩：整份背包只評分一次 ----

     精算一次要一次 computeStats，300 件背包 × 13 個部位全精算是 3,900 次。
     用遊戲的 itemScore 粗篩之後只剩 topN × 13 次。

     ⚠️ itemScore 一定要**先算好放進表裡**，不能寫在 sort 的比較函式裡。
     比較函式每次比較都會呼叫兩次，13 個部位各排一次序＝上千次重複計算，
     而 itemScore 內部要遍歷詞條、寶石、附魔。這一行的差別實測是整個面板
     74 ms → 個位數 ms。

     itemScore 已經含裝等與強化倍率（js/formula.js:1546），是個夠好的粗篩器——
     它只是不夠格當**最終**裁判：它看不到對手的閃避、抗性與敵種，
     而那正是「這件裝備對**現在這隻怪**強不強」的關鍵。 */
  var safe = [], score = {};
  for (var i0 = 0; i0 < inv.length; i0++) {
    var raw = inv[i0];
    if (!raw || raw.locked || raw.kind !== 'equip') continue;
    /* 從這裡開始都是複本。理由見 evalSafeItem——itemScore 會就地正規化
       舊格式的附魔欄位，直接餵真實物品會改到存檔。 */
    var cp0 = evalSafeItem(raw);
    cp0.__slots = equipSlotsForItem(cp0) || [];
    score[cp0.id] = itemScore(cp0);
    safe.push(cp0);
  }

  var twoHanded = !!(typeof isTwoHandItem === 'function' && eq.weapon && isTwoHandItem(eq.weapon));

  var used = {};
  for (var s = 0; s < SLOT_LIST.length; s++) {
    var slotKey = SLOT_LIST[s];
    /* 主手是雙手武器時副手用不了，評估它只會產生一個穿不上的建議。 */
    if (twoHanded && slotKey === 'weapon2') continue;

    var cands = [];
    for (var i = 0; i < safe.length; i++) {
      var it = safe[i];
      if (used[it.id]) continue;
      if (it.__slots.indexOf(slotKey) < 0) continue;
      cands.push(it);
    }
    if (!cands.length) continue;
    cands.sort(function (a, b) {
      var d = score[b.id] - score[a.id];
      /* 決定論：分數相同時以 id 決勝，不讓背包順序影響結果。 */
      return d !== 0 ? d : (a.id < b.id ? -1 : (a.id > b.id ? 1 : 0));
    });
    cands = cands.slice(0, topN);

    var cur = eq[slotKey] || null;
    var curSockets = cur && cur.sockets ? cur.sockets.length : 0;
    var curUpgrade = cur ? (cur.upgrade || 0) : 0;

    /* ---- 換裝時寶石會跟著走 ----

       遊戲的 unsocketGem 是免費且無損的（js/item.js，直接 addGem 退回庫存），
       而策略有 unsocket-off-priority / socket-gems 這一對規則會在一兩個決策點內
       把寶石補回新裝備上。所以「候選裝備目前插槽是空的」是暫時狀態，不是它的價值。

       不模擬這件事的話，每一件已鑲滿寶石的舊裝備都會顯得比新裝備強，
       換裝在中後期會整個停擺——而且症狀是「AI 就是不換裝」，看不出原因。 */
    var carried = (cur && cur.sockets) ? cur.sockets.filter(function (g) { return !!g; }) : [];

    var best = null;
    for (var c = 0; c < cands.length; c++) {
      var cand = cands[c];
      var probe = cand;
      if (carried.length && cand.sockets && cand.sockets.length) {
        probe = {};
        for (var pk in cand) probe[pk] = cand[pk];
        probe.sockets = cand.sockets.slice();
        for (var si = 0, ci = 0; si < probe.sockets.length && ci < carried.length; si++) {
          if (!probe.sockets[si]) probe.sockets[si] = carried[ci++];
        }
      }
      var st2 = computeStats(evalEquipmentWith(slotKey, probe));
      var p2 = evalPower(st2, foe);

      var dOff = base.offense > 0 ? (p2.offense / base.offense - 1) * 100 : 0;
      var dEhp = (base.ehp > 0 && isFinite(base.ehp)) ? (p2.ehp / base.ehp - 1) * 100 : 0;
      /* 攻防各半的合成分。不用加權是因為攻防的取捨屬於策略決定（policy JSON 的
         offenseWeight），這裡只提供兩個分量與一個中性的預設合成分。 */
      var gain = dOff + dEhp;

      /* 門檻：插槽變少、以及要重建的強化等級，各折算成必須跨過的增幅。 */
      var candSockets = cand.sockets ? cand.sockets.length : 0;
      var need = 0;
      if (candSockets < curSockets) need += (curSockets - candSockets) * socketPenalty;
      need += curUpgrade * upgradeGuard;

      if (!best || gain > best.gain) {
        best = {
          itemId: cand.id,
          gain: gain,
          dOffPct: dOff,
          dEhpPct: dEhp,
          need: need,
          worth: gain > need,
          /* 揭露用：讓 run_summary 看得出來換裝是被什麼擋下的 */
          candRarity: cand.rarity, candLevel: cand.level,
          curRarity: cur ? cur.rarity : -1, curLevel: cur ? cur.level : 0
        };
      }
    }
    if (best) {
      out[slotKey] = best;
      if (best.worth) used[best.itemId] = true;   // 同一件不要被兩個部位同時選走
    }
  }
  return out;
}

/* ---- 裝等分段展望：為什麼「往前推一關」有時值 28 倍 ----

   equipmentTierLevel（js/formula.js:1251，EQUIP_TIER_SIZE = 50）把掉落裝備的等級
   切成 1 / 50 / 100 / 150…。停在關卡 49 與踏進關卡 50，掉落的裝等差 50 級，
   而詞條數值隨裝等線性成長——實測 atkFlat R4 從 12.0 跳到 335.4。

   舊策略完全不知道有這件事。它的 stageGate 把前期停在 park [41,45]，
   而那個區間**每一件掉落都是裝等 1**。於是：
     裝備永遠是裝等 1 → 戰力上不去 → 過不了 50 關的守關 BOSS → 繼續停在 41~45。
   實測 10 個 seed 有 5 個就這樣卡了整整 20 小時。

   把這個斷點暴露出來，策略才有辦法把「衝過斷點」與「在原地把詞條洗好」
   放在同一把尺上比較——那正是 player_strategy.md v2.0 要的邊際效益導向。 */
function evalTierOutlook() {
  if (typeof equipmentTierLevel !== 'function') return null;
  var stage = (typeof G !== 'undefined' && G && G.stage) ? (G.stage.current || 0) : 0;
  var best = (typeof G !== 'undefined' && G && G.stage) ? (G.stage.best || 0) : 0;
  var size = (typeof EQUIP_TIER_SIZE === 'number') ? EQUIP_TIER_SIZE : 50;

  var here = equipmentTierLevel(stage);
  var nextStage = (Math.floor(stage / size) + 1) * size;
  var next = equipmentTierLevel(nextStage);

  /* 跨過去值多少：拿同一條代表性詞條在兩個裝等下的基準值相比。
     用 atkFlat 當代表是因為它是分佈最廣的攻擊詞條（11 個部位都能出）。 */
  var ratio = null;
  if (typeof affixBaseValue === 'function') {
    var a = affixBaseValue('atkFlat', here, 4);
    var b = affixBaseValue('atkFlat', next, 4);
    if (a > 0 && b > 0) ratio = b / a;
  }

  return {
    stage: stage,
    best: best,
    itemLevelHere: here,
    nextBreakpointStage: nextStage,
    itemLevelNext: next,
    stagesToBreakpoint: Math.max(0, nextStage - stage),
    /* 跨過斷點後同一條詞條會變成幾倍。舊策略看不到這個數字，
       所以它把「停在 41 關洗詞條」與「推到 50 關」當成同一件事。 */
    breakpointGain: ratio,
    /* 身上裝備的裝等是否已經落後於當前關卡能掉的。落後代表換裝規則正在失職。 */
    equippedItemLevelMin: (function () {
      var eq = (typeof G !== 'undefined' && G) ? (G.equipment || {}) : {};
      var min = null;
      for (var k in eq) {
        if (!eq[k]) continue;
        var lv = eq[k].level || 0;
        if (min === null || lv < min) min = lv;
      }
      return min;
    })()
  };
}

/* ---- 資源水位：止損與過渡機制的輸入 ----

   player_strategy.md v2.0：「若資源/金幣低於一定比例，AI 自動降級詞條要求」。
   「比例」要有分母，而洗煉／強化的成本是隨等級成長的，固定門檻遲早失準。
   所以分母取**遊戲當下報的成本**，比值才有意義。

   實測動機：一場 20 小時的模擬送了 52,465 次強化，其中 51,353 次（98%）
   遊戲回「資源不足」。策略完全不看有沒有錢就一路送，資源永遠在見底邊緣，
   於是每一項投資都做不完整。 */
function evalResources() {
  var p = (typeof G !== 'undefined' && G) ? (G.player || {}) : {};
  var eq = (typeof G !== 'undefined' && G) ? (G.equipment || {}) : {};

  /* ---- 逐部位算得起算不起，不要用「最貴那件」當全體的分母 ----

     ⚠️ 這一版是改出來的，前一版實測失敗，過程值得留著。

     前一版取**身上最貴那件**的強化成本當分母，理由是「那是資源真正的去處」。
     結果：seed …076 跑到第 20 小時握著 **157,034 碎片沒有用掉**，
     而同時間對照組已經推到關卡 89、它還停在關卡 51。

     因為金幣被寶石商店刷新吃掉之後，最貴那件就變成「付不起」，
     而整條強化規則是用那一個數字當總開關的——於是連一件便宜的都不強化。
     一個部位付不起，全身十三個部位一起停工。

     改成逐部位判定：付得起的就投，付不起的略過。這同時把「資源不足」這種
     必定落空的呼叫壓到零——實測舊規則 20 小時送 309,089 次強化，
     98% 得到「資源不足」。 */
  var gold = p.gold || 0, scrap = p.scrap || 0;
  var affordableSlots = {}, affordableCount = 0, cheapest = null;
  for (var k in eq) {
    if (!eq[k] || typeof upgradeCost !== 'function') continue;
    var c = upgradeCost(eq[k]);
    if (!c) continue;
    var ok = (gold >= c.gold) && (scrap >= c.scrap);
    affordableSlots[k] = ok;
    if (ok) affordableCount++;
    if (!cheapest || c.gold < cheapest.gold) cheapest = c;
  }

  return {
    gold: gold,
    scrap: scrap,
    essence: p.essence || 0,
    ancientEssence: p.ancientEssence || 0,
    /* 逐部位：這一拍付得起哪幾個部位的下一次強化。 */
    affordableSlots: affordableSlots,
    affordableSlotCount: affordableCount,
    nextUpgradeGold: cheapest ? cheapest.gold : null,
    nextUpgradeScrap: cheapest ? cheapest.scrap : null,
    /* 「還能做幾次」——以**最便宜**的那件為基準，回答的是「還做不做得動」，
       不是「有沒有錢一次做完最貴的」。止損要的是前者：
       做不動才該降級要求，而不是「最貴那件買不起就全面停工」。 */
    upgradesAffordable: (cheapest && cheapest.gold > 0)
      ? Math.min(
        Math.floor(gold / cheapest.gold),
        cheapest.scrap > 0 ? Math.floor(scrap / cheapest.scrap) : Infinity
      )
      : null
  };
}

/* ============ 面板組裝 ============

   由 scripts/sim/engine.js 的 panel('eval') 呼叫，結果經 run_sim.js 放進
   state.panels.eval，與其他面板走完全相同的路徑進策略沙箱（深拷貝、純資料）。

   params 由策略在 policy.evalConfig 宣告，這裡不預設任何遊戲相關的清單——
   要評估哪些詞條是策略的事，怎麼評估是這裡的事。 */
/* ---- 便宜的那一半：只做戰鬥側寫 ----

   敗因診斷必須在**死掉的那一瞬間附近**取樣，否則取到的是十秒前的殘影。
   docs/SIM_HARNESS.md 量過同一件事：60 秒取樣會漏掉近一半的交戰失敗。
   所以它得掛在 1Hz 的觀測節奏上。

   但完整的 evalPanel 一次要跑約 47 次 computeStats（換裝精算 39 次 + 詞條探針 8 次），
   掛在 1Hz 上等於每個遊戲秒都做一次全身重算——縮時一千倍之後那是每秒四萬七千次。
   所以拆成兩支：這一支只用 evalPower（純算術，不碰 computeStats），
   貴的那一半留在決策點。

   ⚠️ 拆開之後兩邊都必須是唯讀的，否則觀測頻率會變成遊戲行為的一部分。 */
function buildEvalCombatPanel() {
  if (typeof G === 'undefined' || !G) return null;
  var st = getStats();
  var foe = evalFoe();
  if (!foe) return { known: false, combat: { known: false } };
  return {
    known: true,
    foe: { kind: foe.kind, dodge: foe.dodge, level: foe.level, hpPct: foe.maxHp > 0 ? 100 * foe.hp / foe.maxHp : 100 },
    combat: evalCombatProfile(st, foe, evalCalibration(st, foe))
  };
}

function buildEvalPanel(params) {
  params = params || {};
  if (typeof G === 'undefined' || !G) return null;

  var st = getStats();
  var foe = evalFoe();

  /* 沒有對手就沒有評估對象。回一個標明 unknown 的空殼而不是 null——
     策略的規則會去讀 panels.eval.*，回 null 會讓所有路徑解析失敗並灌爆 BAD_PATHS。 */
  if (!foe) {
    return {
      known: false,
      tier: evalTierOutlook(),
      resources: evalResources(),
      combat: { known: false },
      affixRoi: {},
      slotUpgrades: {},
      model: MODEL_NOTES
    };
  }

  var base = evalPower(st, foe);
  var cal = evalCalibration(st, foe);

  /* ---- 規劃是低頻的，診斷是高頻的 ----

     戰鬥側寫、裝等展望、資源水位都是純算術，每次重算的成本可忽略。
     但換裝精算與詞條 ROI 要跑幾十次 computeStats（實測整包約 20 ms），
     而極限玩家的決策間隔只有 5 秒——20 小時就是 14,400 次，
     等於替一場 11 分鐘的模擬多加 5 分鐘。

     所以規劃結果快取 refreshSec 個遊戲秒。這不只是省時間，它也比較像真人：
     真人不會每 5 秒把整個背包重新評估一次，他是「隔一陣子整理一次裝備」。

     ⚠️ 快取鍵用 GT（遊戲時鐘）而不是真實時間——真實時間會讓同 seed 的兩次跑
     在不同機器上得到不同的快取命中，決定論就沒了。 */
  var refreshSec = (typeof params.refreshSec === 'number') ? params.refreshSec : 15;
  var nowGt = (typeof GT === 'number') ? GT : 0;
  if (!evalPlanCache || refreshSec <= 0 || (nowGt - evalPlanCache.at) >= refreshSec || nowGt < evalPlanCache.at) {
    var affixRoi = evalAffixRoi(params.affixKeys || [], foe, base);

    /* 只對 ROI 前幾名建議的宿主部位探「身上這條詞條值多少」——
       洗煉規則只會用到那幾個，全身探是白花錢。 */
    var probeSlots = [];
    if (params.probeEquippedAffixes) {
      var ranked = [];
      for (var rk in affixRoi) if (affixRoi[rk]) ranked.push(affixRoi[rk]);
      ranked.sort(function (a, b) {
        return (b.dOffPct + b.dEhpPct) - (a.dOffPct + a.dEhpPct);
      });
      var topSlots = (typeof params.probeTopSlots === 'number') ? params.probeTopSlots : 3;
      for (var ri2 = 0; ri2 < ranked.length && probeSlots.length < topSlots; ri2++) {
        if (probeSlots.indexOf(ranked[ri2].slotKey) < 0) probeSlots.push(ranked[ri2].slotKey);
      }
    }

    evalPlanCache = {
      at: nowGt,
      affixRoi: affixRoi,
      equippedAffixes: evalEquippedAffixValue(foe, base, probeSlots),
      slotUpgrades: evalSlotUpgrades(foe, base, params.slotUpgrades)
    };
  }

  return {
    known: true,
    /* 當前戰力純量。策略不必看懂它，但把它放進快照後，
       「這次改動有沒有讓角色變強」在事後就查得出來。 */
    power: { offense: base.offense, ehp: base.ehp },
    foe: foe,
    combat: evalCombatProfile(st, foe, cal),
    tier: evalTierOutlook(),
    resources: evalResources(),
    /* 規劃結果的取樣時刻。非零的落差是正常的（見上方快取說明），
       但它應該永遠 ≤ refreshSec——大於就代表面板沒有被按預期頻率建立。 */
    planAgeSec: nowGt - evalPlanCache.at,
    affixRoi: evalPlanCache.affixRoi,
    equippedAffixes: evalPlanCache.equippedAffixes,
    slotUpgrades: evalPlanCache.slotUpgrades,
    model: MODEL_NOTES
  };
}
