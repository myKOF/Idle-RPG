'use strict';
/* ============ 戰鬥特效（主執行緒） ============
   協議 v10 的 vfx 事件進來這裡變成畫面。模擬層只告訴我們「什麼原型、什麼顏色、打到哪些
   圖層／格子」，怎麼畫完全是這一支的事——所以調特效不必動模擬層，也不會影響戰鬥結果。

   原型共七種（skillVfxSpec 推導；js/skills.js）：
     projectile 投射物：從我方飛向目標，命中時一閃
     slash      斬擊：目標身上劃過的刀光
     burst      爆發：以範圍中心擴散的圓環
     beam       貫穿：從我方往目標方向拉出的一道光束
     rain       天降：範圍內由上而下落下數道衝擊
     aura       領域：蓋在格子上的呼吸光暈，持續到領域結束
     selfBuff   我方增益：我方卡片上的一圈光

   效能守則（16 格滿場、技能連發時很容易失控）：
   - 同時存在的特效節點有硬上限，超過就丟最舊的；掉特效永遠比掉幀好。
   - 只用 transform / opacity 做動畫，不碰 layout。
   - 分頁不可見時整支停用（uiRenderingSuspended 已經停了重繪，特效再畫也沒人看）。 */

var VFX_MAX_NODES = 48;        // 同時存在的特效節點上限
var VFX_MAX_TARGETS = 8;       // 單一事件最多為幾個目標生成特效
var VFX_LAYER_ID = 'bf-vfx-layer';
var _vfxNodes = [];
var _vfxEnabled = true;

function vfxSetEnabled(on) { _vfxEnabled = !!on; if (!on) vfxClear(); }

/* 特效圖層掛在 .battle-scene 上，理由有兩個：
   1. 投射物是「從我方飛向敵人」，必須橫跨我方與敵方兩欄——掛在敵方面板裡會被
      .combatant 的 overflow:hidden 整段裁掉，玩家只看得到最後幾格。
   2. 棋盤本身是 grid，直接塞節點進去會多出匿名格線項目，把敵人卡片擠位。 */
function vfxLayer() {
  var party = document.getElementById('mv-party');
  if (!party || !party.closest) return null;
  var scene = party.closest('.battle-scene');
  if (!scene) return null;
  var layer = document.getElementById(VFX_LAYER_ID);
  if (layer && layer.parentNode === scene) return layer;
  if (layer && layer.parentNode) layer.parentNode.removeChild(layer);
  layer = document.createElement('div');
  layer.id = VFX_LAYER_ID;
  layer.className = 'bf-vfx-layer';
  layer.setAttribute('aria-hidden', 'true');
  scene.appendChild(layer);
  return layer;
}

function vfxClear() {
  for (var i = 0; i < _vfxNodes.length; i++) {
    var n = _vfxNodes[i];
    if (n && n.parentNode) n.parentNode.removeChild(n);
  }
  _vfxNodes = [];
}

function vfxTrack(node, ms) {
  _vfxNodes.push(node);
  while (_vfxNodes.length > VFX_MAX_NODES) {
    var old = _vfxNodes.shift();
    if (old && old.parentNode) old.parentNode.removeChild(old);
  }
  setTimeout(function () {
    var idx = _vfxNodes.indexOf(node);
    if (idx >= 0) _vfxNodes.splice(idx, 1);
    if (node.parentNode) node.parentNode.removeChild(node);
  }, ms);
}

/* 目標圖層 id → 相對於特效圖層的中心座標。找不到（敵人已被清掉）回傳 null。 */
function vfxPointOf(elId, layer) {
  var el = document.getElementById(elId);
  if (!el || !layer) return null;
  var target = el.closest ? (el.closest('.enemy-card') || el.closest('.combatant') || el) : el;
  var r = target.getBoundingClientRect();
  var lr = layer.getBoundingClientRect();
  if (!r.width && !r.height) return null;
  return { x: r.left - lr.left + r.width / 2, y: r.top - lr.top + r.height / 2 };
}

/* 我方出手點：我方卡片的右緣中央（特效從那裡飛出去）。 */
function vfxOriginPoint(layer) {
  var lr = layer.getBoundingClientRect();
  var me = document.querySelector('.battle-scene.multi-enemy-layout > .combatant:not(.enemy-combatant)');
  if (me) {
    var r = me.getBoundingClientRect();
    return { x: r.right - lr.left, y: r.top - lr.top + r.height / 2 };
  }
  return { x: -12, y: lr.height / 2 };
}

