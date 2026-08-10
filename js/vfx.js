'use strict';
/* ============ 戰鬥特效（主執行緒） ============ v2「酷炫改造」（協議 v17）
   協議的 vfx 事件進來這裡變成畫面。模擬層只告訴我們「什麼原型、什麼屬性、什麼變體、
   打到哪些圖層／格子」，怎麼畫完全是這一支的事——調特效不必動模擬層，也不影響戰鬥結果。

   原型（fxKind）：
     projectile 投射物：元素化彈體（核心＋拖尾）從我方飛向目標；火屬性從畫面上方 45° 俯衝
     slash      斬擊：目標身上交叉劃過的刀光
     burst      爆發：範圍中心的爆裂；variant cyclone＝氣旋在敵陣中旋轉、bladestorm＝刀光亂舞
     beam       貫穿：我方往目標拉出的光束；冰＝冰晶槍、聖＝雷射
     rain       天降：variant meteor＝大隕石砸全場、pillar＝光柱降下、smite＝天罰神雷；
                預設為範圍內落下數道元素雨
     aura       領域：蓋在格子上的持續特效（火＝火苗上升、swordfield＝旋轉劍氣環）
     selfBuff   我方增益：光環＋上升光點
     curse      敵身詛咒（v17）：暗紫符紋在敵人身上迴旋
     chain      連鎖雷鏈（v17）：閃電劈落第一個目標後沿 targets 順序在敵間彈射
     impact     純受擊（v17）：只畫命中反饋（敵攻我方的爪痕等）

   受擊反饋：所有會命中敵人的原型都會在「命中那一刻」（與傷害數字同時）補一發
   元素化爆點（vfxImpact）＋目標卡片震動閃光（vfxHitReact）。

   效能守則（16 格滿場、技能連發時很容易失控）：
   - 同時存在的特效節點有硬上限，超過就丟最舊的；掉特效永遠比掉幀好。
   - 動畫只用 transform / opacity / filter，不碰 layout。
   - 粒子一律是特效節點的子 span，隨父節點一起回收，不佔節點名額。
   - 分頁不可見時整支停用（uiRenderingSuspended 已停了重繪，特效再畫也沒人看）。 */

var VFX_MAX_NODES = 96;        // 同時存在的特效節點上限
var VFX_MAX_TARGETS = 8;       // 單一事件最多為幾個目標生成特效
var VFX_LAYER_ID = 'bf-vfx-layer';
var _vfxNodes = [];
var _vfxEnabled = true;
var _vfxGeneration = 0;
var VFX_QUALITY_LEVELS = { FULL: 'full', REDUCED: 'reduced', OFF: 'off' };
var VFX_EVENT_QUEUE_MAX = 48;
var VFX_FRAME_BUDGET_FULL = 8;
var VFX_FRAME_BUDGET_REDUCED = 4;
var VFX_MERGE_WINDOW_MS = 120;
var VFX_STALE_EVENT_MS = 1500;
var VFX_METEOR_MAX_DELAY_MS = 900;
var VFX_METEOR_MAX_TRAVEL_MS = 450;
var VFX_NODE_WATCHDOG_MS = 1000;
var VFX_METEOR_HARD_LIFETIME_MS = 2800;
var _vfxQuality = VFX_QUALITY_LEVELS.FULL;
var _vfxEventQueue = [];
var _vfxFlushHandle = 0;
var _vfxWatchdogHandle = 0;
var _vfxAnchorCache = Object.create(null);
var _vfxLayerRectCache = null;
var _vfxLayoutVersion = 0;

/* 元素主題：c1 主色、c2 亮部／輔色、glow 光暈。無屬性事件退回 spec.color 單色。 */
var VFX_ELEM_THEME = {
  fire:      { c1: '#fb7233', c2: '#ffd166', glow: 'rgba(251, 114, 51, 0.85)' },
  ice:       { c1: '#54c7fc', c2: '#e8faff', glow: 'rgba(84, 199, 252, 0.85)' },
  lightning: { c1: '#ffd93d', c2: '#fffbe0', glow: 'rgba(255, 217, 61, 0.9)' },
  poison:    { c1: '#9ee34a', c2: '#e0ffb0', glow: 'rgba(158, 227, 74, 0.85)' },
  light:     { c1: '#ffe9a8', c2: '#fffdf2', glow: 'rgba(255, 233, 168, 0.95)' },
  dark:      { c1: '#b76cff', c2: '#2e1046', glow: 'rgba(183, 108, 255, 0.9)' },
  earth:     { c1: '#d2a05c', c2: '#6b4526', glow: 'rgba(210, 160, 92, 0.85)' }
};

function vfxSetEnabled(on) {
  _vfxEnabled = !!on;
  if (!on) vfxClear();
}

function vfxQuality() {
  return _vfxQuality;
}

function vfxSetQuality(level) {
  var next = level === VFX_QUALITY_LEVELS.REDUCED ? VFX_QUALITY_LEVELS.REDUCED
    : level === VFX_QUALITY_LEVELS.OFF ? VFX_QUALITY_LEVELS.OFF : VFX_QUALITY_LEVELS.FULL;
  if (next === _vfxQuality) return;
  _vfxQuality = next;
  _vfxEventQueue.length = 0;
  if (next === VFX_QUALITY_LEVELS.OFF) vfxClear();
}

function vfxInvalidateLayout() {
  _vfxLayoutVersion++;
  _vfxAnchorCache = Object.create(null);
  _vfxLayerRectCache = null;
  _vfxOriginCache = null;
}

/* ---- 圖層與座標 ---- */
/* 特效圖層掛在「事件目標所在」的 .battle-scene 上：野外掛棋盤景、高塔掛塔景。
   掛在 scene 的理由不變：
   1. 投射物必須橫跨我方與敵方兩欄——掛在敵方面板裡會被裁掉。
   2. 棋盤本身是 grid，直接塞節點會多出匿名格線項目，把敵人卡片擠位。 */
function vfxSceneFor(anchorId) {
  var el = anchorId ? document.getElementById(anchorId) : null;
  var scene = (el && el.closest) ? el.closest('.battle-scene') : null;
  if (scene) return scene;
  var party = document.getElementById('mv-party');
  return (party && party.closest) ? party.closest('.battle-scene') : null;
}

function vfxLayer(anchorId) {
  var scene = vfxSceneFor(anchorId);
  if (!scene) return null;
  var layer = document.getElementById(VFX_LAYER_ID);
  if (layer && layer.parentNode === scene) return layer;
  if (layer && layer.parentNode) layer.parentNode.removeChild(layer);
  if (!layer) {
    layer = document.createElement('div');
    layer.id = VFX_LAYER_ID;
    layer.className = 'bf-vfx-layer';
    layer.setAttribute('aria-hidden', 'true');
  }
  scene.appendChild(layer);
  return layer;
}

