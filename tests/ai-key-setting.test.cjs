'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const aiKeySettingCode = fs.readFileSync(path.join(root, 'js/ai-key-setting.js'), 'utf8');

function setup(hostname, initialStorage = {}) {
  const storage = { ...initialStorage };
  const listeners = {};
  const nodes = {};

  function makeElement(id) {
    return {
      id,
      style: { display: 'none' },
      value: '',
      type: 'password',
      innerHTML: '',
      textContent: '',
      placeholder: '',
      disabled: false,
      listeners: {},
      addEventListener(event, fn) { this.listeners[event] = fn; },
      click() { if (this.listeners.click) this.listeners.click(); },
      focus() { doc.activeElement = this; }
    };
  }

  for (const id of [
    'ai-gm-key-panel',
    'game-menu-ai-key',
    'input-ai-gemini-key',
    'btn-ai-toggle-key-vis',
    'btn-ai-save-key',
    'btn-ai-test-key',
    'btn-ai-clear-key',
    'ai-key-status'
  ]) {
    nodes[id] = makeElement(id);
  }

  const doc = {
    readyState: 'complete',
    activeElement: null,
    getElementById: id => nodes[id] || null,
    addEventListener(event, fn) { listeners[event] = fn; }
  };

  const win = {
    location: { hostname: hostname, protocol: hostname === 'file' ? 'file:' : 'http:' },
    localStorage: {
      getItem: k => (Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null),
      setItem: (k, v) => { storage[k] = String(v); },
      removeItem: k => { delete storage[k]; }
    }
  };

  const ctx = {
    window: win,
    document: doc,
    location: win.location,
    localStorage: win.localStorage,
    setTimeout: (fn) => fn(),
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ models: [] }) }),
    GameMenu: { openSettings: () => {} },
    module: { exports: {} }
  };

  vm.createContext(ctx);
  vm.runInContext(aiKeySettingCode, ctx);
  const mod = ctx.module.exports;
  return { ctx, mod, nodes, storage, doc };
}

test('非內測服環境防護：隱藏介面且拒絕存取 Key', () => {
  const { mod, nodes } = setup('play.mygame.com');
  assert.equal(mod.isInternal(), false);
  mod.initUI();
  assert.equal(nodes['ai-gm-key-panel'].style.display, 'none');
  assert.equal(nodes['game-menu-ai-key'].style.display, 'none');
  assert.equal(mod.getApiKey(), '');
  assert.equal(mod.setApiKey('test-key'), false);
});

test('內測服環境（localhost）：顯示面板並可正常儲存/讀取/清除 Key', () => {
  const { mod, nodes, storage } = setup('localhost');
  assert.equal(mod.isInternal(), true);
  mod.initUI();
  assert.equal(nodes['ai-gm-key-panel'].style.display, 'block');
  assert.equal(nodes['game-menu-ai-key'].style.display, 'block');

  // 模擬在輸入框輸入金鑰並點擊保存
  nodes['input-ai-gemini-key'].value = 'AIzaSyDemoKey1234567890';
  nodes['btn-ai-save-key'].click();
  assert.equal(storage[mod.STORAGE_KEY], 'AIzaSyDemoKey1234567890');
  assert.equal(mod.getApiKey(), 'AIzaSyDemoKey1234567890');
  assert.match(nodes['ai-key-status'].innerHTML, /(金鑰已成功儲存|已設定金鑰)/);

  // 測試金鑰遮罩
  assert.equal(mod.maskKey('AIzaSyDemoKey1234567890'), 'AIzaSy...7890');

  // 切換眼睛顯示/隱藏
  nodes['btn-ai-toggle-key-vis'].click();
  assert.equal(nodes['input-ai-gemini-key'].type, 'text');
  assert.equal(nodes['btn-ai-toggle-key-vis'].textContent, '🙈');
  nodes['btn-ai-toggle-key-vis'].click();
  assert.equal(nodes['input-ai-gemini-key'].type, 'password');
  assert.equal(nodes['btn-ai-toggle-key-vis'].textContent, '👁️');

  // 點擊清除
  nodes['btn-ai-clear-key'].click();
  assert.equal(mod.getApiKey(), '');
  assert.equal(storage[mod.STORAGE_KEY], undefined);
  assert.match(nodes['ai-key-status'].innerHTML, /(已清除|尚未設定金鑰)/);
});

