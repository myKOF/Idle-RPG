const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

/* ============================================================
   移動場域的畫面運動：直接跑數值，不是比對原始碼字串

   兩個渲染器（Canvas 的 js/battle-renderer.js、DOM 後備的 js/vfx.js）都把
   運動模型寫在自己的閉包裡，外面拿不到。這裡用大括號配對把指定的函式整段挖出來
   再放進 VM 執行——函式改名或被刪掉時測試會直接失敗，不會靜靜地跳過。

   釘的是 AI_RULES 8.3.1 的兩個可量測性質：
     ① 兩則事件之間畫面不得停住（沒有靜止畫格）
     ② 也不得為了補距離而衝刺（單幀位移不得遠超過模擬層的速度）
   ============================================================ */

/* 從原始碼挖出 `function NAME(...) { ... }` 整段（大括號配對，字面量夠單純）。 */
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

function loadFieldMotion(file, names, extra) {
  const src = read(file);
  const code = (extra || '') + names.map((n) => extractFunction(src, n)).join('\n');
  const ctx = { Math, Number, isFinite, console };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return ctx;
}

/* 事件的實測到達樣態：Worker 以固定間隔批次送出，而場域自己的節拍與它不整除，
   因此「事件描述的模擬時刻」與「事件抵達的真實時刻」永遠對不齊。
   雷球的量級：速度 60px/s、節拍 0.35s、沿 +X 直線飛向 300px 外的落點。 */
const PACKETS = [
  { at: 0.4, simT: 0.4 }, { at: 0.8, simT: 0.7 }, { at: 1.2, simT: 1.1 },
  { at: 1.4, simT: 1.4 }, { at: 1.8, simT: 1.75 }, { at: 2.0, simT: 2.1 }
];
const SPEED = 60;
const FRAME = 1 / 60;
const DEST = 300;

function replaySteps(onEvent, onFrame, readX) {
  let next = 0;
  const xs = [];
  for (let frame = 1; frame <= 150; frame++) {
    while (next < PACKETS.length && PACKETS[next].at <= frame * FRAME) {
      onEvent(PACKETS[next].simT * SPEED);
      next++;
    }
    onFrame(FRAME);
    xs.push(readX());
  }
  /* 出生的那一幀畫面值＝權威值（沒有推算歷史），不計入步長統計。 */
  return xs.slice(1).map((v, i) => v - xs[i]);
}

function assertSmooth(steps, label) {
  const ideal = SPEED * FRAME;
  const still = steps.filter((d) => d <= 1e-6).length;
  assert.equal(still, 0, label + '：不得有靜止畫格（那就是一格一格移動），實際 ' + still + ' 幀');
  assert.ok(Math.max.apply(null, steps) <= ideal * 1.35,
    label + '：單幀位移不得遠超過模擬層的速度，實際最大 ' + Math.max.apply(null, steps).toFixed(3));
  assert.ok(Math.min.apply(null, steps) >= ideal * 0.65,
    label + '：也不得慢到近乎停頓，實際最小 ' + Math.min.apply(null, steps).toFixed(3));
}

test('Canvas：移動場域兩則事件之間仍以模擬層的速度前進', () => {
  const ctx = loadFieldMotion('js/battle-renderer.js',
    ['fieldApproach', 'fieldMotionInit', 'fieldMotionAim', 'fieldMotionStep'],
    'var FIELD_VFX_FOLLOW_TAU_SEC = 0.14;\n' +
    'var FIELD_VFX_MAX_RESIDUAL_PX = 100;\n' +
    'var FIELD_VFX_CORRECT_MAX_RATIO = 0.3;\n');

  const area = { x: 0, y: 0, speed: SPEED, moveA: 0, destX: DEST, destY: 0 };
  const fx = ctx.fieldMotionInit({}, area, 30, 30);
  const steps = replaySteps(
    (x) => ctx.fieldMotionAim(fx, { x, y: 0, speed: SPEED, moveA: 0, destX: DEST, destY: 0 }, 30, 30),
    (dt) => ctx.fieldMotionStep(fx, dt),
    () => fx.x
  );
  assertSmooth(steps, 'Canvas');
});

