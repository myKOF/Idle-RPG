const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const renderer = fs.readFileSync(path.join(root, 'js/battle-renderer.js'), 'utf8');

/* ============================================================
   穿透式角色輪廓（js/battle-renderer.js 的 PLAYER_OUTLINE）

   角色本體維持原樣被特效遮擋，另外把一圈只有邊緣的輪廓畫在所有特效之上。
   會讓這個功能「安靜地失效」的有兩件事，這裡各釘一條：

     ① 輪廓層被排到特效層底下 —— 畫面上什麼都不會壞，只是輪廓再也蓋不住特效，
        也就是整個功能等於沒做。
     ② syncOutline 的座標算錯 —— 輪廓不在 root 底下（掛進去就會被特效一起蓋住），
        位置是自己算的；算錯就是輪廓和角色分家。

   ② 用實際數值驗：把函式挖出來跑，拿獨立寫的一套矩陣連乘當標準答案。
   貼圖本身（外擴量、是否空心、跨格污染）需要 canvas，驗證在
   scratch/_outline_verify.html，那支直接抓現役程式來跑。
   ============================================================ */

/* 從原始碼挖出 `function NAME(...) { ... }` 整段（大括號配對）。 */
function extractFunction(src, name) {
  const head = src.indexOf('function ' + name + '(');
  assert.notEqual(head, -1, '找不到函式 ' + name + '——改名了就要同步更新這支測試');
  let i = src.indexOf('{', head);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(head, i + 1);
    }
  }
  throw new Error(name + ' 的大括號沒有配對');
}

/* 獨立實作的 2D 仿射矩陣（與 Pixi 相同的排法），用來當標準答案。
   同一組姿勢已在瀏覽器上與 Pixi 自己算的 worldTransform 對過（誤差 0）。 */
function mat(x, y, rot, sx, sy) {
  const c = Math.cos(rot), s = Math.sin(rot);
  return { a: c * sx, b: s * sx, c: -s * sy, d: c * sy, tx: x, ty: y };
}
function mul(m, n) {   // 先套 n 再套 m
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    tx: m.a * n.tx + m.c * n.ty + m.tx,
    ty: m.b * n.tx + m.d * n.ty + m.ty
  };
}

function makeSprite() {
  return {
    destroyed: false, visible: false, texture: null,
    x: 0, y: 0, rotation: 0,
    scale: { x: 1, y: 1, set(a, b) { this.x = a; this.y = (b === undefined ? a : b); } }
  };
}

function loadSync() {
  const code = extractFunction(renderer, 'rotateOutlinePt') +
    '\nvar _outlinePt = { x: 0, y: 0 };\n' +
    extractFunction(renderer, 'syncOutline');
  const outlineTex = { id: 'outline-frame' };
  const bodyTex = { id: 'body-frame' };
  const ctx = {
    Math, console,
    S: { sheets: { player: { outline: { map: new Map([[bodyTex, outlineTex]]) } } } }
  };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return { syncOutline: ctx.syncOutline, ctx, outlineTex, bodyTex };
}

function makeEnt(pose, bodyTex, sprite) {
  return {
    sheetName: 'player',
    outline: sprite,
    root: {
      x: pose.root.x, y: pose.root.y, rotation: pose.root.rotation || 0,
      scale: { x: pose.root.s || 1, y: pose.root.s || 1 }, visible: true, destroyed: false
    },
    bodyWrap: {
      x: pose.wrap.x || 0, y: pose.wrap.y || 0, rotation: pose.wrap.rotation || 0,
      scale: { x: pose.wrap.sx || 1, y: pose.wrap.sy || 1 }, visible: true
    },
    body: {
      x: pose.body && pose.body.x || 0, y: pose.body && pose.body.y || 0,
      scale: { x: 3.154, y: 3.154 }, texture: bodyTex, visible: true, destroyed: false
    }
  };
}

