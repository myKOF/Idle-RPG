/* 裝備快照頁籤上「三套裝備各自的用途」：來源是策略的切套規則（equipSetSwitch），
   由 scripts/sim/equip_set_roles.js 算好寫進 run_summary.equipSetRoles，儀表板照著標。 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { equipSetRoles } = require(path.join(ROOT, 'scripts/sim/equip_set_roles.js'));

test('依 home 與 encounter 推出每套的用途，同一套的多個用途依固定順序', () => {
  const pol = { rules: [{ id: 'x' }, { equipSetSwitch: { home: 0, encounter: { elite: 2, tower: 1, boss: 1 } } }] };
  assert.deepEqual(equipSetRoles(pol), { 0: ['field'], 1: ['boss', 'tower'], 2: ['elite'] });
  assert.deepEqual(equipSetRoles({ rules: [{ equipSetSwitch: { encounter: { boss: 0 } } }] }), { 0: ['field', 'boss'] });
  assert.equal(equipSetRoles({ rules: [] }), null, '沒有切套規則就不標');
  assert.equal(equipSetRoles(null), null);
});

test('現有每一份策略都推得出三套用途，且每套至少一個用途', () => {
  const dir = path.join(ROOT, 'scripts/sim');
  const files = fs.readdirSync(dir).filter((f) => /^policy\..+\.json$/.test(f));
  assert.ok(files.length >= 7);
  for (const f of files) {
    const roles = equipSetRoles(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
    assert.ok(roles, f + ' 沒有切套規則');
    assert.ok(roles[0] && roles[0].includes('field'), f + ' 第 1 套應該是練功');
    for (const k of Object.keys(roles)) assert.ok(roles[k].length > 0, f);
  }
});

test('run_sim 寫進摘要、儀表板頁籤讀出來並在舊資料時退回讀策略檔', () => {
  const runSim = fs.readFileSync(path.join(ROOT, 'scripts/run_sim.js'), 'utf8');
  assert.match(runSim, /equipSetRoles: TRACE_PATH \? null : equipSetRoles\(/);
  const page = fs.readFileSync(path.join(ROOT, 'monte_carlo_app.html'), 'utf8');
  assert.match(page, /loadEquipSetRoles\(summary\)/);
  assert.match(page, /equipSetRoleText\(i\)/);
});

test('遊戲快照視窗有 seed 下拉選單：與主畫面的檢視對象同一份選項、互相同步，切換後重畫快照', () => {
  const page = fs.readFileSync(path.join(ROOT, 'monte_carlo_app.html'), 'utf8');
  assert.match(page, /<select id="snapSeedSelect" onchange="onSnapSeedChange\(\)">/);
  assert.match(page, /snapSel\.innerHTML = sel\.innerHTML;/, '選項沿用主畫面那一份');
  assert.match(page, /async function onSnapSeedChange\(\)[\s\S]*?await onBatchSeedChange\(\);[\s\S]*?openEquipmentSnapshotModal\(\);/);
  assert.match(page, /if \(snapSel\) snapSel\.value = sel\.value;/, '主畫面切換時同步快照選單');
});

test('分頁／工作列標題顯示模擬進度：進度放最前面，獨立輪詢（重新整理後也會動）', () => {
  const page = fs.readFileSync(path.join(ROOT, 'monte_carlo_app.html'), 'utf8');
  assert.match(page, /\(function simTitleProgress\(\) \{/);
  assert.match(page, /document\.title = `\$\{pct\}% ⏳ 模擬中\$\{batchPart\}｜\$\{BASE_TITLE\}`/);
  assert.match(page, /setInterval\(poll, 2000\)/);
});
