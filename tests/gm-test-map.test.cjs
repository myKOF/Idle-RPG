/* GM 測試場景 test_map（2026-11-02）
   用來逐隻檢查 NPC 外觀與動作的空場景。守住：
     1. 指令進出：NPC 表全部＋封魔塔 BOSS 擺進場，從原點依場景向右分列、逐列向上，間隔 20 米，off 清場
     2. 被動怪：沒被打不索敵、不攻擊；被打（血量下降）之後才醒來
     3. 我方只聽點擊：沒有目標就不動；點地面走過去、點怪走到近戰距離
     4. 死亡後原位重生，而且重生的是新的被動怪 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { extractFunction, fakePixi } = require('./helpers/battle-scene.cjs');
const { createEngine } = require('../scripts/sim/engine');

const root = path.resolve(__dirname, '..');

function loadContext() {
  const context = {
    console,
    Math: Object.create(Math),
    setTimeout() {}, clearTimeout() {},
    document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } },
    location: { hostname: 'localhost' },
    UI: { dirty: {} },
    blog() {}, floatText() {}, trackDps() {}, recordRunDamage() {}
  };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/strings_data.js', 'js/strings.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js',
    'js/combat.js', 'js/skills.js', 'js/skills2.js', 'js/gm_exec.js']
    .forEach((file) => vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file }));
  context.G = {
    player: { gold: 0, level: 1000, skills2: { levels: {} }, loadout: [] },
    stage: { current: 1, zone: 'desert' },
    tower: { active: false }
  };
  vm.runInContext('FIELD.player = { hp: 100, mp: 100, shield: 0, atkCd: 0, skillCds: {}, buffs: {}, dots: [], effects: {} };', context);
  return context;
}
const run = (c, code) => vm.runInContext(code, c);

test('test_map：NPC 表全部＋封魔塔 BOSS，依場景向右分列、逐列向上每 20 米一隻，off 清場', () => {
  const c = loadContext();
  const res = c.executeGMCommand('test_map');
  assert.equal(res.ok, true, res.message);
  /* 封魔塔 BOSS 每關一列（50 列），場景只放外觀不同的：同名稱＋圖像＋模型只取第一隻 */
  const towerIds = Array.from(run(c, "(function(){var s={};return BOSS_LIST.filter(function(b){var k=b.name+'|'+(b.img||'')+'|'+((b.model3d&&b.model3d.file)||'');if(s[k])return false;s[k]=1;return true;}).map(function(b){return b.id;});})()"));
  assert.equal(towerIds.length, 10);
  const expected = run(c, 'Object.keys(NPC_CONFIG_TABLE).length') + towerIds.length;
  const list = run(c, 'fieldEnemyList()');
  assert.equal(list.length, expected, '每個 NPC 識別碼一隻（塔 BOSS 每種外觀一隻）');
  assert.equal(run(c, 'FIELD._testMap && FIELD._gmArena'), true);
  assert.equal(c.GM_TEST.god, true, '被動怪被打會還擊，測試期間鎖血');

  const step = run(c, 'bfMeterPx(20)');
  const rows = run(c, 'ZONE_LIST.map(k => ZONES[k].pool.map(mt => mt.id))');
  const seen = new Set();
  const groups = [...rows, run(c, 'Object.keys(NPC_CONFIG_TABLE)'), towerIds]
    .map(row => Array.from(row).filter(id => {
      if (seen.has(id)) return false;
      seen.add(id); return true;
    })).filter(row => row.length);
  const positions = new Map();
  groups.forEach((row, r) => row.forEach((id, col) => positions.set(id, { x: col * step, y: r ? -r * step : 0 })));
  const ids = new Set();
  list.forEach((e, i) => {
    assert.deepEqual({ x: e.pos.x, y: e.pos.y }, positions.get(e.npcId), '第 ' + i + ' 隻站位：' + e.npcId);
    assert.equal(e._passive, true);
    assert.equal(e._alerted, false);
    assert.equal(e._enterCd, 0, '立即可被打，不走進場動畫');
    ids.add(e.npcId);
  });
  assert.equal(ids.size, expected, 'npcId 不重複');
  for (let n = 1; n <= 10; n++) assert.ok(ids.has('tower_boss_' + n), '塔 BOSS tower_boss_' + n);
  const towerBoss = list.find((e) => e.npcId === 'tower_boss_1');
  assert.equal(towerBoss.isBoss, true);
  assert.ok(towerBoss.img, '塔 BOSS 帶圖檔欄位');

  const off = c.executeGMCommand('test_map off');
  assert.equal(off.ok, true);
  assert.equal(run(c, 'FIELD._testMap'), false);
  assert.equal(run(c, 'FIELD._gmArena'), false);
  assert.equal(run(c, 'fieldEnemyList().length'), 0);
  assert.equal(c.GM_TEST.god, false);
});