function vfxClear() {
  _vfxGeneration++;
  _vfxEventQueue.length = 0;
  if (_vfxFlushHandle) {
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(_vfxFlushHandle);
    if (typeof clearTimeout === 'function') clearTimeout(_vfxFlushHandle);
    _vfxFlushHandle = 0;
  }
  if (_vfxWatchdogHandle) {
    if (typeof clearTimeout === 'function') clearTimeout(_vfxWatchdogHandle);
    _vfxWatchdogHandle = 0;
  }
  for (var i = 0; i < _vfxNodes.length; i++) {
    var n = _vfxNodes[i];
    if (n && n.parentNode) n.parentNode.removeChild(n);
  }
  _vfxNodes = [];
  if (typeof document === 'undefined' || !document.querySelectorAll) return;
  var hitCards = document.querySelectorAll('.enemy-card, .combatant');
  for (var ci = 0; ci < hitCards.length; ci++) {
    var card = hitCards[ci];
    if (!card.classList) continue;
    for (var hi = 0; hi < VFX_HIT_CLASSES.length; hi++) card.classList.remove(VFX_HIT_CLASSES[hi]);
    card._vfxHitUntil = 0;
  }
  var scenes = document.querySelectorAll('.battle-scene');
  for (var si = 0; si < scenes.length; si++) {
    if (!scenes[si].classList) continue;
    scenes[si].classList.remove('vfx-scene-shake', 'vfx-scene-shake-strong');
  }
}

function vfxNodeClassName(node) {
  if (!node) return '';
  if (typeof node.className === 'string') return node.className;
  if (node.className && typeof node.className.baseVal === 'string') return node.className.baseVal;
  return '';
}

function vfxRemoveNode(node) {
  if (node && node.parentNode) node.parentNode.removeChild(node);
}

function vfxRunNodeWatchdog() {
  _vfxWatchdogHandle = 0;
  var now = Date.now();
  for (var i = _vfxNodes.length - 1; i >= 0; i--) {
    var node = _vfxNodes[i];
    if (!node || !node.parentNode || (node._vfxExpiresAt && node._vfxExpiresAt <= now)) {
      _vfxNodes.splice(i, 1);
      vfxRemoveNode(node);
    }
  }
  if (_vfxNodes.length) _vfxWatchdogHandle = setTimeout(vfxRunNodeWatchdog, VFX_NODE_WATCHDOG_MS);
}

function vfxScheduleNodeWatchdog() {
  if (!_vfxWatchdogHandle && _vfxNodes.length) {
    _vfxWatchdogHandle = setTimeout(vfxRunNodeWatchdog, VFX_NODE_WATCHDOG_MS);
  }
}

function vfxTrack(node, ms) {
  var ttl = Number(ms);
  if (!isFinite(ttl) || ttl < 0) ttl = 0;
  var cls = vfxNodeClassName(node);
  if (cls.indexOf('vfx-meteor') >= 0 || cls.indexOf('vfx-area-flash') >= 0) {
    ttl = Math.min(ttl, VFX_METEOR_HARD_LIFETIME_MS);
  }
  node._vfxExpiresAt = Date.now() + ttl;
  _vfxNodes.push(node);
  while (_vfxNodes.length > VFX_MAX_NODES) {
    // 撞頂時優先踢短命特效：領域（aura）是長駐視覺狀態，最老≠最該死，
    // 被技能連發擠掉會看起來像「領域提早結束」
    var evict = 0;
    for (var ei = 0; ei < _vfxNodes.length; ei++) {
      var cand = _vfxNodes[ei];
      if (!cand || typeof cand.className !== 'string' || cand.className.indexOf('vfx-aura') < 0) {
        evict = ei;
        break;
      }
    }
    var old = _vfxNodes.splice(evict, 1)[0];
    vfxRemoveNode(old);
  }
  setTimeout(function () {
    var idx = _vfxNodes.indexOf(node);
    if (idx >= 0) _vfxNodes.splice(idx, 1);
    vfxRemoveNode(node);
  }, ttl);
  vfxScheduleNodeWatchdog();
}

/* 目標圖層 id → 相對於特效圖層的中心座標。找不到（敵人已被清掉）回傳 null。 */
function vfxLayerRect(layer) {
  if (_vfxLayerRectCache && _vfxLayerRectCache.layer === layer && _vfxLayerRectCache.version === _vfxLayoutVersion) {
    return _vfxLayerRectCache.rect;
  }
  var rect = layer.getBoundingClientRect();
  _vfxLayerRectCache = { layer: layer, version: _vfxLayoutVersion, rect: rect };
  return rect;
}

function vfxPointTarget(elId, el) {
  /* 高塔的 tb-float 只是浮字層；整個 .combatant boss 會被 grid 拉滿整欄，
     取它的中心會把命中爆點與投射物終點推到血條／狀態列附近。
     座標錨點要改用 BOSS 圖像，受擊震動仍由 vfxHitReact 另外尋找 combatant。 */
  if (elId === 'tb-float') {
    var bossVisualHost = document.getElementById('tb-emoji');
    if (bossVisualHost) {
      var visual = bossVisualHost.querySelector
        ? bossVisualHost.querySelector('img, span')
        : null;
      if (visual && visual.getBoundingClientRect) {
        var vr = visual.getBoundingClientRect();
        if (vr.width || vr.height) return visual;
      }
      if (bossVisualHost.getBoundingClientRect) {
        var hr = bossVisualHost.getBoundingClientRect();
        if (hr.width || hr.height) return bossVisualHost;
      }
    }
  }
  return el && el.closest
    ? (el.closest('.enemy-card') || el.closest('.combatant') || el)
    : el;
}

function vfxPointOf(elId, layer) {
  var el = document.getElementById(elId);
  if (!el || !layer) return null;
  var target = vfxPointTarget(elId, el);
  var cached = _vfxAnchorCache[elId];
  var r;
  if (cached && cached.target === target && cached.layer === layer && cached.version === _vfxLayoutVersion) {
    r = cached.rect;
  } else {
    r = target.getBoundingClientRect();
    _vfxAnchorCache[elId] = { target: target, layer: layer, version: _vfxLayoutVersion, rect: r };
  }
  var lr = vfxLayerRect(layer);
  if (!r.width && !r.height) return null;
  return { x: r.left - lr.left + r.width / 2, y: r.top - lr.top + r.height / 2 };
}

/* 我方出手點：同一 scene 內我方卡片的右緣中央。

   走與 vfxLayerRect／vfxPointOf 相同的版面版本快取——我方卡片的位置只在版面失效時
   才會變，但這支原本每次施法都重量一次。回報者機器上實測 46 秒內 29 次強制重排
   出自這裡，而強制重排的成本取決於整份文件多大（後期背包上千格）。 */
