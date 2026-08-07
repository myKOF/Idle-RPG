/* 策略 JSON 引用的每一個遊戲鍵，在遊戲裡都必須真的存在。

   這是本專案反覆踩到、而且最難察覺的一類失真：策略寫了一個遊戲沒有的鍵，
   送出去只會被遊戲回一句錯誤訊息，模擬照樣跑完、報表照樣產出，
   只是那條規則整場沒有生效過。實際發生過三次——
     - 詞條清單寫了 patk／crit／xpGain／dropRate 四個不存在的鍵；
     - 鑲嵌寫死 garnet，1,421 次呼叫全部回「沒有這種寶石」；
     - 技能清單裡的 id 打錯。
   靠人看報表是看不出來的，只能由這支哨兵擋。

   基準取自**遊戲本體**（透過模擬器的 vm context 直接讀 GEM_TYPES / SKILLS / AFFIX_POOL），
   不是另抄一份清單——另抄一份的話遊戲改名時兩邊會一起錯。 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createEngine } = require('../scripts/sim/engine.js');

const SIM_DIR = path.resolve(__dirname, '..', 'scripts', 'sim');
const POLICY_FILES = fs.readdirSync(SIM_DIR).filter((f) => /^policy\..+\.json$/.test(f));

const ctx = createEngine({ seed: 1 }).ctx;
const GEM_TYPES = ctx.GEM_TYPES;
const SKILLS = ctx.SKILLS;
const AFFIX_POOL = ctx.AFFIX_POOL;

function loadPolicy(f) {
  return JSON.parse(fs.readFileSync(path.join(SIM_DIR, f), 'utf8'));
}

/* 把 socketEmpty 底下所有形態的寶石種類收集起來：
   preferTypes（單段）、preferByLevel[].types（分段）、preferByLevel[].mix[][]（分組輪用）。 */
function gemTypesIn(rule) {
  const cfg = rule.socketEmpty;
  if (!cfg) return [];
  const out = [...(cfg.preferTypes || [])];
  for (const band of cfg.preferByLevel || []) {
    out.push(...(band.types || []));
    for (const group of band.mix || []) out.push(...group);
  }
  return out;
}

/* expand 項目引用的清單名稱：list（單一）與 listByLevel[].list（分段）。 */
function listNamesIn(rule) {
  const out = [];
  for (const spec of rule.expand || []) {
    if (spec.list) out.push(spec.list);
    for (const band of spec.listByLevel || []) if (band.list) out.push(band.list);
  }
  return out;
}

test('策略引用的寶石種類都存在於 GEM_TYPES', () => {
  for (const f of POLICY_FILES) {
    for (const rule of loadPolicy(f).rules) {
      for (const t of gemTypesIn(rule)) {
        assert.ok(GEM_TYPES[t],
          `${f} 規則 ${rule.id} 引用了不存在的寶石種類「${t}」——` +
          'socketGem() 只會回「沒有這種寶石」，整條規則整場落空且無任何徵兆。' +
          '正確鍵名見 js/data.js 的 GEM_TYPES');
      }
    }
  }
});

test('策略的技能清單裡每個 id 都存在於 SKILLS', () => {
  for (const f of POLICY_FILES) {
    const p = loadPolicy(f);
    for (const rule of p.rules) {
      if (rule.cmd !== 'skill.learn' && rule.cmd !== 'skill.maxUpgrade') continue;
      for (const name of listNamesIn(rule)) {
        const list = p.lists[name];
        assert.ok(list, `${f} 規則 ${rule.id} 指到不存在的清單「${name}」——清單缺席時展開結果是空的，規則靜靜失效`);
        for (const id of list) {
          assert.ok(SKILLS[id], `${f} 清單 ${name} 有不存在的技能 id「${id}」（見 js/skills.js 的 SKILLS）`);
        }
      }
    }
  }
});

