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
  var pDmg = (st.atk || 0) * (1 - defReduction(pDef, lv));
  pDmg *= 1 - physicalResistanceReduction(0, lv);   // 野怪沒有物理抗性欄位，留著讓公式對齊
  dmg += pDmg;

  var mIgnore = penIgnoreRatio(st.mPen || 0);
  var mDef = (foe.mdef || 0) * penDefMultiplier(mIgnore);
  var mDmg = (st.matk || 0) * (1 - defReduction(mDef, lv));
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
     要靠這一段才量得出來——沒有它，抗性詞條的 ROI 恆為 0。

     ⚠️ 這三項全部要呼叫**遊戲的函式**，不能自己寫 `1 - 值/100`。

     實測踩到的：globalDmgRed 是 `pct: false` 的**定值**（詞條 base 3、每級 +0.35，
     身上五條就是兩千多），而遊戲用的是遞減曲線 globalDamageMultiplier——
     100 點＝減傷 50%、1000 點＝90.9%、2260 點＝95.8%。
     舊寫法 `1 - 值/100` 在 100 點以上就變成負數，被下面的 Math.max(0, raw) 夾成 0，
     於是 ehp 變成 Infinity、增幅算出來是 **−59%**。
     結果 AI 主動避開遊戲裡最強的防禦詞條（weight 9、8 個部位都能出）：
     真人身上 5 條，AI 平均 0.8 條。

     這正是本專案反覆強調的那條線：harness 不重推遊戲公式。
     這三支都是遊戲的公開函式，直接呼叫就不會有第二份會漂的實作。 */
  raw *= (typeof globalDamageMultiplier === 'function')
    ? globalDamageMultiplier(st.globalDmgRed || 0)
    : 1;
  var redByKind = { normal: st.normalDmgRed, elite: st.eliteDmgRed, boss: st.bossDmgRed };
  var kindRed = redByKind[foe.kind] || 0;
  if (kindRed > 0 && typeof enemyTypeDamageReduction === 'function') {
    raw *= 1 - enemyTypeDamageReduction(kindRed, lv);
  }

  /* 格擋是機率性的，取期望值。減傷率一樣走遊戲的 blockDmgReduction 曲線。 */
  var blockP = Math.min(100, Math.max(0, st.blockRate || 0)) / 100;
  if (blockP > 0 && typeof blockDmgReduction === 'function') {
    raw *= 1 - blockP * (blockDmgReduction(st.blockDmgRed || 0) / 100);
  }

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

/* 造一條「期望強度」的詞條。roll 取區間中點，見 MODEL_NOTES.probeRollRatio。

   ancient=true 時 roll 完全不參與計算——太古走的是另一條乘算路徑
   （js/formula.js affixValueFromStrength）：

     一般   baseV × strengthMult(roll)，strengthMult = 0.8 + roll/MAX × 0.4
     太古   baseV × AFFIX_MAX_VALUE_MULT × ANCIENT_AFFIX_VALUE_MULT

   代入常數：探針（roll 取中點）＝ baseV × 1.0，一般滿值 ＝ ×1.2，太古 ＝ ×1.62。
   所以拿一般探針去估「洗太古位置」的收益會**系統性低估 1.62 倍**。
   這裡不自己算那個倍率——照樣造一條 ancient 的詞條丟給 computeStats，
   倍率是遊戲算的。 */