var _vfxOriginCache = null;
function vfxOriginPoint(layer) {
  var lr = vfxLayerRect(layer);
  if (_vfxOriginCache && _vfxOriginCache.layer === layer && _vfxOriginCache.version === _vfxLayoutVersion) {
    return _vfxOriginCache.point;
  }
  var scene = layer.parentNode;
  var me = (scene && scene.querySelector)
    ? scene.querySelector('.combatant:not(.enemy-combatant):not(.boss)') : null;
  var point;
  if (me) {
    var r = me.getBoundingClientRect();
    point = { x: r.right - lr.left - 4, y: r.top - lr.top + r.height / 2 };
  } else {
    point = { x: -12, y: lr.height / 2 };
  }
  _vfxOriginCache = { layer: layer, version: _vfxLayoutVersion, point: point };
  return point;
}

/* 棋盤格 [{col,row}] → 相對特效圖層的矩形（用實際的格線方框量，不自己算格寬）。 */
function vfxCellsRect(cells, layer) {
  if (!cells || !cells.length) return null;
  var party = document.getElementById('mv-party');
  if (!party) return null;
  var lr = vfxLayerRect(layer);
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

/* 目標點退化矩形：高塔戰沒有棋盤格，範圍特效以目標卡片為中心畫。 */
function vfxRectAround(pt) {
  return { x: pt.x - 70, y: pt.y - 80, w: 140, h: 160 };
}

/* ---- 節點工廠 ---- */
function vfxTheme(spec) {
  var t = (spec && spec.elem) ? VFX_ELEM_THEME[spec.elem] : null;
  if (t) return t;
  var c = (spec && spec.color) || '#ffffff';
  return { c1: c, c2: '#ffffff', glow: c };
}

function vfxNode(cls, layer, spec) {
  var d = document.createElement('div');
  d.className = 'vfx ' + cls;
  if (spec) {
    var th = vfxTheme(spec);
    d.style.setProperty('--vfx-c1', th.c1);
    d.style.setProperty('--vfx-c2', th.c2);
    d.style.setProperty('--vfx-glow', th.glow);
  }
  layer.appendChild(d);
  return d;
}

function vfxPlace(d, pt) {
  d.style.left = pt.x + 'px';
  d.style.top = pt.y + 'px';
}

function vfxStagger() {
  return (typeof VFX_HIT_STAGGER_SEC === 'number') ? VFX_HIT_STAGGER_SEC * 1000 : 90;
}

/* ---- 受擊反饋：卡片震動＋元素色閃光 ----
   卡片只在敵群「簽章」（身分＋站位）變動時重建，短命 class 掛上去是安全的；
   萬一剛好碰上重建把 class 洗掉，也只是少抖一下，不會殘留。 */
var VFX_HIT_CLASSES = ['vfx-hit', 'vfx-hit-strong', 'vfx-hit-fire', 'vfx-hit-ice',
  'vfx-hit-lightning', 'vfx-hit-poison', 'vfx-hit-light', 'vfx-hit-dark', 'vfx-hit-earth'];
function vfxHitReact(targetId, elem, delayMs, strong) {
  if (!targetId) return;
  if (_vfxQuality === VFX_QUALITY_LEVELS.REDUCED && !strong) return;
  var generation = _vfxGeneration;
  setTimeout(function () {
    if (!_vfxEnabled || generation !== _vfxGeneration) return;
    var el = document.getElementById(targetId);
    var card = (el && el.closest) ? (el.closest('.enemy-card') || el.closest('.combatant')) : null;
    if (!card || !card.classList) return;
    // 先移除再隔兩幀掛回：連續命中時動畫才會重新播放（不用 offsetWidth 硬觸發 reflow）
    for (var i = 0; i < VFX_HIT_CLASSES.length; i++) card.classList.remove(VFX_HIT_CLASSES[i]);
    var until = Date.now() + 340;
    card._vfxHitUntil = until;
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (!_vfxEnabled || generation !== _vfxGeneration || card._vfxHitUntil !== until) return;  // 已被更新的一擊接手
        card.classList.add('vfx-hit');
        if (strong) card.classList.add('vfx-hit-strong');
        if (elem && VFX_ELEM_THEME[elem]) card.classList.add('vfx-hit-' + elem);
        setTimeout(function () {
          if (generation !== _vfxGeneration || card._vfxHitUntil !== until) return;
          for (var j = 0; j < VFX_HIT_CLASSES.length; j++) card.classList.remove(VFX_HIT_CLASSES[j]);
        }, 360);
      });
    });
  }, Math.max(0, delayMs || 0));
}

/* 畫面震動：大爆點（隕石、引爆）時整個戰鬥畫面晃一下。 */
function vfxSceneShake(layer, delayMs, strong) {
  if (_vfxQuality !== VFX_QUALITY_LEVELS.FULL) return;
  var generation = _vfxGeneration;
  setTimeout(function () {
    if (!_vfxEnabled || generation !== _vfxGeneration) return;
    var scene = (layer && layer.parentNode) ? layer.parentNode : null;
    if (!scene || !scene.classList) return;
    scene.classList.remove('vfx-scene-shake', 'vfx-scene-shake-strong');
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (!_vfxEnabled || generation !== _vfxGeneration) return;
        scene.classList.add(strong ? 'vfx-scene-shake-strong' : 'vfx-scene-shake');
        setTimeout(function () {
          if (generation !== _vfxGeneration) return;
          scene.classList.remove('vfx-scene-shake', 'vfx-scene-shake-strong');
        }, strong ? 520 : 340);
      });
    });
  }, Math.max(0, delayMs || 0));
}

/* ---- 受擊爆點（vfxImpact）----
   命中那一刻（delayMs 與傷害數字同一個數）在目標身上炸開的元素化爆點：
     fire 火光爆裂＋火花亂飛     ice 冰晶碎裂       lightning 電弧火花
     poison 綠泡上飄             light 聖輝十字     dark 暗紫渦爆
     earth 岩塊崩碎               phys 白色斬痕碎屑   claw 敵人抓我方的紅爪痕
   variant 覆寫（單體技的專屬受擊）：
     vortex 暗渦收縮引爆（虛空裂隙）    detonate 大爆炸＋畫面震動（斷罪／碎印）
     venomburst 疫病炸裂               venom 命中後殘留 2.5 秒毒雲泡泡
     nova 冰環爆發＋地面結霜（霜之新星） */