test('策略的目標詞條清單裡每個鍵都存在於 AFFIX_POOL', () => {
  for (const f of POLICY_FILES) {
    const p = loadPolicy(f);
    for (const rule of p.rules) {
      const name = rule.rerollOffTarget && rule.rerollOffTarget.targetList;
      if (!name) continue;
      const list = p.lists[name];
      assert.ok(list, `${f} 規則 ${rule.id} 指到不存在的清單「${name}」`);
      for (const key of list) {
        assert.ok(AFFIX_POOL[key],
          `${f} 清單 ${name} 有不存在的詞條鍵「${key}」——` +
          '洗煉會被遊戲回錯而且不會有人發現。正確鍵名見 js/data.js 的 AFFIX_POOL');
      }
    }
  }
});

/* ---- 熔爐零件 ---- */

/* forgeParts 底下所有形態的零件鍵：plan（各爐主力）、rebalance.materials[].part、backlog.part。 */
function partKeysIn(rule) {
  const cfg = rule.forgeParts;
  if (!cfg) return [];
  const out = [...(cfg.plan || [])];
  for (const m of (cfg.rebalance && cfg.rebalance.materials) || []) if (m && m.part) out.push(m.part);
  if (cfg.backlog && cfg.backlog.part) out.push(cfg.backlog.part);
  return out;
}

test('熔爐零件策略引用的零件鍵都存在，而且是分解槽零件', () => {
  /* 兩種都會靜靜失效：
     鍵名打錯 → newForgeBestOwnedPart 找不到，回「尚無此類型零件」；
     鍵名對但屬於合成節點（luckCore／rerollModule）→ 回「此零件無法安裝到熔爐」。
     兩者都只是一句錯誤訊息，模擬照樣跑完，熔爐整場空著。 */
  for (const f of POLICY_FILES) {
    for (const rule of loadPolicy(f).rules) {
      for (const k of partKeysIn(rule)) {
        const pt = ctx.PART_TYPES[k];
        assert.ok(pt, `${f} 規則 ${rule.id} 引用了不存在的零件鍵「${k}」（見 js/data.js 的 PART_TYPES）`);
        assert.equal(pt.node, 'salvage',
          `${f} 規則 ${rule.id} 的零件「${k}」是 ${pt.node} 節點零件，` +
          'newForgeInstallPart 只收 salvage 節點的，會整場回「此零件無法安裝到熔爐」');
      }
    }
  }
});

test('熔爐零件策略必須宣告 uninstallCmd', () => {
  /* 沒有拆的能力時，規則只能補空格：早期用低階零件填滿之後，
     即使庫存已經是 T7 也永遠換不上去——快照制不會自己升階。 */
  for (const f of POLICY_FILES) {
    for (const rule of loadPolicy(f).rules) {
      if (!rule.forgeParts) continue;
      assert.equal(typeof rule.uninstallCmd, 'string',
        `${f} 規則 ${rule.id} 少了 uninstallCmd——零件是快照制，不能拆就無法把過期的低階零件換成高階的`);
    }
  }
});

test('分段設定的最後一段必須是無上限的 catch-all', () => {
  /* 每一段都寫了 maxLevel 的話，超過最高段的角色會落到「沒有任何一段適用」，
     回傳空清單——等級一過門檻，整條規則就無聲停止運作。 */
  const check = (bands, where) => {
    if (!bands || !bands.length) return;
    const last = bands[bands.length - 1];
    assert.equal(last.maxLevel, undefined,
      `${where} 的最後一段仍設了 maxLevel=${last.maxLevel}——` +
      '角色等級超過它之後這條規則會靜靜停止運作');
    /* 分段除了等級之外還可以掛 when（例如「爆率 100% 以上才改鑲屬性寶石」）。
       收尾段若也掛了條件，條件不成立時同樣會找不到任何一段而整條停擺。 */
    assert.equal(last.when, undefined,
      `${where} 的最後一段仍掛了 when 條件——條件不成立時這條規則會靜靜停止運作`);
  };
  for (const f of POLICY_FILES) {
    for (const rule of loadPolicy(f).rules) {
      if (rule.socketEmpty) check(rule.socketEmpty.preferByLevel, `${f} 規則 ${rule.id} 的 preferByLevel`);
      if (rule.convertToPreferred) check(rule.convertToPreferred.preferByLevel, `${f} 規則 ${rule.id} 的 preferByLevel`);
      for (const spec of rule.expand || []) check(spec.listByLevel, `${f} 規則 ${rule.id} 的 listByLevel`);
    }
  }
});