/* 棋盤格 [{col,row}] → 相對特效圖層的矩形（用實際的格線方框量，不自己算格寬）。 */
function vfxCellsRect(cells, layer) {
  if (!cells || !cells.length) return null;
  var party = document.getElementById('mv-party');
  if (!party) return null;
  var lr = layer.getBoundingClientRect();
  var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, found = 0;
  var guides = party.querySelectorAll('.bf-cell-guide');
  var cols = (typeof battlefieldCols === 'function') ? battlefieldCols() : 4;
  for (var i = 0; i < cells.length; i++) {
    var idx = (cells[i].row - 1) * cols + (cells[i].col - 1);
    var g = guides[idx];
    if (!g) continue;
    var r = g.getBoundingClientRect();
    found++;
    minX = Math.min(minX, r.left - lr.left);
    minY = Math.min(minY, r.top - lr.top);
    maxX = Math.max(maxX, r.right - lr.left);
    maxY = Math.max(maxY, r.bottom - lr.top);
  }
  if (!found) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function vfxNode(cls, layer) {
  var d = document.createElement('div');
  d.className = 'vfx ' + cls;
  layer.appendChild(d);
  return d;
}

/* ---- 各原型 ---- */
function vfxProjectile(spec, layer, from, to, delayMs) {
  var d = vfxNode('vfx-projectile', layer);
  d.textContent = spec.glyph;
  d.style.color = spec.color;
  d.style.setProperty('--vfx-x0', from.x + 'px');
  d.style.setProperty('--vfx-y0', from.y + 'px');
  d.style.setProperty('--vfx-x1', to.x + 'px');
  d.style.setProperty('--vfx-y1', to.y + 'px');
  d.style.animationDelay = delayMs + 'ms';
  d.style.animationDuration = Math.round(spec.dur * 1000) + 'ms';
  vfxTrack(d, delayMs + spec.dur * 1000 + 120);
}

function vfxAtPoint(cls, spec, layer, pt, delayMs, sizePx) {
  var d = vfxNode(cls, layer);
  d.style.left = pt.x + 'px';
  d.style.top = pt.y + 'px';
  d.style.color = spec.color;
  d.style.setProperty('--vfx-color', spec.color);
  if (sizePx) d.style.setProperty('--vfx-size', sizePx + 'px');
  d.style.animationDelay = delayMs + 'ms';
  d.style.animationDuration = Math.round(spec.dur * 1000) + 'ms';
  vfxTrack(d, delayMs + spec.dur * 1000 + 120);
  return d;
}

function vfxBeam(spec, layer, from, to) {
  var dx = to.x - from.x, dy = to.y - from.y;
  var len = Math.sqrt(dx * dx + dy * dy);
  var d = vfxNode('vfx-beam', layer);
  d.style.left = from.x + 'px';
  d.style.top = from.y + 'px';
  d.style.width = len + 'px';
  d.style.setProperty('--vfx-color', spec.color);
  d.style.transform = 'rotate(' + Math.atan2(dy, dx) + 'rad)';
  d.style.animationDuration = Math.round(spec.dur * 1000) + 'ms';
  vfxTrack(d, spec.dur * 1000 + 120);
}

function vfxAura(spec, layer, rect) {
  var d = vfxNode('vfx-aura', layer);
  d.style.left = rect.x + 'px';
  d.style.top = rect.y + 'px';
  d.style.width = rect.w + 'px';
  d.style.height = rect.h + 'px';
  d.style.setProperty('--vfx-color', spec.color);
  // 領域可能長達數十秒，節點壽命跟著它；上限由 VFX_MAX_NODES 兜底
  vfxTrack(d, Math.min(60, Math.max(1, spec.dur)) * 1000);
}

function vfxRain(spec, layer, rect) {
  var drops = Math.min(6, Math.max(3, Math.round(rect.w / 60)));
  for (var i = 0; i < drops; i++) {
    var pt = { x: rect.x + rect.w * ((i + 0.5) / drops), y: rect.y + rect.h * 0.5 };
    var d = vfxAtPoint('vfx-rain', spec, layer, pt, i * 70, Math.round(rect.h));
    d.textContent = spec.glyph;
  }
}

/* ---- 進入點：協議 vfx 事件 → 畫面 ---- */
function playCombatVfx(spec) {
  if (!_vfxEnabled || !spec) return;
  if (typeof document === 'undefined' || document.hidden) return;
  var layer = vfxLayer();
  if (!layer) return;
  var kind = spec.fxKind;
  var dur = spec.dur > 0 ? spec.dur : 0.5;
  var count = Math.max(1, Math.min(5, spec.count || 1));
  var s = { fxKind: kind, glyph: spec.glyph || '✨', color: spec.color || '#fff', dur: dur };

  if (kind === 'aura' || kind === 'rain') {
    var rect = vfxCellsRect(spec.cells, layer);
    if (!rect) return;
    if (kind === 'aura') vfxAura(s, layer, rect);
    else vfxRain(s, layer, rect);
    return;
  }

  if (kind === 'selfBuff') {
    var mePt = vfxPointOf((spec.targets && spec.targets[0]) || 'pv-float', layer);
    if (mePt) vfxAtPoint('vfx-selfbuff', s, layer, mePt, 0);
    return;
  }

  var from = vfxOriginPoint(layer);
  var targets = (spec.targets || []).slice(0, VFX_MAX_TARGETS);
  for (var t = 0; t < targets.length; t++) {
    var pt = vfxPointOf(targets[t], layer);
    if (!pt) continue;
    if (kind === 'beam') { vfxBeam(s, layer, from, pt); continue; }
    for (var c = 0; c < count; c++) {
      // 每一段之間的間隔與傷害數字共用同一個常數（data.js），否則畫面與數字會走鐘
      var stagger = (typeof VFX_HIT_STAGGER_SEC === 'number') ? VFX_HIT_STAGGER_SEC * 1000 : 90;
      var delay = c * stagger + t * 40;
      if (kind === 'projectile') vfxProjectile(s, layer, from, pt, delay);
      else if (kind === 'slash') vfxAtPoint('vfx-slash', s, layer, pt, delay);
      else vfxAtPoint('vfx-burst', s, layer, pt, delay);
    }
  }
}