var VFX_IMPACT_PARTS = { fire: 6, ice: 5, lightning: 5, poison: 4, light: 6, dark: 5, earth: 6, phys: 3, claw: 3 };
function vfxImpact(spec, layer, pt, targetId, delayMs) {
  var v = spec.variant;
  var elemKey = spec.elem || 'phys';
  var strong = false;
  var life = 800;
  var cls;
  if (v === 'claw') { cls = 'vfx-impact vfx-impact-claw'; elemKey = 'claw'; }
  else if (v === 'vortex') { cls = 'vfx-impact vfx-impact-vortex'; strong = true; life = 1000; }
  else if (v === 'detonate') { cls = 'vfx-impact vfx-impact-detonate'; strong = true; life = 1000; }
  else if (v === 'venomburst') { cls = 'vfx-impact vfx-impact-venomburst'; strong = true; }
  else if (v === 'nova') { cls = 'vfx-impact vfx-impact-nova'; strong = true; life = 1000; }
  else cls = 'vfx-impact vfx-impact-' + elemKey;
  var d = vfxNode(cls, layer, spec);
  vfxPlace(d, pt);
  d.style.animationDelay = delayMs + 'ms';

  var n = VFX_IMPACT_PARTS[elemKey] || 4;
  if (v === 'detonate' || v === 'nova') n = 7;
  if (_vfxQuality === VFX_QUALITY_LEVELS.REDUCED) n = 1;
  for (var i = 0; i < n; i++) {
    var s = document.createElement('span');
    s.className = 'vfx-p';
    if (elemKey === 'poison') {          // 毒泡向上飄
      s.style.setProperty('--dx', (Math.random() * 34 - 17).toFixed(1) + 'px');
      s.style.setProperty('--dy', (-(20 + Math.random() * 30)).toFixed(1) + 'px');
    } else {
      var ang = (Math.PI * 2) * (i / n) + Math.random() * 0.9;
      var dist = 16 + Math.random() * 26 + (strong ? 14 : 0);
      s.style.setProperty('--dx', (Math.cos(ang) * dist).toFixed(1) + 'px');
      s.style.setProperty('--dy', (Math.sin(ang) * dist).toFixed(1) + 'px');
    }
    s.style.setProperty('--rot', Math.round(Math.random() * 360) + 'deg');
    s.style.animationDelay = (delayMs + i * 22) + 'ms';
    d.appendChild(s);
  }
  vfxTrack(d, delayMs + life);

  if (v === 'venom' && _vfxQuality !== VFX_QUALITY_LEVELS.REDUCED) {
    // 殘留毒雲：中毒 DoT 的視覺殘影，泡泡持續冒 2.5 秒
    var cloud = vfxNode('vfx-cloud', layer, spec);
    vfxPlace(cloud, pt);
    cloud.style.animationDelay = delayMs + 'ms';
    for (var b = 0; b < 5; b++) {
      var bb = document.createElement('span');
      bb.className = 'vfx-p';
      bb.style.setProperty('--dx', (Math.random() * 44 - 22).toFixed(1) + 'px');
      bb.style.setProperty('--dy', (-(24 + Math.random() * 30)).toFixed(1) + 'px');
      bb.style.animationDelay = (delayMs + 150 + b * 420) + 'ms';
      cloud.appendChild(bb);
    }
    vfxTrack(cloud, delayMs + 2600);
  }
  if (v === 'detonate') vfxSceneShake(layer, delayMs, false);
  vfxHitReact(targetId, spec.elem || null, delayMs, strong);
}

/* ---- 投射物 ----
   元素化彈體：外層節點做 x0→x1 位移（等速，時長＝travelMs），內層 core／trail
   以 --vfx-rot 對齊飛行方向。火屬性從畫面上方 45° 俯衝（「火球從畫面 45 度飛向敵方」），
   glyph 模式（特殊／潛力／融合系）保留技能 emoji 當彈體。 */
function vfxProjectileCls(spec) {
  var v = spec.variant;
  if (v === 'swordwave') return 'vfx-proj-sword';
  if (v === 'venom') return 'vfx-proj-poison';
  if (v === 'flamewave') return 'vfx-proj-fire vfx-proj-big';
  if (spec.elem && VFX_ELEM_THEME[spec.elem]) return 'vfx-proj-' + spec.elem;
  if (spec.cat === 'special' || spec.cat === 'potential' || spec.cat === 'fusion') return 'vfx-proj-glyph';
  return 'vfx-proj-plain';
}

function vfxProjectile(spec, layer, from, to, delayMs, travelMs) {
  var flight = travelMs > 0 ? travelMs : Math.round((spec.dur || 0.5) * 1000);
  var fromPt = from;
  if (spec.elem === 'fire' && spec.variant !== 'flamewave') {
    // 45° 俯衝：起點在目標左上方，水平垂直等距；貼到上緣就沿 45° 斜線往右推
    var run = Math.max(70, (to.x - from.x) * 0.8);
    fromPt = { x: to.x - run, y: to.y - run };
    if (fromPt.y < -36) { fromPt.x = to.x - (to.y + 36); fromPt.y = -36; }
  }
  var dx = to.x - fromPt.x, dy = to.y - fromPt.y;
  var d = vfxNode('vfx-proj ' + vfxProjectileCls(spec), layer, spec);
  d.style.setProperty('--vfx-x0', fromPt.x + 'px');
  d.style.setProperty('--vfx-y0', fromPt.y + 'px');
  d.style.setProperty('--vfx-x1', to.x + 'px');
  d.style.setProperty('--vfx-y1', to.y + 'px');
  d.style.setProperty('--vfx-rot', Math.atan2(dy, dx).toFixed(3) + 'rad');
  d.style.animationDelay = delayMs + 'ms';
  d.style.animationDuration = flight + 'ms';
  var core = document.createElement('span');
  core.className = 'vfx-proj-core';
  if (vfxProjectileCls(spec) === 'vfx-proj-glyph') core.textContent = spec.glyph || '✨';
  d.appendChild(core);
  var trail = document.createElement('span');
  trail.className = 'vfx-proj-trail';
  d.appendChild(trail);
  vfxTrack(d, delayMs + flight + 160);

  if (spec.variant === 'drain') {
    // 汲取類：命中後一縷魂息流回我方
    var back = vfxNode('vfx-proj vfx-proj-wisp', layer, spec);
    back.style.setProperty('--vfx-x0', to.x + 'px');
    back.style.setProperty('--vfx-y0', to.y + 'px');
    back.style.setProperty('--vfx-x1', from.x + 'px');
    back.style.setProperty('--vfx-y1', from.y + 'px');
    back.style.setProperty('--vfx-rot', Math.atan2(from.y - to.y, from.x - to.x).toFixed(3) + 'rad');
    back.style.animationDelay = (delayMs + flight + 70) + 'ms';
    back.style.animationDuration = Math.max(280, flight) + 'ms';
    var bc = document.createElement('span');
    bc.className = 'vfx-proj-core';
    back.appendChild(bc);
    vfxTrack(back, delayMs + flight + Math.max(280, flight) + 200);
  }
}

/* ---- 斬擊：交叉雙刀光 ---- */
function vfxSlash(spec, layer, pt, delayMs) {
  var d = vfxNode('vfx-slash', layer, spec);
  vfxPlace(d, pt);
  d.style.setProperty('--vfx-tilt', (Math.random() * 50 - 25).toFixed(0) + 'deg');
  d.style.animationDelay = delayMs + 'ms';
  d.style.animationDuration = Math.round((spec.dur || 0.5) * 1000) + 'ms';
  vfxTrack(d, delayMs + (spec.dur || 0.5) * 1000 + 160);
}