test('關卡閘門的最後一段必須是無上限、且不再設門檻', () => {
  /* 最後一段仍設 maxStage → 超過之後閘門不再送指令，自動推關就停在上次的值；
     最後一段仍要求品質 → 前期指南會一路管到後期，把角色永久卡在某一關。
     兩種都不會報錯，只會看起來「這個 seed 卡住了」。 */
  for (const f of POLICY_FILES) {
    for (const rule of loadPolicy(f).rules) {
      const cps = rule.stageGate && rule.stageGate.checkpoints;
      if (!cps || !cps.length) continue;
      const last = cps[cps.length - 1];
      assert.equal(last.maxStage, undefined,
        `${f} 規則 ${rule.id}：最後一段仍設了 maxStage=${last.maxStage}，超過之後閘門就不再送指令`);
      assert.equal(last.coverage, 0,
        `${f} 規則 ${rule.id}：最後一段的 coverage 應為 0（前期指南只涵蓋前期，之後交回推關策略）`);
    }
  }
});

/* ---- 打不開的品質門檻 ----

   這個坑踩過兩次：

   一、閘門要求 41~50 關達到 30% 史詩，但掉落表按**怪物等級**查（怪物等級＝關卡數），
       Lv20~49 的史詩掉落率是 0。101 小時實跑、85,524 次擲骰，史詩一件都沒掉，
       角色從第 40 小時起卡在 41 關。當時就是補了這裡的哨兵擋住它。

   二、關卡改造把掉落權威換成「地圖＋關卡」（js/combat.js 的 fieldDropRatesFor →
       ZONE_STAGE_DROP_TABLE），荒漠 1~50 關的獨特與史詩掉落率都是 0。
       **哨兵沒有失敗，它是瞎了**——還在讀舊的 FIELD_DROP_TABLE。
       實測 20 小時 × 5 個 seed 全部退回 34 關，五個 seed 的最高關卡一模一樣是 50。

   所以第二次的修法不是「再寫一支更嚴的建置期檢查」——建置期檢查會跟著權威改變
   而靜靜失效，這正是第二次事故的形狀。改成**執行期問遊戲**（stageGate.dropRates），
   而這裡改測那條逃生口本身：宣告了沒有、接到的是不是遊戲當下真正在用的那一支。

   門檻的數字本身不再由測試釘死：地圖掉落表還在調整中，把今天的值寫進斷言
   只會在下一次調整時變成假警報，或更糟——跟著改成錯的期望值一起綠燈。 */