/* 實際會出現的姿勢：站立、向左翻面、倒地旋轉、受擊彈跳（root 縮放）。 */
const POSES = [
  { name: '站立', root: { x: 1200, y: -340 }, wrap: {} },
  { name: '向左翻面', root: { x: 90210, y: 512 }, wrap: { sx: -1, x: -6.5, y: 1.5 } },
  { name: '倒地旋轉', root: { x: -455.25, y: 88 }, wrap: { rotation: -Math.PI / 2 * 0.83, x: 3, y: -2 } },
  { name: '受擊彈跳', root: { x: 0, y: 0, s: 1.11 }, wrap: { sx: -1, rotation: 0.21, x: 14, y: -3 } },
  { name: '本體有偏移', root: { x: 77, y: -12, s: 0.94 }, wrap: { sx: -1, rotation: 0.4, x: 5, y: 5 }, body: { x: 9, y: -4 } },
  /* root 目前只有位移與受擊縮放，但 syncOutline 也處理了 root 旋轉——
     沒有這一組的話，那兩行算錯了測試也不會紅（實測：兩個突變體存活）。 */
  { name: 'root 也旋轉', root: { x: 12, y: 34, s: 1.05, rotation: 0.6 }, wrap: { sx: -1, rotation: -0.25, x: 8, y: -6 }, body: { x: 3, y: 7 } }
];

test('輪廓與角色本體的世界座標完全一致（root → bodyWrap → body 這條鏈）', () => {
  const { syncOutline, bodyTex, outlineTex } = loadSync();
  for (const pose of POSES) {
    const sp = makeSprite();
    const ent = makeEnt(pose, bodyTex, sp);
    syncOutline(ent);

    const expected = mul(mul(
      mat(ent.root.x, ent.root.y, ent.root.rotation, ent.root.scale.x, ent.root.scale.y),
      mat(ent.bodyWrap.x, ent.bodyWrap.y, ent.bodyWrap.rotation, ent.bodyWrap.scale.x, ent.bodyWrap.scale.y)),
      mat(ent.body.x, ent.body.y, 0, ent.body.scale.x, ent.body.scale.y));
    const actual = mat(sp.x, sp.y, sp.rotation, sp.scale.x, sp.scale.y);

    for (const k of ['a', 'b', 'c', 'd', 'tx', 'ty']) {
      assert.ok(Math.abs(expected[k] - actual[k]) < 1e-9,
        pose.name + ' 的輪廓矩陣 ' + k + ' 不符：' + actual[k] + ' ≠ ' + expected[k]);
    }
    assert.equal(sp.texture, outlineTex, pose.name + ' 應掛上對應幀的輪廓貼圖');
    assert.equal(sp.visible, true, pose.name + ' 的輪廓應為可見');
  }
});

test('查不到對應幀的輪廓貼圖時寧可不畫，不沿用上一幀', () => {
  const { syncOutline, bodyTex } = loadSync();
  const sp = makeSprite();
  const ent = makeEnt(POSES[0], bodyTex, sp);
  syncOutline(ent);
  assert.equal(sp.visible, true);
  ent.body.texture = { id: '沒有登記過的幀' };
  syncOutline(ent);
  assert.equal(sp.visible, false, '對照表查不到就必須隱藏——畫上一幀等於輪廓擺出別的姿勢');
});

test('輪廓層排在所有特效之上、飄字與玩家 HUD 之下', () => {
  /* 釘相對順序而不是字面：輪廓的用途就是壓在特效上面，被排到特效底下＝功能沒了。 */
  const names = ['zone', 'entity', 'fx', 'presetFx', 'outlineLayer', 'floatLayer', 'playerHud'];
  const at = names.map((n) => renderer.indexOf('world.addChild(' + n + ')'));
  names.forEach((n, i) => assert.ok(at[i] > 0, '找不到 world.addChild(' + n + ')'));
  for (let i = 1; i < at.length; i++) {
    assert.ok(at[i] > at[i - 1], '層順序不對：' + names[i] + ' 必須晚於 ' + names[i - 1] + ' 加入');
  }
  assert.match(renderer, /outline:\s*outlineLayer/);
});

test('輪廓掛在獨立圖層而不是角色 root，且每幀都會同步', () => {
  /* 掛進 root 就會跟著本體一起被特效蓋住，那正是這個功能要解決的事。 */
  assert.match(renderer, /S\.layers\.outline\.addChild\(sp\)/);
  assert.doesNotMatch(renderer, /root\.addChild\(outline\)/);
  assert.match(renderer, /var outline = makeOutlineSprite\('player', body\)/);
  /* 同步必須在 `if (p && dt > 0)` 區塊之外：暫停時 dt 是 0，輪廓仍要對齊。 */
  assert.match(renderer, /\n {4}if \(p\) syncOutline\(p\);/);
  /* 玩家序列幀載入時要一併備好輪廓貼圖。 */
  assert.match(renderer, /loadSheet\('player', 'images\/sprites\/player', \{ outline: true \}\)/);
});