/* ---- 爆發（單點） ---- */
function vfxBurst(spec, layer, pt, delayMs) {
  var d = vfxNode('vfx-burst' + (spec.elem ? ' vfx-burst-' + spec.elem : ''), layer, spec);
  vfxPlace(d, pt);
  d.style.animationDelay = delayMs + 'ms';
  d.style.animationDuration = Math.round((spec.dur || 0.5) * 1000) + 'ms';
  vfxTrack(d, delayMs + (spec.dur || 0.5) * 1000 + 160);
}

/* ---- 氣旋（旋風斬）：圓形氣旋斬擊在敵陣中旋轉 ---- */
function vfxCyclone(spec, layer, rect) {
  var size = Math.min(rect.w, rect.h) * 1.05;
  var d = vfxNode('vfx-cyclone', layer, spec);
  vfxPlace(d, { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 });
  d.style.setProperty('--vfx-size', Math.round(size) + 'px');
  for (var i = 0; i < 3; i++) {
    var s = document.createElement('span');
    s.className = 'vfx-cyc-blade';
    s.style.setProperty('--i', String(i));
    d.appendChild(s);
  }
  vfxTrack(d, 1000);
}

/* ---- 刀光亂舞（疾風連斬／殘影迴斬）：白刃在範圍內連閃 ---- */
function vfxBladestorm(spec, layer, rect, count) {
  var slashes = Math.max(4, Math.min(7, (count || 3) + 2));
  for (var i = 0; i < slashes; i++) {
    var pt = {
      x: rect.x + rect.w * (0.18 + Math.random() * 0.64),
      y: rect.y + rect.h * (0.18 + Math.random() * 0.64)
    };
    var d = vfxNode('vfx-bstorm', layer, spec);
    vfxPlace(d, pt);
    d.style.setProperty('--vfx-tilt', Math.round(Math.random() * 360) + 'deg');
    d.style.animationDelay = (i * 70) + 'ms';
    vfxTrack(d, i * 70 + 500);
  }
}

/* ---- 光束：冰＝冰晶槍、聖＝雷射、其他＝元素光束 ---- */
function vfxBeam(spec, layer, from, to) {
  var dx = to.x - from.x, dy = to.y - from.y;
  var len = Math.sqrt(dx * dx + dy * dy);
  var cls = 'vfx-beam';
  if (spec.elem === 'ice') cls += ' vfx-beam-ice';
  else if (spec.elem === 'light') cls += ' vfx-beam-light';
  var d = vfxNode(cls, layer, spec);
  d.style.left = from.x + 'px';
  d.style.top = from.y + 'px';
  d.style.width = len + 'px';
  d.style.transform = 'rotate(' + Math.atan2(dy, dx) + 'rad)';
  d.style.animationDuration = Math.round((spec.dur || 0.5) * 1000) + 'ms';
  vfxTrack(d, (spec.dur || 0.5) * 1000 + 160);
}

/* ---- 天降 ---- */
/* 大隕石：一顆燃燒的大火團由敵軍正上方斜落，砸進範圍中心後大爆炸＋全屏震動。
   落地時刻＝travelMs（模擬層已把所有目標統一成同一個值，傷害數字同時跳）。 */
function vfxMeteor(spec, layer, rect, targetIds, travelMs, baseDelay) {
  var fall = travelMs > 0 ? Math.min(VFX_METEOR_MAX_TRAVEL_MS, travelMs) : VFX_METEOR_MAX_TRAVEL_MS;
  var safeBaseDelay = Number(baseDelay);
  if (!isFinite(safeBaseDelay) || safeBaseDelay < 0) safeBaseDelay = 0;
  safeBaseDelay = Math.min(VFX_METEOR_MAX_DELAY_MS, safeBaseDelay);
  var cx = rect.x + rect.w / 2, cy = rect.y + rect.h * 0.45;
  var d = vfxNode('vfx-meteor', layer, spec);
  var mx0 = cx + rect.w * 0.45, my0 = rect.y - 170;
  d.style.setProperty('--vfx-x0', mx0 + 'px');
  d.style.setProperty('--vfx-y0', my0 + 'px');
  d.style.setProperty('--vfx-x1', cx + 'px');
  d.style.setProperty('--vfx-y1', cy + 'px');
  d.style.setProperty('--vfx-rot', Math.atan2(cy - my0, cx - mx0).toFixed(3) + 'rad');
  d.style.animationDelay = safeBaseDelay + 'ms';
  d.style.animationDuration = fall + 'ms';
  var core = document.createElement('span');
  core.className = 'vfx-proj-core';
  d.appendChild(core);
  var trail = document.createElement('span');
  trail.className = 'vfx-proj-trail';
  d.appendChild(trail);
  vfxTrack(d, safeBaseDelay + fall + 120);

  var hitAt = safeBaseDelay + fall;
  // 爆炸：中心大爆＋全範圍橙光一閃＋震動＋每個目標的火焰受擊
  var boom = vfxNode('vfx-meteor-boom', layer, spec);
  vfxPlace(boom, { x: cx, y: cy });
  boom.style.animationDelay = hitAt + 'ms';
  for (var i = 0; i < 8; i++) {
    var s = document.createElement('span');
    s.className = 'vfx-p';
    var ang = (Math.PI * 2) * (i / 8) + Math.random() * 0.8;
    var dist = 34 + Math.random() * 46;
    s.style.setProperty('--dx', (Math.cos(ang) * dist).toFixed(1) + 'px');
    s.style.setProperty('--dy', (Math.sin(ang) * dist * 0.7).toFixed(1) + 'px');
    s.style.animationDelay = (hitAt + i * 18) + 'ms';
    boom.appendChild(s);
  }
  vfxTrack(boom, hitAt + 1000);

  var flash = vfxNode('vfx-area-flash', layer, spec);
  flash.style.left = rect.x + 'px';
  flash.style.top = rect.y + 'px';
  flash.style.width = rect.w + 'px';
  flash.style.height = rect.h + 'px';
  flash.style.animationDelay = hitAt + 'ms';
  vfxTrack(flash, hitAt + 700);

  vfxSceneShake(layer, hitAt, true);
  for (var t = 0; t < (targetIds || []).length; t++) {
    vfxHitReact(targetIds[t], 'fire', hitAt + (t % 3) * 40, true);
  }
}