test('打不開的品質門檻：要嘛掉得出來，要嘛有執行期逃生口', () => {
  /* ⚠️ 合併說明（ai/claude × ai/codex 對同一支哨兵各改了一版）：

     codex 那一側把斷言改讀 ZONE_STAGE_DROP_TABLE，方向是對的——FIELD_DROP_TABLE
     已經不是掉落權威了。但條件寫成
       Object.values(ZONE_STAGE_DROP_TABLE).flat().some(row => row.equipmentRates[r] > 0)
     問的是「**任何地圖的任何一段**有沒有這個品質」。太古戰場 1~150 的獨特是 10、
     史詩 3，所以這次真正發生的荒漠死鎖在那個條件底下**仍然全綠**——同一種瞎，
     換了個形狀。（訊息也還寫著「怪物 Lv」與「FIELD_DROP_TABLE」，跟實際檢查的不一致。）

     claude 那一側只檢查有沒有宣告逃生口，沒有真的去問掉落表。

     合起來才是完整的：問**角色實際會停下來刷的那一段**掉不掉得出來，
     掉不出來時允許以執行期逃生口（stageGate.dropRates）作為合法例外——
     那條逃生口會在執行期問遊戲並放行，所以不再是死鎖。兩者皆無才是真的會卡死。

     為什麼不直接把門檻改成今天的 CSV 值：地圖掉落表還在調整中，
     把當下的數字寫進斷言，下一次調整不是變成假警報，就是跟著改成錯的期望值一起綠燈。 */
  const e = createEngine({ seed: 20260807 }).boot(null);
  /* 新角色從哪張地圖開始，問遊戲，不要寫死 'desert'。 */
  const startZone = e.state().stage.zone;

  for (const f of POLICY_FILES) {
    const policy = loadPolicy(f);
    for (const rule of policy.rules) {
      const cps = (rule.stageGate && rule.stageGate.checkpoints) || [];
      let lo = 1;
      let gated = false;
      for (const cp of cps) {
        if (cp.minRarity > 0 && cp.coverage > 0) {
          gated = true;
          /* 卡住時角色停在哪：park 有設就是 park 的下緣，沒有就是這一段的下緣。 */
          const at = Array.isArray(cp.park) && cp.park.length ? cp.park[0] : lo;
          /* 掉落路徑本人那一支（怪物等級＝關卡，見 formula.js monsterStatsFor）。 */
          const rates = e.ctx.fieldDropRatesFor(at, at, startZone);
          const droppable = Number(rates[cp.minRarity]) > 0;
          assert.ok(droppable || rule.stageGate.dropRates,
            `${f} 規則 ${rule.id}：卡住時會停在【${startZone}】第 ${at} 關，那裡要求 ` +
            `${ctx.RARITIES[cp.minRarity].name}(R${cp.minRarity})，但該段掉落率是 0，` +
            '而且沒有宣告 stageGate.dropRates 逃生口——這道閘門永遠打不開，模擬會從此卡死');
        }
        if (cp.maxStage === undefined) break;
        lo = cp.maxStage + 1;
      }
      if (gated && rule.stageGate.dropRates) {
        assert.ok((policy.needPanels || []).includes('battle'),
          `${f}：dropRates 讀 battle 面板，needPanels 就要宣告`);
      }
    }
  }
});

test('逃生口接到的是遊戲當下真正在用的掉落權威', () => {
  /* 這一支才是第二次事故真正的防線：面板投影必須跟掉落路徑同源。
     兩者對不上就代表有人換了掉落的算法而沒有帶著面板一起走。 */
  const e = createEngine({ seed: 20260806 }).boot(null);
  const g = e.state();

  assert.equal(typeof e.panel('battle').dropRates, 'object',
    'battle 面板必須投影 dropRates（陣列）——沒有的話策略只能瞎猜');

  for (const stage of [1, 20, 34, 50, 51, 100, 151]) {
    g.stage.current = stage;
    const panel = e.panel('battle').dropRates;
    /* 掉落路徑本人：js/combat.js:889 的 fieldDropRatesFor(關卡, 怪物等級, 地圖)。
       怪物等級＝關卡（formula.js monsterStatsFor 的 level: stage）。 */
    const truth = e.ctx.fieldDropRatesFor(stage, stage, g.stage.zone);
    assert.deepEqual(Array.from(panel), Array.from(truth),
      `關卡 ${stage}：面板的 dropRates 與掉落路徑用的不是同一份`);
  }
});

