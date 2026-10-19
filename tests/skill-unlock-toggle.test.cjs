'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function createMockElement(id, tagName = 'div') {
  return {
    id: id,
    tagName: tagName.toUpperCase(),
    hidden: false,
    textContent: '',
    attributes: {},
    classList: {
      _classes: new Set(),
      add(c) { this._classes.add(c); },
      remove(c) { this._classes.delete(c); },
      contains(c) { return this._classes.has(c); },
      toggle(c, force) {
        if (force === undefined) {
          if (this.contains(c)) this.remove(c);
          else this.add(c);
        } else if (force) {
          this.add(c);
        } else {
          this.remove(c);
        }
      }
    },
    style: {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    setAttribute(name, val) { this.attributes[name] = String(val); },
    getAttribute(name) { return this.attributes[name] !== undefined ? this.attributes[name] : null; },
    removeAttribute(name) { delete this.attributes[name]; }
  };
}

function loadUIContext(hostname = 'localhost') {
  const elements = {
    'skill-unlock-toggle': createMockElement('skill-unlock-toggle', 'button'),
    'skill-trees': createMockElement('skill-trees'),
    'skill-loadout': createMockElement('skill-loadout'),
    'loadout-cap': createMockElement('loadout-cap'),
    'mastery-level': createMockElement('mastery-level'),
    'mastery-bar': createMockElement('mastery-bar'),
    'mastery-bar-fill': createMockElement('mastery-bar-fill'),
    'mastery-bar-text': createMockElement('mastery-bar-text'),
    'attr-hide-zero': createMockElement('attr-hide-zero'),
    'attr-panel': createMockElement('attr-panel'),
    'attr-hide-zero-bar': createMockElement('attr-hide-zero-bar'),
    'sgb-chips': createMockElement('sgb-chips'),
    'sgb-items': createMockElement('sgb-items'),
    'sgb-detail': createMockElement('sgb-detail')
  };
  elements['skill-trees'].querySelector = (sel) => {
    if (sel === '.sgb-wrap') return createMockElement('sgb-wrap');
    return null;
  };
  elements['sgb-detail'].contains = () => false;
  elements['skill-unlock-toggle'].hidden = true;

  let currentSnapshot = {
    skills2: {
      levels: {},
      ult: {},
      skillUnlock: false
    },
    loadout: [],
    loadoutSize: 6,
    mastery: { level: 10, xp: 50, xpMax: 100, maxLevel: 1000 }
  };

  const context = {
    console,
    Math: Object.create(Math),
    setTimeout() {},
    clearTimeout() {},
    requestAnimationFrame() {},
    cancelAnimationFrame() {},
    location: { hostname: hostname, protocol: 'http:' },
    document: {
      getElementById(id) { return elements[id] || null; },
      querySelector(sel) {
        if (sel === '#skill-unlock-toggle') return elements['skill-unlock-toggle'];
        return null;
      },
      querySelectorAll() { return []; },
      addEventListener() {}
    },
    $id(id) { return elements[id] || null; },
    UI: {
      dirty: {},
      sgBrowse: { gid: 'fireball', tier: 0, filter: 'all', ultFocus: null, focus: 'tier' }
    },
    GM_TEST: { skillUnlock: false },
    LOADOUT_SIZE: { base: 2, perLevels: 10, max: 6 },
    SKILLS2: {
      fireball: {
        name: '火球術',
        emoji: '🔥',
        elem: 'fire',
        tiers: [{ name: '火球術', max: 10, fx: {} }]
      }
    },
    SG_TIER_MAX_LV: 10,
    blog() {},
    fmt(n) { return String(n); },
    esc(s) { return String(s); },
    panelData(key) {
      if (key === 'skills') return currentSnapshot;
      if (key === 'talents') return { levels: {} };
      if (key === 'header') return { player: { level: 100, reincarnations: 0 } };
      return null;
    },
    setSkillsSnapshot(snap) { currentSnapshot = snap; },
    getMockElements() { return elements; }
  };
  context.window = context;

  vm.createContext(context);

  ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/skills.js', 'js/skills2.js', 'js/ui.js', 'js/gm_exec.js']
    .forEach((file) => {
      const code = fs.readFileSync(path.join(root, file), 'utf8');
      vm.runInContext(code, context, { filename: file });
    });

  context.panelData = (key) => {
    if (key === 'skills') return currentSnapshot;
    if (key === 'talents') return { levels: {} };
    if (key === 'header') return { player: { level: 100, reincarnations: 0 } };
    return null;
  };

  return context;
}

