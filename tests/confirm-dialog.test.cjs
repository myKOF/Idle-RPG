const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { readExpanded } = require('./helpers/str-expand.cjs');

function makeElement() {
  return {
    innerHTML: '',
    _textContent: '',
    get textContent() { return this._textContent + this.children.map(child => child.textContent).join(''); },
    set textContent(value) { this._textContent = value; this.children = []; },
    value: '',
    style: {},
    options: [],
    parentNode: null,
    children: [],
    onclick: null,
    appendChild(child) { this.children.push(child); },
    listeners: {},
    addEventListener(type, handler) { this.listeners[type] = handler; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {},
    getAttribute() { return null; }
  };
}

function loadGameContext() {
  const root = path.resolve(__dirname, '..');
  const elements = new Map();
  const getElementById = (id) => {
    if (!elements.has(id)) elements.set(id, makeElement());
    return elements.get(id);
  };

  const context = {
    console,
    setTimeout() {},
    clearTimeout() {},
    document: {
      getElementById,
      querySelectorAll() { return []; },
      addEventListener() {},
      createElement() { return makeElement(); },
      body: makeElement()
    },
    location: { reload() {} }
  };
  context.PANEL_KEYS = ['header', 'forge'];
  context.window = context;
  vm.createContext(context);

  ['js/util.js', 'js/strings_data.js', 'js/strings.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/item.js', 'js/ui.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });

  return { context, elements };
}

test('ui confirmations use shared custom modal instead of native confirm', () => {
  const ui = readExpanded(path.resolve(__dirname, '..', 'js/ui.js'));

  assert.doesNotMatch(ui, /\bconfirm\s*\(/);
  assert.match(ui, /function showConfirmDialog/);
  assert.match(ui, /showConfirmDialog\(\s*(?:'' \+ )?actTitle \+ '效果：/);
  assert.doesNotMatch(ui, /gdis-fused-list/); // 拆解改為免費無損九宮格，不再有融合寶石拆解確認入口。
  assert.match(ui, /showConfirmDialog\('確定要重新開局嗎/);
  assert.match(ui, /dialogClass: 'reincarnation-confirm'/);
  assert.match(ui, /initGemWorkshopUi\(\)/);
  assert.match(ui, /title: '重新開局確認'/);
});

test('confirm modal actions are centered and evenly spaced', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '..', 'css/style.css'), 'utf8');

  assert.match(css, /\.confirm-actions\s*{[\s\S]*display:\s*grid/);
  assert.match(css, /\.confirm-actions\s*{[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(72px,\s*96px\)\)/);
  assert.match(css, /\.confirm-actions\s*{[\s\S]*justify-content:\s*center/);
  assert.match(css, /\.confirm-actions\s*{[\s\S]*column-gap:\s*80px/);
});

test('轉生確認視窗使用專屬金框與加深底色，裝飾不攔截操作', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '..', 'css/dialogs.css'), 'utf8');
  const ui = readExpanded(path.resolve(__dirname, '..', 'js/ui.js'));

  assert.match(ui, /modal\.className = 'modal-overlay confirm-modal' \+ \(options\.dialogClass \? ' ' \+ options\.dialogClass : ''\)/);
  assert.match(ui, /dialogClass: 'reincarnation-confirm'/);
  assert.match(css, /--dialog-frame: linear-gradient\(135deg, #fff0ad/);
  assert.match(css, /--dialog-surface: linear-gradient\(135deg, #727672/);
  assert.match(css, /\.confirm-modal\.reincarnation-confirm \.confirm-box::after\s*\{[^}]*pointer-events: none/);
});

test('轉生預告依正式門檻，只列轉生回1級立即新開放的系統', () => {
  const { context: c } = loadGameContext();
  const notices = (count, level = 1000) => Array.from(c.reincarnationUnlockNotices({ player: { level, reincarnations: count } }));
  assert.deepEqual(notices(0), ['解鎖【天堂威能】系統']);
  assert.deepEqual(notices(1), ['解鎖【神鑄】系統']);
  assert.deepEqual(notices(2), []);
  assert.deepEqual(notices(3), ['解鎖【寶石共鳴】系統']);
  assert.deepEqual(notices(4), []);
  assert.deepEqual(notices(10), []); // 融合雖達轉數，仍缺重置後的等級門檻。
  c.FORGE_UNLOCK_REINCARNATION = 1;
  c.GEM_RESONANCE_UNLOCK_REINCARNATION = 1;
  assert.deepEqual(notices(0), ['解鎖【天堂威能】系統', '解鎖【神鑄】系統', '解鎖【寶石共鳴】系統']);
  c.UI_WORKER_STATE.panels.forge = { forge: { unlocked: true } };
  assert.deepEqual(notices(0), ['解鎖【天堂威能】系統', '解鎖【寶石共鳴】系統']);
  c.TALENT_UNLOCK_LEVEL = 2;
  assert.deepEqual(notices(0), ['解鎖【寶石共鳴】系統']);
  c.GEM_FUSION_UNLOCK_LEVEL = 1;
  c.GEM_FUSION_UNLOCK_REINCARNATIONS = 1;
  c.EQUIP_SET_UNLOCK_REINCARNATIONS[2] = 1;
  assert.deepEqual(notices(0), ['解鎖【寶石共鳴】系統', '解鎖【寶石融合】系統', '解鎖【裝備方案 第三套】系統']);
});

test('新解鎖各自使用純文字獨立行，重開一般確認不殘留', () => {
  const { context: c, elements } = loadGameContext();
  c.showConfirmDialog('效果', () => {}, { unlockNotices: ['解鎖【天堂威能】系統', '<b>名稱</b>'] });
  const msg = elements.get('confirm-message');
  assert.equal(msg.children.length, 2);
  assert.equal(msg.children[0].className, 'reincarnation-unlock');
  assert.equal(msg.children[0].textContent, '解鎖【天堂威能】系統');
  assert.equal(msg.children[1].textContent, '<b>名稱</b>');
  assert.equal(msg.children[1].innerHTML, '');
  c.showConfirmDialog('一般確認', () => {});
  assert.equal(msg.children.length, 0);
  assert.equal(msg.textContent, '一般確認');
});

test('實際轉生按鈕換算提高50%與250%及解鎖預告，確認才送一次', async () => {
  const { context: c, elements } = loadGameContext();
  const header = { player: { level: 1000, reincarnations: 0 } };
  c.uiHeaderPanelSnapshot = () => header;
  c.blog = () => {};
  const commands = [];
  c.sendUiCommand = (command) => { commands.push(command); return Promise.resolve({ ok: true }); };
  const ui = fs.readFileSync(path.resolve(__dirname, '..', 'js/ui.js'), 'utf8');
  const start = ui.lastIndexOf("  var reincBtn = $id('btn-reincarnate');");
  const end = ui.indexOf('  // 技能：學習/升級/裝載/融合', start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(ui.slice(start, end), c);
  const click = () => elements.get('btn-reincarnate').listeners.click();
  click();
  assert.match(elements.get('confirm-message').textContent, /力量、敏捷、體質、智力提高50%/);
  assert.doesNotMatch(elements.get('confirm-message').textContent, /×|\*\s*3\.5/);
  assert.equal(elements.get('confirm-message').children[0].textContent, '解鎖【天堂威能】系統');
  assert.equal(commands.length, 0);
  elements.get('confirm-cancel').onclick();
  assert.equal(commands.length, 0);
  click();
  elements.get('confirm-ok').onclick();
  await Promise.resolve();
  assert.deepEqual(commands, ['player.reincarnate']);
  header.player.reincarnations = 1;
  click();
  assert.match(elements.get('confirm-message').textContent, /提高/);
  assert.equal(elements.get('confirm-message').children[0].textContent, '解鎖【神鑄】系統');
  header.player.reincarnations = 2;
  click();
  assert.match(elements.get('confirm-message').textContent, /提高250%/);
  assert.equal(elements.get('confirm-message').children.length, 0);
  header.player.level = 999;
  elements.get('confirm-cancel').onclick();
  click();
  assert.equal(elements.get('confirm-modal').style.display, 'none');
  assert.equal(commands.length, 1);
});

test('shared confirm modal shows message and runs callback only on confirm', () => {
  const { context, elements } = loadGameContext();
  let confirmed = 0;

  context.showConfirmDialog('第一行\n第二行', () => { confirmed += 1; }, { title: '寶石拆解確認' });

  assert.equal(elements.get('confirm-modal').style.display, 'flex');
  assert.equal(elements.get('confirm-modal').className, 'modal-overlay confirm-modal');
  assert.equal(elements.get('confirm-title').textContent, '寶石拆解確認');
  assert.equal(elements.get('confirm-message').textContent, '第一行\n第二行');
  assert.equal(confirmed, 0);

  elements.get('confirm-cancel').onclick();
  assert.equal(elements.get('confirm-modal').style.display, 'none');
  assert.equal(confirmed, 0);

  context.showConfirmDialog('再次確認', () => { confirmed += 1; });
  elements.get('confirm-ok').onclick();
  assert.equal(elements.get('confirm-modal').style.display, 'none');
  assert.equal(confirmed, 1);
});

test('首次轉生成功彈窗依 Worker header Snapshot 顯示天賦解鎖提示', () => {
  const { context, elements } = loadGameContext();
  context.UI_WORKER_STATE.panels.header = {
    player: { reincarnations: 1 }
  };

  context.showConfirmDialog('轉生成功', () => {}, { title: '轉生成功' });

  const message = elements.get('confirm-message');
  assert.equal(message.children.length, 1);
  assert.equal(message.children[0].textContent, '已解鎖威能系統！');
});