test('掉落表真的會出現「這一段掉不出這個品質」的情形', () => {
  /* 逃生口只有在真的踩得到時才有意義。如果整張表任何品質在任何關卡都掉得出來，
     上面兩支就只是在測空氣——那時應該回頭質疑逃生口還需不需要，而不是繼續留著。
     實際情形：荒漠 1~50 關的 [R0..R7] 是 [25,15,10,0,0,0,0,0]。 */
  const e = createEngine({ seed: 20260806 }).boot(null);
  const g = e.state();
  g.stage.current = 1;
  const rates = e.panel('battle').dropRates;
  assert.ok(rates.some((v) => !(Number(v) > 0)),
    '開局那一段每個品質都掉得出來的話，執行期逃生口就永遠不會觸發——請重新檢視是否還需要它');
});

test('關卡閘門引用的品質索引落在遊戲的 RARITIES 範圍內', () => {
  for (const f of POLICY_FILES) {
    for (const rule of loadPolicy(f).rules) {
      const cps = (rule.stageGate && rule.stageGate.checkpoints) || [];
      for (const cp of cps) {
        assert.ok(cp.minRarity >= 0 && cp.minRarity < ctx.RARITIES.length,
          `${f} 規則 ${rule.id} 的 minRarity=${cp.minRarity} 超出 RARITIES（0~${ctx.RARITIES.length - 1}）` +
          '——門檻高於遊戲最高品質的話閘門永遠打不開');
      }
    }
  }
});

/* ---- 產出閘門（stageGate.requireTargets + ratePerMin）---- */

function targetsOf(p) {
  const out = {};
  for (const t of p.targets || []) if (t && t.id) out[t.id] = t;
  return out;
}

test('關卡閘門要求的目標必須真的宣告過', () => {
  /* requireTargets 指到一個不存在的目標 id，deficit 查出來是 undefined，
     程式會判成「沒有阻擋」——閘門看起來裝上了，其實整場沒作用過。 */
  for (const f of POLICY_FILES) {
    const p = loadPolicy(f);
    const declared = targetsOf(p);
    for (const rule of p.rules) {
      for (const id of (rule.stageGate && rule.stageGate.requireTargets) || []) {
        assert.ok(declared[id],
          `${f} 規則 ${rule.id} 的 requireTargets 指到未宣告的目標「${id}」——` +
          '查不到缺口會被當成沒有阻擋，這道閘門不會有任何作用且無徵兆');
      }
      /* tierPush 的前進條件同理，而且方向相反：查不到缺口時它會被當成「不准前進」，
         症狀是 AI 停在分段下緣不動——一樣沒有徵兆，只是壞的方向不同。 */
      const tp = rule.stageGate && rule.stageGate.tierPush;
      for (const id of (tp && tp.advanceRequiresTargets) || []) {
        assert.ok(declared[id],
          `${f} 規則 ${rule.id} 的 tierPush.advanceRequiresTargets 指到未宣告的目標「${id}」——` +
          '查不到缺口會被當成「不准前進」，AI 會停在裝等分段下緣不動且無徵兆');
      }
    }
  }
});

test('動態退關的間隔必須不短於速率目標的取樣視窗', () => {
  /* 退關之後速率視窗裡還留著退關前那個關卡的取樣。間隔比視窗短的話，
     下一次判斷用的仍是舊資料，於是再退一階、再判一次⋯⋯一路退到底，
     而且看起來就只是「這個 seed 一直往回跑」。 */
  for (const f of POLICY_FILES) {
    const p = loadPolicy(f);
    const declared = targetsOf(p);
    for (const rule of p.rules) {
      const g = rule.stageGate;
      if (!g || !g.targetRetreat) continue;
      const every = (typeof g.targetRetreat.everySec === 'number') ? g.targetRetreat.everySec : 300;
      for (const id of g.requireTargets || []) {
        const t = declared[id];
        if (!t || t.kind !== 'ratePerMin') continue;
        const win = (typeof t.windowSec === 'number') ? t.windowSec : 300;
        assert.ok(every >= win,
          `${f} 規則 ${rule.id}：退關間隔 ${every}s 短於目標「${id}」的視窗 ${win}s——` +
          '會連續退關直到視窗換血完畢');
      }
    }
  }
});

