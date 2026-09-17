'use strict';
/* ============================================================
   vfx-editor-filename-id.test.cjs — 檔名優先於檔案內的 id

   2026-09-14 使用者回報：用「另存新檔」複製出 x-copy.json，在檔案總管改名成
   x-blue.json 後重新載入，畫面上仍然是 x-copy。原因是編輯器照 JSON 裡的 "id"
   顯示與存檔——而一按存檔會另外寫出一份 x-copy.json，改好名的那份反而沒更新。

   受測對象：tools/vfx/editor/editor.js 的 adoptFileName 與它的兩個呼叫點
   （「載入 Preset」與網址 ?preset= 開啟）。adoptFileName 從原始碼挖出來丟進 vm 跑，
   驗行為而不是只驗名字還在。
   ============================================================ */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const REPO = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(REPO, 'tools/vfx/editor/editor.js'), 'utf8');
const policy = require('../tools/vfx/editor/preset-id-policy.js');

/* 從 function 關鍵字開始數大括號，挖出整個函式。改名時這裡會直接失敗，不會靜靜跳過。 */
function extractFunction(src, name) {
  const at = src.indexOf('function ' + name + '(');
  assert.ok(at >= 0, '找不到 function ' + name);
  let depth = 0;
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  throw new Error(name + ' 的大括號沒有配對');
}

function body(name) {
  const fn = SRC.slice(SRC.indexOf('function ' + name + '('));
  return fn.slice(0, fn.indexOf('\n  }'));
}

const context = { VFXPresetIdPolicy: policy };
vm.createContext(context);
vm.runInContext(extractFunction(SRC, 'adoptFileName') + '; this.adoptFileName = adoptFileName;', context);
const adoptFileName = context.adoptFileName;

test('NAME-1 檔名與檔案內的 id 不同時，改用檔名', function () {
  const preset = { id: 'slash-thrust-scatter-copy' };
  const r = adoptFileName(preset, 'slash-thrust-scatter-blue.json');
  assert.equal(preset.id, 'slash-thrust-scatter-blue', '存檔要寫到改好名的那一份');
  assert.equal(r.renamedFrom, 'slash-thrust-scatter-copy', '要記得舊名字：分組檔還留在那底下');
  assert.equal(r.problem, null);
});

test('NAME-2 名字本來就一致時什麼都不動', function () {
  const preset = { id: 'beam-light' };
  const r = adoptFileName(preset, 'beam-light.json');
  assert.equal(preset.id, 'beam-light');
  assert.equal(r.renamedFrom, null);
  assert.equal(r.problem, null);
});

test('NAME-3 不能當 id 的檔名：維持檔案內的 id，並回報原因', function () {
  for (const bad of ['slash-thrust-scatter - 複製.json', 'Beam-Light.json', 'a b.json']) {
    const preset = { id: 'beam-light' };
    const r = adoptFileName(preset, bad);
    assert.equal(preset.id, 'beam-light', bad + ' 不該被拿來當 id');
    assert.equal(r.renamedFrom, null);
    assert.ok(r.problem, bad + ' 要說明為什麼不能用');
  }
});

test('NAME-4 兩個入口都走 adoptFileName；不再「停用存檔」，改名後分組跟著搬', function () {
  const load = body('loadPresetFromFile');
  assert.ok(/adoptFileName\(parsed, file && file\.name\)/.test(load), '載入 Preset 要看檔名');
  assert.ok(/adoptLayoutFor\(parsed, naming\.renamedFrom\)/.test(load),
    '載入 Preset 也要帶分組，否則一存檔群組就沒了');
  assert.ok(/announceNaming\(naming\)/.test(load), '換了名字要讓使用者知道');

  /* 從網址開啟、從選單或瀏覽特效開啟，都走 openPresetInPane（2026-09-17 多視窗之後不再整頁重載） */
  const open = body('openPresetInPane');
  assert.ok(/adoptFileName\(state\.preset, id \+ '\.json'\)/.test(open),
    '開啟 repo 裡的特效時，檔名就是那份的 id');
  assert.ok(open.indexOf('adoptFileName') > open.indexOf('state.savedText = VFXCore.serialisePreset'),
    '基準線要是換名字之前的內容，換完才會顯示未存檔');
  assert.ok(/openPresetInPane\(first, query\.ids\[0\]\)/.test(body('boot')), '開場也走這一條');
  assert.ok(!/已停用存檔/.test(SRC), '以前的「preset.id 與檔名不一致，已停用存檔」要拿掉');

  const adopt = body('adoptLayoutFor');
  assert.ok(/loadLayout\(renamedFrom\)/.test(adopt), '新名字底下沒有分組檔時，要去舊名字那裡找');
  assert.ok(/renameRootGroup\(preset\.id\)/.test(adopt), '搬過來的根群組要跟著改名（VFX_AGENT_WORKFLOW §9.11）');
  assert.ok(/state\.preset !== preset/.test(adopt), '非同步回來時要確認還是同一份 preset');
});

