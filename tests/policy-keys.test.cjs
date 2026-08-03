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

test('關卡閘門的品質門檻在該關卡區間必須真的掉得出來', () => {
  /* 這條擋的是一個實際發生過、而且非常昂貴的錯誤：
     閘門要求 41~50 關達到 30% 史詩，但 FIELD_DROP_TABLE 是按**怪物等級**查表的，
     而怪物等級＝關卡數（monsterStatsFor 的 level: stage），Lv20~49 的史詩掉落率是 0。
     結果是一道數學上不可能打開的閘門——101 小時實跑、85,524 次掉落擲骰，
     史詩一件都沒掉，角色從第 40 小時起卡在 41 關直到跑完，而且完全沒有徵兆。

     檢查點取各段的**下緣**（進入這一段時所在的關卡），因為角色就是被卡在那裡。 */
  let lo = 1;
  for (const f of POLICY_FILES) {
    for (const rule of loadPolicy(f).rules) {
      const cps = (rule.stageGate && rule.stageGate.checkpoints) || [];
      lo = 1;
      for (const cp of cps) {
        if (cp.minRarity > 0 && cp.coverage > 0) {
          const rates = ctx.dropRatesFor(ctx.FIELD_DROP_TABLE, lo);
          assert.ok(rates[cp.minRarity] > 0,
            `${f} 規則 ${rule.id}：${lo}~${cp.maxStage === undefined ? '∞' : cp.maxStage} 關要求 ` +
            `${ctx.RARITIES[cp.minRarity].name}(R${cp.minRarity})，但怪物 Lv${lo} 的該品質掉落率是 0` +
            `（FIELD_DROP_TABLE）——這道閘門永遠打不開，模擬會從此卡死`);
        }
        if (cp.maxStage === undefined) break;
        lo = cp.maxStage + 1;
      }
    }
  }
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