test('速率目標的計數器路徑在遊戲的面板裡真的取得到', () => {
  /* 這是本檔要擋的那一類失真的速率版：路徑寫錯只會讓取樣安靜地跳過，
     速率永遠是 unknown，閘門永遠不觸發——報表上完全看不出來。
     所以實際開一場遊戲、打到有擊殺、再把策略宣告的路徑解一次。 */
  const specs = [];
  for (const f of POLICY_FILES) {
    for (const t of loadPolicy(f).targets || []) {
      if (t && t.kind === 'ratePerMin' && t.counter) specs.push({ f, id: t.id, path: t.counter });
    }
  }
  if (!specs.length) return;

  const eng = createEngine({ seed: 7 }).boot(null);
  /* 打到第一隻怪死掉為止。sources 那一桶是第一次擊殺才建的（js/stats.js 的
     lootSourceBucket），所以不打就驗不到——這正是要驗的東西。 */
  for (let i = 0; i < 200 && !((eng.ctx.LOOT_STATS.sources.field || {}).kills > 0); i++) eng.step(20);
  assert.ok((eng.ctx.LOOT_STATS.sources.field || {}).kills > 0, '前置條件：模擬應該要打得死第一關的怪');

  for (const s of specs) {
    const m = /^panels\.([^.]+)\.(.+)$/.exec(s.path);
    assert.ok(m, `${s.f} 目標 ${s.id} 的 counter「${s.path}」不是 panels.<面板>.<欄位> 格式`);
    let cur = eng.panel(m[1]);
    for (const part of m[2].split('.')) {
      assert.ok(cur !== null && cur !== undefined,
        `${s.f} 目標 ${s.id} 的 counter「${s.path}」在「${part}」這一段斷掉——取樣會整場跳過`);
      cur = cur[part];
    }
    assert.equal(typeof cur, 'number', `${s.f} 目標 ${s.id} 的 counter「${s.path}」解出來不是數字（得到 ${cur}）`);
  }
});

test('策略引用的附魔書鍵都存在於 ENCHANTS，且類別對得上', () => {
  /* 送錯類別只會換回「XX 只能使用 OO 類附魔」——規則整場落空，看報表看不出來。
     這裡直接拿遊戲的 ENCHANTS[key].cat 對照策略把它歸在哪一類。 */
  for (const f of POLICY_FILES) {
    for (const rule of loadPolicy(f).rules) {
      const byCat = rule.enchantPriority && rule.enchantPriority.byCategory;
      if (!byCat) continue;
      for (const cat of Object.keys(byCat)) {
        for (const key of byCat[cat]) {
          const def = ctx.ENCHANTS[key];
          assert.ok(def, `${f} 規則 ${rule.id} 引用了不存在的附魔書「${key}」（見 js/data.js 的 ENCHANTS）`);
          assert.equal(def.cat, cat,
            `${f} 規則 ${rule.id} 把「${key}」歸在 ${cat} 類，但遊戲裡它是 ${def.cat} 類——` +
            '部位只吃自己那一類，歸錯的話這本書永遠附不上去');
        }
      }
    }
  }
});