test('HTML 檔案確保預設包含 AI 金鑰相關節點且預設 display:none', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /id="ai-gm-key-panel"[^>]*style="display:none/);
  assert.match(html, /id="game-menu-ai-key"[^>]*style="display:none/);
  assert.match(html, /src="js\/ai-key-setting\.js/);
});

test('parseNaturalCommand 成功透過 Gemini 轉譯白話指令為 GM 指令陣列', async () => {
  const { mod, ctx } = setup('localhost', { idle_rpg_gemini_api_key: 'AIzaFakeKey123' });
  ctx.fetch = async (url, opts) => {
    assert.match(url, /gemini-1\.5-flash:generateContent/);
    return {
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: '["equipset mythic 500 50 4 wear", "gold 100000000000"]' }]
            }
          }
        ]
      })
    };
  };

  const cmds = await mod.parseNaturalCommand('加全身強化+50的神話裝備，並都是4太古的詞條，並加金幣1000億');
  assert.deepEqual([...cmds], ['equipset mythic 500 50 4 wear', 'gold 100000000000']);
});

test('js/gm_exec.js 的 equipset 支援強化等級、太古數與自動穿戴', () => {
  const inventory = [];
  const equipment = {};
  const G = {
    player: { level: 200 },
    inventory: inventory,
    equipment: equipment
  };

  const context = {
    location: { hostname: 'localhost' },
    G,
    RARITIES: [
      { key: 'common', name: '普通', affix: [1, 2] },
      { key: 'uncommon', name: '精良', affix: [2, 3] },
      { key: 'rare', name: '稀有', affix: [3, 4] },
      { key: 'unique', name: '獨特', affix: [4, 5] },
      { key: 'epic', name: '史詩', affix: [5, 6] },
      { key: 'legendary', name: '傳說', affix: [6, 7] },
      { key: 'mythic', name: '神話', affix: [7, 7] }
    ],
    pick: (arr) => arr[0],
    makeEquipment: (lvl, opts) => ({
      id: Math.random(),
      level: lvl,
      rarity: opts.rarity,
      slot: opts.slot,
      upgrade: 0,
      ancientCount: opts.ancientCount || 0
    }),
    equipItem: (it, slotKey) => {
      equipment[slotKey] = it;
    },
    markStatsDirty: () => {},
    UI: { dirty: {} },
    module: { exports: {} }
  };
  context.window = context;

  vm.createContext(context);
  const code = fs.readFileSync(path.join(root, 'js/gm_exec.js'), 'utf8');
  vm.runInContext(code, context);
  const exec = context.module.exports.executeGMCommand;

  // 1. 發放到背包，帶強化 50 與 4 太古
  const resInv = exec('equipset mythic 500 50 4 inv');
  assert.equal(resInv.ok, true);
  assert.match(resInv.message, /強化\+50/);
  assert.match(resInv.message, /4太古/);
  assert.equal(inventory.length, 13);
  assert.equal(inventory[0].upgrade, 50);
  assert.equal(inventory[0].ancientCount, 4);

  // 2. 直接穿戴到全身 (wear)
  const resWear = exec('equipset mythic 500 50 4 wear');
  assert.equal(resWear.ok, true);
  assert.match(resWear.message, /已自動替換並穿戴全身/);
  assert.equal(equipment.weapon.upgrade, 50);
  assert.equal(equipment.weapon.ancientCount, 4);
  assert.equal(equipment.helmet.upgrade, 50);
});

