'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
function mount(audio = true, hostPresent = true) {
  const timers = [], heard = [], host = { children: [], appendChild(n) { n.parentNode = this; this.children.push(n); }, removeChild(n) { this.children.splice(this.children.indexOf(n), 1); n.parentNode = null; } };
  const modal = { style: { display: 'none' }, setAttribute() {} };
  const list = { innerHTML: '' };
  const c = { ACHIEVEMENTS: [{ id: 'one', icon: '1', name: 'One', count: 1 }, { id: 'two', icon: '2', name: 'Two', count: 2 }],
    document: { readyState: 'loading', addEventListener() {}, getElementById(id) { return id === 'achv-toast' ? (hostPresent ? host : null) : id === 'achv-modal' ? modal : id === 'achv-list' ? list : null; }, createElement() { return { classList: { add() {} } }; } },
    esc: String, fmt: String, setHtmlIfChanged(node, html) { node.innerHTML = html; }, UI: {}, requestPanelData() {}, setInterval() {}, clearInterval() {},
    setTimeout(fn, ms) { timers.push({ fn, ms }); } };
  if (audio) c.UISound = { achievementUnlocked() { heard.push(host.children.at(-1).innerHTML); } };
  vm.createContext(c); vm.runInContext(fs.readFileSync(path.join(root, 'js/ui-achievements.js'), 'utf8'), c);
  return { c, host, list, timers, heard };
}
test('achievement notices sound once as each toast appears, not when subsequent notices enter the queue', () => {
  const s = mount(); s.c.AchievementUI.onUnlocked({ id: 'one' }); s.c.AchievementUI.onUnlocked({ id: 'two' });
  assert.equal(s.heard.length, 1); assert.ok(s.heard[0].includes('One')); assert.equal(s.host.children.length, 1);
  assert.equal(s.timers[0].ms, 3600); s.timers.shift().fn();
  assert.equal(s.heard.length, 1); assert.equal(s.timers[0].ms, 400); s.timers.shift().fn();
  assert.equal(s.heard.length, 2); assert.ok(s.heard[1].includes('Two'));
  s.timers.shift().fn(); s.timers.shift().fn(); assert.equal(s.heard.length, 2); assert.equal(s.host.children.length, 0);
});
test('already completed snapshot/render/open/filter and invalid notices are silent; missing sound module stays usable', () => {
  const s = mount();
  s.c.peekUiPanelData = () => ({ list: [{ id: 'one', at: Date.now(), prog: 1, goal: 1 }], got: 1 });
  s.c.AchievementUI.render(); s.c.AchievementUI.open(); s.c.AchievementUI.setFilter('done'); s.c.AchievementUI.close();
  assert.ok(s.list.innerHTML.includes('One')); assert.ok(!s.list.innerHTML.includes('Two'));
  s.c.AchievementUI.onUnlocked({ id: 'invalid' }); s.c.AchievementUI.onUnlocked(null); assert.equal(s.heard.length, 0);
  const absent = mount(false); assert.doesNotThrow(() => absent.c.AchievementUI.onUnlocked({ id: 'one' })); assert.equal(absent.host.children.length, 1);
  const noHost = mount(true, false); noHost.c.AchievementUI.onUnlocked({ id: 'one' }); assert.equal(noHost.heard.length, 0);
});
test('achievement WAV is the selected original and its manifest, runtime hash and cache URLs agree', () => {
  const dir = path.join(root, 'audio/achievements');
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json')));
  const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, manifest.file))).digest('hex');
  assert.equal(hash, '8da83b49ceb580493ba7c7081ec3d176fe069d4505474b604f6fb08b339bd32a'); assert.equal(hash, manifest.sha256);
  const sound = fs.readFileSync(path.join(root, 'js/ui-sound.js'), 'utf8');
  assert.ok(sound.includes(manifest.file + '?v=' + hash.slice(0, 12)));
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  for (const file of ['ui-sound', 'ui-achievements']) assert.ok(html.includes('js/' + file + '.js?v=20261105-achievement-sound-v1'));
});
