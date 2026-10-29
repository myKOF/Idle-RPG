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
    setTimeout,
    clearTimeout,
    AbortController,
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
  let generated = 0;
  ctx.fetch = async (url, opts) => {
    if (opts && opts.method === 'POST') {
      generated++;
      assert.match(url, /:generateContent/);
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
    }
    // GET list models
    return {
      ok: true,
      json: async () => ({
        models: [
          { name: 'models/gemini-2.0-flash', supportedGenerationMethods: ['generateContent'] }
        ]
      })
    };
  };

  const cmds = await mod.parseNaturalCommand('加全身強化+50的神話裝備，並都是4太古的詞條，並加金幣1000億');
  assert.deepEqual([...cmds], ['equipset mythic 500 50 4 wear', 'gold 100000000000']);
  assert.equal(generated, 1, '此案例須實際走雲端替身，不可被快徑攔截');
});

test('parseNaturalCommand 遇到首選模型 High Demand (503) 時能自動切換備用模型成功', async () => {
  const { mod, ctx } = setup('localhost', { idle_rpg_gemini_api_key: 'AIzaFakeKey123' });
  let callCount = 0;
  ctx.fetch = async (url, opts) => {
    if (opts && opts.method === 'POST') {
      callCount++;
      if (callCount === 1) {
        // 第一個模型報 High Demand
        return {
          ok: false,
          status: 503,
          json: async () => ({
            error: { message: 'This model is currently experiencing high demand. Spikes in demand are usually temporary.' }
          })
        };
      }
      // 第二個模型成功
      return {
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: '["gold 999999"]' }]
              }
            }
          ]
        })
      };
    }
    return {
      ok: true,
      json: async () => ({
        models: [
          { name: 'models/gemini-2.0-flash', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/gemini-1.5-flash', supportedGenerationMethods: ['generateContent'] }
        ]
      })
    };
  };

  const cmds = await mod.parseNaturalCommand('替我的測試角色準備足夠金幣');
  assert.strictEqual(callCount, 2, '應自動呼叫下一個模型重試');
  assert.deepEqual([...cmds], ['gold 999999']);
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

test('js/gm_exec.js 的 gmRarity 支援中文名與 godforge/chaosGodforged 等別名，且 socketall 可鑲滿全身裝備', () => {
  const equipment = {
    weapon: { id: 1, rarity: 10, sockets: [null, null], runes: [null] },
    chest: { id: 2, rarity: 10, sockets: [], runes: [] }
  };
  const G = {
    player: { level: 500 },
    inventory: [],
    equipment: equipment
  };

  const context = {
    location: { hostname: 'localhost' },
    G,
    RARITIES: [
      { key: 'common', name: '普通', affix: [1, 1], sockets: 0, runeSlots: 0 },
      { key: 'uncommon', name: '精良', affix: [2, 2], sockets: 1, runeSlots: 1 },
      { key: 'rare', name: '稀有', affix: [2, 2], sockets: 1, runeSlots: 1 },
      { key: 'unique', name: '獨特', affix: [3, 3], sockets: 1, runeSlots: 1 },
      { key: 'epic', name: '史詩', affix: [4, 4], sockets: 2, runeSlots: 2 },
      { key: 'legendary', name: '傳說', affix: [5, 5], sockets: 2, runeSlots: 2 },
      { key: 'mythic', name: '神話', affix: [6, 6], sockets: 2, runeSlots: 2 },
      { key: 'genesis', name: '創世', affix: [7, 7], sockets: 3, runeSlots: 3 },
      { key: 'godforged', name: '神鑄創世', affix: [8, 8], sockets: 3, runeSlots: 3 },
      { key: 'chaos', name: '混沌', affix: [9, 9], sockets: 4, runeSlots: 4 },
      { key: 'chaosGodforged', name: '神鑄混沌', affix: [10, 10], sockets: 4, runeSlots: 4 }
    ],
    GEM_TYPES: {
      ruby: { name: '紅寶石', enabled: true },
      topaz: { name: '黃玉', enabled: true }
    },
    RUNES: [
      { id: 'r01', name: '艾爾' },
      { id: 'r33', name: '查姆' }
    ],
    pick: (arr) => arr[0],
    makeEquipment: (lvl, opts) => ({
      id: Math.random(),
      level: lvl,
      rarity: opts.rarity,
      slot: opts.slot,
      sockets: [],
      runes: []
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

  // 1. 別名 godforge
  const resGf = exec('equipset godforge 500 100 0 wear');
  assert.equal(resGf.ok, true, 'godforge 應成功識別為神鑄創世');
  assert.match(resGf.message, /神鑄創世/);

  // 2. 中文名稱 神鑄混沌
  const resChaosGf = exec('equipset 神鑄混沌 500 100 4 wear');
  assert.equal(resChaosGf.ok, true, '神鑄混沌 應成功識別');
  assert.match(resChaosGf.message, /神鑄混沌/);

  // 3. socketall 10
  const resSocket = exec('socketall 10');
  assert.equal(resSocket.ok, true);
  assert.match(resSocket.message, /已將全身 \d+ 件裝備全數鑲滿/);
  assert.equal(equipment.weapon.sockets.length, 4, '混沌神鑄應有 4 孔');
  assert.equal(equipment.weapon.sockets[0].level, 10);
  assert.equal(equipment.weapon.runes.length, 4);
});