test('test_map：被動怪沒被打就不索敵；血量下降後才醒來', () => {
  const c = loadContext();
  c.executeGMCommand('test_map');
  const e = run(c, 'fieldEnemyList()[0]');
  assert.deepEqual({ x: e.pos.x, y: e.pos.y }, { x: 0, y: 0 }, '第一隻與玩家都在原點');
  // 原點重疊與走近都不能喚醒被動怪
  assert.equal(run(c, 'bfEnemyAlerted(fieldEnemyList()[0])'), false);
  run(c, 'testMapTick()');
  assert.equal(e._alerted, false, '沒被打就維持被動');
  e.hp -= 1;
  run(c, 'testMapTick()');
  assert.equal(e._alerted, true, '被打之後醒來');
  assert.equal(run(c, 'bfEnemyAlerted(fieldEnemyList()[0])'), true);
  // 沒被打的其他怪仍然是被動
  assert.equal(run(c, 'fieldEnemyList()[1]._alerted'), false);
});

test('test_map：空場景不留空列、重複NPC只放首次場景，未歸圖NPC與塔BOSS接續分列', () => {
  const c = loadContext();
  run(c, `ZONE_LIST = ['empty', 'a', 'b'];
    var types = Object.values(NPC_CONFIG_TABLE);
    ZONES = { empty: { pool: [] }, a: { pool: [types[0], types[1]] }, b: { pool: [types[1], types[2]] } };`);
  const entries = run(c, 'testMapNpcList()');
  const where = Array.from(entries, e => [e.row, e.col]);
  assert.deepEqual(where.slice(0, 5), [[0, 0], [0, 1], [1, 0], [2, 0], [2, 1]]);
  const tower = entries.filter(e => e.tower >= 0);
  assert.equal(tower.length, 10);
  assert.ok(tower.every((e, i) => e.row === 3 && e.col === i && e.tower === i));
  assert.equal(new Set(entries.map(e => e.mt.id)).size, entries.length);
});

test('test_map：正式makeEnemy尺寸與原地圖普通NPC及塔戰BOSS一致，不受排列或測試旗標影響', () => {
  const c = loadContext();
  ['js/elite.js', 'js/tower.js'].forEach(file => run(c, fs.readFileSync(path.join(root, file), 'utf8')));
  c.executeGMCommand('test_map');
  const source = fs.readFileSync(path.join(root, 'js/battle-renderer.js'), 'utf8');
  Object.assign(c, { PIXI: fakePixi, S: { sheets: {}, layers: { entity: new fakePixi.Container() } },
    playerPos: () => ({ x: 0, y: 0 }), npcSpriteDef: () => null,
    densityScale: () => 0.75, cellSize: () => ({ w: 60, h: 50 }),
    makeMobBody: (data, scale) => { const body = new fakePixi.Sprite({}); body.scale.set(scale); return body; },
    enemyNameText: data => data.name, nowMs: () => 0, posTrack() {}, groundToScreenY: y => y,
    syncNpcRankGlow() {}, applyEntityBillboard() {}, drawHpBar() {}, requestNpcSheet() {}, requestMobImage() {} });
  run(c, extractFunction(source, 'enemyLayout') + '\n' + extractFunction(source, 'makeEnemy'));
  const entries = run(c, 'testMapNpcList()');
  entries.forEach((entry, i) => {
    const preview = run(c, 'fieldEnemyList()')[i];
    c.entry = entry;
    const original = entry.tower >= 0 ? run(c, 'makeBoss(entry.tower + 1)') :
      run(c, 'makeFieldEnemy(entry.mt, monsterStatsFor(1, false, false), currentZoneDef(), 1)');
    const shown = c.makeEnemy(preview);
    c.S.testMap = false;
    const reference = c.makeEnemy(original);
    c.S.testMap = true;
    assert.equal(shown.visScale, reference.visScale, entry.mt.id + '配置倍率／階級體型');
    assert.equal(shown.body.scale.y, reference.body.scale.y, entry.mt.id + '本體縮放');
    assert.equal(shown.hitHeight, reference.hitHeight, entry.mt.id + '本體高度');
  });
});

