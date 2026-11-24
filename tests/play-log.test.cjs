'use strict';
/* 真人遊玩記錄（docs/PLAY_LOG.md）：
   - electron/play-log.cjs：依日期分檔追加、單行與單批上限、存檔副本 gzip 與保留份數
   - js/play-log.js：只在 ApexHost.playLog 回 enabled 時啟用；操作、日誌、狀態取樣、存檔副本
   端到端那段的 ApexHost.playLog 直接接到 play-log.cjs、寫進暫存資料夾——中間只少了 IPC。 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');
const PlayLogHost = require('../electron/play-log.cjs');

const root = path.resolve(__dirname, '..');
const FIXED = new Date(2026, 10, 24, 9, 5, 7);

function tempDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'idle-rpg-playlog-')); }
function readLines(dir) {
  const f = path.join(dir, 'play_2026-11-24.jsonl');
  return fs.readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
}

/* ---- 主行程端 ---- */

test('append：依本機日期分檔追加；含換行的行拒收；超長行換成截斷說明', () => {
  const dir = tempDir();
  const h = PlayLogHost.create(dir, { now: () => FIXED });
  assert.equal(h.append(['{"a":1}', 'bad\nline', 42, '{"b":2}']), 2);
  h.append([JSON.stringify({ big: 'x'.repeat(PlayLogHost.MAX_LINE_BYTES + 10) })]);
  const lines = readLines(dir);
  assert.deepEqual(lines.slice(0, 2), [{ a: 1 }, { b: 2 }]);
  assert.equal(lines[2].k, 'truncated');
  assert.equal(h.status().dropped, 3);
  assert.throws(() => h.append('x'));
  assert.throws(() => h.append(new Array(PlayLogHost.MAX_BATCH_LINES + 1).fill('{}')));
});

test('writeSave：檔名由主行程產生、內容 gzip、只留最新幾份', () => {
  const dir = tempDir();
  let sec = 0;
  const h = PlayLogHost.create(dir, { now: () => new Date(2026, 10, 24, 9, 0, sec++), keepSaves: 2 });
  const names = [1, 2, 3].map((lv) => h.writeSave(JSON.stringify({ lv }), { level: lv + 0.7 }));
  assert.equal(names[0], '20261124-090000_lv1.json');
  const left = fs.readdirSync(path.join(dir, 'saves')).sort();
  assert.deepEqual(left, names.slice(1));
  const buf = fs.readFileSync(path.join(dir, 'saves', names[2]));
  assert.deepEqual(JSON.parse(zlib.gunzipSync(buf).toString()), { lv: 3 });
  assert.equal(h.writeSave('{}', { level: '../../x' }).endsWith('_lv0.json'), true);
  assert.throws(() => h.writeSave(''));
  assert.throws(() => h.writeSave({}));
});

/* ---- 遊戲端 ---- */