test('DOM 後備：移動場域兩則事件之間仍以模擬層的速度前進', () => {
  const ctx = loadFieldMotion('js/vfx.js', ['vfxFieldMotionStep'],
    'var VFX_FIELD_FOLLOW_TAU_SEC = 0.14;\n' +
    'var VFX_FIELD_CORRECT_MAX_RATIO = 0.3;\n');

  /* vfxFieldMotionSet 會碰 DOM，這裡直接組出它產生的 state 形狀。 */
  const state = {
    x: 0, y: 0, w: 30, h: 30, toW: 30, toH: 30,
    baseX: 0, baseY: 0, offX: 0, offY: 0,
    speed: SPEED, moveA: 0, destX: DEST, destY: 0
  };
  const steps = replaySteps(
    (x) => {
      const prevX = state.baseX + state.offX;
      state.baseX = x;
      state.offX = prevX - x;
    },
    (dt) => ctx.vfxFieldMotionStep(state, dt),
    () => state.x
  );
  assertSmooth(steps, 'DOM');
});

/* 抵達落點就停駐（雷球飛到定點後停留）：事件不再帶運動語意，畫面也必須停下來，
   不能靠推算自己飄過頭。 */
test('Canvas：落點抵達後畫面跟著停駐', () => {
  const ctx = loadFieldMotion('js/battle-renderer.js',
    ['fieldApproach', 'fieldMotionInit', 'fieldMotionAim', 'fieldMotionStep'],
    'var FIELD_VFX_FOLLOW_TAU_SEC = 0.14;\n' +
    'var FIELD_VFX_MAX_RESIDUAL_PX = 100;\n' +
    'var FIELD_VFX_CORRECT_MAX_RATIO = 0.3;\n');

  const fx = ctx.fieldMotionInit({}, { x: 0, y: 0, speed: SPEED, moveA: 0, destX: 30, destY: 0 }, 30, 30);
  for (let i = 0; i < 120; i++) ctx.fieldMotionStep(fx, FRAME);
  assert.ok(Math.abs(fx.x - 30) < 0.5, '自走到落點就停，不得越過：' + fx.x);

  ctx.fieldMotionAim(fx, { x: 30, y: 0 }, 30, 30);   // 停駐後的事件不帶運動語意
  const before = fx.x;
  for (let i = 0; i < 60; i++) ctx.fieldMotionStep(fx, FRAME);
  assert.ok(Math.abs(fx.x - before) < 0.01, '停駐後不得再前進');
});

/* 半徑／長寬的擴增（沼澤漫延、擴增雷球）同樣不得一拍跳一級。 */
test('Canvas：場域尺寸擴增是逐幀逼近，不是每則事件跳一級', () => {
  const ctx = loadFieldMotion('js/battle-renderer.js',
    ['fieldApproach', 'fieldMotionInit', 'fieldMotionAim', 'fieldMotionStep'],
    'var FIELD_VFX_FOLLOW_TAU_SEC = 0.14;\n' +
    'var FIELD_VFX_MAX_RESIDUAL_PX = 100;\n' +
    'var FIELD_VFX_CORRECT_MAX_RATIO = 0.3;\n');

  const fx = ctx.fieldMotionInit({}, { x: 0, y: 0 }, 100, 100);
  ctx.fieldMotionAim(fx, { x: 0, y: 0 }, 200, 200);
  ctx.fieldMotionStep(fx, FRAME);
  assert.ok(fx.w > 100 && fx.w < 200, '一幀之內只能逼近一部分：' + fx.w);
  for (let i = 0; i < 120; i++) ctx.fieldMotionStep(fx, FRAME);
  assert.ok(Math.abs(fx.w - 200) < 0.5, '足夠的時間後要完全追上：' + fx.w);
});

