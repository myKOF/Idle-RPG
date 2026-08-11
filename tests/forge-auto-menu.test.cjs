const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function functionBody(src, name) {
  const start = src.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, 'missing function ' + name);
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  assert.fail('unterminated function ' + name);
}

test('神鑄自動放入選單將素材清單與固定操作列分離', () => {
  const uiJs = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');

  assert.match(uiJs, /class="fam-list"/);
  assert.match(uiJs, /class="fam-foot"/);
  assert.match(uiJs, /fam-gem-mode/);
  assert.match(uiJs, /famList\.style\.height/);
  // 兩種素材列各自帶得上自己的識別屬性，點擊委派才找得到
  const body = functionBody(uiJs, 'renderForgeAutoMenu');
  assert.match(body, /rowHtmls\.push\('<div class="fam-opt'[\s\S]*data-fam-equip/);
  assert.match(body, /rowHtmls\.push\('<div class="fam-opt'[\s\S]*data-fam-gem/);
});

/* 選單開著時，戰鬥中的每一次重繪都會重跑 renderForgeAutoMenu。整份 innerHTML 重建會把
   玩家正壓著的那一列（或確定 / 關閉鈕）換掉，瀏覽器就不發 click——按了沒反應。
   骨架只能由 famEnsureShell 建一次，之後一律逐格比對。 */
test('自動放入選單不得整份重建，否則按住的那一下點擊會被吞掉', () => {
  const uiJs = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  const body = functionBody(uiJs, 'renderForgeAutoMenu');

  assert.doesNotMatch(body, /\.innerHTML\s*=/, 'renderForgeAutoMenu 不得整份重寫 DOM');
  assert.match(body, /syncItemGridCells\(menu\.querySelector\('\.fam-list'\)/);
  assert.match(body, /famEnsureShell\(menu\)/);
  // 骨架含固定的三顆按鈕；取消鈕以 display 切換，不靠增刪節點
  const shell = uiJs.slice(uiJs.indexOf('var FAM_SHELL_HTML'), uiJs.indexOf('function famEnsureShell'));
  ['fam-confirm', 'fam-stop', 'fam-close'].forEach((id) => assert.match(shell, new RegExp(`id="${id}"`)));
  assert.match(body, /setStyleIfChanged\(stopBtn, 'display'/);
  // picked 是選取態，不可寫進指紋，否則換個選取就整份重建（見 syncItemGridCells 的告誡）
  assert.doesNotMatch(body, /' picked'/);
  assert.match(body, /famApplyPickHighlight\(menu\)/);
});

/* 法陣的素材槽、魔塵符位與神鑄背包的寶石切頁是同一個病：都是可點的格子，
   都在戰鬥中被高頻重繪。裝備切頁早就走增量更新，這兩處先前漏了。 */
test('法陣與神鑄寶石背包同樣逐格比對，不整份重建', () => {
  const uiJs = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  const body = functionBody(uiJs, 'renderForge');

  assert.doesNotMatch(body, /hex\.innerHTML\s*=/);
  assert.match(body, /syncItemGridCells\(hex, hexKeys, hexHtmls\)/);
  assert.match(body, /hexKeys\.push\('slot:' \+ i\)/);
  assert.match(body, /hexKeys\.push\('dust:' \+ di\)/);
  assert.match(body, /hexKeys\.push\('center'\)/);
  assert.doesNotMatch(body, /grid\.innerHTML = gh/);
  assert.match(body, /syncItemGridCells\(grid, gemKeys, gemHtmls\)/);
});

test('神鑄寶石自動放入會將可合成項目優先排列', () => {
  const uiJs = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');

  assert.match(uiJs, /gemOptions\.sort\(/);
  assert.match(uiJs, /b\.canForge\s*-\s*a\.canForge/);
});

test('神鑄自動放入選單的操作列固定且清單獨立捲動', () => {
  const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');

  assert.match(css, /\.forge-auto-menu\s*{[\s\S]*display:\s*flex/);
  assert.match(css, /\.forge-auto-menu\s*{[\s\S]*overflow:\s*hidden/);
  assert.match(css, /\.fam-list\s*{[\s\S]*overflow-y:\s*scroll/);
  assert.match(css, /\.fam-list\s*{[\s\S]*overscroll-behavior:\s*contain/);
  assert.match(css, /\.fam-foot\s*{[\s\S]*flex:\s*0\s+0\s+auto/);
  assert.match(css, /\.forge-auto-menu\.fam-gem-mode\s+\.fam-list\s*{[\s\S]*flex:\s*0\s+0\s+auto/);
});

test('神鑄切回頁面時依目前鑄造模式選擇素材分頁', () => {
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');

  assert.match(ui, /forge: \['forge', 'inv', 'gems', 'header'\]/, '神鑄頁應訂閱四份 Worker panel');
  assert.match(ui, /var forgeSnapshot = uiForgePanelSnapshot\(\);[\s\S]*var inventorySnapshot = uiInventoryPanelSnapshot\(\);[\s\S]*var gemsSnapshot = uiGemsPanelSnapshot\(\);[\s\S]*var headerSnapshot = uiHeaderPanelSnapshot\(\);/);
  assert.match(ui, /function forgeInventoryTab\(forge\)[\s\S]*c\.mode === 'gem'[\s\S]*return 'gems'[\s\S]*c\.mode === 'equip'[\s\S]*return 'items'/);
  assert.match(ui, /function renderForgeAutoMenu\(forge, inventorySnapshot, gemsSnapshot\)[\s\S]*var invTab = forgeInventoryTab\(forge\)/);
  assert.match(ui, /function renderForge\(\)[\s\S]*var invTab = forgeInventoryTab\(f\)/);
  [
    'placeItem', 'removeItem', 'placeGem', 'unloadAll', 'toggleDust',
    'autoFillDust', 'start', 'cancel', 'setAuto', 'setAutoFill'
  ].forEach((name) => {
    assert.match(ui, new RegExp(`sendUiCommand\\('forge\\.${name}'`), `應送出 forge.${name}`);
  });
  assert.doesNotMatch(ui, /forgeState\(\)\.unlockNotified\s*=\s*true/, 'UI 不得再寫神鑄解鎖旗標');
});

test('寶石自動放入選單會設定明確高度並隔離滑鼠滾輪', () => {
  const uiJs = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');

  assert.match(uiJs, /menu\.style\.height = invTab === 'gems'/);
  /* 高度換算是強制同步版面，選單開著時每次重繪都跑就太貴：只在骨架剛建好、
     切頁換了、或全域版面版本前進時重算（同浮字幾何快取那一套）。 */
  const heightBody = functionBody(uiJs, 'famSyncHeight');
  assert.match(heightBody, /menu\._famHeightVer === UI_FLOAT_LAYOUT_VERSION/);
  assert.match(heightBody, /UI_FLOAT_LAYOUT_MAX_AGE_MS/);
  assert.match(uiJs, /addEventListener\('wheel'/);
  assert.match(uiJs, /list\.scrollTop \+= e\.deltaY/);
  assert.match(uiJs, /e\.stopPropagation\(\)/);
  assert.doesNotMatch(uiJs, /forgeAutoMiddleScroll/);
});