test('NAME-5 名稱跟著畫面上的特效走；存檔時沒有群組就自動收成單一根群組', function () {
  /* 2026-09-14 使用者回報兩件事：載入 Preset 之後下拉還寫著上一份的名字；
     另存新檔出來的特效沒有群組。 */
  const load = body('loadPresetFromFile');
  assert.ok(/syncPresetIdentity\(\)/.test(load), '載入 Preset 之後下拉的名字要換成這一份');
  const sync = body('syncPresetIdentity');
  assert.ok(/combo\.currentId = id/.test(sync) && /comboDisplayText\(\)/.test(sync));
  assert.ok(/replaceState/.test(sync) && /inRepo/.test(sync), '網址只在 repo 裡有這份時才改');

  const save = body('saveLayout');
  assert.ok(/!state\.layout\.groups\.length/.test(save), '一個群組都沒有時要補上');
  assert.ok(/id: state\.preset\.id, name: state\.preset\.id/.test(save),
    '根群組的 id 與名稱取 preset id（VFX_AGENT_WORKFLOW §9.11）');
  assert.ok(save.indexOf('groups.length') < save.indexOf('validateLayout'), '要在驗證與送出之前補上');
});

test('NAME-6 「已改用檔名」要留在畫面上，不能被 refreshDirty 清掉', function () {
  /* 2026-09-14 瀏覽器實測抓到的：提示寫進去之後，分組非同步載完會呼叫 refreshDirty；
     改了名字本來就是未存檔，它把 ok 樣式當成過期的「已存檔」清空，畫面上什麼都沒留下。
     三個函式從原始碼挖出來照真正的順序跑，驗的是結果而不是寫法。 */
  const els = {
    'save-status': { textContent: '', className: 'save-status', title: '' },
    'dirty-flag': { textContent: '', className: 'dirty' }
  };
  const ctx = {
    $: (id) => els[id] || null,
    isDirty: () => true,
    state: { preset: { id: 'slash-thrust-scatter-blue' } },
    renderPaneHeads: () => {},
    showSaveError: () => { throw new Error('改名成功不該走到錯誤訊息'); }
  };
  vm.createContext(ctx);
  vm.runInContext(['setSaveStatus', 'refreshDirty', 'announceNaming']
    .map((n) => extractFunction(SRC, n)).join('\n') +
    '; this.announceNaming = announceNaming; this.refreshDirty = refreshDirty;' +
    ' this.setSaveStatus = setSaveStatus;', ctx);

  ctx.announceNaming({ fileId: 'slash-thrust-scatter-blue', renamedFrom: 'slash-thrust-scatter-copy', problem: null });
  ctx.refreshDirty();
  const st = els['save-status'];
  assert.ok(/已改用檔名：slash-thrust-scatter-blue/.test(st.textContent), '提示被清掉了：「' + st.textContent + '」');
  assert.ok(/slash-thrust-scatter-copy/.test(st.title), '滑鼠移上去要看得到檔案內原本的 id');
  assert.equal(els['dirty-flag'].textContent, '● 未存檔', '同時要顯示未存檔：新名字還沒寫進檔案');

  ctx.setSaveStatus('存檔中…', '');
  assert.equal(st.title, '', '換成別的狀態時，上一則的說明不能還掛在 title 上');
});
