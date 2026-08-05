/* 技能點的三條新規則：learnPlan / combatLoadout / deleteUnusedSkills。

   這三條都會**永久花掉或退掉技能點**，而技能點是不可再生的資源（來自熟練度等級），
   所以錯了不是「效率差一點」，是整場的戰力被鎖住。四個性質必須釘死：

     1. 主動的名額＝遊戲給的 loadoutSize，不是策略寫死的清單長度。
        js/skills.js 的 pickAndCastSkill 只走 G.player.loadout——沒裝載的主動技
        一次都不會被施放，而技能點是 1 級 1 點，學了不裝就是死點。
        實測一場 Lv.169 的存檔：152 點裡有 37 點（24%）壓在沒裝載的主動上。
     2. 名額只能給「現在真的學得起來」的。優先序前面若是還沒解鎖的高等技能，
        照位置硬切會讓那幾格永久空著（送出去只會得到「需人物達到 Lv.N 才解鎖」）。
     3. 換裝載欄要收斂。少了「已經是目標狀態就不送」這一條，每個決策點都會重送
        一次卸下＋裝上，而報表上只看得到指令數變多。
     4. 退點要有保護。deleteSkill 全額退還，但它**不檢查融合佔用**，也不知道
        BOSS 組平時就是「學了沒裝」的狀態——刪錯的代價是融合技壞掉、或是
        刪了又學的無限迴圈。 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createEngine } = require('../scripts/sim/engine.js');
const { createPolicy } = require('../scripts/sim/policy.js');

const ROOT = path.resolve(__dirname, '..');
const ROI = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/sim/policy.extreme.roi.json'), 'utf8'));

/* 只留下要測的那一條規則，其餘拿掉——否則別條規則的指令會混進來。 */
function policyWithOnly(ruleId, tweak) {
  const p = JSON.parse(JSON.stringify(ROI));
  p.rules = p.rules.filter((r) => r.id === ruleId);
  assert.equal(p.rules.length, 1, `找不到規則 ${ruleId}`);
  if (tweak) tweak(p.rules[0], p);
  return createPolicy(p);
}

/* ⚠️ 每次 decide 都要往前推時間：規則有 everySec 節流，同一個 gameTimeSec
   連問兩次的話第二次會被跳過而回空陣列——那看起來就像「規則沒送指令」，
   而測試會把它讀成功能壞掉。 */
let clock = 0;
function decide(policy, state) {
  clock += 3600;
  return policy.decide(Object.assign({}, state, { gameTimeSec: clock }));
}

/* always 宣告的 BOSS 組本來就也在 loadoutPriority 裡（排在末段），
   所以「主動名額用掉幾個」不能用清單成員數去數——要把 always 扣掉。 */
const ALWAYS = ['regenerate', 'manaBarrier'];

/* 最小的狀態：只有規則真的會讀的那幾個路徑。 */
function makeState(over) {
  const s = {
    view: { level: 200 },
    panels: {
      skills: {
        skills: {}, loadout: [], loadoutSize: 7, fusions: [],
        unlockLv: { soulBrandFlurry: 100, counterStance: 100, swiftCuts: 50 },
        maxLv: 10
      },
      battle: { field: { monster: null } }
    }
  };
  if (over) over(s);
  return s;
}

test('learnPlan：主動只送 loadoutSize 個，其餘全給被動', () => {
  const policy = policyWithOnly('learn-skills');
  const actives = ROI.lists.loadoutPriority;
  const passives = ROI.lists.passivePriority;

  for (const size of [4, 7]) {
    const cmds = decide(policy, makeState((s) => { s.panels.skills.loadoutSize = size; }));
    const ids = cmds.map((c) => c.args.id);
    const gotActives = ids.filter((id) => actives.indexOf(id) >= 0 && ALWAYS.indexOf(id) < 0);
    const gotPassives = ids.filter((id) => passives.indexOf(id) >= 0);
    assert.equal(gotActives.length, size, `${size} 格就只該學 ${size} 個主動`);
    assert.deepEqual(gotPassives, passives, '被動要全部送出（不佔裝載欄）');
    /* BOSS 組即使不常駐裝載欄也一定要學 */
    for (const must of ['regenerate', 'manaBarrier']) {
      assert.ok(ids.indexOf(must) >= 0, `${must} 是 always，必須送出`);
    }
  }
});

test('learnPlan：名額不給還沒解鎖的（否則那幾格永久空著）', () => {
  const policy = policyWithOnly('learn-skills');
  const actives = ROI.lists.loadoutPriority;

  /* 等級 1：unlockLv 裡 >1 的都還不能學 */
  const low = decide(policy, makeState((s) => {
    s.view.level = 1;
    s.panels.skills.loadoutSize = 4;
  })).map((c) => c.args.id);
  for (const locked of ['soulBrandFlurry', 'counterStance', 'swiftCuts']) {
    assert.equal(low.indexOf(locked), -1, `${locked} 還沒解鎖，不該佔名額`);
  }
  assert.equal(low.filter((id) => actives.indexOf(id) >= 0 && ALWAYS.indexOf(id) < 0).length, 4,
    '名額仍要填滿 4 個');

  /* 已經學會的一律算數，即使門檻比現在的等級高（它已經佔著格子了） */
  const learned = decide(policy, makeState((s) => {
    s.view.level = 1;
    s.panels.skills.loadoutSize = 4;
    s.panels.skills.skills = { soulBrandFlurry: 3 };
  })).map((c) => c.args.id);
  assert.ok(learned.indexOf('soulBrandFlurry') >= 0, '已學會的要繼續升級');
});