/* 光柱：目標上方一道聖光射下，觸地後光環散開＋光點上升。 */
function vfxPillar(spec, layer, pt, targetId, delayMs) {
  var d = vfxNode('vfx-pillar', layer, spec);
  vfxPlace(d, pt);
  d.style.setProperty('--vfx-size', Math.round(pt.y + 40) + 'px');
  d.style.animationDelay = delayMs + 'ms';
  vfxTrack(d, delayMs + 900);
  var glow = vfxNode('vfx-pillar-glow', layer, spec);
  vfxPlace(glow, pt);
  glow.style.animationDelay = (delayMs + 200) + 'ms';
  for (var i = 0; i < 5; i++) {
    var s = document.createElement('span');
    s.className = 'vfx-p';
    s.style.setProperty('--dx', (Math.random() * 50 - 25).toFixed(1) + 'px');
    s.style.setProperty('--dy', (-(26 + Math.random() * 30)).toFixed(1) + 'px');
    s.style.animationDelay = (delayMs + 220 + i * 60) + 'ms';
    glow.appendChild(s);
  }
  vfxTrack(glow, delayMs + 1100);
  vfxHitReact(targetId, spec.elem || 'light', delayMs + 220, false);
}

/* 預設天降：範圍內落下數道元素雨。 */
function vfxRainDrops(spec, layer, rect) {
  var drops = Math.min(6, Math.max(3, Math.round(rect.w / 60)));
  for (var i = 0; i < drops; i++) {
    var pt = { x: rect.x + rect.w * ((i + 0.5) / drops), y: rect.y + rect.h * 0.5 };
    var d = vfxNode('vfx-rain', layer, spec);
    vfxPlace(d, pt);
    d.style.setProperty('--vfx-size', Math.round(rect.h) + 'px');
    d.style.animationDelay = (i * 70) + 'ms';
    d.style.animationDuration = Math.round((spec.dur || 0.75) * 1000) + 'ms';
    d.textContent = spec.glyph || '✨';
    vfxTrack(d, i * 70 + (spec.dur || 0.75) * 1000 + 160);
  }
}

/* ---- 閃電（SVG 折線）----
   from→to 之間 6 段鋸齒；粗白芯＋色描邊，閃兩下就消失。weak＝彈射弧光（細）。 */
function vfxBolt(spec, layer, from, to, delayMs, weak) {
  var minX = Math.min(from.x, to.x) - 26, minY = Math.min(from.y, to.y) - 26;
  var w = Math.max(8, Math.abs(to.x - from.x)) + 52, h = Math.max(8, Math.abs(to.y - from.y)) + 52;
  var segs = 6;
  var pts = [];
  var nx = -(to.y - from.y), ny = (to.x - from.x);
  var nl = Math.sqrt(nx * nx + ny * ny) || 1;
  for (var i = 0; i <= segs; i++) {
    var t = i / segs;
    var px = from.x + (to.x - from.x) * t;
    var py = from.y + (to.y - from.y) * t;
    if (i > 0 && i < segs) {
      var off = (Math.random() - 0.5) * Math.min(36, nl * 0.3);
      px += nx / nl * off;
      py += ny / nl * off;
    }
    pts.push((px - minX).toFixed(1) + ',' + (py - minY).toFixed(1));
  }
  var d = vfxNode('vfx-bolt' + (weak ? ' vfx-bolt-weak' : ''), layer, spec);
  d.style.left = minX + 'px';
  d.style.top = minY + 'px';
  d.style.animationDelay = delayMs + 'ms';
  var pl = pts.join(' ');
  d.innerHTML = '<svg width="' + Math.round(w) + '" height="' + Math.round(h) + '" viewBox="0 0 ' +
    Math.round(w) + ' ' + Math.round(h) + '">' +
    '<polyline points="' + pl + '" fill="none" stroke="var(--vfx-c2, #fffbe0)" stroke-width="' + (weak ? 2.4 : 4.5) + '" stroke-linejoin="round"/>' +
    '<polyline points="' + pl + '" fill="none" stroke="var(--vfx-c1, #ffd93d)" stroke-width="' + (weak ? 1 : 1.8) + '" stroke-linejoin="round"/>' +
    '</svg>';
  vfxTrack(d, delayMs + 420);
}

/* 連鎖雷鏈：第一個目標被天雷連劈 strikes 下（多段技的段數），之後沿 targets 順序
   在敵人之間彈射；單目標時向場上其他敵人卡片彈 1~2 道弱化弧光（純視覺氛圍，不帶數字）。 */
function vfxChain(spec, layer, ptList, idList, baseDelay, strikes) {
  if (!ptList.length) return;
  var hop = vfxStagger();
  var n = Math.max(1, strikes || 1);
  for (var st = 0; st < n; st++) {
    vfxBolt(spec, layer, { x: ptList[0].x + 34 - st * 16, y: -60 }, ptList[0], baseDelay + st * hop, false);
    vfxImpact({ elem: 'lightning', variant: null, color: spec.color }, layer, ptList[0], idList[0], baseDelay + st * hop + 50);
  }
  for (var i = 1; i < ptList.length; i++) {
    vfxBolt(spec, layer, ptList[i - 1], ptList[i], baseDelay + i * hop, i > 2);
    vfxImpact({ elem: 'lightning', variant: null, color: spec.color }, layer, ptList[i], idList[i], baseDelay + i * hop + 40);
  }
  if (ptList.length === 1) {
    var scene = layer.parentNode;
    var cards = scene ? scene.querySelectorAll('.enemy-card') : [];
    var lr = layer.getBoundingClientRect();
    var added = 0;
    for (var c = 0; c < cards.length && added < 2; c++) {
      var r = cards[c].getBoundingClientRect();
      if (!r.width) continue;
      var cpt = { x: r.left - lr.left + r.width / 2, y: r.top - lr.top + r.height / 2 };
      if (Math.abs(cpt.x - ptList[0].x) < 4 && Math.abs(cpt.y - ptList[0].y) < 4) continue;
      added++;
      vfxBolt(spec, layer, ptList[0], cpt, baseDelay + (n - 1) * hop + added * hop, true);
    }
  }
}

/* 天罰／單發神雷：一道天雷直劈目標。 */
function vfxSmite(spec, layer, pt, targetId, delayMs) {
  vfxBolt(spec, layer, { x: pt.x + 26, y: -50 }, pt, delayMs, false);
  vfxImpact({ elem: 'lightning', variant: null, color: spec.color }, layer, pt, targetId, delayMs + 40);
}

/* ---- 領域：元素化持續特效 ---- */
function vfxAura(spec, layer, rect) {
  var cls = 'vfx-aura';
  if (spec.variant === 'swordfield') cls += ' vfx-aura-sword';
  else if (spec.elem && VFX_ELEM_THEME[spec.elem]) cls += ' vfx-aura-' + spec.elem;
  var d = vfxNode(cls, layer, spec);
  d.style.left = rect.x + 'px';
  d.style.top = rect.y + 'px';
  d.style.width = rect.w + 'px';
  d.style.height = rect.h + 'px';
  // 上升粒子（火苗／劍氣／光點）：infinite 循環，壽命隨領域節點
  var n = 5;
  for (var i = 0; i < n; i++) {
    var s = document.createElement('span');
    s.className = 'vfx-aura-p';
    s.style.left = Math.round(8 + Math.random() * 84) + '%';
    s.style.animationDelay = (Math.random() * 1.8).toFixed(2) + 's';
    d.appendChild(s);
  }
  // 領域可能長達數十秒，節點壽命跟著它；上限由 VFX_MAX_NODES 兜底
  vfxTrack(d, Math.min(60, Math.max(1, spec.dur)) * 1000);
}

