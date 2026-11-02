/* GM 測試場景 test_map（2026-11-02）
   用來逐隻檢查 NPC 外觀與動作的空場景。守住：
     1. 指令進出：NPC 表全部＋封魔塔 BOSS 擺進場，從原點朝上／下／左每 12 米一隻（右邊留空），off 清場
     2. 被動怪：沒被打不索敵、不攻擊；被打（血量下降）之後才醒來
     3. 我方只聽點擊：沒有目標就不動；點地面走過去、點怪走到近戰距離
     4. 死亡後原位重生，而且重生的是新的被動怪 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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

test('test_map：NPC 表全部＋封魔塔 BOSS，朝上／下／左每 12 米一隻，off 清場', () => {
  const c = loadContext();
  const res = c.executeGMCommand('test_map');
  assert.equal(res.ok, true, res.message);
  const expected = run(c, 'Object.keys(NPC_CONFIG_TABLE).length + BOSS_LIST.length');
  const list = run(c, 'fieldEnemyList()');
  assert.equal(list.length, expected, '每個 NPC 識別碼一隻（含 10 個塔 BOSS）');
  assert.equal(run(c, 'FIELD._testMap && FIELD._gmArena'), true);
  assert.equal(c.GM_TEST.god, true, '被動怪被打會還擊，測試期間鎖血');

  const step = run(c, 'bfMeterPx(12)');
  const ids = new Set();
  list.forEach((e, i) => {
    const arm = i % 3, k = Math.floor(i / 3) + 1;
    const want = [{ x: 0, y: -1 }, { x: 0, y: 1 }, { x: -1, y: 0 }][arm];
    assert.deepEqual({ x: e.pos.x, y: e.pos.y }, { x: want.x * step * k, y: want.y * step * k }, '第 ' + i + ' 隻站位');
    assert.ok(e.pos.x <= 0, '右邊（角色面向的前方）不擺');
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
  // 玩家就站在原點、離牠 120 單位：視野幾乎為零，不算發現
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

  const target = run(c, 'fieldEnemyList()[2]');   // 左邊第一隻（-120, 0）
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