test('learnPlan：已滿級的不再送（上限由遊戲給，不寫死 10）', () => {
  const policy = policyWithOnly('learn-skills');
  const maxed = decide(policy, makeState((s) => {
    s.panels.skills.maxLv = 10;
    s.panels.skills.skills = { midasTouch: 10 };
  })).map((c) => c.args.id);
  assert.equal(maxed.indexOf('midasTouch'), -1, '滿級了就不該再送');

  /* 轉生後上限提高，同一個技能又該送了 */
  const raised = decide(policy, makeState((s) => {
    s.panels.skills.maxLv = 15;
    s.panels.skills.skills = { midasTouch: 10 };
  })).map((c) => c.args.id);
  assert.ok(raised.indexOf('midasTouch') >= 0, '上限提高後要繼續升——寫死 10 的話這裡會靜靜停住');
});

/* 危險等級不能用注入的——updateContext 每個決策點都會重建 state.ctx。
   所以走完整條鏈：以 1Hz 觀測餵血量 → 血量水位 → 危險等級 → 換裝。
   這也才測得到「觀測到的是最低值而不是當下值」這個真正的性質。 */
function driveHp(policy, state, hpPct, seconds) {
  for (let i = 0; i < seconds; i++) {
    clock += 1;
    policy.observe(Object.assign({}, state, {
      gameTimeSec: clock,
      view: Object.assign({}, state.view, { hp: hpPct, hpMax: 100 })
    }));
  }
}

/* 兩階都設成 atLeast:1，就能只用血量水位測到「階梯是累積的」——
   第二階原本要等級 2，而等級 2 還需要一個卡關紀錄，那是另一條路徑的事。 */
const bothTiers = (rule) => rule.combatLoadout.tiers.forEach((t) => { t.atLeast = 1; });

test('combatLoadout：血量水位掉破門檻就換上保命技，卸下排在裝上前面', () => {
  const policy = policyWithOnly('danger-loadout', bothTiers);
  const state = makeState((s) => {
    s.panels.skills.skills = { regenerate: 10, manaBarrier: 10, midasTouch: 10, treasureSense: 10 };
    s.panels.skills.loadout = ['midasTouch', 'treasureSense', 'a', 'b', 'c', 'd', 'e'];
  });
  driveHp(policy, state, 10, 200);          // 最低血量 10% ≪ 進入門檻 50%
  const cmds = decide(policy, state);
  const names = cmds.map((c) => c.name);
  const ids = cmds.map((c) => c.args.id);
  assert.deepEqual(ids.slice(0, 2).sort(), ['midasTouch', 'treasureSense'], '先卸下產出技');
  assert.deepEqual(ids.slice(2).sort(), ['manaBarrier', 'regenerate'], '再裝上保命技');
  assert.equal(names[0], 'skill.unequipLoadout');
  assert.equal(names[names.length - 1], 'skill.equipLoadout');
});

test('combatLoadout：回到安全時換回產出技', () => {
  const policy = policyWithOnly('danger-loadout', bothTiers);
  const state = makeState((s) => {
    s.panels.skills.skills = { regenerate: 10, manaBarrier: 10, midasTouch: 10, treasureSense: 10 };
    s.panels.skills.loadout = ['regenerate', 'manaBarrier', 'a', 'b', 'c', 'd', 'e'];
  });
  driveHp(policy, state, 100, 400);         // 整個視窗都滿血
  const ids = decide(policy, state).map((c) => c.args.id);
  assert.deepEqual(ids.slice(0, 2).sort(), ['manaBarrier', 'regenerate'], '先卸下保命技');
  assert.deepEqual(ids.slice(2).sort(), ['midasTouch', 'treasureSense'], '再裝回產出技');
});

test('遲滯：回到 50~65 之間不算安全，維持原狀（否則會在門檻上抖動）', () => {
  const policy = policyWithOnly('danger-loadout', bothTiers);
  const state = makeState((s) => {
    s.panels.skills.skills = { regenerate: 10, manaBarrier: 10, midasTouch: 10, treasureSense: 10 };
    s.panels.skills.loadout = ['regenerate', 'manaBarrier', 'a', 'b', 'c', 'd', 'e'];
  });
  driveHp(policy, state, 10, 200);          // 先進入危險
  decide(policy, state);
  driveHp(policy, state, 58, 400);          // 回到 58%：高於進入門檻 50、低於離開門檻 65
  assert.equal(decide(policy, state).length, 0, '在遲滯區間內不得換回去');
  driveHp(policy, state, 90, 400);          // 真的安全了
  assert.ok(decide(policy, state).length > 0, '越過離開門檻才換回去');
});