test('寶石轉換的九宮格上限不得超過遊戲的上限', () => {
  /* convertGems 是先驗證整批、任一格超標就整批回絕（js/item.js），
     所以超標不是「多的那格失敗」，而是那次轉換完全沒發生——而且不會有徵兆。
     這兩個值寫在策略資料裡是為了讓引擎不內建遊戲常數，代價就是要有這支哨兵。 */
  for (const f of POLICY_FILES) {
    for (const rule of loadPolicy(f).rules) {
      const cfg = rule.convertToPreferred;
      if (!cfg) continue;
      assert.ok(cfg.maxSlots <= ctx.GEM_CONVERT_SLOTS,
        `${f} 規則 ${rule.id} 的 maxSlots=${cfg.maxSlots} 超過遊戲的 GEM_CONVERT_SLOTS=${ctx.GEM_CONVERT_SLOTS}`);
      assert.ok(cfg.maxPerSlot <= ctx.GEM_CONVERT_STACK,
        `${f} 規則 ${rule.id} 的 maxPerSlot=${cfg.maxPerSlot} 超過遊戲的 GEM_CONVERT_STACK=${ctx.GEM_CONVERT_STACK}`);
    }
  }
});

test('寶石規則的順序：轉換 → 合成 → 換下 → 鑲嵌', () => {
  /* 這條產線是靠**規則順序**成立的，不是靠參數，順序反了不會報錯：
     先合成再轉換 → 合成時同種類還沒集中，湊不到 3 顆；
     先鑲嵌再合成 → 鑲上的是沒合成過的低階寶石（socketGem 取庫存最高階）。 */
  const CHAIN = ['gem-convert', 'gem-compose', 'unsocket-off-priority', 'socket-gems'];
  for (const f of POLICY_FILES) {
    const ids = loadPolicy(f).rules.map((r) => r.id);
    const pos = CHAIN.map((id) => ids.indexOf(id)).filter((i) => i >= 0);
    const sorted = pos.slice().sort((a, b) => a - b);
    assert.deepEqual(pos, sorted,
      `${f} 的寶石規則順序不是「${CHAIN.join(' → ')}」（目前索引 ${pos.join(', ')}）`);
  }
});

test('合成寶石必須排在鑲嵌之前（先合成才鑲得到最高品質）', () => {
  /* socketGem() 取的是庫存中最高階的那顆（js/item.js），
     所以「鑲寶石前先向上合成」這條策略是靠**規則順序**實現的，不是靠參數。
     順序反了不會報錯，只會整場鑲到沒合成過的低階寶石。 */
  for (const f of POLICY_FILES) {
    const ids = loadPolicy(f).rules.map((r) => r.id);
    const compose = ids.indexOf('gem-compose');
    const socket = ids.indexOf('socket-gems');
    if (compose < 0 || socket < 0) continue;
    assert.ok(compose < socket,
      `${f}：gem-compose 必須排在 socket-gems 前面（目前 ${compose} vs ${socket}）`);
  }
});

test('learnPlan 宣告的被動清單必須涵蓋遊戲裡所有被動技', () => {
  /* 被動不佔裝載欄、學會即常駐，所以「主動配滿之後的點數全投被動」這條策略
     只在**清單涵蓋得夠廣**時才成立。清單短了不會有任何徵兆——技能點就靜靜地
     堆著，而堆積本身在面板上看起來很正常。

     實測一份 Lv.392 的快照：技能點 118/348 閒置，已學的 23 支全部 10/10
     （23×10=230，348−230=118）。不是「還沒投完」，是清單學光了沒東西可投——
     遊戲有 19 個被動，策略只宣告了 8 個（而且舊註解還寫著「全部 10 個被動」，
     本身就是錯的）。漏掉的 11 個裡包含殺陣反射（暴擊時免費再攻擊）與
     死神節拍（擊殺減冷卻）這種中後期的主力被動。

     所以這裡拿遊戲當權威逐一比對：日後 SKILLS 新增被動，這支會紅。
     真的有不想投的（例如物理流的 matkPct），做法是排在清單最後面，
     不是把它留在清單外——留在外面等於「有剩也不投」，而點數有剩時投什麼都比不投好。 */
  const passives = Object.keys(SKILLS).filter((k) => SKILLS[k].cat === 'passive');
  assert.ok(passives.length > 0, '前提：遊戲裡要有被動技');

  for (const f of POLICY_FILES) {
    const p = loadPolicy(f);
    for (const rule of p.rules) {
      const name = rule.learnPlan && rule.learnPlan.passives;
      if (!name) continue;
      const list = p.lists[name] || [];
      const missing = passives.filter((k) => list.indexOf(k) < 0);
      assert.deepEqual(missing, [],
        `${f} 的 ${name} 沒有涵蓋這些被動：${missing.join(', ')}` +
        '——技能點會靜靜地堆著，不會有任何錯誤訊息');
      const notPassive = list.filter((k) => !SKILLS[k] || SKILLS[k].cat !== 'passive');
      assert.deepEqual(notPassive, [],
        `${f} 的 ${name} 有不是被動技的項目：${notPassive.join(', ')}` +
        '——主動技學了不裝就是死點，那正是這條策略要避免的事');
    }
  }
});