/* ---- 我方增益：光環＋上升光點 ---- */
function vfxSelfBuff(spec, layer, pt, delayMs) {
  var d = vfxNode('vfx-selfbuff', layer, spec);
  vfxPlace(d, pt);
  d.style.animationDelay = delayMs + 'ms';
  d.style.animationDuration = Math.round((spec.dur || 0.5) * 1000) + 'ms';
  for (var i = 0; i < 4; i++) {
    var s = document.createElement('span');
    s.className = 'vfx-p';
    s.style.setProperty('--dx', (Math.random() * 44 - 22).toFixed(1) + 'px');
    s.style.setProperty('--dy', (-(26 + Math.random() * 24)).toFixed(1) + 'px');
    s.style.animationDelay = (delayMs + i * 70) + 'ms';
    d.appendChild(s);
  }
  vfxTrack(d, delayMs + (spec.dur || 0.5) * 1000 + 400);
}

/* ---- 敵身詛咒：暗紫符紋迴旋下沉 ---- */
function vfxCurse(spec, layer, pt, targetId, delayMs) {
  var d = vfxNode('vfx-curse', layer, spec);
  vfxPlace(d, pt);
  d.style.animationDelay = delayMs + 'ms';
  d.textContent = spec.glyph || '☠️';
  vfxTrack(d, delayMs + 1100);
  vfxHitReact(targetId, spec.elem || 'dark', delayMs + 150, false);
}

/* ---- 進入點：協議 vfx 事件 → 畫面 ---- */
function renderCombatVfx(spec) {
  if (!_vfxEnabled || !spec) return;
  if (typeof document === 'undefined' || document.hidden) return;
  var anchorId = (spec.targets && spec.targets.length) ? spec.targets[0] : null;
  var layer = vfxLayer(anchorId);
  if (!layer) return;
  var kind = spec.fxKind;
  var dur = spec.dur > 0 ? spec.dur : 0.5;
  var count = Math.max(1, Math.min(5, spec.count || 1));
  var baseDelay = spec.delayMs > 0 ? spec.delayMs : 0;
  var s = {
    fxKind: kind, glyph: spec.glyph || '✨', color: spec.color || '#fff',
    elem: spec.elem || null, cat: spec.cat || null, variant: spec.variant || null, dur: dur
  };
  var travelMs = spec.travelMs || null;   // 每個目標各自的飛行時間（毫秒）
  var targets = (spec.targets || []).slice(0, VFX_MAX_TARGETS);

  /* 目標點解析（保留 id／座標／原始索引的配對；找不到的目標直接略過）。
     一次把所有 getBoundingClientRect 讀完再開始寫入 DOM——讀寫交錯會讓每個目標
     都強制同步 layout 一次（8 目標＝一個事件內 8 次 forced reflow）。
     idxs＝原始 targets 索引：travelMs 與 targets 同順序，跳過死目標後必須用它對位。 */
  function resolveTargets() {
    var pts = [], ids = [], idxs = [];
    for (var i = 0; i < targets.length; i++) {
      var p = vfxPointOf(targets[i], layer);
      if (!p) continue;
      pts.push(p);
      ids.push(targets[i]);
      idxs.push(i);
    }
    return { pts: pts, ids: ids, idxs: idxs };
  }

  if (kind === 'chain' || s.variant === 'chain') {
    var ch = resolveTargets();
    if (!ch.pts.length) return;
    var chBase = baseDelay;
    var chStrikes = 1;
    if (kind !== 'chain') {
      // 技能版（連鎖閃電）：傷害數字延遲＝飛行時間＋段間隔（skillVfxImpactDelayMs 的
      // projectile 規則），天雷的劈落時刻與段數對齊它，數字跟著每一劈跳出來
      chBase += (travelMs && travelMs[0] > 0) ? travelMs[0] : 0;
      chStrikes = count;
    }
    vfxChain(s, layer, ch.pts, ch.ids, chBase, chStrikes);
    return;
  }

  if (kind === 'impact') {
    var im = resolveTargets();
    for (var ii = 0; ii < im.pts.length; ii++) vfxImpact(s, layer, im.pts[ii], im.ids[ii], baseDelay);
    return;
  }

  if (kind === 'curse') {
    var cu = resolveTargets();
    for (var ci = 0; ci < cu.pts.length; ci++) vfxCurse(s, layer, cu.pts[ci], cu.ids[ci], baseDelay + ci * 60);
    return;
  }

  if (kind === 'selfBuff') {
    var mePt = vfxPointOf(anchorId || 'pv-float', layer);
    if (mePt) vfxSelfBuff(s, layer, mePt, baseDelay);
    return;
  }

  if (kind === 'aura' || kind === 'rain') {
    if (kind === 'rain' && s.variant === 'pillar') {
      var pl = resolveTargets();
      for (var pi = 0; pi < pl.pts.length; pi++) {
        // 傷害數字（rain 走 travelMs 延遲）跳在光柱觸地那一刻：柱體提前 200ms 開始降下
        var pTravel = (travelMs && travelMs[pl.idxs[pi]] > 0) ? travelMs[pl.idxs[pi]] : pi * 90 + 200;
        vfxPillar(s, layer, pl.pts[pi], pl.ids[pi], baseDelay + Math.max(0, pTravel - 200));
      }
      return;
    }
    if (kind === 'rain' && s.variant === 'smite') {
      var sm = resolveTargets();
      for (var si = 0; si < sm.pts.length; si++) vfxSmite(s, layer, sm.pts[si], sm.ids[si], baseDelay);
      return;
    }
    var rect = vfxCellsRect(spec.cells, layer);
    if (!rect) {
      // 高塔戰沒有棋盤格：以目標卡片為中心的退化矩形
      var fallbackPt = vfxPointOf(anchorId, layer);
      if (!fallbackPt) return;
      rect = vfxRectAround(fallbackPt);
    }
    if (kind === 'aura') { vfxAura(s, layer, rect); return; }
    if (s.variant === 'meteor') {
      vfxMeteor(s, layer, rect, targets, travelMs && travelMs.length ? travelMs[0] : 0, baseDelay);
      return;
    }
    vfxRainDrops(s, layer, rect);
    var rd = resolveTargets();
    for (var ri = 0; ri < rd.pts.length && ri < 4; ri++) {
      vfxHitReact(rd.ids[ri], s.elem, baseDelay + 300 + ri * 60, false);
    }
    return;
  }

  if (kind === 'burst' && (s.variant === 'cyclone' || s.variant === 'bladestorm')) {
    var bRect = vfxCellsRect(spec.cells, layer);
    var bt = resolveTargets();
    if (!bRect && bt.pts.length) bRect = vfxRectAround(bt.pts[0]);
    if (!bRect) return;
    if (s.variant === 'cyclone') vfxCyclone(s, layer, bRect);
    else vfxBladestorm(s, layer, bRect, count);
    for (var bi = 0; bi < bt.pts.length; bi++) {
      vfxImpact({ elem: s.elem, variant: null, color: s.color }, layer, bt.pts[bi], bt.ids[bi], baseDelay + 140 + bi * 70);
    }
    return;
  }

  // 讀在前、寫在後：先解析我方出手點與所有目標座標（純讀取），再開始生成節點
  var rt = resolveTargets();
  var from = vfxOriginPoint(layer);
  var stagger = vfxStagger();
  for (var t = 0; t < rt.pts.length; t++) {
    var pt = rt.pts[t];
    var tid = rt.ids[t];
    if (kind === 'beam') {
      vfxBeam(s, layer, from, pt);
      vfxImpact({ elem: s.elem, variant: null, color: s.color }, layer, pt, tid, baseDelay + 100);
      continue;
    }
    for (var c = 0; c < count; c++) {
      // 每一段之間的間隔與傷害數字共用同一個常數（data.js），否則畫面與數字會走鐘
      var delay = baseDelay + c * stagger + t * 40;
      if (kind === 'projectile') {
        var tr = (travelMs && travelMs[rt.idxs[t]] > 0) ? travelMs[rt.idxs[t]] : 0;
        vfxProjectile(s, layer, from, pt, delay, tr);
        var hitAt = delay + (tr > 0 ? tr : Math.round(dur * 1000));
        // 受擊爆點的節點預算：目標多、段數多時只留第一段的爆點，其餘只抖卡片
        if (c === 0 || rt.pts.length <= 3) vfxImpact(s, layer, pt, tid, hitAt);
        else vfxHitReact(tid, s.elem, hitAt, false);
      } else if (kind === 'slash') {
        vfxSlash(s, layer, pt, delay);
        if (c === 0) vfxImpact({ elem: s.elem, variant: s.variant, color: s.color }, layer, pt, tid, delay + 70);
        else vfxHitReact(tid, s.elem, delay + 70, false);
      } else {
        vfxBurst(s, layer, pt, delay);
        if (c === 0) vfxImpact({ elem: s.elem, variant: s.variant, color: s.color }, layer, pt, tid, delay + 80);
        else vfxHitReact(tid, s.elem, delay + 80, false);
      }
    }
  }
}

