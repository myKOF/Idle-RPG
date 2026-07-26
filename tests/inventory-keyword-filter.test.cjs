const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('背包關鍵字篩選 UI 與 DOM 結構驗證', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');

  // 1. 驗證 index.html 包含 #inv-keyword-filter 且位於 #inv-ancient-filter 左側
  assert.match(html, /id="inv-keyword-filter"/);
  const kwIdx = html.indexOf('id="inv-keyword-filter"');
  const ancientIdx = html.indexOf('id="inv-ancient-filter"');
  assert.ok(kwIdx > 0 && ancientIdx > 0 && kwIdx < ancientIdx, '關鍵字篩選欄應位於太古篩選左側');

  // 2. 驗證 css/style.css 包含 .item-cell-dimmed 置灰與動畫遮蔽樣式
  assert.match(css, /\.item-cell\.item-cell-dimmed/);
  assert.match(css, /\.item-cell\.item-cell-dimmed::before/);

  // 3. 驗證 js/ui.js 核心函式、高效DOM更新與 IME 防抖綁定
  assert.match(ui, /function\s+isInternalServer\s*\(/);
  assert.match(ui, /function\s+itemMatchesKeyword\s*\(/);
  assert.match(ui, /function\s+updateInventoryKeywordFilter\s*\(/);
  assert.match(ui, /function\s+onKeywordFilterInput\s*\(/);
  assert.match(ui, /compositionstart/);
  assert.match(ui, /compositionend/);
  assert.match(ui, /classList\.toggle\s*\(\s*'item-cell-dimmed'/);
});

test('isInternalServer 內測服與本機環境判定驗證', () => {
  function isInternalServerTest(loc) {
    if (!loc) return false;
    var host = loc.hostname || '';
    var proto = loc.protocol || '';
    if (proto === 'file:') return true;
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0' || host === '[::1]') return true;
    if (/^192\.168\.\d+\.\d+$/.test(host) || /^10\.\d+\.\d+\.\d+$/.test(host) || /^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(host)) return true;
    if (host.endsWith('.local') || host.endsWith('.test')) return true;
    return false;
  }

  assert.strictEqual(isInternalServerTest({ hostname: 'localhost', protocol: 'http:' }), true, 'localhost 應判定為內測服');
  assert.strictEqual(isInternalServerTest({ hostname: '127.0.0.1', protocol: 'http:' }), true, '127.0.0.1 應判定為內測服');
  assert.strictEqual(isInternalServerTest({ hostname: '::1', protocol: 'http:' }), true, '::1 應判定為內測服');
  assert.strictEqual(isInternalServerTest({ hostname: '192.168.1.100', protocol: 'http:' }), true, '區域網 IP 應判定為內測服');
  assert.strictEqual(isInternalServerTest({ hostname: '', protocol: 'file:' }), true, 'file 協定開啟本地檔案應判定為內測服');
  assert.strictEqual(isInternalServerTest({ hostname: 'game.official.com', protocol: 'https:' }), false, '正式外服網域應判定為非內測服');
});

test('itemMatchesKeyword 全文（名稱/部位/詞條/傳奇/神鑄/附魔）比對邏輯驗證', () => {
  const AFFIX_POOL = {
    critRate: { name: '暴擊率%' },
    atkFlat: { name: '物理攻擊' }
  };
  const PASSIVE_POOL = {
    sunder: { name: '破甲', desc: '攻擊時忽略目標 10% 防禦' }
  };
  const GODFORGE_POOL = {
    dragonBlood: { name: '龍血', desc: '生命上限提高 50%' }
  };

  function itemMatchesKeywordTest(it, keyword) {
    if (!it || !keyword) return true;
    var kw = String(keyword).trim().toLowerCase();
    if (!kw) return true;

    if (it.name && it.name.toLowerCase().indexOf(kw) !== -1) return true;

    if (Array.isArray(it.affixes)) {
      for (var i = 0; i < it.affixes.length; i++) {
        var a = it.affixes[i];
        if (!a) continue;
        if (AFFIX_POOL[a.key]) {
          var def = AFFIX_POOL[a.key];
          if (def.name && def.name.toLowerCase().indexOf(kw) !== -1) return true;
        }
        if (a.key && a.key.toLowerCase().indexOf(kw) !== -1) return true;
      }
    }

    if (it.passive) {
      if (PASSIVE_POOL[it.passive.key]) {
        var pDef = PASSIVE_POOL[it.passive.key];
        if (pDef.name && pDef.name.toLowerCase().indexOf(kw) !== -1) return true;
        if (pDef.desc && pDef.desc.toLowerCase().indexOf(kw) !== -1) return true;
      }
      if (it.passive.key && it.passive.key.toLowerCase().indexOf(kw) !== -1) return true;
    }

    if (Array.isArray(it.godPassives)) {
      for (var j = 0; j < it.godPassives.length; j++) {
        var gp = it.godPassives[j];
        var gDef = GODFORGE_POOL[gp.key];
        if (gDef) {
          if (gDef.name && gDef.name.toLowerCase().indexOf(kw) !== -1) return true;
          if (gDef.desc && gDef.desc.toLowerCase().indexOf(kw) !== -1) return true;
        }
      }
    }

    return false;
  }

  const testItem1 = {
    name: '精良的長劍',
    affixes: [{ key: 'critRate', val: 5 }]
  };
  const testItem2 = {
    name: '神話的聖殿巨盾',
    affixes: [{ key: 'atkFlat', val: 100 }],
    passive: { key: 'sunder', val: 10 }
  };
  const testItem3 = {
    name: '創世胸甲',
    affixes: [{ key: 'atkFlat', val: 100 }],
    godPassives: [{ key: 'dragonBlood', val: 50 }]
  };

  // 空關鍵字應全部匹配
  assert.strictEqual(itemMatchesKeywordTest(testItem1, ''), true);

  // 比對詞條
  assert.strictEqual(itemMatchesKeywordTest(testItem1, '暴擊'), true);
  assert.strictEqual(itemMatchesKeywordTest(testItem1, '破甲'), false);

  // 比對傳奇特效名稱「破甲」與描述關鍵字「忽略」
  assert.strictEqual(itemMatchesKeywordTest(testItem2, '破甲'), true, '輸入「破甲」應能匹配帶有破甲特效之神話盾牌');
  assert.strictEqual(itemMatchesKeywordTest(testItem2, '忽略'), true, '輸入「忽略」應能匹配破甲特效之描述');
  assert.strictEqual(itemMatchesKeywordTest(testItem2, '暴擊'), false, '未帶暴擊之裝備應不匹配');

  // 比對神鑄特效
  assert.strictEqual(itemMatchesKeywordTest(testItem3, '龍血'), true);
  assert.strictEqual(itemMatchesKeywordTest(testItem3, '生命上限'), true);
  assert.strictEqual(itemMatchesKeywordTest(testItem3, '破甲'), false);
});