test('DOM 結構：index.html 技能頂欄包含技能全解鎖開關，預設隱藏', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /<div class="sgb-top">[\s\S]*?<button[^>]*id="skill-unlock-toggle"/);
  assert.match(html, /id="skill-unlock-toggle"[^>]*class="[^"]*sgb-unlock-toggle[^"]*"/);
  assert.match(html, /id="skill-unlock-toggle"[^>]*hidden/);
  assert.match(html, /data-tt-title="技能全解鎖（內測專用）"/);
});

test('正式環境（非內測/非GM主機）：按鈕保持隱藏且不可切換', () => {
  const c = loadUIContext('production-game.example.com');
  const btn = c.getMockElements()['skill-unlock-toggle'];

  assert.equal(c.isSkillUnlockToggleAvailable(), false);
  c.initSkillUnlockToggle();
  assert.equal(btn.hidden, true);

  c.toggleSkillUnlockDev();
  assert.equal(c.GM_TEST.skillUnlock, false);
});

test('內測環境（localhost）：初始化正確顯示為關閉狀態', () => {
  const c = loadUIContext('localhost');
  const btn = c.getMockElements()['skill-unlock-toggle'];

  assert.equal(c.isSkillUnlockToggleAvailable(), true);
  c.initSkillUnlockToggle();
  assert.equal(btn.hidden, false);
  assert.equal(btn.textContent, '技能全解鎖：關');
  assert.equal(btn.getAttribute('aria-pressed'), 'false');
});

test('內測環境：點擊開關切換技能全解鎖（開與關）', () => {
  const c = loadUIContext('127.0.0.1');
  const btn = c.getMockElements()['skill-unlock-toggle'];

  c.initSkillUnlockToggle();
  assert.equal(btn.textContent, '技能全解鎖：關');

  // 切換至開
  c.toggleSkillUnlockDev();
  assert.equal(c.GM_TEST.skillUnlock, true);
  assert.equal(btn.textContent, '🔓 技能全解鎖：開');
  assert.equal(btn.getAttribute('aria-pressed'), 'true');

  // 再次切換至關
  c.toggleSkillUnlockDev();
  assert.equal(c.GM_TEST.skillUnlock, false);
  assert.equal(btn.textContent, '技能全解鎖：關');
  assert.equal(btn.getAttribute('aria-pressed'), 'false');
});

test('renderSkills 刷新時自動同步開關狀態', () => {
  const c = loadUIContext('localhost');
  const btn = c.getMockElements()['skill-unlock-toggle'];

  c.setSkillsSnapshot({
    skills2: { levels: {}, ult: {}, skillUnlock: true },
    loadout: [],
    loadoutSize: 6,
    mastery: { level: 10, xp: 0, xpMax: 100, maxLevel: 1000 }
  });

  c.renderSkills();
  assert.equal(btn.textContent, '🔓 技能全解鎖：開');
  assert.equal(btn.getAttribute('aria-pressed'), 'true');
  assert.equal(c.GM_TEST.skillUnlock, true);

  c.setSkillsSnapshot({
    skills2: { levels: {}, ult: {}, skillUnlock: false },
    loadout: [],
    loadoutSize: 6,
    mastery: { level: 10, xp: 0, xpMax: 100, maxLevel: 1000 }
  });

  c.renderSkills();
  assert.equal(btn.textContent, '技能全解鎖：關');
  assert.equal(btn.getAttribute('aria-pressed'), 'false');
  assert.equal(c.GM_TEST.skillUnlock, false);
});
