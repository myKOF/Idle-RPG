'use strict';
/* 技能音效（2026-11-06）：Skills2 音效欄 → spec.sfx → Sfx 播放。見 docs/BATTLE_SOUND.md「技能音效」。 */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), vm = require('vm'), path = require('path');
const { readExpanded } = require('./helpers/str-expand.cjs');
const synth = require('../js/sfx-synth.js');
const vfx = require('../tools/skills2-vfx.cjs');
const plain = x => JSON.parse(JSON.stringify(x));
function context() {
  const c = vm.createContext({ console, Math });
  vm.runInContext(readExpanded('js/skills2.js'), c);
  c.skills2Levels = () => [1, 1, 1, 1, 1, 1, 1]; c.skills2Ult = () => null;
  return c;
}
function eachRow(SKILLS2, fn) {
  for (const gid of Object.keys(SKILLS2)) {
    const g = SKILLS2[gid];
    (g.tiers || []).forEach((t, i) => fn(gid, String(i + 1), t));
    (g.ult || []).forEach(u => fn(gid, u.id, u));
  }
}

test('配方登記表：每個音效都有合成函式與合法類型', () => {
  const ids = synth.ids();
  assert.ok(ids.length >= 50, '音效數量 ' + ids.length);
  for (const id of ids) {
    const d = synth.def(id);
    assert.equal(typeof d.fn, 'function', id);
    assert.ok(['oneshot', 'flight', 'loop'].includes(d.kind), id + ' kind=' + d.kind);
    assert.ok(d.gain > 0, id);
    assert.match(id, /^[a-z][a-z0-9-]*$/, '音效 id 只用小寫與連字號：' + id);
  }
});

test('Skills2 填的音效名稱全部登記過，觸發音效只出現在有接線的角色', () => {
  const c = context(), ids = new Set(synth.ids());
  let body = 0, trig = 0;
  eachRow(c.SKILLS2, (gid, stage, row) => {
    for (const [role, id] of Object.entries(row.sfx || {})) { body++; assert.ok(ids.has(id), gid + '/' + stage + ' ' + role + '=' + id); }
    const ev = vfx.event(gid, stage);
    for (const [role, id] of Object.entries(row.triggerSfx || {})) {
      trig++;
      assert.ok(ids.has(id), gid + '/' + stage + ' trigger ' + role + '=' + id);
      assert.ok(ev && ev.roles.includes(role), gid + '/' + stage + ' 觸發音效角色 ' + role + ' 未接線');
    }
  });
  assert.ok(body >= 30 && trig >= 30, '本體 ' + body + '／觸發 ' + trig);
});

test('23 種玩家技能都有主音效（本體欄或施放音效）', () => {
  const c = context();
  const groups = Object.keys(c.SKILLS2);
  assert.equal(groups.length, 23);
  for (const gid of groups) {
    const has = (c.SKILLS2[gid].tiers || []).some(t => t.sfx && Object.keys(t.sfx).length);
    assert.ok(has, gid + ' 沒有主音效');
  }
});

test('音效解析與特效同規則：本體逐階繼承、觸發只讀本列、指定角色表時只留那幾個角色', () => {
  const c = context();
  // 火球：第 1 階本體攻擊音效沿用到第 5 階的爆燃
  c.skills2Levels = () => [1, 1, 1, 1, 1, 0, 0];
  assert.equal(c.sgSfxRoles('fireball', { vfxTier: 5 }).attack, 'fireball');
  // 第 7 階引入隕石飛行／砸地；指定 vfxRoles 時只留下有特效的角色
  assert.deepEqual(plain(c.sgSfxRoles('fireball', { vfxTier: 7, vfxRoles: { projectile: 'proj-meteor-inferno' } })), { projectile: 'meteor-fly' });
  // 觸發列：只讀本列，不繼承本體
  assert.deepEqual(plain(c.sgSfxRoles('gale', { vfxUlt: 'thunderGodSlash' })), { attack: 'thunderstrike' });
  // 毒霧感染（中毒每跳機率觸發）：持續傷害每次作用不發聲，觸發列留白也不退回本體的血刃斬音效
  assert.deepEqual(plain(c.sgSfxRoles('bloodblade', { vfxTier: 5 })), {});
  assert.deepEqual(plain(c.sgSfxRoles('bloodblade', { vfxUlt: 'venomDomain' })), {});
  // vfxBase：觸發列被要求走本體時，回到本體繼承鏈
  assert.equal(c.sgSfxRoles('bloodblade', { vfxTier: 5, vfxBase: true }).attack, 'bloodblade');
  // 呼叫端指定的外觀與目前階不同（火球分裂固定用第 1 階外觀）：聲音跟著外觀的來源列走
  c.skills2Levels = () => [1, 1, 1, 1, 1, 1, 1];
  const t1 = c.SKILLS2.fireball.tiers[0].vfx;
  assert.deepEqual(plain(c.sgSfxRoles('fireball', { vfxRoles: { projectile: t1.projectile } })), {}, '分裂小火球不借第 7 階隕石聲');
  assert.deepEqual(plain(c.sgSfxRoles('fireball', { vfxRoles: { attack: t1.attack } })), { attack: 'fireball' });
  // 借用其他群組（vfxGid）照特效規則讀被借用的那一列
  assert.equal(c.sgSfxRoles('cleave', { vfxGid: 'vacuumslash', vfxTier: 4 }).attack, 'vacuumslash');
});

test('特效事件只在有音效時帶 sfx；施放動作帶施放音效', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'worker', 'shim.js'), 'utf8');
  assert.match(src, /if \(spec\.sfx && typeof spec\.sfx === 'object'\) event\.sfx = spec\.sfx;/);
  assert.match(src, /if \(sfx\) event\.sfx = String\(sfx\);/);
  const c = context();
  const spec = {};
  c.sgAttachSfx(spec, 'knife', {});
  assert.deepEqual(plain(spec.sfx), { hit: 'knife' });
  const none = {};
  c.sgAttachSfx(none, 'knife', { vfxRoles: { projectile: 'proj-knife' } });
  assert.equal(none.sfx, undefined, '沒有音效就不帶空物件');
});

test('VFX Runtime 在角色播放時交給 Sfx；Sfx 提供播放介面', () => {
  const rt = fs.readFileSync(path.join(__dirname, '..', 'js', 'vfx-runtime.js'), 'utf8');
  assert.match(rt, /sfxRole\(spec, 'hit', preHitDelay\)/);
  assert.match(rt, /if \(primary\) sfxRole\(spec, primary, 0\)/);
  const sfx = fs.readFileSync(path.join(__dirname, '..', 'js', 'sfx.js'), 'utf8');
  for (const api of ['playSynth', 'skillRole', 'playCast', 'loopStop']) assert.match(sfx, new RegExp(api + ': '));
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(html.indexOf('js/sfx-synth.js') > 0 && html.indexOf('js/sfx-synth.js') < html.indexOf('js/sfx.js'), 'sfx-synth.js 要在 sfx.js 之前載入');
});
