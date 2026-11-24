'use strict';
/* Demo 版（Steam 封測）：倍率與開放範圍只在 GAME_EDITION === 'demo' 時生效（js/data.js「Demo 版」區塊）。
   兩件事都要守：demo 版確實套用；正式版（沒有 GAME_EDITION 或 'full'）數值與原本完全相同。 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadRuneEnv } = require('./helpers/runeword-env.cjs');

const root = path.resolve(__dirname, '..');
const FILES = [
  'util.js', 'strings_data.js', 'strings.js', 'data.js', 'runeword_data.js', 'status.js', 'formula.js', 'battlefield.js', 'stats.js',
  'item.js', 'runeword.js', 'skills.js', 'skills2.js', 'talents.js', 'player.js', 'special_rules.js',
  'combat.js', 'legendary.js', 'tower.js', 'factory.js', 'newforge.js', 'forge.js', 'save.js', 'tasks.js',
  'chest_data.js', 'chest.js'
];

function env(edition) {
  // GAME_EDITION 由 js/game-edition.js 定義；這裡直接放進全域，模擬外殼改寫後的結果
  const c = loadRuneEnv({ files: [], noState: true });
  if (edition) c.GAME_EDITION = edition;
  FILES.forEach((file) => vm.runInContext(fs.readFileSync(path.join(root, 'js', file), 'utf8'), c, { filename: 'js/' + file }));
  vm.runInContext('G = newGameState(); markStatsDirty();', c);
  return c;
}

const NOT_OPEN = '未開放';

test('js/game-edition.js 提交的版本永遠是 full（demo 由桌面外殼改寫回應）', () => {
  const c = {};
  vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(root, 'js', 'game-edition.js'), 'utf8'), c);
  assert.equal(c.GAME_EDITION, 'full');
});

test('正式版：開放範圍與上限不變', () => {
  for (const edition of [undefined, 'full']) {
    const c = env(edition);
    assert.equal(c.isDemoEdition(), false);
    assert.equal(c.demoMult(c.DEMO_ENEMY_XP_MULT), 1);
    assert.equal(c.playerMaxLevel(), c.MAX_LEVEL);
    assert.equal(c.towerOpenMaxFloor(), c.TOWER_MAX_FLOOR);
    assert.equal(c.demoReincarnationClosed(), false);
    assert.ok(c.ZONE_LIST.every((z) => c.demoZoneOpen(z)));
  }
});

test('STR(DEMO_NOT_OPEN_STR) 是「未開放」', () => {
  const c = env('demo');
  assert.equal(c.STR(c.DEMO_NOT_OPEN_STR), NOT_OPEN);
});

test('經驗：只乘打敵人得到的經驗；熟練度乘自己的倍率、不吃玩家經驗倍率', () => {
  for (const edition of ['full', 'demo']) {
    const c = env(edition);
    const p = c.G.player;
    const masteryCalls = [];
    const realMastery = c.gainSkillMasteryXp;
    c.gainSkillMasteryXp = (n) => { masteryCalls.push(n); return realMastery(n); };
    const xpCalls = [];
    const realGain = c.gainXp;
    c.gainXp = (n) => { xpCalls.push(n); return realGain(n); };
    const got = c.gainEnemyXp(1000);
    const demo = edition === 'demo';
    assert.equal(got, demo ? Math.round(1000 * c.DEMO_ENEMY_XP_MULT) : 1000, edition);
    assert.deepEqual(xpCalls, [got], edition);
    const mastery = Math.round(1000 * c.SKILL_MASTERY_XP_RATE / 100 * (demo ? c.DEMO_MASTERY_XP_MULT : 1));
    assert.deepEqual(masteryCalls, [mastery], edition);
    assert.ok(p.level >= 1);
  }
});

test('升級所需經驗不受 demo 影響', () => {
  const full = env('full'), demo = env('demo');
  for (const lv of [1, 50, 300, 999]) assert.equal(demo.xpForLevel(lv), full.xpForLevel(lv));
});

test('技能升級與終極進化的金幣消耗：demo 乘 DEMO_SKILL_GOLD_MULT，正式版不變', () => {
  const full = env('full'), demo = env('demo');
  const gid = Object.keys(full.SKILLS2).find((g) => full.SKILLS2[g].tiers && full.SKILLS2[g].tiers.length && full.SKILLS2[g].tiers[0].goldBase > 0);
  assert.ok(gid, '至少要有一個有金幣費用的技能群組');
  const t = full.SKILLS2[gid].tiers[0];
  for (const lv of [0, 3, 10]) {
    const rawFloat = t.goldBase * Math.pow(Number(t.goldGrow) || 1, lv);
    assert.equal(full.skills2UpgradeCost(gid, 0, lv), Math.floor(rawFloat));
    assert.equal(demo.skills2UpgradeCost(gid, 0, lv), Math.floor(rawFloat * demo.DEMO_SKILL_GOLD_MULT));
  }
  const ultGid = Object.keys(full.SKILLS2).find((g) => full.sgUltOption(g, 0) && full.sgUltOption(g, 0).goldBase > 0);
  assert.ok(ultGid, '至少要有一個有終極進化費用的技能群組');
  const opt = full.sgUltOption(ultGid, 0);
  const ultFloat = opt.goldBase * Math.pow(Number(opt.goldGrow) || 1, 5);
  assert.equal(full.skills2UltCost(ultGid, 0, 5), Math.floor(ultFloat));
  assert.equal(demo.skills2UltCost(ultGid, 0, 5), Math.floor(ultFloat * demo.DEMO_SKILL_GOLD_MULT));
});

test('熔爐寶箱鍛造經驗：demo 乘 DEMO_CHEST_FORGE_XP_MULT', () => {
  const gains = {};
  for (const edition of ['full', 'demo']) {
    const c = env(edition);
    const def = c.CHESTS.find((d) => c.chestLevelDef(d, 1) && c.chestLevelDef(d, 1).xp.some((x) => Number(x) > 0));
    assert.ok(def);
    const rarity = c.chestLevelDef(def, 1).xp.findIndex((x) => Number(x) > 0);
    const st = c.chestState(def.id);
    st.lv = 1; st.xp = 0; st.n = 0;
    c.chestGainSalvageXp(rarity, 1);
    gains[edition] = st.xp + st.n * Number(c.chestLevelDef(def, st.lv).need);
  }
  assert.equal(gains.demo, gains.full * 2);
});

test('等級上限：demo 取 DEMO_MAX_LEVEL（不超過 MAX_LEVEL）', () => {
  const c = env('demo');
  c.DEMO_MAX_LEVEL = 50;
  c.gainXp(1e15);
  assert.equal(c.G.player.level, 50);
  assert.equal(c.G.player.xp, 0);
  c.DEMO_MAX_LEVEL = c.MAX_LEVEL + 500;
  assert.equal(c.playerMaxLevel(), c.MAX_LEVEL, '超過升級經驗表的上限一律夾回 MAX_LEVEL');
});

test('轉生：demo 未開放時 Worker 拒絕（就算等級到了）；改成 1 就照常', () => {
  const c = env('demo');
  c.G.player.level = c.REINCARNATION_LEVEL;
  assert.equal(c.reincarnate(), NOT_OPEN);
  assert.equal(c.G.player.reincarnations || 0, 0);
  c.DEMO_REINCARNATION_OPEN = 1;
  assert.notEqual(c.reincarnate(), NOT_OPEN);
  assert.equal(c.G.player.reincarnations, 1);
});

test('場景：demo 只開放 Zones 表順序前 N 張；其餘就算進度到了也進不去', () => {
  const c = env('demo');
  assert.deepEqual(Array.from(c.ZONE_LIST.slice(0, 2)), ['desert', 'Icefield']);   // vm 另一個 realm 的陣列：先轉成本 realm
  assert.equal(c.isZoneUnlocked('desert'), true);
  assert.equal(c.demoZoneOpen('Icefield'), true);
  // 把冰原打通：迷霧森林依進度已解鎖，但 demo 未開放
  c.markZoneCleared('Icefield', c.zoneMaxStage('Icefield'));
  assert.equal(c.zoneUnlockedByProgress('mist_forest'), true);
  assert.equal(c.isZoneUnlocked('mist_forest'), false);
  c.switchZone('mist_forest');
  assert.notEqual(c.G.stage.zone, 'mist_forest', 'Worker 端 switchZone 也要擋下');
  const full = env('full');
  full.markZoneCleared('Icefield', full.zoneMaxStage('Icefield'));
  assert.equal(full.isZoneUnlocked('mist_forest'), true);
});

test('封魔塔：demo 超過開放樓層不能開打（扣錢之前就擋下）', () => {
  const c = env('demo');
  c.G.tower.highest = c.DEMO_TOWER_MAX_FLOOR;
  c.G.player.gold = 1e15;
  c.startTowerFight(c.DEMO_TOWER_MAX_FLOOR + 1);
  assert.equal(c.G.tower.active, false);
  assert.equal(c.G.player.gold, 1e15);
  assert.ok(c.logs.some((l) => l.includes(NOT_OPEN)));
});

test('技能法力：正式版不變，demo普通階／終極／反擊及快照共用表定倍率', () => {
  for (const edition of [undefined, 'full', 'demo']) {
    const c = env(edition), prog = { level: 999999, reinc: 2, towerHighest: 999999 };
    assert.equal(c.DEMO_SKILL_MANA_MULT, 0.5);
    const mult = edition === 'demo' ? 0.5 : 1;
    delete c.G; // UI只有快照，不能依賴Worker中的G。
    for (const [gid, group] of Object.entries(c.SKILLS2)) {
      for (const [i, tier] of group.tiers.entries()) {
        const levels = group.tiers.map((_, j) => j <= i ? 1 : 0);
        const cost = (tier.cost || 0) * 2.5 * mult;
        assert.equal(c.skills2TierManaCost(gid, i, null, prog), cost, gid + ':' + i);
        if (!c.skills2IsPassive(gid)) assert.equal(c.skills2ManaCost(gid, levels, {}, prog), cost);
        if (gid === 'counter') {
          assert.equal(c.skills2TierTriggerMp(gid, i, prog), cost);
          assert.equal(c.skills2PassiveMinMp(gid, levels, {}, prog), cost);
        }
      }
      for (const [pick, ult] of (group.ult || []).entries()) {
        const levels = group.tiers.map(() => 10), raw = { [gid]: { pick, lv: 1 } };
        const cost = (ult.cost || 0) * 2.5 * mult;
        assert.equal(c.skills2TierManaCost(gid, 0, ult.id, prog), cost);
        const active = gid === 'counter' ? c.skills2PassiveMinMp(gid, levels, raw, prog)
          : c.skills2ManaCost(gid, levels, raw, prog);
        assert.equal(active, c.skills2IsPassive(gid) && gid !== 'counter' ? 0 : cost);
      }
    }
  }
});

function prepareManaCast(c) {
  c.G.player.reincarnations = 1;
  c.G.player.skills2.levels.thrust = [1, 0, 0, 0, 0, 0, 0];
  c.SKILLS2.thrust.tiers[0].cost = 20;
  c.skills2Castable = () => true;
  c.getStats = () => ({});
  c.skills2CanReach = () => true;
  c.sgCastThrust = () => {};
  c.skills2Cooldown = () => 8;
  c.sgArmUltRepeat = () => {};
  c.rwManaCostFactor = () => 1.2;
}

test('demo施放與自動排程：轉生及符文耗魔疊乘一次，足額才起手並實際扣魔', () => {
  const c = env('demo'); prepareManaCast(c);
  const p = { hp: 100, mp: 17 }, enemy = { hp: 100 };
  assert.equal(c.castSkill2(p, [enemy], 'thrust', ''), null);
  assert.equal(p.mp, 17); assert.equal(p.skillCds, undefined);
  c.G.player.loadout = ['sg:thrust'];
  c.skillCastInProgress = () => false; c.ensureSkillReadyOrder = () => {};
  let jobs = 0; c.beginSkillCast = () => { jobs++; return { casting: true }; };
  p._skillReadyQueue = ['sg:thrust']; p._skillReadyQueued = { 'sg:thrust': true };
  assert.equal(c.pickAndCastSkill(p, [enemy], ''), null); assert.equal(jobs, 0);
  p.mp = 18;
  assert.ok(c.pickAndCastSkill(p, [enemy], '')); assert.equal(jobs, 1);
  const spent = []; c.legendaryOnManaSpent = (_p, cost) => spent.push(cost);
  assert.ok(c.castSkill2(p, [enemy], 'thrust', ''));
  assert.equal(p.mp, 0); assert.equal(p.skillCds['sg:thrust'], 8);
  assert.deepEqual(spent, [18]);
  p.mp = 17; assert.equal(c.sgAutoCastCanPay(p, 'thrust'), false);
  p.mp = 18; assert.equal(c.sgAutoCastCanPay(p, 'thrust'), true);
  c.sgAutoCastPay(p, 'thrust'); assert.equal(p.mp, 0);
  assert.deepEqual(spent, [18, 18]);
});

test('demo反擊本體與追加按減幅扣魔，免費技能／追加／零倍率及GM鎖魔保持正確', () => {
  const c = env('demo'); prepareManaCast(c);
  c.G.player.skills2.levels.counter = [1, 0, 0, 0, 0, 0, 0];
  c.SKILLS2.counter.tiers[0].cost = 20; c.SKILLS2.counter.tiers[5].cost = 40;
  const p = { hp: 100, mp: 14 };
  assert.equal(c.sgCounterPayMp(p), false); assert.equal(p.mp, 14);
  p.mp = 45;
  assert.equal(c.sgCounterPayMp(p), true); assert.equal(p.mp, 30);
  assert.equal(c.sgCounterPayMp(p, 5), true); assert.equal(p.mp, 0);
  for (const opts of [{ repeat: true }, { storm: true }]) {
    assert.ok(c.castSkill2(p, [{ hp: 100 }], 'thrust', '', opts));
    assert.equal(p.mp, 0); assert.equal(p.skillCds, undefined);
  }
  c.gmMpLockActive = () => true;
  assert.ok(c.castSkill2(p, [{ hp: 100 }], 'thrust', '')); assert.equal(p.mp, 0);
  assert.equal(c.sgCounterPayMp(p, 5), true);
  c.sgAutoCastPay(p, 'thrust'); assert.equal(p.mp, 0);
  c.gmMpLockActive = () => false;
  c.DEMO_SKILL_MANA_MULT = 0;
  assert.equal(c.skills2ManaCost('thrust'), 0);
  assert.equal(c.sgAutoCastCanPay(p, 'thrust'), true);
  assert.ok(c.castSkill2(p, [{ hp: 100 }], 'thrust', '')); assert.equal(p.mp, 0);
  c.DEMO_SKILL_MANA_MULT = 0.25;
  assert.equal(c.skills2ManaCost('thrust'), 7.5, '參數可調且保留小數，不提早取整');
  c.SKILLS2.thrust.tiers[0].cost = 0;
  assert.equal(c.skills2ManaCost('thrust'), 0);
});

test('demo技能標頭與反擊提示讀取相同快照耗魔，主執行緒無G也一致', () => {
  const c = env('demo'); prepareManaCast(c); delete c.G;
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  for (const [from, to] of [
    ['function sgUiUnlockProgress(', 'function sgUiTotalLevel('],
    ['function sgbMetaText(', '/* 未解鎖階段']
  ]) vm.runInContext(ui.slice(ui.indexOf(from), ui.indexOf(to, ui.indexOf(from))), c);
  c.SKILLS2.counter.tiers[0].cost = 20;
  const snapshot = { skills2: { levels: { thrust: [1], counter: [1] }, ult: {},
    progress: { level: 1, reinc: 1, skillUnlock: true } } };
  assert.match(c.sgbMetaText('thrust', 0, snapshot), /15 MP/);
  assert.match(c.sgbMetaText('counter', 0, snapshot), /15/);
  assert.match(c.describeSkill2Group('counter', [1], {}, snapshot.skills2.progress), /🔵15 MP/);
});

test('Demo技能法力參數可由Excel匯出並經具名錨點調整，試跑不寫入遊戲', () => {
  const os = require('node:os'), { execFileSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-mana-'));
  const csv = path.join(dir, 'game_parameters.csv');
  const dataBefore = fs.readFileSync(path.join(root, 'js/data.js'));
  try {
    execFileSync(process.execPath, ['tools/xlsx_to_csv.cjs'], {
      cwd: root, env: { ...process.env, PARAMS_CSV_OUT: csv }
    });
    const source = fs.readFileSync(csv, 'utf8');
    // The exporter uses CRLF, while .gitattributes stores the CSV with LF.
    assert.ok(source.endsWith('\r\n'));
    assert.doesNotMatch(source.replaceAll('\r\n', ''), /[\r\n]/);
    const tracked = fs.readFileSync(path.join(root, 'config/CSV/game_parameters.csv'), 'utf8');
    assert.deepEqual(Buffer.from(source.replaceAll('\r\n', '\n')), Buffer.from(tracked.replaceAll('\r\n', '\n')));
    const row = source.split(/\r?\n/).find(line => line.startsWith('380,'));
    const cells = row.split(',');
    assert.equal(cells[2], '11-Demo版');
    assert.equal(cells[3], 'Demo 技能法力消耗倍率');
    assert.equal(Number(cells[6]), 0.5);
    cells[6] = '0.25'; fs.writeFileSync(csv, source.replace(row, cells.join(',')));
    const output = execFileSync(process.execPath, ['tools/apply_params.cjs'], {
      cwd: root, encoding: 'utf8', env: { ...process.env, PARAMS_CSV: csv }
    });
    assert.match(output, /將變更 1、錨點問題 0/);
    assert.match(output, /DEMO_SKILL_MANA_MULT：0\.5 → 0\.25/);
    assert.deepEqual(fs.readFileSync(path.join(root, 'js/data.js')), dataBefore);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('真Worker技能面板及讀檔使用demo倍率，法力上限與正式版消耗不受影響', () => {
  const { createEngine } = require('../scripts/sim/engine.js');
  const full = createEngine({ seed: 20261124 }).boot(null);
  const demo = createEngine({ seed: 20261124 }).boot(null);
  demo.ctx.GAME_EDITION = 'demo'; // 模擬桌面外殼提供的版本旗標。
  const fullCost = full.ctx.skills2ManaCost('knife');
  assert.equal(demo.ctx.skills2ManaCost('knife'), fullCost * 0.5);
  assert.equal(demo.ctx.getStats().mp, full.ctx.getStats().mp);
  const panel = demo.panel('skills').skills2;
  assert.equal(demo.ctx.skills2ManaCost('knife', panel.levels.knife, panel.ult, panel.progress), fullCost * 0.5);
  const restored = createEngine({ seed: 20261124 }).boot(JSON.parse(demo.saveJson()));
  restored.ctx.GAME_EDITION = 'demo';
  assert.equal(restored.ctx.skills2ManaCost('knife'), fullCost * 0.5);
  restored.ctx.GAME_EDITION = 'full';
  assert.equal(restored.ctx.skills2ManaCost('knife'), fullCost);
});