function loadGame(opts) {
  const handlers = {};
  let intervals = 0;
  const ctx = {
    console: { info() {}, warn() {}, error() {} },
    Promise, JSON, Date, Math, Object, String, Number, Array, RegExp,
    setInterval() { intervals++; return 1; },
    MSG_OUT: { TICK: 'tick', ACK: 'ack', BOOTED: 'booted', PERSIST: 'persist' },
    PERSIST_KINDS: { AUTO: 'auto', FOLDER: 'folder', MANUAL: 'manual', RESTART: 'restart' },
    WORKER_PROTOCOL_VERSION: 99,
    GAME_EDITION: 'full',
    WorkerBridge: { on(type, fn) { (handlers[type] = handlers[type] || []).push(fn); } },
    window: opts.host === undefined ? {} : { ApexHost: { playLog: opts.host }, addEventListener() {} }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/play-log.js'), 'utf8') + '\nthis.PlayLog = PlayLog;', ctx);
  const fire = (type, msg) => (handlers[type] || []).forEach((fn) => fn(msg));
  return { PlayLog: ctx.PlayLog, fire, handlers, intervals: () => intervals };
}

function hostFor(dir, enabled) {
  const h = PlayLogHost.create(dir, { now: () => FIXED });
  return {
    status: async () => (enabled ? h.status() : { enabled: false }),
    append: (lines) => h.append(lines),
    save: async (json, meta) => h.writeSave(json, meta)
  };
}

const settle = () => new Promise((r) => setImmediate(r));

test('網頁版（沒有 ApexHost）：完全不啟用、不訂閱任何訊息', () => {
  const g = loadGame({});
  assert.equal(g.PlayLog.active(), false);
  assert.deepEqual(Object.keys(g.handlers), []);
});

test('一般桌面版（status 回 enabled:false）：停用且不寫檔', async () => {
  const dir = tempDir();
  const g = loadGame({ host: hostFor(dir, false) });
  g.fire('booted', { protocolVersion: 99 });
  await settle();
  assert.equal(g.PlayLog.active(), false);
  g.PlayLog.onSend(1, 'stage.go', { delta: 1 });
  g.fire('ack', { id: 1, ok: true });
  g.PlayLog.flush();
  assert.equal(fs.existsSync(path.join(dir, 'play_2026-11-24.jsonl')), false);
});

test('內測桌面版：操作、日誌、計數、狀態取樣、存檔副本都落地', async () => {
  const dir = tempDir();
  const g = loadGame({ host: hostFor(dir, true) });
  /* 開機訊息比 status() 回覆早到：要暫存起來，不能漏 */
  g.fire('booted', { protocolVersion: 99, offlineSummary: { sec: 120 } });
  await settle();
  assert.equal(g.PlayLog.active(), true);

  g.fire('tick', { view: { gt: 10, level: 5, stage: 3, zone: 'desert' }, events: [
    { kind: 'log', cat: 'combat', cls: 'log-kill', msg: '💀 擊敗 史萊姆' },
    { kind: 'log', cat: 'combat', cls: 'log-kill', msg: '💀 擊敗 史萊姆' },
    { kind: 'log', cat: 'combat', cls: 'log-enemy-damage', msg: '🛡️ 史萊姆 攻擊你' },
    { kind: 'log', cat: 'loot', cls: 'good', msg: '📦 戰利品：💰10' },
    { kind: 'log', cat: '', cls: '', msg: '🔪 你施放【飛刀 Lv12】' },
    { kind: 'flog', cls: 'good', msg: '⚒️ 分解 [普通] 普通級赤砂' },
    { kind: 'log', cat: '', cls: 'bad', msg: '☠️ 你被擊倒了…<b>退回</b>第 2 階段' },
    { kind: 'float', text: '123' }
  ] });
  g.PlayLog.onSend(7, 'stage.go', { delta: 1 });
  g.PlayLog.onSend(8, 'item.equip', { itemId: 'x' });
  g.fire('ack', { id: 7, ok: true });
  g.fire('ack', { id: 8, ok: false, error: '等級不足' });
  g.fire('ack', { id: 999, ok: true });          // 記錄器啟用前送出的指令：沒有對應資料，略過
  g.fire('tick', { view: { gt: 75, level: 6, stage: 4, zone: 'desert' }, events: [] });

  g.fire('persist', { kind: 'auto', payload: { json: '{"player":{"level":6}}', meta: { level: 6, zone: 'desert', stage: 4 } } });
  await settle(); await settle();
  g.fire('persist', { kind: 'auto', payload: { json: '{"again":1}', meta: { level: 6 } } });   // 15 分鐘內：不再複製
  g.fire('persist', { kind: 'manual', payload: { json: '{}', meta: { level: 6, zone: 'desert', stage: 4 } } });
  await settle();
  g.PlayLog.flush();

  const lines = readLines(dir);
  const kinds = lines.map((l) => l.k);
  assert.equal(kinds[0], 'session');
  assert.equal(lines[0].protocol, 99);
  assert.deepEqual(lines[1], Object.assign({}, lines[1], { k: 'boot', offline: { sec: 120 } }));

  const logs = lines.filter((l) => l.k === 'log');
  assert.deepEqual(logs.map((l) => l.msg), ['☠️ 你被擊倒了…退回第 2 階段']);

  const cmds = lines.filter((l) => l.k === 'cmd');
  assert.deepEqual(cmds.map((c) => [c.name, c.ok, c.err]), [['stage.go', true, undefined], ['item.equip', false, '等級不足']]);
  assert.deepEqual(cmds[0].args, { delta: 1 });
  assert.equal(cmds[0].gt, 10);

  const snaps = lines.filter((l) => l.k === 'snap');
  assert.equal(snaps.length, 2, '第一則 tick 與跨過 60 遊戲秒時各一筆');
  assert.deepEqual(snaps[0].counts, { kill: 2, hitTaken: 1, loot: 1, salvage: 1 });
  assert.deepEqual(snaps[0].casts, { '飛刀': 1 });
  assert.equal(snaps[1].v.level, 6);
  assert.deepEqual(snaps[1].counts, {}, '計數在每筆 snap 之後歸零');

  const saves = lines.filter((l) => l.k === 'save');
  assert.equal(saves.length, 1);
  const saved = fs.readFileSync(path.join(dir, 'saves', saves[0].file));
  assert.deepEqual(JSON.parse(zlib.gunzipSync(saved).toString()), { player: { level: 6 } });
  assert.deepEqual(lines.filter((l) => l.k === 'persist').map((l) => l.kind), ['manual']);
  assert.ok(lines.every((l) => typeof l.t === 'number'));
});

test('bridge.send 會呼叫記錄器鉤子；index.html 把它排在 bridge 之後、main 之前', () => {
  const bridge = fs.readFileSync(path.join(root, 'js/bridge.js'), 'utf8');
  assert.match(bridge, /PlayLog\.active\(\)\)\s*\{\s*PlayLog\.onSend\(id, name, args\)/);
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const at = (re) => html.search(re);
  assert.ok(at(/js\/bridge\.js\?/) < at(/js\/play-log\.js\?/));
  assert.ok(at(/js\/play-log\.js\?/) < at(/js\/main\.js\?/));
});
