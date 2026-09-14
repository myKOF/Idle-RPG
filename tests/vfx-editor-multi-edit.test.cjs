'use strict';
/* ============================================================
   vfx-editor-multi-edit.test.cjs — Inspector 多選批次編輯

   受測對象：
     tools/vfx/editor/multi-edit-model.js  選取展開、共同值、欄位交集、還原（純函式）
     tools/vfx/editor/editor.js            Inspector 的每個寫入點都經過「全部目標」

   需求（2026-09-14）：Layers 多選之後一起調整參數，例如選好幾層一起改縮放。

   全檔反覆驗證的兩條不變量：
     **各層不同時不挑任何一層的值出來顯示。**
       挑出來的數字看起來就像共同值，順手點進去再離開就會把全部寫成那一層的值。
     **寫進多層的值各自獨立，不共用同一個物件。**
       共用的話，之後單獨改其中一層會連帶改到其他層，而且畫面上看不出來。
   ============================================================ */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const MX = require('../tools/vfx/editor/multi-edit-model.js');

const REPO = path.resolve(__dirname, '..');
const editorSrc = () => fs.readFileSync(path.join(REPO, 'tools/vfx/editor/editor.js'), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/* editor.js 的函式都在 IIFE 內、縮排兩格，第一個「換行＋兩格＋}」就是函式結尾。 */
function fnBody(src, name) {
  const at = src.indexOf('function ' + name + '(');
  assert.ok(at >= 0, '找不到 function ' + name);
  const rest = src.slice(at);
  return rest.slice(0, rest.indexOf('\n  }'));
}

function fixture() {
  return {
    preset: {
      layers: [
        { id: 'a', type: 'sprite' },
        { id: 'b', type: 'sprite' },
        { id: 'c', type: 'particle' },
        { id: 'd', type: 'procedural' }
      ]
    },
    layout: { groups: [{ id: 'g', name: 'g', layerIds: ['b', 'c'] }], order: [] }
  };
}

/* ---------------- 純函式 ---------------- */

test('MULTI-1 選取展開成圖層：群組換成成員、去重、順序跟 preset.layers', () => {
  const { preset, layout } = fixture();
  assert.deepStrictEqual(MX.targetLayerIds(preset, layout, ['layer:d', 'layer:a']), ['a', 'd'],
    '順序跟 preset.layers，不跟點選順序');
  assert.deepStrictEqual(MX.targetLayerIds(preset, layout, ['group:g']), ['b', 'c'],
    '群組沒有自己的參數，改群組就是改成員');
  assert.deepStrictEqual(MX.targetLayerIds(preset, layout, ['group:g', 'layer:b', 'layer:a']),
    ['a', 'b', 'c'], '群組與成員同時選到時，成員只算一次');
  assert.deepStrictEqual(MX.targetLayerIds(preset, layout, ['layer:ghost', 'group:nope', 'bad']), [],
    '不存在的 key 略過，不丟例外');
  assert.deepStrictEqual(MX.targetLayerIds(preset, null, ['group:g', 'layer:a']), ['a'],
    '沒有 layout 時群組展不開，但圖層照算');
  assert.deepStrictEqual(MX.targetLayerIds(null, layout, ['layer:a']), []);
});

test('MULTI-2 共同值：相同就給值，不同只說 mixed、不帶出任何一層', () => {
  const read = (l) => l.v;
  assert.deepStrictEqual(MX.commonValue([{ v: 0.5 }, { v: 0.5 }], read), { mixed: false, value: 0.5 });

  const diff = MX.commonValue([{ v: 0.5 }, { v: 0.3 }], read);
  assert.equal(diff.mixed, true);
  assert.equal(diff.value, undefined, 'mixed 時不得帶出任何一層的值');

  assert.equal(MX.commonValue([{ v: { x: 1, y: 2 } }, { v: { y: 2, x: 1 } }], read).mixed, false,
    '鍵的順序不同仍是同一個值——Inspector 補欄位時建物件的順序不一定與檔案相同');
  assert.equal(MX.commonValue([{ v: [[0, 1], [1, 2]] }, { v: [[0, 1], [1, 2]] }], read).mixed, false,
    '曲線逐點相同');
  assert.equal(MX.commonValue([{ v: [[0, 1], [1, 2]] }, { v: [[0, 1], [1, 3]] }], read).mixed, true,
    '差一個點就是不同');
  assert.equal(MX.commonValue([{}, {}], read).mixed, false, '都沒有這個欄位＝相同');
  assert.equal(MX.commonValue([{}, { v: 0 }], read).mixed, true,
    '「沒有」與 0 不同；要當成相同，得由 read 先換算預設值');
  assert.equal(MX.commonValue([{ v: { x: 1, y: undefined } }, { v: { x: 1 } }], read).mixed, false,
    '值是 undefined 的鍵與沒有這個鍵相同（與 JSON 一致）');
  assert.deepStrictEqual(MX.commonValue([], read), { mixed: false, value: undefined });

  /* read 負責換算預設值：enabled 沒寫就是 true */
  const enabled = (l) => (l.enabled === undefined ? true : l.enabled !== false);
  assert.deepStrictEqual(MX.commonValue([{}, { enabled: true }], enabled), { mixed: false, value: true });
  assert.equal(MX.commonValue([{}, { enabled: false }], enabled).mixed, true);
});

test('MULTI-3 欄位取交集，順序沿用第一份', () => {
  const A = { key: 'alpha' }, S = { key: 'scale' }, O = { key: 'outerScale' }, G = { key: 'gravity' };
  assert.deepStrictEqual(MX.sharedFields([[A, S, O], [S, A, O]]).map((f) => f.key),
    ['alpha', 'scale', 'outerScale']);
  assert.deepStrictEqual(MX.sharedFields([[A, O], [A, G]]).map((f) => f.key), ['alpha'],
    'sprite 的 outerScale 與 particle 的 gravity 都不是共同欄位');
  assert.deepStrictEqual(MX.sharedFields([[A, S]]).map((f) => f.key), ['alpha', 'scale'],
    '單選就是原本的清單，一格都不少');
  assert.deepStrictEqual(MX.sharedFields([]), []);
});

test('MULTI-4 allOrNone：全部、全不、混合', () => {
  const isSprite = (l) => l.type === 'sprite';
  assert.equal(MX.allOrNone([{ type: 'sprite' }, { type: 'sprite' }], isSprite), true);
  assert.equal(MX.allOrNone([{ type: 'particle' }], isSprite), false);
  assert.equal(MX.allOrNone([{ type: 'sprite' }, { type: 'particle' }], isSprite), null,
    '混著的時候不能歸成任何一邊');
});

test('MULTI-5 寫進多層的值各自獨立：改其中一層不會牽動其他層', () => {
  const layers = [{ id: 'a' }, { id: 'b' }, { id: 'c', scaleOverLife: 1 }];
  const curve = [[0, 1], [1, 0]];
  MX.writeAll(layers, 'scaleOverLife', curve);
  layers.forEach((l) => assert.deepStrictEqual(l.scaleOverLife, [[0, 1], [1, 0]]));

  layers[0].scaleOverLife[1][1] = 9;
  assert.equal(layers[1].scaleOverLife[1][1], 0, '共用同一個陣列的話，這裡會跟著變成 9');
  assert.equal(curve[1][1], 0, '呼叫端傳進來的值也不能被牽動');

  MX.writeAll(layers, 'scaleOverLife', undefined);
  layers.forEach((l) => assert.ok(!Object.prototype.hasOwnProperty.call(l, 'scaleOverLife'),
    'undefined＝刪掉鍵，不是留一個值為 undefined 的鍵'));
});

test('MULTI-6 清空輸入框＝不改了：每一層回到各自的原值，本來沒有的鍵要刪掉', () => {
  const layers = [{ id: 'a', rotation: 0.5 }, { id: 'b' }, { id: 'c', rotation: -1 }];
  const saved = MX.captureField(layers, 'rotation');
  MX.writeAll(layers, 'rotation', 2);
  MX.restoreField(layers, 'rotation', saved);
  assert.equal(layers[0].rotation, 0.5);
  assert.ok(!('rotation' in layers[1]), 'b 本來沒有 rotation，還原後也不能多出一個');
  assert.equal(layers[2].rotation, -1);

  /* 物件型欄位記的是複本：中途的修改不會污染記下來的原值 */
  const vecs = [{ scale: { x: 0.5, y: 0.3 } }, { scale: { x: 1, y: 1 } }];
  const kept = MX.captureField(vecs, 'scale');
  vecs[0].scale.x = 9;
  MX.restoreField(vecs, 'scale', kept);
  assert.deepStrictEqual(vecs[0].scale, { x: 0.5, y: 0.3 });
  vecs[0].scale.y = 7;
  MX.restoreField(vecs, 'scale', kept);
  assert.equal(vecs[0].scale.y, 0.3, '還原兩次都要拿到原值：還原時也要給複本');
});

test('MULTI-7 分軸縮放的情境：只改 X 時各層的 Y 保持各自的值', () => {
  /* Inspector 的 vec2 是一軸一格。多選時改 scale 的 X，Y 不能被順手統一——
     這裡用 Inspector 實際走的那兩個基本操作重演一次。 */
  const layers = [
    { id: 'plate', scale: { x: 0.5667, y: 0.5667 } },
    { id: 'shadow', scale: { x: 0.7155, y: 0.186 } },
    { id: 'bare' }
  ];
  const readX = (l) => (l.scale && l.scale.x !== undefined ? l.scale.x : 1);
  const readY = (l) => (l.scale && l.scale.y !== undefined ? l.scale.y : 1);
  assert.equal(MX.commonValue(layers, readX).mixed, true);

  layers.forEach((l) => {
    if (!l.scale) l.scale = { x: 1, y: 1 };
    l.scale.x = 0.8;
  });
  assert.deepStrictEqual(MX.commonValue(layers, readX), { mixed: false, value: 0.8 });
  assert.deepStrictEqual(layers.map(readY), [0.5667, 0.186, 1], '各層的 Y 維持原樣');
});

/* ---------------- editor.js 的接線 ---------------- */

test('MULTI-8 Inspector 從 inspectorTargets 取得編輯對象，欄位寫入沒有只寫單層的漏網之魚', () => {
  const src = stripComments(editorSrc());
  const body = fnBody(src, 'renderInspector');
  assert.ok(/inspectorTargets\(\)/.test(body), 'Inspector 要從 inspectorTargets 取得編輯對象');
  /* 只寫一層的寫法（layer[...] = 、lead[...] =）在多選時會變成「改了只有一層有反應」 */
  assert.ok(!/\b(layer|lead)\[[^\]]+\]\s*=[^=]/.test(body), '欄位不得直接寫單一圖層');
  assert.ok(!/\b(layer|lead)\.(radiusProfile|water)\[[^\]]+\]\s*=[^=]/.test(body),
    '水柱的參數也要寫到全部目標');
  assert.ok(/renderOverLife\(host, targets\)/.test(body), 'OVER-LIFE 也吃同一組目標');

  const targets = fnBody(src, 'inspectorTargets');
  assert.ok(/MX\.targetLayerIds\(/.test(targets), '選取展開只有 multi-edit-model 一份實作');
});