function vfxNormalizeTiming(spec) {
  if (!spec || spec.fxKind !== 'rain' || spec.variant !== 'meteor') return spec;
  var out = {};
  for (var key in spec) out[key] = spec[key];
  var delay = Number(spec.delayMs);
  if (!isFinite(delay) || delay < 0) delay = 0;
  out.delayMs = Math.min(VFX_METEOR_MAX_DELAY_MS, delay);
  if (spec.travelMs && spec.travelMs.length) {
    out.travelMs = spec.travelMs.map(function (value) {
      var travel = Number(value);
      if (!isFinite(travel) || travel < 0) travel = 0;
      return Math.min(VFX_METEOR_MAX_TRAVEL_MS, travel);
    });
  }
  return out;
}

function vfxSpecForQuality(spec) {
  if (!spec || _vfxQuality === VFX_QUALITY_LEVELS.OFF) return null;
  var source = vfxNormalizeTiming(spec);
  if (_vfxQuality === VFX_QUALITY_LEVELS.FULL) return source;
  if (source.fxKind === 'aura') return null;
  var out = {};
  for (var key in source) out[key] = source[key];
  out.count = 1;
  if (source.targets && source.targets.length) {
    var targetLimit = source.fxKind === 'chain' || source.variant === 'chain' ? 2 : 3;
    out.targets = source.targets.slice(0, targetLimit);
  }
  if (source.travelMs && source.travelMs.length && out.targets) {
    out.travelMs = source.travelMs.slice(0, out.targets.length);
  }
  return out;
}

function vfxMergeKey(spec) {
  if (!spec || (spec.fxKind !== 'impact' && spec.cat !== 'basic')) return null;
  var target = spec.targets && spec.targets.length ? spec.targets[0] : '';
  return [spec.fxKind || '', spec.cat || '', spec.elem || '', spec.variant || '', target].join('|');
}

function vfxScheduleFlush() {
  if (_vfxFlushHandle || !_vfxEventQueue.length) return;
  var flush = function () {
    _vfxFlushHandle = 0;
    vfxFlushQueue();
  };
  if (typeof requestAnimationFrame === 'function') _vfxFlushHandle = requestAnimationFrame(flush);
  else _vfxFlushHandle = setTimeout(flush, 0);
}

function vfxFlushQueue() {
  if (!_vfxEnabled || _vfxQuality === VFX_QUALITY_LEVELS.OFF || (typeof document !== 'undefined' && document.hidden)) {
    _vfxEventQueue.length = 0;
    return;
  }
  var budget = _vfxQuality === VFX_QUALITY_LEVELS.REDUCED ? VFX_FRAME_BUDGET_REDUCED : VFX_FRAME_BUDGET_FULL;
  var count = 0;
  var now = Date.now();
  while (_vfxEventQueue.length && count < budget) {
    var entry = _vfxEventQueue.shift();
    if (!entry || !entry.spec || now - entry.queuedAt > VFX_STALE_EVENT_MS) continue;
    renderCombatVfx(entry.spec);
    count++;
  }
  if (_vfxEventQueue.length) vfxScheduleFlush();
}

function vfxEnqueue(spec) {
  var now = Date.now();
  var mergeKey = vfxMergeKey(spec);
  if (mergeKey) {
    for (var i = _vfxEventQueue.length - 1; i >= 0; i--) {
      var queued = _vfxEventQueue[i];
      if (queued.key === mergeKey && now - queued.queuedAt <= VFX_MERGE_WINDOW_MS) {
        queued.spec = spec;
        queued.queuedAt = now;
        vfxScheduleFlush();
        return;
      }
    }
  }
  if (_vfxEventQueue.length >= VFX_EVENT_QUEUE_MAX) _vfxEventQueue.shift();
  _vfxEventQueue.push({ spec: spec, key: mergeKey, queuedAt: now });
  vfxScheduleFlush();
}

function playCombatVfx(spec) {
  var next = vfxSpecForQuality(spec);
  if (!next || !_vfxEnabled || (typeof document !== 'undefined' && document.hidden)) return;
  vfxEnqueue(next);
}