test('test_map：連續Tick大型塔BOSS也保持十五米排位，受擊後仍可追擊', () => {
  const c = loadContext();
  run(c, fs.readFileSync(path.join(root, 'js/elite.js'), 'utf8'));
  c.executeGMCommand('test_map');
  const enemies = run(c, 'fieldEnemyList()');
  const positions = Array.from(enemies, e => ({ x: e.pos.x, y: e.pos.y }));
  for (let i = 0; i < 100; i++) run(c, 'testMapTick(); bfTickApproach(fieldEnemyList(), 0.1)');
  enemies.forEach((e, i) => {
    assert.deepEqual({ x: e.pos.x, y: e.pos.y }, positions[i], e.npcId + '待機不移位');
    assert.equal(e._alerted, false);
  });
  const last = enemies[enemies.length - 1]; last.hp -= 1;
  run(c, 'testMapTick(); bfTickApproach(fieldEnemyList(), 0.1)');
  assert.equal(last._alerted, true);
  assert.notDeepEqual({ x: last.pos.x, y: last.pos.y }, positions[positions.length - 1], '受擊後照常追擊');
});

test('test_map：沒有點擊目標就不動；點地面走過去；點怪走到近戰距離', () => {
  const c = loadContext();
  c.executeGMCommand('test_map');
  const home = run(c, 'bfPlayerPos()');
  assert.equal(run(c, 'testMapMovePlayer(FIELD.player, 0.1)'), false, '沒有目標不自動索敵也不往前推進');
  assert.deepEqual({ x: home.x, y: home.y }, { x: 0, y: 0 });

  assert.equal(c.executeGMCommand('test_map_move 300 200').ok, true);
  for (let i = 0; i < 60; i++) run(c, 'testMapMovePlayer(FIELD.player, 0.1)');
  assert.ok(Math.hypot(home.x - 300, home.y - 200) < 1, '走到點擊的地面座標');
  assert.equal(run(c, 'TEST_MAP_RT.move'), null, '到了就清掉目的地');

  const target = run(c, 'fieldEnemyList()[2]');
  assert.equal(c.executeGMCommand('test_map_atk ' + target.floatSel).ok, true);
  for (let i = 0; i < 80; i++) run(c, 'testMapMovePlayer(FIELD.player, 0.1)');
  assert.equal(run(c, 'bfPlayerCanReach(TEST_MAP_RT.target)'), true, '走到近戰距離');

  assert.equal(c.executeGMCommand('test_map_atk no-such-id').ok, false);
  c.executeGMCommand('test_map off');
  assert.equal(c.executeGMCommand('test_map_move 1 1').ok, false, '離開測試場景後內部指令不再生效');
});

test('test_map：死亡後過幾秒原位重生，重生的是新的被動怪', () => {
  const c = loadContext();
  c.executeGMCommand('test_map');
  run(c, 'GT = 100');
  const old = run(c, 'fieldEnemyList()[3]');
  const where = { x: old.pos.x, y: old.pos.y };
  old.hp = 0; old._rewarded = true;
  run(c, 'testMapTick()');
  assert.equal(run(c, 'fieldEnemyList().indexOf(TEST_MAP_RT.slots[3].ent) >= 0'), true, '屍體還在，尚未重生');
  assert.equal(run(c, 'TEST_MAP_RT.slots[3].ent') === old, true);
  run(c, 'GT = 100 + TEST_MAP_RESPAWN_SEC + 0.1');
  run(c, 'testMapTick()');
  const fresh = run(c, 'TEST_MAP_RT.slots[3].ent');
  assert.notEqual(fresh, old);
  assert.ok(fresh.hp > 0);
  assert.equal(fresh._alerted, false);
  assert.deepEqual({ x: fresh.pos.x, y: fresh.pos.y }, where);
  const list = run(c, 'fieldEnemyList()');
  assert.equal(list.indexOf(old), -1, '舊屍體一併移走');
  assert.ok(list.indexOf(fresh) >= 0);
  assert.ok(fresh.floatSel, '重生的怪拿到顯示層用的 id');
});