function evalProbeAffix(key, ancient) {
  return {
    key: key,
    roll: Math.round(STRENGTH_ROLL_MAX * MODEL_NOTES.probeRollRatio),
    ancient: !!ancient
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
function evalItemPlusAffix(item, key, ancient) {
  if (!item) return null;
  var clone = {};
  for (var k in item) clone[k] = item[k];
  clone.affixes = (item.affixes || []).slice();
  clone.affixes.push(evalProbeAffix(key, ancient));
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
function evalAffixRoi(keys, foe, base, ancientTop) {
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
       (基礎值 + 成長基礎值×每級成長×(裝等−1)) × 品質倍率 × 強化倍率，js/item.js affixValue），
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

  /* ---- 洗在**太古位置**上值多少（只算前幾名）----

     遊戲規則（js/item.js rerollSingleAffix）：「太古與否只看位置」——
     太古位置洗煉只換詞條種類、永遠維持太古；而太古的數值走另一條乘算路徑
     （baseV × AFFIX_MAX_VALUE_MULT × ANCIENT_AFFIX_VALUE_MULT），與 roll 無關。
     實測倍率 1.620。只給一個 dOffPct 的話，策略永遠不會知道「洗太古位置比較划算」，
     於是 8 個存檔的 47 個太古位置有 49% 放著遊戲權重 <= 1 的詞條、一直閒置。

     ⚠️ 但這是**每條詞條多一次 computeStats**。17 條全算的話 evalAffixRoi
     從 22ms 變 44ms、整份面板 76ms → 98ms（+29%），而這套機制能不能開著跑
     一直是效能決定的（見 SIM_HARNESS.md 的效能一節）。

     實際上策略只會用到**排名第一**那條的太古估值（rerollByRoi 的 pick）。
     所以這裡只替前 ancientTop 名補算——名次用未加權的增幅估，
     與上面挑宿主部位是同一種取捨：估錯的代價只是那一條退回一般分數，
     而 policy_interpreter 的 rankRoi 對缺欄位的情形本來就退回 score（保守，不會高估）。 */
  var top = (typeof ancientTop === 'number' && ancientTop >= 0) ? ancientTop : 4;
  if (top > 0) {
    var order = [];
    for (var k2 in out) {
      if (!out[k2]) continue;
      order.push({ key: k2, rough: (out[k2].dOffPct || 0) + (out[k2].dEhpPct || 0) });
    }
    /* 決定論：粗分相同時以鍵名決勝。 */
    order.sort(function (a, b) {
      if (b.rough !== a.rough) return b.rough - a.rough;
      return a.key < b.key ? -1 : (a.key > b.key ? 1 : 0);
    });
    for (var oi = 0; oi < order.length && oi < top; oi++) {
      var ek = order[oi].key;
      var slot2 = out[ek].slotKey;
      var probeA = evalItemPlusAffix(eq[slot2], ek, true);
      var stA = computeStats(evalEquipmentWith(slot2, probeA));
      var pA = evalPower(stA, foe);
      out[ek].dOffPctAncient = base.offense > 0 ? (pA.offense / base.offense - 1) * 100 : 0;
      out[ek].dEhpPctAncient = (base.ehp > 0 && isFinite(base.ehp)) ? (pA.ehp / base.ehp - 1) * 100 : 0;
    }
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

   因為詞條數值 =（基礎值 + 成長基礎值 × 每級成長 × (裝等−1)）× 品質倍率，
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
/* ---- 粗篩：整份背包只評分一次 ----

   精算一次要一次 computeStats，300 件背包 × 13 個部位全精算是 3,900 次。
   用遊戲的 itemScore 粗篩之後只剩 topN × 13 次。

   ⚠️ itemScore 一定要**先算好放進表裡**，不能寫在 sort 的比較函式裡。
   比較函式每次比較都會呼叫兩次，13 個部位各排一次序＝上千次重複計算，
   而 itemScore 內部要遍歷詞條、寶石、附魔。這一行的差別實測是整個面板
   74 ms → 個位數 ms。

   itemScore 已經含裝等與強化倍率（js/formula.js:1546），是個夠好的粗篩器——
   它只是不夠格當**最終**裁判：它看不到對手的閃避、抗性與敵種，
   而那正是「這件裝備對**現在這隻怪**強不強」的關鍵。

   拆成獨立函式是因為換裝精算與死庫存判定用的是**同一份**掃描結果——
   掃兩次的話不只是慢一倍，兩邊的分數還可能因為中間有人動過背包而不一致。 */
/* ---- 掃描結果的跨規劃快取 ----

   背包裡的裝備在**待在背包的期間是不動的**：強化、洗煉、鑲嵌、附魔的對象都是
   身上那套，掉落是新物件，穿上去就離開背包。所以同一件東西的複本、可用部位與
   評分每 15 秒重算一次是純浪費——而這一項的成本與背包件數成正比，
   正是「愈到後面愈慢」的來源（策略會把背包上限一路買到 1000 格）。

   實測（深局 0.25 遊戲小時）：背包 850 件時 5.6s → 4.2s，270 件時 3.1s → 2.7s，
   兩邊的存檔雜湊都完全相同。

   ⚠️ 失效判斷用**物件識別**，不是「記得在改東西的時候去清快取」——
   後者漏一個寫入點就會靜靜沿用舊分數。這裡把 itemScore 讀到的每一個可變輸入
   都記下來比對：強化等級／稀有度／裝等是純量，詞條、寶石、附魔、傳奇特效、
   神鑄特效則比對**陣列與每一個元素的識別**。遊戲改這些東西的方式一律是
   換掉物件或換掉整個陣列（rerollSingleAffix 指派新物件、rerollItemAffixes 重建陣列、
   鑲嵌是 sockets[i] = gem、附魔是 push），所以識別比對抓得到全部。
   比對成本是十來次指標比較，itemScore 則要走完詞條、寶石、附魔三圈。 */
var _evalBagCache = new WeakMap();

function evalRefsChanged(prev, now) {
  if (prev === now) return false;                 // 同一個陣列（或都是 undefined）
  if (!prev || !now || prev.length !== now.length) return true;
  for (var i = 0; i < prev.length; i++) if (prev[i] !== now[i]) return true;
  return false;
}

function evalBagEntryFresh(hit, raw) {
  var fp = hit.fp;
  if (fp.upgrade !== (raw.upgrade || 0) || fp.rarity !== raw.rarity || fp.level !== raw.level) return false;
  if (fp.passive !== raw.passive || fp.enchant !== raw.enchant) return false;
  if (evalRefsChanged(fp.affixes, raw.affixes)) return false;
  if (evalRefsChanged(fp.sockets, raw.sockets)) return false;
  if (evalRefsChanged(fp.enchants, raw.enchants)) return false;
  if (evalRefsChanged(fp.godPassives, raw.godPassives)) return false;
  return true;
}

function evalBagFingerprint(raw) {
  return {
    upgrade: raw.upgrade || 0, rarity: raw.rarity, level: raw.level,
    passive: raw.passive, enchant: raw.enchant,
    /* 存快照而不是存原陣列：原陣列若被就地 push（附魔）或改元素（鑲嵌），
       存原參照會連快照一起變，比對就永遠相等。 */
    affixes: raw.affixes ? raw.affixes.slice() : raw.affixes,
    sockets: raw.sockets ? raw.sockets.slice() : raw.sockets,
    enchants: raw.enchants ? raw.enchants.slice() : raw.enchants,
    godPassives: raw.godPassives ? raw.godPassives.slice() : raw.godPassives
  };
}

function evalBagSweep() {
  var inv = (typeof G !== 'undefined' && G && Array.isArray(G.inventory)) ? G.inventory : [];
  var safe = [], score = {};
  for (var i0 = 0; i0 < inv.length; i0++) {
    var raw = inv[i0];
    /* locked 與非裝備一律不進來。死庫存清單也是從這裡長出來的，而
       js/worker/sim.worker.js 的 item.salvage **不檢查 locked**——
       鎖定保護在這一行，漏掉就會把玩家鎖起來的東西拆掉。 */
    if (!raw || raw.locked || raw.kind !== 'equip') continue;

    var hit = _evalBagCache.get(raw);
    if (hit && evalBagEntryFresh(hit, raw)) {
      score[hit.item.id] = hit.score;
      safe.push(hit.item);
      continue;
    }
    /* 從這裡開始都是複本。理由見 evalSafeItem——itemScore 會就地正規化
       舊格式的附魔欄位，直接餵真實物品會改到存檔。 */
    var cp0 = evalSafeItem(raw);
    cp0.__slots = equipSlotsForItem(cp0) || [];
    var sc = itemScore(cp0);
    score[cp0.id] = sc;
    safe.push(cp0);
    _evalBagCache.set(raw, { fp: evalBagFingerprint(raw), item: cp0, score: sc });
  }
  return { safe: safe, score: score };
}

/* 決定論的候選排序：分數高的在前，分數相同時以 id 決勝，不讓背包順序影響結果。 */
function evalRankCandidates(cands, score) {
  return cands.sort(function (a, b) {
    var d = score[b.id] - score[a.id];
    return d !== 0 ? d : (a.id < b.id ? -1 : (a.id > b.id ? 1 : 0));
  });
}

function evalSlotUpgrades(foe, base, cfg, sweep) {
  cfg = cfg || {};
  var out = {};
  if (!foe || !base) return out;

  var topN = (typeof cfg.candidatesPerSlot === 'number') ? cfg.candidatesPerSlot : 2;
  var socketPenalty = (typeof cfg.socketPenaltyPct === 'number') ? cfg.socketPenaltyPct : 8;
  var upgradeGuard = (typeof cfg.upgradeGuardPctPerLevel === 'number') ? cfg.upgradeGuardPctPerLevel : 0.5;

  var eq = (typeof G !== 'undefined' && G) ? (G.equipment || {}) : {};

  sweep = sweep || evalBagSweep();
  var safe = sweep.safe, score = sweep.score;

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
    /* 階級判準要看**全部**候選，不能只看 itemScore 前幾名：它是純比較（品質／裝等／
       太古數），不需要 computeStats 就能篩，只有選中的那一件要算一次。
       實測 itemScore 的排序對這個決策很不準——真正的贏家排到第 9、第 15 名都有。 */
    var allCands = cands;
    cands = evalRankCandidates(cands, score).slice(0, topN);

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
      /* 一律複製一份再改，原始物件屬於 G.inventory，評估器只讀不寫。 */
      var probe = {};
      for (var pk in cand) probe[pk] = cand[pk];
      if (carried.length && cand.sockets && cand.sockets.length) {
        probe.sockets = cand.sockets.slice();
        for (var si = 0, ci = 0; si < probe.sockets.length && ci < carried.length; si++) {
          if (!probe.sockets[si]) probe.sockets[si] = carried[ci++];
        }
      }

      /* ---- 強化等級也要比在同一條起跑線上 ----

         ⚠️ 這裡原本把同一件事算了兩次，方向還都對候選不利：
           1. 候選以自己的強化等級（掉落品一律 +0）去比身上那件的 +17，
              而 upgradeMult = 1 + 0.05×強化，+17 等於 ×1.85 的先天劣勢；
           2. 然後 need 又以「要重建強化」為由再加 curUpgrade × upgradeGuard。

         後果是投資鎖死：一個部位只要開始堆強化，就沒有任何裸掉落追得上，
         那個部位從此凍結在開始投資時的那一件。跑越久凍得越死。
         實測 20 小時 Lv.213 的存檔，把候選補到同等強化再問遊戲，
         13 個部位有 9 個其實有更好的選擇，其中 5 個是純賺（物攻 +6.7%~+20.3%、
         生命不動）——包含一枚**裝等 1** 的傳說戒指，靠 +35 強化和 4 顆寶石
         把那個部位鎖了整場。

         正確的模型是分開兩件事：
           gain 比「候選將會達到的強化等級」——強化是可以重建的，不是候選的缺陷；
           need 收「重建要花的材料」——那才是真正的成本，而且只該收差額。

         取 max(候選自己的, 身上那件的)：背包裡已經帶著 +11 的那件不該被當成 +0
         （它是真的有），身上是 +0 時也不該憑空送候選一堆強化。這個對稱性同時
         擋掉來回換的震盪：兩邊都用同一個等級評估，換過去之後再比一次結論不變。 */
      if (cfg.rebuildUpgrade) {
        probe.upgrade = Math.max(cand.upgrade || 0, curUpgrade);
      }

      var st2 = computeStats(evalEquipmentWith(slotKey, probe));
      var p2 = evalPower(st2, foe);

      var dOff = base.offense > 0 ? (p2.offense / base.offense - 1) * 100 : 0;
      var dEhp = (base.ehp > 0 && isFinite(base.ehp)) ? (p2.ehp / base.ehp - 1) * 100 : 0;
      /* 攻防各半的合成分。不用加權是因為攻防的取捨屬於策略決定（policy JSON 的
         offenseWeight），這裡只提供兩個分量與一個中性的預設合成分。 */
      var gain = dOff + dEhp;

      /* 門檻：插槽變少、以及要重建的強化等級，各折算成必須跨過的增幅。

         ⚠️ 重建成本只該收**差額**。開了 rebuildUpgrade 之後 gain 已經把候選算在
         同一個強化等級上，這裡再收 curUpgrade 全額就又變回雙重計費了。
         候選自己帶著的強化不用花錢重建，所以扣掉。 */
      var candSockets = cand.sockets ? cand.sockets.length : 0;
      var need = 0;
      if (candSockets < curSockets) need += (curSockets - candSockets) * socketPenalty;
      need += (cfg.rebuildUpgrade
        ? Math.max(0, curUpgrade - (cand.upgrade || 0))
        : curUpgrade) * upgradeGuard;

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
    /* ============ 高一階就直接換：只看洗不掉的東西 ============

       ---- 為什麼上面那套 gain/need 不夠 ----

       gain 是拿**候選當下的隨機骰值**去比**身上那件的骰值**。但一件裝備身上，
       真正永久固定的只有三樣：品質（決定詞條數與插槽數）、裝等、太古位置數。
       詞條鍵與數值可以洗、強化可以重堆、寶石可以拔下來重鑲、附魔可以重附。
       拿可變的部分去做不可逆的決定，等於讓一次幸運骰把整個部位鎖死。

       實測：關卡 128 的角色站在「掉裝等 100」的關卡，身上最弱的部位還是裝等 50
       （panels.eval.tier 的 equippedItemLevelMin=50 對 itemLevelHere=100）。
       同一份存檔生 300 件當關史詩護手、連寶石與強化都補過去，只有 6% 的 gain 為正——
       因為身上那件剛好骰到 atkFlat，而那正是可以洗回來的東西。

       ---- 判準 ----

       候選在「品質」或「裝等」上高一階、而且另一項不更差 → 直接換。
       唯一的例外是身上那件累積的**太古位置**：太古洗煉必為滿值且永遠維持太古
       （js/item.js rerollSingleAffix），是唯一無法重建的投資。
       身上比候選多 ancientKeep 條以上太古時才留下。

       ⚠️ 裝等與品質**同等看待**，不是只看品質。實測同一條 atkFlat：
       裝等 1→50 是 ×27.95，而 R2→R5（同裝等）只有 ×2.29——裝等的權重更大，
       只認品質會漏掉更重要的那一半。 */
    var tierCfg = cfg.tierRule;
    if (tierCfg && cur) {
      var keepN = (typeof tierCfg.ancientKeep === 'number') ? tierCfg.ancientKeep : 3;
      var curAnc = (typeof getItemAncientCount === 'function') ? getItemAncientCount(cur) : 0;
      var forced = null, forcedRank = null;
      for (var ti = 0; ti < allCands.length; ti++) {
        var tc = allCands[ti];
        var upR = (tc.rarity || 0) - (cur.rarity || 0);
        var upL = (tc.level || 0) - (cur.level || 0);
        /* 高一階＝其中一項更好、另一項不更差。一升一降交回上面的 gain/need 判斷。 */
        if (!((upR > 0 && upL >= 0) || (upL > 0 && upR >= 0))) continue;
        var tcAnc = (typeof getItemAncientCount === 'function') ? getItemAncientCount(tc) : 0;
        if (curAnc - tcAnc >= keepN) continue;      // 身上的太古投資夠深，留著
        /* 同樣高一階時取裝等 → 品質 → 太古數最好的那一件。 */
        var rank = [tc.level || 0, tc.rarity || 0, tcAnc];
        if (!forced || rank[0] > forcedRank[0]
          || (rank[0] === forcedRank[0] && rank[1] > forcedRank[1])
          || (rank[0] === forcedRank[0] && rank[1] === forcedRank[1] && rank[2] > forcedRank[2])) {
          forced = tc; forcedRank = rank;
        }
      }
      if (forced) {
        /* 覆蓋掉 gain/need 的結論，但保留原本的數字供報表判讀——
           哪些換裝是靠這條放行的，看 forcedByTier 就知道。 */
        if (!best || best.itemId !== forced.id) {
          var fSt = computeStats(evalEquipmentWith(slotKey, forced));
          var fP = evalPower(fSt, foe);
          best = {
            itemId: forced.id,
            gain: (base.offense > 0 ? (fP.offense / base.offense - 1) * 100 : 0)
              + ((base.ehp > 0 && isFinite(base.ehp)) ? (fP.ehp / base.ehp - 1) * 100 : 0),
            dOffPct: base.offense > 0 ? (fP.offense / base.offense - 1) * 100 : 0,
            dEhpPct: (base.ehp > 0 && isFinite(base.ehp)) ? (fP.ehp / base.ehp - 1) * 100 : 0,
            need: 0,
            candRarity: forced.rarity, candLevel: forced.level,
            curRarity: cur.rarity, curLevel: cur.level
          };
        }
        best.worth = true;
        best.forcedByTier = true;
        best.curAncient = curAnc;
        best.candAncient = (typeof getItemAncientCount === 'function') ? getItemAncientCount(forced) : 0;
      }
    }

    if (best) {
      out[slotKey] = best;
      if (best.worth) used[best.itemId] = true;   // 同一件不要被兩個部位同時選走
    }
  }
  return out;
}

/* ---- 死庫存：在每一個穿得上的部位都排不進前 K 名的裝備 ----

   ---- 為什麼要有這個 ----

   背包**唯一**會被清空的時機是策略的壓力閥（salvage-when-bag-full），
   而它的判斷式是「件數 / 上限 ≥ 0.9」——用的是**比例**。於是背包件數的均衡點
   由上限決定：上限 325 就填到約 290 才清，而策略會一路把上限買到 1000。
   實測 20 小時的背包是鋸齒狀的 41→184→58→…→267，平均約 150 件。

   那條規則的目的其實不是管理背包，它自己的註解寫得很清楚：防止掉落管線回堵。
   「背包平常該維持多小」這件事**從來沒有被設計過**——這是缺口，不是決定。
   而真人玩家不是這樣玩的：垃圾一進來就拆，只留幾件真的會考慮的。

   ---- 判準為什麼是「排不進前 K 名」而不是「品質／太古數比身上差」 ----

   直覺的判準是「同部位同品質、太古數沒比較多就拆」。實測那會在**裝等分段邊界**
   出事：R5 裝等 100 帶 1 條太古的一件合計 4,985，而 R5 裝等 150 完全沒有太古的
   是 6,635（強 33%）——跨過關卡 150 之後掉落的裝等從 100 跳到 150，
   那條規則會在掉落的瞬間把強 33% 的東西拆掉。這正是 docs/SIM_HARNESS.md
   記過兩次的形狀：把「通常成立的偏好」寫成了「永遠成立的否決」。

   改成問遊戲：itemScore 是遊戲自己的那把尺（背包滿載捨弱留強用的就是它），
   裝等與強化倍率本來就含在裡面，所以跨分段會自動排對。

   而且這個判準與換裝決策是**對齊**的：evalSlotUpgrades 只精算每個部位前
   candidatesPerSlot（預設 2）名，排在 K 名之外的候選本來就永遠不會被精算到。
   K 取得比 2 大（預設 5）是留給「前面幾件被穿走之後名次往上遞補」的餘裕。

   ⚠️ 兩件不能省的事：
     - locked 與非裝備不會出現在這裡（evalBagSweep 就擋掉了），而遊戲的
       item.salvage **不檢查 locked**——那道保護只有這一層。
     - 清單長度有上限（maxPerRefresh），截斷數量如實回報在 total／truncated。
       不做無聲截斷：看報表的人必須看得出來「還有幾百件沒列出來」。 */
function evalDeadStock(sweep, cfg) {
  if (!cfg) return null;                 // 沒宣告＝機制關閉，行為與改造前完全相同
  var keepPerSlot = (typeof cfg.keepPerSlot === 'number') ? Math.max(0, cfg.keepPerSlot) : 5;
  var maxPerRefresh = (typeof cfg.maxPerRefresh === 'number') ? Math.max(0, cfg.maxPerRefresh) : 50;

  var safe = sweep.safe, score = sweep.score;
  var keep = {};

  for (var s = 0; s < SLOT_LIST.length; s++) {
    var slotKey = SLOT_LIST[s];
    var cands = [];
    for (var i = 0; i < safe.length; i++) {
      if (safe[i].__slots.indexOf(slotKey) >= 0) cands.push(safe[i]);
    }
    if (!cands.length) continue;
    var ranked = evalRankCandidates(cands, score);
    for (var r = 0; r < ranked.length && r < keepPerSlot; r++) keep[ranked[r].id] = true;
  }

  var dead = [];
  for (var j = 0; j < safe.length; j++) {
    if (keep[safe[j].id]) continue;
    dead.push({ id: safe[j].id, score: score[safe[j].id], rarity: safe[j].rarity, level: safe[j].level });
  }
  /* 先拆分數最低的：截斷時留下來的才是「最接近會被選中」的那一批。 */
  dead.sort(function (a, b) {
    var d = a.score - b.score;
    return d !== 0 ? d : (a.id < b.id ? -1 : (a.id > b.id ? 1 : 0));
  });

  return {
    items: dead.slice(0, maxPerRefresh),
    total: dead.length,
    truncated: Math.max(0, dead.length - maxPerRefresh),
    bagCount: safe.length,
    keepPerSlot: keepPerSlot
  };
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
/* 「這一關掉什麼」的簽章：裝等分段 ＋ 各品質掉落率 ＋ 材料掉落率。
   三者全部由遊戲回答（equipmentTierLevel / fieldDropRatesFor / fieldMaterialConfigFor），
   評估層不重推任何一條——掉落表還在調，抄進來就是下一次 sync 之後偷偷失準。 */
function evalFarmSig(s, zone) {
  var tierL = equipmentTierLevel(s);
  var rates = fieldDropRatesFor(s, s, zone) || [];
  var mats = (typeof fieldMaterialConfigFor === 'function') ? (fieldMaterialConfigFor(zone, s) || {}) : {};
  return tierL + '|' + rates.join(',')
    + '|' + ((mats.gemRates || []).join(','))
    + '|' + (mats.bookRate || 0)
    + '|' + (mats.ancientEssenceRate || 0)
    + '|' + (mats.dustRate || 0);
}

function evalTierOutlook() {
  if (typeof equipmentTierLevel !== 'function') return null;
  var stage = (typeof G !== 'undefined' && G && G.stage) ? (G.stage.current || 0) : 0;
  var best = (typeof G !== 'undefined' && G && G.stage) ? (G.stage.best || 0) : 0;
  var size = (typeof EQUIP_TIER_SIZE === 'number') ? EQUIP_TIER_SIZE : 50;
  var zone = (typeof G !== 'undefined' && G && G.stage) ? (G.stage.zone || 'desert') : 'desert';

  var here = equipmentTierLevel(stage);
  var nextStage = (Math.floor(stage / size) + 1) * size;
  var next = equipmentTierLevel(nextStage);

  /* ---- 掛機關卡：同一段裡最便宜的那一關 ----

     關卡改造之後，野外掉落不再由 rollRarity（含 stage×0.006 的連續項）決定，
     而是 rollFieldDrops → fieldDropRatesFor → ZONE_STAGE_DROP_TABLE 查表
     （js/combat.js:931）。查表的粒度是**關卡區間**，區間之內完全相同：
     荒漠 100~149 每一關都是 R3 10% / R4 1.5%，裝等也都是 100。

     而怪物強度在區間之內是連續指數成長。用遊戲自己的 monsterStatsFor 量：

       100 → 149：血量 ×25.79、防禦 ×25.56、經驗 ×21.25、金幣 ×2.73
       150 → 199：血量 ×23.01、經驗 ×20.53

     也就是說停在 149 關與停在 100 關，**每一隻怪掉的東西一模一樣**，
     但殺一隻要多花 25.8 倍的時間。

     ⚠️⚠️ 這裡曾經據此推論「裝備／材料時薪差 20 倍以上」。**那個推論是錯的**，
     實測打臉：24 小時 × 5 seed，後 12 小時的擊殺速率是
       對照（推到打不動）925 隻/時 ／ 待在底部 1,042 隻/時 —— 只差 13%
     因為瓶頸不是「打死一隻要多久」，而是每隻怪**固定**的
     RESPAWN_DELAY 0.8 秒 ＋ FIELD_ENEMY_DEATH_CLEAR_DELAY 2.1 秒 ＝ 2.9 秒
     （js/data.js），即 1,241 隻/時的硬上限。對照組在關卡 189 就已經吃掉上限的
     75%——怪物血量少 25 倍完全用不上，因為早就一擊必殺了。

     所以底部真正買到的是「同樣的掉落數、少很多的死亡」，代價是每隻怪 21 倍的經驗。
     掉落率的階梯是真的（這正是本欄位存在的理由），但不要再拿血量倍率去推時薪。

     ⚠️ 這推翻了 policy_interpreter.js stageGate 裡那句
     「分段之內往前推是純賺：關卡愈深品質擲骰愈好」——那是舊 rollRarity 時代的事實。

     floor 的算法：不重推公式，改成拿遊戲的三支函式問「這一關掉什麼」，
     二分搜出同簽章區間的下界。掉落表改版時這裡自動跟著改。
     二分法成立是因為兩個階梯函式的等值集都是連續區間，交集也是。 */
  var farmFloor = stage;
  var farmNext = null;
  var farmHpRatio = null;
  if (stage >= 1 && typeof fieldDropRatesFor === 'function') {
    var sigHere = evalFarmSig(stage, zone);
    var lo = 1, hi = stage, mid;
    while (lo < hi) {
      mid = Math.floor((lo + hi) / 2);
      if (evalFarmSig(mid, zone) === sigHere) hi = mid; else lo = mid + 1;
    }
    farmFloor = lo;

    /* 下一段的底：同簽章區間的頂 +1。這是「值得搬過去的下一個掛機點」——
       真人口中的 101 → 151 → 201。超出地圖上限就沒有下一段了（回 null）。 */
    var zMax = (typeof zoneMaxStage === 'function') ? (zoneMaxStage(zone) || 0) : 0;
    if (zMax > stage) {
      var lo2 = stage, hi2 = zMax;
      while (lo2 < hi2) {
        mid = Math.ceil((lo2 + hi2) / 2);
        if (evalFarmSig(mid, zone) === sigHere) lo2 = mid; else hi2 = mid - 1;
      }
      if (lo2 < zMax) farmNext = lo2 + 1;
    }

    if (typeof monsterStatsFor === 'function' && farmFloor < stage) {
      var hHere = monsterStatsFor(stage, false, false);
      var hFloor = monsterStatsFor(farmFloor, false, false);
      if (hFloor && hFloor.hp > 0) farmHpRatio = hHere.hp / hFloor.hp;
    }
  }

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
    /* 掉落與裝等都不變的前提下，這一段最便宜的關卡（見上方註解）。 */
    farmFloorStage: farmFloor,
    /* 下一個掉落／裝等會變好的關卡，也就是下一個掛機點。地圖打到頂時為 null。 */
    nextFarmStage: farmNext,
    /* 從這裡退到 floor，怪物血量會少幾倍。掉落率與裝等不變，所以這個倍率
       直接就是裝備／材料時薪的倍率。null＝已經站在 floor 上。 */
    farmFloorHpRatio: farmHpRatio,
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

/* ---- 規劃期間的詞條數值記憶化 ----

   為什麼需要：一次規劃要跑約 47 次 computeStats，而每一次都把**全身十三個部位的
   每一條詞條**從頭算一遍——其中十二個部位在這 47 次之間一個位元都沒變
   （evalEquipmentWith 只換掉被探的那一格，其餘直接沿用 G.equipment 的同一個物件）。
   實測 affixValue 與它底下的 affixBaseValue 合計佔 headless 總 CPU 的 16%，
   而其中絕大多數是同一條詞條被重算了 47 次。

   ---- 為什麼放在這裡而不是 js/formula.js ----

   第一版就是改在 formula.js 的，被既有測試擋下來，而且擋得對：
   tests/affix-roll-storage.test.cjs 的「調整參數表的基礎值／成長基礎值後，
   同一強度值算出新數值」會**就地改 AFFIX_POOL.atkFlat.base** 再要求數值跟著變——
   參數調整回溯生效到舊存檔是設計要求，一個永久快取會靜靜違背它。
   （另外重排 affixBaseValue 的內文還會讓 apply_params 的錨點對不上那幾格。）

   放在規劃區塊裡就沒有這個問題：安裝與卸載夾住的這一段是**純讀取**的——
   evalSafeItem 保證流進遊戲函式的都是複本，AFFIX_POOL 更不會在這中間被改。
   離開這一段就還原成遊戲原本的函式，任何參數調整下一次規劃立刻反映。

   ⚠️ 卸載一定要走 finally。留著沒卸載的話，快取就變成整場有效——
   那正是上面那條測試在防的事，而且不會有任何錯誤訊息。 */
var _evalMemoDepth = 0;
var _evalMemoOrig = null;

function evalMemoInstall() {
  if (_evalMemoDepth++ > 0) return;
  _evalMemoOrig = { affixBaseValue: affixBaseValue, affixValue: affixValue };
  var baseCache = new Map();
  var valCache = new WeakMap();
  var origBase = _evalMemoOrig.affixBaseValue;
  var origVal = _evalMemoOrig.affixValue;

  affixBaseValue = function (key, itemLevel, rarityIdx) {
    var ck = key + '|' + itemLevel + '|' + rarityIdx;
    var hit = baseCache.get(ck);
    if (hit !== undefined) return hit;
    var v = origBase(key, itemLevel, rarityIdx);
    baseCache.set(ck, v);
    return v;
  };

  /* 指紋涵蓋原函式讀到的每一個輸入（宿主物件、裝等、稀有度、詞條種類、強度值、
     太古旗標），任何一項對不上就重算。宿主用物件識別比對而不是逐欄比對，
     因為雙手武器倍率是由宿主的 slot / weaponType 決定的，那兩欄不會就地改。 */
  affixValue = function (it, a) {
    if (!a || typeof a !== 'object') return origVal(it, a);
    /* 缺 roll 的舊格式走原路徑：那條路徑讀的是 a.val，不在指紋裡，也會就地改寫 a。 */
    if (a.roll === undefined || a.roll === null) return origVal(it, a);
    var lv = it ? it.level : 1;
    var ra = it ? it.rarity : 0;
    var hit = valCache.get(a);
    if (hit !== undefined && hit.it === it && hit.lv === lv && hit.ra === ra &&
        hit.key === a.key && hit.roll === a.roll && hit.anc === a.ancient) {
      return hit.v;
    }
    var v = origVal(it, a);
    valCache.set(a, { it: it, lv: lv, ra: ra, key: a.key, roll: a.roll, anc: a.ancient, v: v });
    return v;
  };
}

function evalMemoUninstall() {
  if (--_evalMemoDepth > 0) return;
  _evalMemoDepth = 0;
  if (!_evalMemoOrig) return;
  affixBaseValue = _evalMemoOrig.affixBaseValue;
  affixValue = _evalMemoOrig.affixValue;
  _evalMemoOrig = null;
}

function buildEvalPanel(params) {
  params = params || {};
  if (typeof G === 'undefined' || !G) return null;

  var st = getStats();
  var foe = evalFoe();

  /* 沒有對手就沒有評估對象。回一個標明 unknown 的空殼而不是 null——
     策略的規則會去讀 panels.eval.*，回 null 會讓所有路徑解析失敗並灌爆 BAD_PATHS。 */
  if (!foe) {
    /* ⚠️ 這個空殼的欄位必須與下面的正常回傳**一模一樣**，少一個都不行。

       實測後果：`equippedAffixes` 是後來才加的，只加在正常回傳那一份，
       空殼漏掉。於是每個「沒有對手」的決策點（剛死、正在復活、剛過關），
       `panels.eval.equippedAffixes` 就解析失敗一次並記進 BAD_PATHS。
       Codex 的獨立驗證量到 8 場全都有，最嚴重的那一場 167 次。

       行為上其實無害（沒有對手時洗煉規則本來就該按兵不動），但它汙染的是
       **失效路徑**這個診斷管道——那是用來發現「策略指到已改名欄位」的唯一訊號，
       被雜訊灌滿之後就再也看不出真正的問題。 */
    return {
      known: false,
      power: null,
      foe: null,
      combat: { known: false },
      tier: evalTierOutlook(),
      resources: evalResources(),
      planAgeSec: null,
      affixRoi: {},
      equippedAffixes: {},
      slotUpgrades: {},
      /* 機制沒開就是 null（與正常回傳一致）；開了就給一個空的同形物件，
         否則「剛死、正在復活、剛過關」這些沒有對手的決策點會讓
         panels.eval.deadStock.items 解析失敗，把 BAD_PATHS 灌成雜訊——
         上面那段註解記的就是這個坑，不要再犯第二次。 */
      deadStock: params.deadStock
        ? { items: [], total: 0, truncated: 0, bagCount: 0, keepPerSlot: 0 }
        : null,
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
    /* 這一整段是純讀取的（流進遊戲函式的裝備一律先過 evalSafeItem），
       所以詞條數值在這中間不可能變——見 evalMemoInstall 的說明。 */
    evalMemoInstall();
    try {
      /* ancientProbeTop：替前幾名的詞條補算「洗在太古位置上」的增幅。
         0 = 關掉（面板不給太古欄位，策略會退回一般分數，保守但不會高估）。 */
      var affixRoi = evalAffixRoi(params.affixKeys || [], foe, base, params.ancientProbeTop);

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

      /* 換裝精算與死庫存判定共用同一份背包掃描：掃兩次不只是慢一倍，
         兩邊的分數還可能不一致。 */
      var sweep = evalBagSweep();
      evalPlanCache = {
        at: nowGt,
        affixRoi: affixRoi,
        equippedAffixes: evalEquippedAffixValue(foe, base, probeSlots),
        slotUpgrades: evalSlotUpgrades(foe, base, params.slotUpgrades, sweep),
        deadStock: evalDeadStock(sweep, params.deadStock)
      };
    } finally {
      evalMemoUninstall();
    }
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
    /* 死庫存清單。null＝策略沒宣告 deadStock，這個機制整場關閉。
       ⚠️ 這份清單的年齡與規劃相同（planAgeSec）——已經被拆掉的 id 會在
       下一次刷新前留在清單上，重送只會被遊戲回「該裝備不在背包中」，無害。 */
    deadStock: evalPlanCache.deadStock,
    model: MODEL_NOTES
  };
}