test('視窗沒攢滿時不猜（開場血量本來就滿，猜安全會讓保命技在最需要的前期缺席）', () => {
  const policy = policyWithOnly('danger-loadout', bothTiers);
  const state = makeState((s) => {
    s.panels.skills.skills = { regenerate: 10, manaBarrier: 10, midasTouch: 10, treasureSense: 10 };
    s.panels.skills.loadout = ['midasTouch', 'treasureSense', 'a', 'b', 'c', 'd', 'e'];
  });
  driveHp(policy, state, 10, 10);           // 只有 10 秒＝攢不滿兩個 50 秒的桶
  assert.equal(decide(policy, state).length, 0, '資料不足就不該動作');
});

test('combatLoadout：已經是目標狀態就不送（否則每個決策點都在拆了又裝）', () => {
  const policy = policyWithOnly('danger-loadout', bothTiers);
  const danger = makeState((s) => {
    s.panels.skills.skills = { regenerate: 10, manaBarrier: 10 };
    s.panels.skills.loadout = ['regenerate', 'manaBarrier', 'a', 'b', 'c', 'd', 'e'];
  });
  driveHp(policy, danger, 10, 200);
  assert.equal(decide(policy, danger).length, 0, '保命組已經在場上，不該再送');

  const policy2 = policyWithOnly('danger-loadout', bothTiers);
  const safe = makeState((s) => {
    s.panels.skills.skills = { midasTouch: 10, treasureSense: 10 };
    s.panels.skills.loadout = ['midasTouch', 'treasureSense', 'a', 'b', 'c', 'd', 'e'];
  });
  driveHp(policy2, safe, 100, 400);
  assert.equal(decide(policy2, safe).length, 0, '產出組已經在場上，不該再送');
});

test('combatLoadout：沒學會的不送裝上（否則會誤以為已經切過去了）', () => {
  const policy = policyWithOnly('danger-loadout', bothTiers);
  const state = makeState((s) => {
    s.panels.skills.skills = { midasTouch: 10, treasureSense: 10 };   // 保命組還沒學
    s.panels.skills.loadout = ['midasTouch', 'treasureSense', 'a', 'b', 'c', 'd', 'e'];
  });
  driveHp(policy, state, 10, 200);
  const cmds = decide(policy, state);
  assert.equal(cmds.filter((c) => c.name === 'skill.equipLoadout').length, 0,
    '沒學會就不該送裝上');
});

test('deleteUnusedSkills：三道保護一道都不能少', () => {
  const policy = policyWithOnly('delete-unused-skills');
  const cmds = decide(policy, makeState((s) => {
    s.panels.skills.loadoutSize = 7;
    s.panels.skills.skills = {
      midasTouch: 10,          // 在主動名額內 → 留
      sharpBlade: 10,          // 被動清單 → 留
      regenerate: 10,          // always（BOSS 組，平時沒裝）→ 留
      arcaneBurst: 1,          // 沒用的舊主動 → 刪
      powerSlash: 10,          // 舊主動 → 刪
      whirlwind: 5,            // 融合材料 → 留
      stunBlow: 3              // 現在裝載中 → 留
    };
    s.panels.skills.loadout = ['stunBlow'];
    s.panels.skills.fusions = [{ id: 'fusion_1', components: ['whirlwind'] }];
  }));
  const ids = cmds.map((c) => c.args.id).sort();
  assert.deepEqual(ids, ['arcaneBurst', 'powerSlash'],
    '只刪「不在任何清單、不在裝載欄、不是融合材料」的主動');
});

test('deleteUnusedSkills：融合技本身與材料都不能刪（deleteSkill 不檢查融合佔用）', () => {
  const policy = policyWithOnly('delete-unused-skills');
  const cmds = decide(policy, makeState((s) => {
    s.panels.skills.skills = { fusion_1: 3, whirlwind: 5, armorBreak: 5 };
    s.panels.skills.fusions = [{ id: 'fusion_1', components: ['whirlwind', 'armorBreak'] }];
  }));
  assert.equal(cmds.length, 0, '融合技與它的材料一個都不能刪');
});

test('unequip-worst-skill 不得拆掉 boss-loadout 換上去的保命技', () => {
  const policy = policyWithOnly('unequip-worst-skill');
  const cmds = decide(policy, makeState((s) => {
    s.panels.skills.loadoutSize = 3;
    s.panels.skills.loadout = ['regenerate', 'manaBarrier', 'midasTouch'];
    /* 場外有更好的（優先序第一），所以這條規則本來會想卸一個 */
    s.panels.skills.skills = { regenerate: 10, manaBarrier: 10, midasTouch: 10, swiftCuts: 10 };
  }));
  for (const c of cmds) {
    assert.ok(['regenerate', 'manaBarrier'].indexOf(c.args.id) < 0,
      `${c.args.id} 是 BOSS 組，protect 應該擋下——不擋的話兩條規則會整場 BOSS 戰互相拆台`);
  }
});