test('MULTI-9 多選時拿掉 id，其餘欄位取交集', () => {
  const src = stripComments(editorSrc());
  const body = fnBody(src, 'inspectorFields');
  assert.ok(/f\.key !== 'id'/.test(body), 'id 批次寫同一個值只會撞名');
  assert.ok(/MX\.sharedFields\(/.test(body), '型別不同時取交集');
});

test('MULTI-10 曲線：各層相同才畫出來一起改，不同時走說明列，不挑一層冒充', () => {
  const src = stripComments(editorSrc());
  ['curveBlock', 'gradientBlock'].forEach((name) => {
    const body = fnBody(src, name);
    assert.ok(/MX\.commonValue\(targets/.test(body), name + ' 要先比對各層是否相同');
    assert.ok(/mixedCurveRow\(/.test(body), name + ' 各層不同時要走說明列');
    assert.ok(/writeCurve\(targets, field, curve\)/.test(body), name + ' 要寫到全部目標');
  });
  const mixed = fnBody(src, 'mixedCurveRow');
  assert.ok((mixed.match(/edit\('/g) || []).length >= 2, '統一與停用各是一筆歷史');

  const overLife = fnBody(src, 'renderOverLife');
  assert.ok(/MX\.allOrNone\(targets, supportsPerAxisScale\)/.test(overLife),
    '分軸曲線要看「全部」是不是 sprite／procedural，混著 particle 時不能畫');
  const link = fnBody(src, 'setScaleLink');
  assert.equal((link.match(/window\.confirm\(/g) || []).length, 1,
    '多選接回等比時只問一次，不是每一層問一次');
});

test('MULTI-11 選擇素材：多選時換掉全部選取圖層的素材，而且是一筆歷史', () => {
  const src = stripComments(editorSrc());
  const apply = fnBody(src, 'applyPicker');
  assert.ok(/edit\('更換素材', function \(\) \{ MX\.writeAll\(targets, field, value\)/.test(apply));
  assert.ok(/openPicker\(targets, f\.key\)/.test(src));
  assert.ok(!/picker\.layer\b/.test(src), '舊的單層欄位 picker.layer 不應再出現');
});

test('MULTI-12 數值欄位清空時還原各層原值，不是全部刪掉或歸零', () => {
  const src = stripComments(editorSrc());
  const helper = fnBody(src, 'clearRestorer');
  assert.ok(/MX\.captureField\(/.test(helper) && /MX\.restoreField\(/.test(helper));
  assert.ok(/'focus'/.test(helper), '原值要在聚焦當下記下來');
  const body = fnBody(src, 'renderInspector');
  assert.ok((body.match(/clearRestorer\(/g) || []).length >= 3, 'vec2、angle、number 都要接上');
});

test('MULTI-13 預覽拖曳時同步的輸入框也看全部目標', () => {
  /* 多選時拖的是作用中那一層，拖完那一格就不再是共同值，要改顯示成「多個值」 */
  const src = stripComments(editorSrc());
  const body = fnBody(src, 'syncTransformInputs');
  assert.ok(/inspectorTargets\(\)/.test(body));
  assert.ok(/MX\.commonValue\(/.test(body));
});

test('MULTI-14 index.html 載入順序：layer-model → multi-edit-model → editor.js', () => {
  const html = fs.readFileSync(path.join(REPO, 'tools/vfx/editor/index.html'), 'utf8');
  const at = (s) => html.indexOf(s);
  assert.ok(at('layer-model.js') > 0, '找不到 layer-model.js');
  assert.ok(at('multi-edit-model.js') > at('layer-model.js'), '依賴 layer-model，必須排在它後面');
  assert.ok(at('multi-edit-model.js') < at('editor/editor.js'));
  assert.ok(/'VFXMultiEditModel'/.test(editorSrc()), '要列進 checkModules');
});