test('保留清單的詞條，在它每一個合法部位上都要受保護', () => {
  /* rerollOffTarget 按「主副手／飾品／防具」三組各給一份保留清單，但**遊戲的詞條池
     不照這個分類**：AFFIX_POOL 的 slots 是逐條詞條各自宣告的，傷害類詞條照樣出在
     頭盔、肩甲、護手、手腕上。

     兩者對不齊的後果是同一條詞條在不同部位待遇相反——武器上受保護、護手上被當垃圾
     洗掉。而洗煉是不可逆的，等於策略每隔幾分鐘就親手砸掉自己剛拿到的好詞條。

     實測抓到 7 條，其中包含 ROI 排名的前三名（拿一份關卡 200 沙漠 BOSS 的存檔量）：
       pPen    ΔDPS +40.5%（第 1 名）  合法部位含 gloves/wrist → 兩個都沒保護
       aspd    ΔDPS +33.2%（第 2 名）  合法部位含 gloves       → 沒保護
       bossDmg ΔDPS +25.1%（第 3 名）  合法部位含 helmet/shoulder → 都沒保護
     而評估器建議的最佳宿主部位正好就是 gloves——策略把它自己算出來的第一名，
     在它自己挑的部位上洗掉。

     這支測試把「清單分組」與「遊戲的 slots」逐一對照，避免再犯。
     不想保護的詞條做法是**從清單裡拿掉**，不是讓它只在某些部位受保護。 */
  const ITEM_TYPES = ctx.ITEM_TYPES;
  for (const f of POLICY_FILES) {
    const p = loadPolicy(f);
    for (const rule of p.rules) {
      const cfg = rule.rerollOffTarget;
      if (!cfg || !cfg.targetGroups) continue;

      /* 每個部位實際生效的保留集合。沒宣告 slots 的那一組是 catch-all。 */
      const keepBySlot = {};
      let fallback = null;
      for (const g of cfg.targetGroups) {
        const keys = [];
        for (const l of g.lists || []) keys.push(...(p.lists[l.list] || []));
        if (!g.slots) { fallback = keys; continue; }
        for (const s of g.slots) keepBySlot[s] = (keepBySlot[s] || []).concat(keys);
      }
      for (const s of ITEM_TYPES) if (!keepBySlot[s]) keepBySlot[s] = fallback || [];

      const holes = [];
      for (const key of new Set(Object.values(keepBySlot).flat())) {
        const def = AFFIX_POOL[key];
        if (!def) continue;                       // 鍵是否存在由另一支測試把關
        const legal = (def.slots && def.slots.length) ? def.slots : ITEM_TYPES;
        const missing = legal.filter((s) => !(keepBySlot[s] || []).includes(key));
        if (missing.length) holes.push(`${key} 在 ${missing.join('/')} 上沒受保護`);
      }
      assert.deepEqual(holes, [],
        `${f} 規則 ${rule.id}：\n  ` + holes.join('\n  ') +
        '\n（同一條詞條在不同部位待遇相反，會被自己的洗煉規則砸掉）');
    }
  }
});