test('test_map：封魔塔戰鬥中不可進入；演武場指令會離開測試場景', () => {
  const c = loadContext();
  c.G.tower.active = true;
  assert.equal(c.executeGMCommand('test_map').ok, false);
  c.G.tower.active = false;
  assert.equal(c.executeGMCommand('test_map').ok, true);
  assert.equal(c.executeGMCommand('spawn 2').ok, true);
  assert.equal(run(c, 'FIELD._testMap'), false);
});

test('真Worker：同圖返回／換圖／切關／GM跳關與off均清除測試旗標並恢復自然出怪', () => {
  const actions = [
    ['同圖', c => c.switchZone('god_chaos')],
    ['換圖', c => c.switchZone('god_battlefield')],
    ['切關', c => c.stageGo(-1)],
    ['最高關', c => c.stageGoMax()],
    ['GM跳關', c => assert.equal(c.executeGMCommand('stage_jump god_chaos 309').ok, true)],
    ['test_map off', c => c.executeGMCommand('test_map off')],
    ['spawn off', c => c.executeGMCommand('spawn off')]
  ];
  for (const [label, leave] of actions) {
    const engine = createEngine({ seed: 8 }).boot(null), c = engine.ctx;
    assert.equal(c.executeGMCommand('stage_jump god_chaos 309').ok, true);
    c.G.stage.autoAdvance = false; c.G.stage.best = 499;
    c.GM_TEST.hpLock = true; c.executeGMCommand('damage 0');
    c.executeGMCommand('test_map');
    const testIds = new Set(c.fieldEnemyList().map(e => e.floatSel));
    c.testMapSetTarget(c.fieldEnemyList()[1].floatSel);
    leave(c);
    assert.equal(c.FIELD._testMap, false, label);
    assert.equal(c.FIELD._gmArena, false, label);
    assert.equal(c.GM_TEST.god, false, label);
    assert.equal(c.TEST_MAP_RT.slots.length, 0, label);
    assert.equal(c.TEST_MAP_RT.target, null, label);
    assert.equal(c.TEST_MAP_RT.move, null, label);
    engine.stepSeconds(c.FIELD_STAGE_SWITCH_DELAY + 1);
    assert.ok(c.fieldEnemyList().some(e => e.hp > 0), label + '自然出怪恢復');
    assert.ok(c.fieldEnemyList().every(e => !testIds.has(e.floatSel) && !e._passive), label + '不再生成測試NPC');
  }
});

test('test_map：非法／未解鎖切換不退出，直接返回不修改場景進度與玩家設定', () => {
  const engine = createEngine({ seed: 3 }).boot(null), c = engine.ctx;
  c.executeGMCommand('test_map');
  c.switchZone('no-zone'); c.switchZone('god_sanctuary'); c.stageGo(-1);
  assert.equal(c.executeGMCommand('stage_jump no-zone 309').ok, false);
  assert.equal(c.executeGMCommand('stage_jump desert 9999').ok, false);
  assert.equal(c.FIELD._testMap, true); assert.equal(c.GM_TEST.god, true);
  const before = JSON.stringify({ stage: c.G.stage, progress: c.G.zoneProgress, equipment: c.G.equipment });
  c.switchZone('desert');
  assert.equal(JSON.stringify({ stage: c.G.stage, progress: c.G.zoneProgress, equipment: c.G.equipment }), before);
  assert.equal(c.FIELD._testMap, false);
  c.GM_TEST.god = true; c.gmArenaOff();
  assert.equal(c.GM_TEST.god, true, '非測試模式不關閉玩家自行開啟的god');
});