/* ============================================================
   轉彎：以「進場航向」為起始切線的曲線，抵達時刻不變
   ============================================================ */

test('Canvas：連鎖轉彎是連續的弧，且終點仍是模擬層的目標點', () => {
  const ctx = loadFieldMotion('js/battle-renderer.js',
    ['curveControl', 'curveAt', 'curveHeading'],
    'var CURVE_ENTRY_MAX_RAD = Math.PI * 2 / 3;\nvar CURVE_HANDLE_RATIO = 0.55;\n');

  const from = { x: 0, y: 0 };
  const to = { x: 100, y: 0 };
  /* 上一段是從正上方衝下來的：這一段若照直線畫，方向會在一幀之內轉 90 度。 */
  const enter = Math.PI / 2;
  const ctrl = ctx.curveControl(from.x, from.y, to.x, to.y, enter);
  assert.ok(ctrl, '有進場航向時要產生控制點');

  const N = 60;
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const k = i / N;
    pts.push({ x: ctx.curveAt(from.x, ctrl.x, to.x, k), y: ctx.curveAt(from.y, ctrl.y, to.y, k) });
  }
  // 終點仍是目標點：路徑彎了，抵達時刻與落點都不變
  assert.ok(Math.abs(pts[N].x - to.x) < 1e-6 && Math.abs(pts[N].y - to.y) < 1e-6);
  // 起始切線＝進場航向：銜接處不折角
  const h0 = ctx.curveHeading(from.x, from.y, ctrl, to.x, to.y, 0);
  assert.ok(Math.abs(Math.atan2(Math.sin(h0 - enter), Math.cos(h0 - enter))) < 1e-6);
  // 相鄰兩點的方向變化要處處很小＝沒有折角
  let maxTurn = 0;
  for (let i = 1; i < N; i++) {
    const a1 = Math.atan2(pts[i].y - pts[i - 1].y, pts[i].x - pts[i - 1].x);
    const a2 = Math.atan2(pts[i + 1].y - pts[i].y, pts[i + 1].x - pts[i].x);
    maxTurn = Math.max(maxTurn, Math.abs(Math.atan2(Math.sin(a2 - a1), Math.cos(a2 - a1))));
  }
  assert.ok(maxTurn < 0.2, '沿路不得有折角，實測最大單步轉角 ' + maxTurn.toFixed(3));
  // 速度也不得歸零（歸零＝停一下再彈出去，看起來仍然不連續）
  let minStep = Infinity;
  for (let i = 1; i <= N; i++) {
    minStep = Math.min(minStep, Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  assert.ok(minStep > 0.1, '路徑上不得出現近乎停止的點，實測最小步長 ' + minStep.toFixed(3));
});

test('Canvas：進場航向正對後方時要夾角度，不得退化成原路倒退', () => {
  const ctx = loadFieldMotion('js/battle-renderer.js',
    ['curveControl', 'curveAt'],
    'var CURVE_ENTRY_MAX_RAD = Math.PI * 2 / 3;\nvar CURVE_HANDLE_RATIO = 0.55;\n');

  const ctrl = ctx.curveControl(0, 0, 100, 0, Math.PI);   // 完全反向
  assert.ok(ctrl, '反向時仍要有控制點');
  /* 三點共線就會沿著原路倒退再前進；夾角之後控制點必須離開那條直線。 */
  assert.ok(Math.abs(ctrl.y) > 1, '控制點不得落在起點與目標的連線上：' + JSON.stringify(ctrl));

  // 本來就對著目標時維持直線（與加入轉彎之前完全相同）
  assert.equal(ctx.curveControl(0, 0, 100, 0, 0), null);
  assert.equal(ctx.curveControl(0, 0, 100, 0, NaN), null);
});
