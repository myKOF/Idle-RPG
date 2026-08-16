'use strict';
/* ============ 戰鬥特效（主執行緒） ============ v2「酷炫改造」（協議 v17）
   協議的 vfx 事件進來這裡變成畫面。模擬層只告訴我們「什麼原型、什麼屬性、什麼變體、
   打到哪些圖層／格子」，怎麼畫完全是這一支的事——調特效不必動模擬層，也不影響戰鬥結果。

   原型（fxKind）：
     projectile 投射物：元素化彈體（核心＋拖尾）從我方飛向目標；火球術為直線火球
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
   - 分頁不可見時整支停用（uiRenderingSuspended 已停了重繪，特效再畫也沒人看）。

   資料流總覽：Worker／舊路徑模擬層先送出純資料 spec，playCombatVfx() 只負責
   做品質裁切與排程；renderCombatVfx() 才把 spec 分派到下方各種繪圖函式。
   因此本檔可以調整畫法、延遲與節點生命週期，而不會改變傷害或戰鬥狀態。 */

/* ---- 全域上限、品質狀態與排程器狀態 ----
   _vfxNodes 管理已建立但尚未過期的 DOM 節點；_vfxEventQueue 管理尚未繪製的
   spec。兩者是不同層次：前者防止畫面殘留，後者防止短時間事件洪峰塞爆主執行緒。 */
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
var VFX_METEOR_MAX_TRAVEL_MS = (typeof VFX_METEOR_RAW_TRAVEL_MS === 'number' && VFX_METEOR_RAW_TRAVEL_MS > 0)
  ? VFX_METEOR_RAW_TRAVEL_MS : 700;
var VFX_METEOR_SIZE_SCALE = 1.30; // 新版殞石術特效寬度／尺寸增加 30%
var VFX_NODE_WATCHDOG_MS = 1000;
var VFX_METEOR_HARD_LIFETIME_MS = 2800;
var _vfxQuality = VFX_QUALITY_LEVELS.FULL;
var _vfxEventQueue = [];
var _vfxFlushHandle = 0;
var _vfxWatchdogHandle = 0;
var _vfxAnchorCache = Object.create(null);
var _vfxLayerRectCache = null;
var _vfxLayoutVersion = 0;
var _vfxFirePillars = Object.create(null);
var VFX_FIRE_PILLAR_LIFE_MS = 3600;
var _vfxFireWalls = Object.create(null);
var VFX_FIRE_WALL_LIFE_MS = 3600;

/* 版面快取的版本號只在尺寸、頁籤或戰鬥場景變動時遞增。
   座標函式用這個版本判斷快取是否仍可用，避免每個特效都重新量測整個 DOM。 */

/* 元素主題：c1 主色、c2 亮部／輔色、glow 光暈。
   這組色票同時供 DOM CSS 與 PixiJS 使用，所以 glow 採十六進位色碼，
   不用 rgba；無屬性事件才退回 spec.color 單色。 */
var VFX_ELEM_THEME = {
  light:     { c1: '#ffe47a', c2: '#fffef4', glow: '#fff3a3' },
  dark:      { c1: '#6f2da8', c2: '#1a0c2e', glow: '#913dcc' },
  fire:      { c1: '#e63924', c2: '#ffd447', glow: '#ff6a2a' },
  ice:       { c1: '#4da6ff', c2: '#f2fbff', glow: '#79d8ff' },
  lightning: { c1: '#f2b705', c2: '#fff8b0', glow: '#ffd23f' },
  earth:     { c1: '#ad7444', c2: '#5b3a27', glow: '#c48a55' },
  poison:    { c1: '#4caf2b', c2: '#d8ff8a', glow: '#76d83b' }
};

/* 開關是比品質分級更高一層的總閘門；關閉時連已存在的特效也要清掉，
   否則玩家雖然不再收到新事件，舊節點仍可能留在戰場上。 */
function vfxSetEnabled(on) {
  _vfxEnabled = !!on;
  if (!on) vfxClear();
}

/* UI／頁籤策略讀取目前品質，實際裁切由 vfxSpecForQuality() 統一處理。 */
function vfxQuality() {
  return _vfxQuality;
}

/* Full 保留完整事件；Reduced 保留主要命中但壓低數量；Off 清空佇列與畫面。
   切換品質時清佇列，避免切回頁籤後補播已經過時的高負載事件。 */
function vfxSetQuality(level) {
  var next = level === VFX_QUALITY_LEVELS.REDUCED ? VFX_QUALITY_LEVELS.REDUCED
    : level === VFX_QUALITY_LEVELS.OFF ? VFX_QUALITY_LEVELS.OFF : VFX_QUALITY_LEVELS.FULL;
  if (next === _vfxQuality) return;
  _vfxQuality = next;
  _vfxEventQueue.length = 0;
  if (next === VFX_QUALITY_LEVELS.OFF) vfxClear();
}

/* 戰場尺寸、縮放、全螢幕或 DOM 重建後，所有錨點座標都必須重新讀取。 */
function vfxInvalidateLayout() {
  _vfxLayoutVersion++;
  _vfxAnchorCache = Object.create(null);
  _vfxLayerRectCache = null;
  _vfxOriginCache = null;
}

/* ---- 圖層與座標 ----
   這一區把「事件目標 id」轉成特效圖層內的座標。特效層跟著 battle-scene
   移動，這樣投射物可以跨越我方欄與敵方欄，也不會成為 battlefield grid 的格子項目。 */
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

/* 取得或建立目前 scene 唯一的特效容器；高塔與野外共用同一套 DOM 畫法，
   差別只在 anchorId 會落到哪一個 battle-scene。 */
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

/* 場景切換、死亡、關閉 VFX 或品質切到 Off 時的總清理入口。
   generation 讓尚未執行的 setTimeout／RAF 回呼自動失效，避免舊事件復活。 */
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
  _vfxFirePillars = Object.create(null);
  _vfxFireWalls = Object.create(null);
  if (typeof document === 'undefined' || !document.querySelectorAll) return;
  var hitCards = document.querySelectorAll('.enemy-card, .combatant');
  for (var ci = 0; ci < hitCards.length; ci++) {
    var card = hitCards[ci];
    if (!card.classList) continue;
    for (var hi = 0; hi < VFX_HIT_CLASSES.length; hi++) card.classList.remove(VFX_HIT_CLASSES[hi]);
    card._vfxHitUntil = 0;
    card._vfxHitLastAt = 0;
  }
  var hitVisuals = document.querySelectorAll('.vfx-hit-target');
  for (var vi = 0; vi < hitVisuals.length; vi++) {
    var visual = hitVisuals[vi];
    if (!visual.classList) continue;
    for (var vhi = 0; vhi < VFX_HIT_CLASSES.length; vhi++) visual.classList.remove(VFX_HIT_CLASSES[vhi]);
    visual.classList.remove('vfx-hit-target');
    visual._vfxHitUntil = 0;
  }
  var scenes = document.querySelectorAll('.battle-scene');
  for (var si = 0; si < scenes.length; si++) {
    if (!scenes[si].classList) continue;
    scenes[si].classList.remove('vfx-scene-shake', 'vfx-scene-shake-strong', 'vfx-scene-shake-meteor');
  }
}

/* className 在 HTML DOM 是字串，在 SVG／部分測試替身可能是 SVGAnimatedString；
   統一取成字串，供節點上限與看門狗辨識 aura／meteor 類節點。 */
function vfxNodeClassName(node) {
  if (!node) return '';
  if (typeof node.className === 'string') return node.className;
  if (node.className && typeof node.className.baseVal === 'string') return node.className.baseVal;
  return '';
}

/* 對已脫離 DOM 的節點也安全；清理路徑可重複呼叫。 */
function vfxRemoveNode(node) {
  if (node && node.parentNode) node.parentNode.removeChild(node);
}

/* Timer 是正常回收之外的第二道保險：處理動畫中斷、節點被外部移除或
   某個 CSS／瀏覽器回呼沒有如期完成的情況。 */
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

/* 只有有追蹤節點且目前沒有 watchdog 時才排程，避免每個特效各自建立 Timer。 */
function vfxScheduleNodeWatchdog() {
  if (!_vfxWatchdogHandle && _vfxNodes.length) {
    _vfxWatchdogHandle = setTimeout(vfxRunNodeWatchdog, VFX_NODE_WATCHDOG_MS);
  }
}

/* 登記節點的預期壽命、套用全域節點上限並安排回收。
   aura 是長駐狀態，節點爆量時優先淘汰短命效果，避免領域被技能連發擠掉。 */
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

/* ---- 錨點與範圍幾何 ----
   目標圖層 id → 相對於特效圖層的中心座標。找不到（敵人已被清掉）回傳 null。 */
function vfxLayerRect(layer) {
  if (_vfxLayerRectCache && _vfxLayerRectCache.layer === layer && _vfxLayerRectCache.version === _vfxLayoutVersion) {
    return _vfxLayerRectCache.rect;
  }
  var rect = layer.getBoundingClientRect();
  _vfxLayerRectCache = { layer: layer, version: _vfxLayoutVersion, rect: rect };
  return rect;
}

/* 高塔的浮字節點不等於 BOSS 圖像節點；先找實際可見的 emoji／圖片，
   避免以整張 combatant 欄位中心當成命中點。野外則回到 enemy-card／combatant。 */
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
/* 取得我方出手點。這是投射物、光束、突刺與彈射首段的共同起點；
   對於沒有可見我方卡片的退化場景，使用 layer 中線左側的安全座標。 */
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

/* 將協議中的棋盤格集合轉成實際像素矩形；只讀取現有格線的 DOM 位置，
   不自行猜測欄寬，因而能跟著 UI 縮放與響應式版面走。 */
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
function vfxRectAround(pt, area) {
  var r = area && Number(area.r);
  if (isFinite(r) && r > 0) {
    return { x: pt.x - r, y: pt.y - r, w: r * 2, h: r * 2, r: r };
  }
  return { x: pt.x - 70, y: pt.y - 80, w: 140, h: 160 };
}

/* ---- 節點工廠與共用時序 ----
   所有特效都透過 vfxNode() 建立，讓元素色票、CSS custom properties 與 DOM
   父層保持一致；各專用函式只負責自己的幾何與子粒子。 */
function vfxTheme(spec) {
  /* variant 的專屬色優先於元素色；沒有元素時才使用事件傳入的單色。 */
  if (spec && (spec.variant === 'bleed' || spec.variant === 'bleed-tick')) {
    return { c1: '#d92846', c2: '#ffd0d8', glow: '#ff4962' };
  }
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

/* DOM 特效的定位統一使用中心點，CSS 再透過 margin／transform 做視覺偏移。 */
function vfxPlace(d, pt) {
  d.style.left = pt.x + 'px';
  d.style.top = pt.y + 'px';
}

/* 多段命中、連鎖與 DoT 共用的段間延遲；必須和傷害浮字使用同一個基準，
   才不會出現特效已命中但數字尚未出現，或數字先跳出的錯位。 */
function vfxStagger() {
  return (typeof VFX_HIT_STAGGER_SEC === 'number') ? VFX_HIT_STAGGER_SEC * 1000 : 90;
}

var VFX_HIT_COOLDOWN_MS = 3000;
var VFX_BOUNCE_HIT_RADIUS_SCALE = 1 / 3;

/* ---- 受擊反饋：卡片震動＋元素色閃光 ----
   卡片只在敵群「簽章」（身分＋站位）變動時重建，短命 class 掛上去是安全的；
   萬一剛好碰上重建把 class 洗掉，也只是少抖一下，不會殘留。
   受擊反饋是命中特效的附加層，不負責產生傷害數字，也不改變戰鬥狀態。 */
var VFX_HIT_CLASSES = ['vfx-hit', 'vfx-hit-strong', 'vfx-hit-fire', 'vfx-hit-ice',
  'vfx-hit-lightning', 'vfx-hit-poison', 'vfx-hit-light', 'vfx-hit-dark', 'vfx-hit-earth'];
function vfxHitVisualTarget(elId, card) {
  if (!card || !card.querySelector) return null;
  if (elId === 'tb-float') {
    var bossHost = document.getElementById('tb-emoji');
    var bossVisual = bossHost && bossHost.querySelector
      ? bossHost.querySelector('img, span') : null;
    if (bossVisual) return bossVisual;
  }
  return card.querySelector('.cb-icon, .cb-emoji, .enemy-emoji-fallback');
}
function vfxHitReact(targetId, elem, delayMs, strong) {
  if (!targetId) return;
  if (_vfxQuality === VFX_QUALITY_LEVELS.REDUCED && !strong) return;
  var generation = _vfxGeneration;
  setTimeout(function () {
    if (!_vfxEnabled || generation !== _vfxGeneration) return;
    var el = document.getElementById(targetId);
    var card = (el && el.closest) ? (el.closest('.enemy-card') || el.closest('.combatant')) : null;
    var visual = vfxHitVisualTarget(targetId, card);
    if (!card || !card.classList || !visual || !visual.classList) return;
    var hitAt = Date.now();
    if (typeof card._vfxHitLastAt === 'number' &&
        hitAt - card._vfxHitLastAt < VFX_HIT_COOLDOWN_MS) return;
    card._vfxHitLastAt = hitAt;
    for (var vi = 0; vi < VFX_HIT_CLASSES.length; vi++) visual.classList.remove(VFX_HIT_CLASSES[vi]);
    // 先移除再隔兩幀掛回：連續命中時動畫才會重新播放（不用 offsetWidth 硬觸發 reflow）
    for (var i = 0; i < VFX_HIT_CLASSES.length; i++) card.classList.remove(VFX_HIT_CLASSES[i]);
    var until = Date.now() + 340;
    card._vfxHitUntil = until;
    visual._vfxHitUntil = until;
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (!visual || visual._vfxHitUntil !== until) return;
        if (!_vfxEnabled || generation !== _vfxGeneration || card._vfxHitUntil !== until) return;  // 已被更新的一擊接手
        visual.classList.add('vfx-hit-target', 'vfx-hit');
        if (strong) visual.classList.add('vfx-hit-strong');
        if (elem && VFX_ELEM_THEME[elem]) visual.classList.add('vfx-hit-' + elem);
        setTimeout(function () {
          if (generation !== _vfxGeneration || card._vfxHitUntil !== until || visual._vfxHitUntil !== until) return;
          for (var j = 0; j < VFX_HIT_CLASSES.length; j++) visual.classList.remove(VFX_HIT_CLASSES[j]);
          visual.classList.remove('vfx-hit-target');
        }, 360);
      });
    });
  }, Math.max(0, delayMs || 0));
}

/* 畫面震動：大爆點（隕石、引爆）時整個戰鬥畫面晃一下。
   Reduced 直接跳過，避免普通裝備操作頁也因戰鬥事件產生大範圍重繪。 */
function vfxAllowsSceneShake(spec) {
  var v = spec && spec.variant;
  return v === 'meteor' || v === 'pillar' || v === 'purple-thunder' ||
    v === 'storm-sigil' || v === 'detonate' || v === 'blood-explosion' ||
    v === 'zero-infection' || v === 'nova' || v === 'venomburst' || v === 'vortex';
}
function vfxSceneShake(layer, delayMs, strong, spec) {
  if (!vfxAllowsSceneShake(spec)) return;
  var meteor = spec && spec.variant === 'meteor';
  if (_vfxQuality !== VFX_QUALITY_LEVELS.FULL && !meteor) return;
  var generation = _vfxGeneration;
  setTimeout(function () {
    if (!_vfxEnabled || generation !== _vfxGeneration) return;
    var scene = (layer && layer.closest) ? layer.closest('.battle-scene')
      : ((layer && layer.parentNode) ? layer.parentNode : null);
    if (!scene || !scene.classList) return;
    scene.classList.remove('vfx-scene-shake', 'vfx-scene-shake-strong', 'vfx-scene-shake-meteor');
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (!_vfxEnabled || generation !== _vfxGeneration) return;
        if (meteor) scene.classList.add('vfx-scene-shake-meteor');
        else scene.classList.add(strong ? 'vfx-scene-shake-strong' : 'vfx-scene-shake');
        setTimeout(function () {
          if (generation !== _vfxGeneration) return;
          scene.classList.remove('vfx-scene-shake', 'vfx-scene-shake-strong', 'vfx-scene-shake-meteor');
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
      nova 冰環爆發＋地面結霜（霜之新星）
   這是最常用的末端命中回饋；特殊技能通常仍由自己的幾何函式出手，
   再呼叫本函式補命中爆點與卡片反應。 */
var VFX_IMPACT_PARTS = { fire: 6, ice: 5, lightning: 5, poison: 4, light: 6, dark: 5, earth: 6, phys: 3, claw: 3 };
function vfxImpact(spec, layer, pt, targetId, delayMs, isBounceHit) {
  /* 先把 variant 映射成 CSS class，再由粒子數與 strong 決定爆點規模。 */
  var v = spec.variant;
  var elemKey = spec.elem || 'phys';
  var strong = false;
  var life = 800;
  var cls;
  if (v === 'claw') { cls = 'vfx-impact vfx-impact-claw'; elemKey = 'claw'; }
  else if (v === 'vortex') { cls = 'vfx-impact vfx-impact-vortex'; strong = true; life = 1000; }
  else if (v === 'detonate') { cls = 'vfx-impact vfx-impact-detonate'; strong = true; life = 1000; }
  else if (v === 'venomburst') { cls = 'vfx-impact vfx-impact-venomburst'; strong = true; }
  else if (v === 'blood-explosion') { cls = 'vfx-impact vfx-impact-detonate'; strong = true; life = 1000; }
  else if (v === 'zero-infection') { cls = 'vfx-impact vfx-impact-poison vfx-impact-zero'; strong = true; life = 900; }
  else if (v === 'bleed-tick') { cls = 'vfx-impact vfx-impact-phys vfx-impact-bleed'; }
  else if (v === 'poison-tick') { cls = 'vfx-impact vfx-impact-poison'; }
  else if (v === 'nova') { cls = 'vfx-impact vfx-impact-nova'; strong = true; life = 1000; }
  else if (v === 'fire-explosion') { cls = 'vfx-impact vfx-impact-fire-explosion'; strong = true; life = 900; }
  else cls = 'vfx-impact vfx-impact-' + elemKey;
  var d = vfxNode(cls, layer, spec);
  vfxPlace(d, pt);
  if (v === 'fire-explosion') {
    d.style.setProperty('--vfx-c1', '#c51e0d');
    d.style.setProperty('--vfx-c2', '#ffd447');
    d.style.setProperty('--vfx-glow', '#ff3b0a');
  }
  if (isBounceHit) d.style.setProperty('--vfx-hit-scale', String(VFX_BOUNCE_HIT_RADIUS_SCALE));
  d.style.animationDelay = delayMs + 'ms';

  var n = VFX_IMPACT_PARTS[elemKey] || 4;
  if (v === 'fire-explosion') n = 16;
  if (v === 'detonate' || v === 'blood-explosion' || v === 'zero-infection' || v === 'nova') n = 7;
  if (_vfxQuality === VFX_QUALITY_LEVELS.REDUCED) n = 1;
  for (var i = 0; i < n; i++) {
    var s = document.createElement('span');
    s.className = 'vfx-p';
    if (elemKey === 'poison') {          // 毒泡向上飄
      s.style.setProperty('--dx', (Math.random() * 34 - 17).toFixed(1) + 'px');
      s.style.setProperty('--dy', (-(20 + Math.random() * 30)).toFixed(1) + 'px');
    } else {
      var ang = (Math.PI * 2) * (i / n) + Math.random() * 0.9;
      var dist = v === 'fire-explosion'
        ? 14 + Math.random() * 22 : 6 + Math.random() * 9 + (strong ? 5 : 0);
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
  if (v === 'detonate' || v === 'blood-explosion') vfxSceneShake(layer, delayMs, false, spec);
  vfxHitReact(targetId, spec.elem || null, delayMs, strong);
}

/* ---- 投射物 ----
   元素化彈體：外層節點做 x0→x1 位移（等速，時長＝travelMs），內層 core／trail
   以 --vfx-rot 對齊飛行方向。火球術是我方到敵方的直線；殞石術由 vfxMeteor
   另外建立 60° 天降路徑。殞石才使用 Phaser 範例同款 flares.png 的白色 flare
   粒子；一般火球改用獨立的短動態尾焰與核心脈動，避免和殞石外觀混用。
   vfxBarrageProjectile 是多線彈幕；vfxProjectile 是一般單線投射物，兩者都只
   表現視覺飛行，命中時機由 renderCombatVfx 的 travelMs／delayMs 對齊。 */
function vfxProjectileCls(spec) {
  var v = spec.variant;
  if (v === 'swordwave') return 'vfx-proj-sword';
  if (v === 'knife' || v === 'knife-bounce') return 'vfx-proj-knife';
  if (v === 'venom') return 'vfx-proj-poison';
  if (v === 'flamewave') return 'vfx-proj-fire vfx-proj-big';
  if (spec.elem && VFX_ELEM_THEME[spec.elem]) return 'vfx-proj-' + spec.elem;
  if (spec.cat === 'special' || spec.cat === 'potential' || spec.cat === 'fusion') return 'vfx-proj-glyph';
  return 'vfx-proj-plain';
}

/* 僅用於投射物路徑內的數值插值，不涉及遊戲公式。 */
function vfxLerp(a, b, t) { return a + (b - a) * t; }

/* 讀取調速參數；沒有配置時退回 0.75，保證舊存檔或測試環境仍有合理速度。 */
function vfxProjectileSpeedMultiplier() {
  return (typeof VFX_PROJECTILE_SPEED_MULTIPLIER === 'number' && VFX_PROJECTILE_SPEED_MULTIPLIER > 0)
    ? VFX_PROJECTILE_SPEED_MULTIPLIER : 0.6;
}

/* travelMs 是模擬層提供的實際距離時間；缺少時用 spec.dur 估算，並套用
   顯示層速度倍率。這裡只計算動畫時長，不延遲或改寫戰鬥結算。 */
function vfxProjectileFlightMs(travelMs, fallbackDurationSec) {
  if (travelMs > 0) return travelMs;
  return Math.round((fallbackDurationSec || 0) * 1000 / vfxProjectileSpeedMultiplier());
}

/*
 * Phaser 範例的粒子設定，逐項保留在 DOM 版：white frame、四色 color、
 * quad.out 色彩插值、lifespan 2400、scale 0.70→0、speed 100、advance 2000、
 * ADD 混合。原範例的 -100°～-80° 是向上發射；移植到投射物後，改成飛行反方向
 * ±10°，再由外層飛行角度旋轉，因此拖尾會和 60° 落下軌跡保持同一條軸線。
 */
var VFX_FLARE_COLORS = [0xfacc22, 0xf89800, 0xf83600, 0x9f0404];
var VFX_FLARE_LIFESPAN_MS = 2400;
var VFX_FLARE_SPEED = 100;
var VFX_FLARE_ADVANCE_MS = 2000;
var VFX_FLARE_START_SCALE = 0.70;

function vfxFlareColorAt(progress) {
  var q = Math.max(0, Math.min(1, progress));
  q = 1 - (1 - q) * (1 - q); // Phaser colorEase: quad.out
  var pos = q * (VFX_FLARE_COLORS.length - 1);
  var idx = Math.min(VFX_FLARE_COLORS.length - 2, Math.floor(pos));
  var local = pos - idx;
  var a = VFX_FLARE_COLORS[idx], b = VFX_FLARE_COLORS[idx + 1];
  var ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  var br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return 'rgb(' + Math.round(ar + (br - ar) * local) + ',' +
    Math.round(ag + (bg - ag) * local) + ',' + Math.round(ab + (bb - ab) * local) + ')';
}

/* 以真正的 emitter 方式建立火焰：先 advance 2000ms 預填粒子，之後依固定頻率
   持續生成；每顆粒子都有自己的角度、生命週期、位置、縮放與色彩。 */
function vfxBuildFlareFlame(parent, small, sizeScale) {
  var emitter = document.createElement('span');
  emitter.className = 'vfx-flare-emitter';
  parent.appendChild(emitter);
  var size = (typeof sizeScale === 'number' ? sizeScale : 1) * (small ? 0.58 : 1);
  var count = _vfxQuality === VFX_QUALITY_LEVELS.REDUCED ? (small ? 8 : 14) : (small ? 14 : 26);
  var interval = VFX_FLARE_ADVANCE_MS / count;
  var particles = [];
  var accumulator = 0;
  var lastAt = Date.now();
  var generation = _vfxGeneration;

  function spawn(ageMs) {
    var p = document.createElement('span');
    p.className = 'vfx-flare vfx-emitter-particle';
    p._age = ageMs;
    p._angle = Math.PI + ((Math.random() * 20 - 10) * Math.PI / 180);
    p._scale = size * VFX_FLARE_START_SCALE;
    emitter.appendChild(p);
    particles.push(p);
  }

  /* Phaser advance:2000：先把過去兩秒已發射的粒子補進畫面。 */
  for (var i = 0; i < count; i++) spawn((i + 0.5) * interval);

  function update(now) {
    if (!_vfxEnabled || generation !== _vfxGeneration || !parent.parentNode) return;
    var dt = Math.max(0, Math.min(80, now - lastAt));
    lastAt = now;
    accumulator += dt;
    while (accumulator >= interval) {
      accumulator -= interval;
      spawn(0);
    }
    for (var pi = particles.length - 1; pi >= 0; pi--) {
      var p = particles[pi];
      p._age += dt;
      if (p._age >= VFX_FLARE_LIFESPAN_MS) {
        if (p.parentNode) p.parentNode.removeChild(p);
        particles.splice(pi, 1);
        continue;
      }
      var life = p._age / VFX_FLARE_LIFESPAN_MS;
      var distance = VFX_FLARE_SPEED * p._age / 1000;
      var scale = p._scale * Math.cos(life * Math.PI * 0.5);
      p.style.setProperty('--flare-x', (Math.cos(p._angle) * distance).toFixed(2) + 'px');
      p.style.setProperty('--flare-y', (Math.sin(p._angle) * distance).toFixed(2) + 'px');
      p.style.setProperty('--flare-sx', scale.toFixed(3));
      p.style.setProperty('--flare-sy', scale.toFixed(3));
      p.style.setProperty('--flare-color', vfxFlareColorAt(life));
      p.style.opacity = String(Math.max(0, 1 - life));
    }
    (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : function (fn) { return setTimeout(fn, 16); })(update);
  }
  update(lastAt);
}

/* 一般火球專用的小型彈體：不用殞石的 flare emitter，改成短尾焰＋小核心，
   只配合 vfxProjectile 的直線投射物位移，避免視覺上再被誤認成天降殞石。 */
function vfxBuildSmallFireball(parent) {
  var scale = 3;
  var core = document.createElement('span');
  core.className = 'vfx-fireball-small-core';
  core.style.setProperty('--fireball-size-scale', scale);
  parent.appendChild(core);
  var tail = document.createElement('span');
  tail.className = 'vfx-fireball-small-tail';
  tail.style.setProperty('--fireball-size-scale', scale);
  parent.appendChild(tail);
}

/* 彈幕專用投射物：同一目標建立左右兩側、三條 lane 的交錯彈道，
   用來表現 arcane-barrage 這類密集魔法，而不是逐目標重複建立同一條線。 */
function vfxBarrageProjectile(spec, layer, from, to, side, lane, delayMs, travelMs) {
  var flight = vfxProjectileFlightMs(travelMs, spec.dur || 0.55);
  var start = {
    x: from.x + side * (12 + lane * 8),
    y: from.y + 10 + lane * 7
  };
  var turn = {
    x: start.x + side * (48 + lane * 18),
    y: start.y - 16 - lane * 8
  };
  var projClass = vfxProjectileCls(spec);
  var d = vfxNode('vfx-proj ' + projClass + ' vfx-proj-barrage', layer, spec);
  d.style.animation = 'none';
  var core = document.createElement('span');
  core.className = 'vfx-proj-core';
  if (projClass === 'vfx-proj-glyph' || projClass === 'vfx-proj-knife') {
    core.textContent = spec.glyph || (projClass === 'vfx-proj-knife' ? '🔪' : '✨');
  }
  d.appendChild(core);
  var trail = document.createElement('span');
  trail.className = 'vfx-proj-trail';
  d.appendChild(trail);
  var generation = _vfxGeneration;
  var startedAt = Date.now() + Math.max(0, delayMs || 0);
  function frame() {
    if (!_vfxEnabled || generation !== _vfxGeneration || !d.parentNode) return;
    var elapsed = Date.now() - startedAt;
    if (elapsed < 0) {
      (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : function (fn) { return setTimeout(fn, 16); })(frame);
      return;
    }
    var k = Math.min(1, elapsed / Math.max(1, flight));
    var x, y, q;
    if (k < 0.38) {
      q = k / 0.38;
      q = q * q * (3 - 2 * q);
      x = vfxLerp(start.x, turn.x, q);
      y = vfxLerp(start.y, turn.y, q);
    } else {
      q = (k - 0.38) / 0.62;
      q = q * q;
      x = vfxLerp(turn.x, to.x, q);
      y = vfxLerp(turn.y, to.y, q);
    }
    var aheadX = k < 0.38 ? turn.x : to.x;
    var aheadY = k < 0.38 ? turn.y : to.y;
    d.style.left = x + 'px';
    d.style.top = y + 'px';
    d.style.setProperty('--vfx-rot', Math.atan2(aheadY - y, aheadX - x).toFixed(3) + 'rad');
    d.style.transform = 'translate(-50%, -50%)';
    d.style.opacity = String(k >= 1 ? 0 : 1);
    if (k < 1) {
      (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : function (fn) { return setTimeout(fn, 16); })(frame);
    }
  }
  vfxTrack(d, Math.max(0, delayMs || 0) + flight + 220);
  frame();
}

function vfxProjectile(spec, layer, from, to, delayMs, travelMs) {
  /* 火球術使用一般的我方→敵方直線；殞石術的 60° 天降路徑由 vfxMeteor
     獨立處理，避免兩種火焰技能共用錯誤的進場方向。 */
  var flight = vfxProjectileFlightMs(travelMs, spec.dur || 0.5);
  var fromPt = from;
  var dx = to.x - fromPt.x, dy = to.y - fromPt.y;
  var projClass = vfxProjectileCls(spec);
  var smallFireball = spec.variant === 'fireball-small' || spec.variant === 'fireball';
  var d = vfxNode('vfx-proj ' + projClass + (smallFireball ? ' vfx-proj-fireball-small' : ''), layer, spec);
  d.style.setProperty('--vfx-x0', fromPt.x + 'px');
  d.style.setProperty('--vfx-y0', fromPt.y + 'px');
  d.style.setProperty('--vfx-x1', to.x + 'px');
  d.style.setProperty('--vfx-y1', to.y + 'px');
  d.style.setProperty('--vfx-rot', Math.atan2(dy, dx).toFixed(3) + 'rad');
  d.style.animationDelay = delayMs + 'ms';
  d.style.animationDuration = flight + 'ms';
  var core = document.createElement('span');
  core.className = 'vfx-proj-core';
  if (projClass === 'vfx-proj-glyph' || projClass === 'vfx-proj-knife') {
    core.textContent = spec.glyph || (projClass === 'vfx-proj-knife' ? '🔪' : '✨');
  }
  if (smallFireball) {
    vfxBuildSmallFireball(d);
  } else {
    d.appendChild(core);
    var trail = document.createElement('span');
    trail.className = 'vfx-proj-trail';
    d.appendChild(trail);
  }
  vfxTrack(d, delayMs + flight + VFX_FLARE_LIFESPAN_MS + 160);

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

/* ---- 斬擊與近戰幾何 ----
   這些函式只建立刀光／衝擊線；目標命中數量與傷害已由模擬層決定。 */
function vfxSlash(spec, layer, pt, delayMs, tiltDeg, extraClass) {
  var d = vfxNode('vfx-slash' + (extraClass ? ' ' + extraClass : ''), layer, spec);
  vfxPlace(d, pt);
  var tilt = typeof tiltDeg === 'number' ? tiltDeg : (Math.random() * 50 - 25);
  d.style.setProperty('--vfx-tilt', tilt.toFixed(0) + 'deg');
  d.style.animationDelay = delayMs + 'ms';
  d.style.animationDuration = Math.round((spec.dur || 0.5) * 1000) + 'ms';
  vfxTrack(d, delayMs + (spec.dur || 0.5) * 1000 + 160);
}

/* 直線突刺／飛出斬擊：固定 70 個系統距離單位（7 米）的刀光，
   從玩家位置沿目標方向貫穿；三向突刺由 angleOffset 產生三道刀光。 */
/* 迴旋斬的既有大型弧形斬擊；可選擇沿指定方向飛出，目標身上只保留普通受擊反應。 */
function vfxCleaveArc(spec, layer, pt, delayMs, angleDeg, extraClass, travel) {
  if (!pt) return;
  var d = vfxNode('vfx-cleave-arc' + (extraClass ? ' ' + extraClass : ''), layer, spec);
  vfxPlace(d, pt);
  d.style.setProperty('--vfx-tilt', (typeof angleDeg === 'number' ? angleDeg : 0).toFixed(0) + 'deg');
  var delay = Math.max(0, delayMs || 0);
  d.style.animationDelay = delay + 'ms';
  var duration = Math.max(0.38, spec.dur || 0.5);
  d.style.animationDuration = Math.round(duration * 1000) + 'ms';
  if (travel && Number(travel.length) > 0) {
    var distance = Math.max(48, Number(travel.length));
    var travelAngle = Number(travel.angle) || 0;
    var generation = _vfxGeneration;
    var startedAt = Date.now() + delay;
    var frame = function () {
      if (!_vfxEnabled || generation !== _vfxGeneration || !d.parentNode) return;
      var elapsed = Date.now() - startedAt;
      var k = elapsed <= 0 ? 0 : Math.min(1, elapsed / (duration * 1000));
      var eased = k * k * (3 - 2 * k);
      d.style.left = (pt.x + Math.cos(travelAngle) * distance * eased) + 'px';
      d.style.top = (pt.y + Math.sin(travelAngle) * distance * eased) + 'px';
      if (k < 1) {
        (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : function (fn) { return setTimeout(fn, 16); })(frame);
      }
    };
    frame();
  }
  vfxTrack(d, delay + duration * 1000 + 180);
}

function vfxCleaveArcFlightMs(spec) {
  return Math.round(Math.max(0.38, spec.dur || 0.5) * 1000);
}

/* 突刺光槍圖片；圖片本身是垂直長槍，播放時旋轉到路徑方向，並可用
   laneOffsetPx 排成平行三道或用 angleOverride 畫八方向。 */
function vfxThrustLine(spec, layer, from, to, delayMs, angleOffset, lengthPx, laneOffsetPx, angleOverride, isFinal) {
  if (!from || !to) return;
  var dx = to.x - from.x, dy = to.y - from.y;
  var angle = typeof angleOverride === 'number'
    ? angleOverride : Math.atan2(dy, dx) + (Number(angleOffset) || 0);
  var distance = Math.max(48, Number(spec.lineLength) || Number(lengthPx) || 70);
  var bodyLength = isFinal ? distance : Math.min(96, Math.max(42, distance * 0.34));
  var flightDistance = Math.max(0, distance - bodyLength);
  var laneOffset = Number(laneOffsetPx) || 0;
  var side = angle + Math.PI / 2;
  var start = { x: from.x + Math.cos(side) * laneOffset, y: from.y + Math.sin(side) * laneOffset };
  var center = { x: start.x + Math.cos(angle) * bodyLength / 2, y: start.y + Math.sin(angle) * bodyLength / 2 };
  var d = vfxNode('vfx-thrust-line', layer, spec);
  if (!isFinal) d.classList.add('vfx-thrust-flight');
  vfxPlace(d, center);
  d.style.setProperty('--vfx-length', bodyLength + 'px');
  d.style.setProperty('--vfx-flight-distance', flightDistance + 'px');
  d.style.setProperty('--vfx-width', Math.max(28, Number(spec.lineWidth) || 36) + 'px');
  d.style.setProperty('--vfx-angle', angle.toFixed(3) + 'rad');
  d.style.animationDelay = Math.max(0, delayMs || 0) + 'ms';
  var duration = isFinal
    ? Math.max(0.24, spec.dur || 0.3)
    : Math.max(0.16, Math.min(0.22, (spec.dur || 0.3) * 0.75));
  d.style.animationDuration = Math.round(duration * 1000) + 'ms';
  vfxTrack(d, Math.max(0, delayMs || 0) + duration * 1000 + 180);
}

/* 近戰彈射：第一組飛刀已從玩家飛出，後續只畫目前命中點到下一個目標的短刀光。
   複製 spec 再改 variant，避免污染同一事件稍後可能使用的原始 spec。 */
function vfxKnifeBounce(spec, layer, from, to, delayMs, travelMs) {
  if (!from || !to) return;
  var next = {};
  for (var key in spec) next[key] = spec[key];
  next.variant = 'knife-bounce';
  vfxProjectile(next, layer, from, to, delayMs, travelMs);
}

/* ---- 爆發（單點） ----
   沒有更具體幾何 variant 的事件會落到這裡，建立一個短命的中心爆發節點。 */
function vfxBurst(spec, layer, pt, delayMs) {
  var cls = 'vfx-burst' + (spec.elem ? ' vfx-burst-' + spec.elem : '');
  if (spec.variant === 'fire-explosion') cls += ' vfx-burst-fireball';
  var d = vfxNode(cls, layer, spec);
  vfxPlace(d, pt);
  d.style.animationDelay = delayMs + 'ms';
  d.style.animationDuration = Math.round((spec.dur || 0.5) * 1000) + 'ms';
  vfxTrack(d, delayMs + (spec.dur || 0.5) * 1000 + 160);
}

/* ---- 氣旋（旋風斬）：圓形氣旋斬擊在敵陣中旋轉 ----
   rect 由棋盤格或高塔目標退化矩形提供；本函式不重新查詢命中目標。 */
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

/* ---- 刀光亂舞（疾風連斬／殘影迴斬）：白刃在範圍內連閃 ----
   粒子位置刻意隨機，但只影響視覺，不影響模擬層的目標與傷害。 */
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

/* ---- 光束：冰＝冰晶槍、聖＝雷射、其他＝元素光束 ----
   由我方出手點拉到目標；元素差異主要交給 CSS class／主題色呈現。 */
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

/* ---- 天降 ----
   天降類特效通常同時包含本體、落地爆炸、範圍閃光與命中反饋，
   所以各函式會分別登記節點，讓每一層都能被生命週期管理。 */
/* 建立一個沿固定路徑飛行的 Phaser-style emitter；主殞石與小殞石只改變
   emitter 的數量與尺寸，形狀、色彩與粒子生命週期保持一致。 */
function vfxMeteorProjectile(spec, layer, from, to, delayMs, flight, small) {
  var d = vfxNode('vfx-meteor' + (small ? ' vfx-meteor-small' : ''), layer, spec);
  d.style.setProperty('--vfx-x0', from.x + 'px');
  d.style.setProperty('--vfx-y0', from.y + 'px');
  d.style.setProperty('--vfx-x1', to.x + 'px');
  d.style.setProperty('--vfx-y1', to.y + 'px');
  d.style.setProperty('--vfx-rot', Math.atan2(to.y - from.y, to.x - from.x).toFixed(3) + 'rad');
  d.style.animationDelay = delayMs + 'ms';
  d.style.animationDuration = flight + 'ms';
  /* 殞石只改變 emitter 的方向、數量、尺寸與速度；不再額外拉扁或拉長尾焰。 */
  vfxBuildFlareFlame(d, !!small, VFX_METEOR_SIZE_SCALE);
  vfxTrack(d, delayMs + flight + VFX_FLARE_LIFESPAN_MS + 140);
}

/*
 * 殞石落地的衝擊波：參考 Phaser Particle Fountain 的徑向粒子邏輯，
 * 讓粒子由落點向外噴散並在短時間內縮小、淡出；同時用三層橢圓環模擬
 * 地面受力的波紋。這和技能傷害範圍是兩回事，只負責落地瞬間的視覺重量感。
 */
function vfxMeteorShockwave(spec, layer, pt, radius, delayMs) {
  var d = vfxNode('vfx-meteor-shockwave', layer, spec);
  /* 震波獨立使用較深的火焰色，避免沿用一般火球的明黃色。 */
  d.style.setProperty('--vfx-c1', '#9f1d12');
  d.style.setProperty('--vfx-c2', '#f05a13');
  d.style.setProperty('--vfx-glow', '#d62f12');
  vfxPlace(d, pt);
  radius = Number(radius);
  if (!isFinite(radius) || radius <= 0) radius = 80;
  var ringCount = 3;
  for (var ri = 0; ri < ringCount; ri++) {
    var ring = document.createElement('span');
    ring.className = 'vfx-shockwave-ring';
    ring.style.setProperty('--ring-sx', (radius / 22 * (0.78 + ri * 0.16)).toFixed(2));
    ring.style.setProperty('--ring-sy', (radius / 11 * (0.66 + ri * 0.12)).toFixed(2));
    ring.style.animationDelay = (delayMs + ri * 62) + 'ms';
    d.appendChild(ring);
  }
  var particleCount = _vfxQuality === VFX_QUALITY_LEVELS.REDUCED ? 9 : 18;
  for (var i = 0; i < particleCount; i++) {
    var angle = Math.PI * 2 * (i / particleCount) + (i % 3) * 0.12;
    var distance = radius * (0.42 + (i % 5) * 0.075);
    var p = document.createElement('span');
    p.className = 'vfx-shockwave-particle';
    p.style.setProperty('--dx', (Math.cos(angle) * distance).toFixed(1) + 'px');
    p.style.setProperty('--dy', (Math.sin(angle) * distance * 0.48 - 10 - (i % 4) * 5).toFixed(1) + 'px');
    p.style.setProperty('--particle-size', (4 + (i % 3) * 2) + 'px');
    p.style.animationDelay = (delayMs + (i % 5) * 18) + 'ms';
    d.appendChild(p);
  }
  for (var di = 0; di < 6; di++) {
    var dust = document.createElement('span');
    dust.className = 'vfx-shockwave-dust';
    dust.style.setProperty('--dx', ((di - 2.5) * radius * 0.23).toFixed(1) + 'px');
    dust.style.setProperty('--dy', (-(8 + (di % 3) * 4)).toFixed(1) + 'px');
    dust.style.animationDelay = (delayMs + 80 + di * 22) + 'ms';
    d.appendChild(dust);
  }
  vfxTrack(d, delayMs + 980);
}

/* 大隕石：右上方以 60° 斜線砸向範圍中心，並由幾顆較小火球伴隨進場。
   落地時刻＝travelMs（模擬層已把所有目標統一成同一個值，傷害數字同時跳）。 */
function vfxMeteor(spec, layer, rect, targetIds, travelMs, baseDelay) {
  /* 先限制外部延遲與飛行時間，避免長時間運行後過期隕石集中補播。 */
  var meteorSpeed = VFX_METEOR_SPEED_MULTIPLIER > 0 ? VFX_METEOR_SPEED_MULTIPLIER : 1;
  var rawFall = travelMs > 0 ? Math.min(VFX_METEOR_MAX_TRAVEL_MS, travelMs) : VFX_METEOR_MAX_TRAVEL_MS;
  var fall = Math.round(rawFall / meteorSpeed);
  var safeBaseDelay = Number(baseDelay);
  if (!isFinite(safeBaseDelay) || safeBaseDelay < 0) safeBaseDelay = 0;
  safeBaseDelay = Math.min(VFX_METEOR_MAX_DELAY_MS, safeBaseDelay);
  var cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
  var diagonalRun = (typeof VFX_METEOR_DROP_RUN === 'number' && VFX_METEOR_DROP_RUN > 0)
    ? VFX_METEOR_DROP_RUN : 180;
  var diagonalRise = diagonalRun * Math.tan(
    (typeof VFX_METEOR_DROP_ANGLE_RAD === 'number') ? VFX_METEOR_DROP_ANGLE_RAD : Math.PI / 3);
  var mainFrom = { x: cx + diagonalRun, y: cy - diagonalRise };
  vfxMeteorProjectile(spec, layer, mainFrom, { x: cx, y: cy }, safeBaseDelay, fall, false);
  /* 小火球總共 4 顆，透過略微不同的起點與延遲形成伴隨感，
     但將總飛行時間對齊主火球，避免小火球落地後才出現命中反饋。 */
  var smallOffsets = [-0.22, -0.04, 0.16, 0.32];
  for (var si = 0; si < smallOffsets.length; si++) {
    var ratio = 0.78 + si * 0.12;
    var smallFrom = {
      x: cx + diagonalRun * ratio,
      y: cy - diagonalRise * ratio + smallOffsets[si] * diagonalRun
    };
    var smallDelay = safeBaseDelay + 36 + si * 42;
    var smallFlight = Math.max(180, fall - 36 - si * 42);
    vfxMeteorProjectile(spec, layer, smallFrom, { x: cx, y: cy }, smallDelay, smallFlight, true);
  }

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
  var waveSize = Math.min(rect.w, rect.h);
  flash.style.left = (cx - waveSize / 2) + 'px';
  flash.style.top = (cy - waveSize / 2) + 'px';
  flash.style.width = waveSize + 'px';
  flash.style.height = waveSize + 'px';
  flash.style.borderRadius = '50%';
  flash.style.border = '3px solid var(--vfx-c1, #fb7233)';
  flash.style.boxSizing = 'border-box';
  flash.style.animationDelay = hitAt + 'ms';
  vfxTrack(flash, hitAt + 700);

  vfxMeteorShockwave(spec, layer, { x: cx, y: cy }, rectRadius(rect), hitAt);

  vfxSceneShake(layer, hitAt, true, spec);
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

/* 火龍捲（新版技能 firepillar）：以場域事件的 id 合併每次 tick，讓 DOM 版也只
   保留一個固定在地板上的持續火焰。area 的世界座標在 DOM 舊路徑沒有直接投影器，
   因此用場域第一個目標作為像素錨點；重要的是不再為每個受傷敵人各生成一根柱子。 */
function vfxFirePillar(spec, layer, area, fallbackPt) {
  var pt = fallbackPt;
  if (!pt || !isFinite(pt.x) || !isFinite(pt.y)) return null;
  var radius = Math.max(22, Number(area && area.r) || 30);
  var key = area && area.id ? String(area.id) : [Math.round(pt.x), Math.round(pt.y), Math.round(radius)].join(':');
  var node = _vfxFirePillars[key];
  if (node && node.parentNode === layer) {
    vfxPlace(node, pt);
    node._vfxExpiresAt = Date.now() + Math.max(900, Number(spec.dur || 0.5) * 2400);
    return node;
  }
  node = vfxNode('vfx-fire-pillar', layer, spec);
  vfxPlace(node, pt);
  node.style.setProperty('--vfx-radius', radius + 'px');
  node.style.setProperty('--vfx-height', Math.max(150, radius * 3.5) + 'px');
  var tongues = _vfxQuality === VFX_QUALITY_LEVELS.REDUCED ? 3 : 7;
  for (var i = 0; i < tongues; i++) {
    var tongue = document.createElement('span');
    tongue.className = 'vfx-fire-tongue';
    tongue.style.setProperty('--vfx-tongue-i', i);
    tongue.style.setProperty('--vfx-tongue-x', ((i - (tongues - 1) / 2) * radius * 0.12).toFixed(1) + 'px');
    tongue.style.setProperty('--vfx-tongue-width', Math.max(5, radius * (0.26 - i * 0.018)).toFixed(1) + 'px');
    tongue.style.setProperty('--vfx-tongue-height', (70 + Math.random() * 30).toFixed(1) + '%');
    tongue.style.setProperty('--vfx-tongue-rot', (Math.random() * 34 - 17).toFixed(1) + 'deg');
    tongue.style.setProperty('--vfx-tongue-delay', (-Math.random() * 0.9).toFixed(2) + 's');
    node.appendChild(tongue);
  }
  _vfxFirePillars[key] = node;
  vfxTrack(node, VFX_FIRE_PILLAR_LIFE_MS);
  return node;
}

/* 第 7 階無限火牆：貼地、橫向延展且向上立起的火焰牆。area 的世界座標在 DOM 舊路徑
   沒有直接投影器，因此沿用場域矩形／目標退化矩形；同一道牆以 id 合併每次 tick。 */
function vfxFireWall(spec, layer, area, rect) {
  if (!rect || !isFinite(rect.x) || !isFinite(rect.y)) return null;
  var wallW = Math.max(70, Number(rect.w) || 140);
  // 橫向長度仍沿用場域矩形，但火焰牆本體要從地面向上長出來。
  var rectH = Number(rect.h) || 120;
  var wallH = Math.max(84, Math.min(180, rectH * 1.15));
  var wallX = Number(rect.x) || 0;
  var floorY = (Number(rect.y) || 0) + Math.max(0, rectH * 0.54);
  var wallY = floorY - wallH;
  var wallAngle = isFinite(area && area.a) ? Number(area.a) : 0;
  var wallAxisX = Math.cos(wallAngle);
  var wallAxisY = Math.sin(wallAngle);
  var key = area && area.id ? String(area.id) : [Math.round(wallX), Math.round(wallY), Math.round(wallW)].join(':');
  function updateWallVortexLayout(target) {
    var vortices = target.querySelectorAll('.vfx-fire-wall-vortex');
    for (var vi = 0; vi < vortices.length; vi++) {
      vortices[vi].style.setProperty('--vfx-wall-vortex-x', (50 + wallAxisX * (vi - 1) * 31).toFixed(1) + '%');
      vortices[vi].style.setProperty('--vfx-wall-vortex-bottom', (7 - wallAxisY * (wallW * 0.31 / wallH * 100) * (vi - 1)).toFixed(1) + '%');
    }
  }
  var node = _vfxFireWalls[key];
  if (node && node.parentNode === layer) {
    node.style.left = wallX + 'px';
    node.style.top = wallY + 'px';
    node.style.width = wallW + 'px';
    node.style.height = wallH + 'px';
    node.style.setProperty('--vfx-wall-angle', wallAngle.toFixed(3) + 'rad');
    updateWallVortexLayout(node);
    node._vfxExpiresAt = Date.now() + Math.max(900, Number(spec.dur || 0.5) * 2400);
    return node;
  }

  node = vfxNode('vfx-fire-wall', layer, spec);
  node.style.left = wallX + 'px';
  node.style.top = wallY + 'px';
  node.style.width = wallW + 'px';
  node.style.height = wallH + 'px';
  node.style.setProperty('--vfx-wall-angle', wallAngle.toFixed(3) + 'rad');
  var ribbonCount = _vfxQuality === VFX_QUALITY_LEVELS.REDUCED ? 3 : 4;
  for (var vi = 0; vi < 3; vi++) {
    var vortex = document.createElement('span');
    vortex.className = 'vfx-fire-wall-vortex';
    vortex.style.setProperty('--vfx-wall-vortex-w', (31 + (vi === 1 ? 3 : 0)) + '%');
    vortex.style.setProperty('--vfx-wall-vortex-h', (86 + vi * 4) + '%');
    vortex.style.setProperty('--vfx-wall-delay', (-Math.random() * 0.9).toFixed(2) + 's');
    for (var ri = 0; ri < ribbonCount; ri++) {
      var ribbon = document.createElement('span');
      ribbon.className = 'vfx-fire-wall-ribbon';
      ribbon.style.setProperty('--vfx-wall-ribbon-i', ri);
      ribbon.style.setProperty('--vfx-wall-ribbon-delay', (-Math.random() * 0.8).toFixed(2) + 's');
      vortex.appendChild(ribbon);
    }
    node.appendChild(vortex);
  }
  updateWallVortexLayout(node);
  var smokeCount = _vfxQuality === VFX_QUALITY_LEVELS.REDUCED ? 3 : 6;
  for (var si = 0; si < smokeCount; si++) {
    var smoke = document.createElement('span');
    smoke.className = 'vfx-fire-wall-smoke';
    smoke.style.setProperty('--vfx-wall-smoke-x', ((si + 0.5) / smokeCount * 100).toFixed(1) + '%');
    smoke.style.setProperty('--vfx-wall-smoke-size', (13 + (si % 3) * 5) + 'px');
    smoke.style.setProperty('--vfx-wall-smoke-delay', (-Math.random() * 1.4).toFixed(2) + 's');
    node.appendChild(smoke);
  }
  _vfxFireWalls[key] = node;
  vfxTrack(node, VFX_FIRE_WALL_LIFE_MS);
  return node;
}

/* 預設天降：範圍內落下數道元素雨；沒有 meteor／pillar／smite 專屬畫法時使用。 */
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
   vfxBolt 是所有「雷鏈／天雷／紫雷」的共用幾何原件：在 from→to 之間擬真折線，
   支援弱化弧光（weak）、大型天雷（mega）、巨型紫雷（purple）。
   在 mega / purple 模式下額外生成分叉副電弧（branch arcs），並使用分層 SVG 筆刷
   （outer 輝光、mid 電漿、core 亮芯）。 */
function vfxBolt(spec, layer, from, to, delayMs, opts) {
  var isWeak = opts === true || (opts && opts.weak);
  var isMega = opts && opts.mega;
  var isPurple = (opts && opts.purple) || (spec && (spec.variant === 'purple-thunder' || spec.variant === 'storm-sigil'));
  var minX = Math.min(from.x, to.x) - 40, minY = Math.min(from.y, to.y) - 40;
  var w = Math.max(12, Math.abs(to.x - from.x)) + 80, h = Math.max(12, Math.abs(to.y - from.y)) + 80;
  var segs = isMega || isPurple ? 8 : 6;
  var coords = [];
  var nx = -(to.y - from.y), ny = (to.x - from.x);
  var nl = Math.sqrt(nx * nx + ny * ny) || 1;
  var maxOff = Math.min(48, nl * 0.35);

  for (var i = 0; i <= segs; i++) {
    var t = i / segs;
    var px = from.x + (to.x - from.x) * t;
    var py = from.y + (to.y - from.y) * t;
    if (i > 0 && i < segs) {
      var off = (Math.random() - 0.5) * maxOff;
      px += nx / nl * off;
      py += ny / nl * off;
    }
    coords.push({ x: px - minX, y: py - minY });
  }

  var className = 'vfx-bolt';
  if (isWeak) className += ' vfx-bolt-weak';
  else if (isPurple) className += ' vfx-bolt-purple';
  else if (isMega) className += ' vfx-bolt-mega';

  var d = vfxNode(className, layer, spec);
  d.style.left = minX + 'px';
  d.style.top = minY + 'px';
  d.style.animationDelay = delayMs + 'ms';

  var c1 = isPurple ? '#c084fc' : (spec && spec.color ? spec.color : 'var(--vfx-c1, #ffd93d)');
  var c2 = isPurple ? '#fdf4ff' : 'var(--vfx-c2, #fffbe0)';
  var glowColor = isPurple ? '#9333ea' : 'var(--vfx-glow, #ffd23f)';

  var svgLines = [];

  // 主幹繪製（三層：光暈、電漿、亮芯）
  for (var si = 0; si < coords.length - 1; si++) {
    var taper = si / (coords.length - 1);
    var outer = isPurple ? (22 - 13 * taper) : (isMega ? (18 - 11 * taper) : (isWeak ? 5.2 - 3.2 * taper : 12 - 9.5 * taper));
    var inner = isPurple ? (6.5 - 3.8 * taper) : (isMega ? (5.5 - 3.2 * taper) : (isWeak ? 1.8 - 0.8 * taper : 4.4 - 3.4 * taper));
    var a = coords[si], b = coords[si + 1];

    // 外層光暈
    svgLines.push('<line x1="' + a.x.toFixed(1) + '" y1="' + a.y.toFixed(1) +
      '" x2="' + b.x.toFixed(1) + '" y2="' + b.y.toFixed(1) +
      '" stroke="' + glowColor + '" stroke-width="' + Math.max(3, outer * 1.3).toFixed(1) +
      '" stroke-linecap="round" opacity="0.6"/>');

    // 中層電漿主色
    svgLines.push('<line x1="' + a.x.toFixed(1) + '" y1="' + a.y.toFixed(1) +
      '" x2="' + b.x.toFixed(1) + '" y2="' + b.y.toFixed(1) +
      '" stroke="' + c1 + '" stroke-width="' + Math.max(1.8, outer).toFixed(1) +
      '" stroke-linecap="round"/>');

    // 內層極致白芯
    svgLines.push('<line x1="' + a.x.toFixed(1) + '" y1="' + a.y.toFixed(1) +
      '" x2="' + b.x.toFixed(1) + '" y2="' + b.y.toFixed(1) +
      '" stroke="' + c2 + '" stroke-width="' + Math.max(0.8, inner).toFixed(1) +
      '" stroke-linecap="round"/>');
  }

  // 分叉副電弧（針對 mega 或 purple，在節點生出向外的自然分叉）
  if ((isMega || isPurple) && coords.length > 4) {
    var branchIdxs = [2, 4];
    for (var bi = 0; bi < branchIdxs.length; bi++) {
      var bIdx = branchIdxs[bi];
      if (bIdx < coords.length - 1) {
        var startP = coords[bIdx];
        var side = (bi % 2 === 0) ? 1 : -1;
        var bLen = 22 + Math.random() * 20;
        var bp1 = {
          x: startP.x + (nx / nl * side * bLen * 0.6) + (Math.random() * 10 - 5),
          y: startP.y + (ny / nl * side * bLen * 0.6) + 12
        };
        var bp2 = {
          x: bp1.x + (nx / nl * side * bLen * 0.5) + (Math.random() * 10 - 5),
          y: bp1.y + 16
        };
        svgLines.push('<line x1="' + startP.x.toFixed(1) + '" y1="' + startP.y.toFixed(1) +
          '" x2="' + bp1.x.toFixed(1) + '" y2="' + bp1.y.toFixed(1) +
          '" stroke="' + c1 + '" stroke-width="3" stroke-linecap="round" opacity="0.85"/>');
        svgLines.push('<line x1="' + startP.x.toFixed(1) + '" y1="' + startP.y.toFixed(1) +
          '" x2="' + bp1.x.toFixed(1) + '" y2="' + bp1.y.toFixed(1) +
          '" stroke="' + c2 + '" stroke-width="1.2" stroke-linecap="round"/>');
        svgLines.push('<line x1="' + bp1.x.toFixed(1) + '" y1="' + bp1.y.toFixed(1) +
          '" x2="' + bp2.x.toFixed(1) + '" y2="' + bp2.y.toFixed(1) +
          '" stroke="' + c1 + '" stroke-width="2" stroke-linecap="round" opacity="0.75"/>');
      }
    }
  }

  d.innerHTML = '<svg width="' + Math.round(w) + '" height="' + Math.round(h) + '" viewBox="0 0 ' +
    Math.round(w) + ' ' + Math.round(h) + '">' +
    svgLines.join('') +
    '</svg>';
  vfxTrack(d, delayMs + (isPurple ? 520 : (isMega ? 460 : 420)));
}

/* 雷擊地表衝擊與電漿火花 */
function vfxLightningGroundImpact(spec, layer, pt, delayMs, isPurple) {
  var wrap = vfxNode('vfx-lightning-impact-wrap', layer, spec);
  vfxPlace(wrap, pt);
  wrap.style.animationDelay = delayMs + 'ms';

  var ring = document.createElement('span');
  ring.className = 'vfx-lightning-ground-ring' + (isPurple ? ' vfx-purple-ring' : '');
  ring.style.animationDelay = delayMs + 'ms';
  wrap.appendChild(ring);

  var sparkCount = isPurple ? 10 : 8;
  for (var i = 0; i < sparkCount; i++) {
    var sp = document.createElement('span');
    sp.className = 'vfx-lightning-spark' + (isPurple ? ' vfx-purple-spark' : '');
    var ang = (Math.PI * 2 * i / sparkCount) + (Math.random() * 0.5 - 0.25);
    var dist = 28 + Math.random() * (isPurple ? 42 : 32);
    sp.style.setProperty('--dx', (Math.cos(ang) * dist).toFixed(1) + 'px');
    sp.style.setProperty('--dy', (Math.sin(ang) * dist * 0.65).toFixed(1) + 'px');
    sp.style.animationDelay = (delayMs + (i % 3) * 16) + 'ms';
    wrap.appendChild(sp);
  }
  vfxTrack(wrap, delayMs + 550);
}

/* 巨型紫色電雷（電紋刻印／雷印烙印）：
   1. 從天頂劈下一道巨型紫色裂空電雷（粗壯、深紫外焰、亮紫電漿、白紫亮芯）。
   2. 地表擴散紫色電漿衝擊環與紫色火花。
   3. 目標身上浮現雙層紫色雷印法陣（Storm Sigil Ring），旋轉並向內收縮烙印。
   4. 目標卡片觸發紫色雷擊受擊反饋與震動。 */
function vfxPurpleThunder(spec, layer, pt, targetId, delayMs) {
  var pSpec = Object.assign({}, spec, { elem: 'lightning', variant: 'purple-thunder', color: '#c084fc' });
  var skyOrigin = { x: pt.x + (Math.random() * 30 - 15), y: -70 };

  // 1. 巨型紫色天雷
  vfxBolt(pSpec, layer, skyOrigin, pt, delayMs, { purple: true, mega: true });

  // 2. 地表雷擊衝擊與紫電火花
  vfxLightningGroundImpact(pSpec, layer, pt, delayMs + 40, true);

  // 3. 紫色雷印法陣
  var sigilWrap = vfxNode('vfx-storm-sigil-wrap', layer, pSpec);
  vfxPlace(sigilWrap, pt);
  sigilWrap.style.animationDelay = (delayMs + 60) + 'ms';

  var outerRing = document.createElement('div');
  outerRing.className = 'vfx-storm-sigil-ring';
  outerRing.style.animationDelay = (delayMs + 60) + 'ms';
  sigilWrap.appendChild(outerRing);

  var innerRing = document.createElement('div');
  innerRing.className = 'vfx-storm-sigil-inner';
  innerRing.style.animationDelay = (delayMs + 60) + 'ms';
  sigilWrap.appendChild(innerRing);

  var rune = document.createElement('div');
  rune.className = 'vfx-storm-sigil-rune';
  rune.textContent = '⚡';
  rune.style.animationDelay = (delayMs + 60) + 'ms';
  sigilWrap.appendChild(rune);

  vfxTrack(sigilWrap, delayMs + 800);

  // 4. 卡片受擊反饋與場景微震
  vfxSceneShake(layer, delayMs + 50, false, pSpec);
  if (targetId) {
    vfxHitReact(targetId, 'lightning', delayMs + 50, true);
  }
}

/* 連鎖閃電的完整流程：
   1. ptList／idList 保持 targets 順序；
   2. 第一個目標從畫面上方被大型天雷直劈（Mega Thunder Bolt），觸發地表雷擊衝擊波。
   3. 命中後，以閃電鏈形式再彈射到另外兩個目標（第 2、第 3 個目標）。
   4. 每一跳彈射都伴隨雷光火花爆點與受擊反饋。
   5. 若場上目標不足 3 個，自動向周圍其他敵卡引導氛圍彈射弧光。 */
function vfxChain(spec, layer, ptList, idList, baseDelay, strikes) {
  if (!ptList.length) return;
  if (spec.variant === 'knife-bounce' || spec.variant === 'poison-spread') {
    // 彈射鏈必須等上一段真的抵達目標；固定段間距會讓 B→C 在 A→B 尚未完成時提前出發。
    var pathStart = baseDelay;
    for (var pathI = 1; pathI < ptList.length; pathI++) {
      var pathTravel = (spec.travelMs && spec.travelMs[pathI] > 0) ? spec.travelMs[pathI] : 0;
      var pathFlight = vfxProjectileFlightMs(pathTravel, spec.dur || 0.5);
      vfxKnifeBounce(spec, layer, ptList[pathI - 1], ptList[pathI],
        pathStart, pathTravel);
      vfxImpact({
        elem: spec.variant === 'poison-spread' ? 'poison' : null,
        variant: null, color: spec.color
      }, layer, ptList[pathI], idList[pathI],
        pathStart + pathFlight, true);
      pathStart += pathFlight;
    }
    return;
  }

  var hop = Math.max(110, vfxStagger());
  var n = Math.max(1, strikes || 1);

  // 1. 首個目標：大型天雷從天頂劈下
  for (var st = 0; st < n; st++) {
    var strikeDelay = baseDelay + st * hop;
    var skyPt = { x: ptList[0].x + (st === 0 ? 28 : (st % 2 === 1 ? -24 : 32)), y: -70 };
    vfxBolt(spec, layer, skyPt, ptList[0], strikeDelay, { mega: true });
    vfxLightningGroundImpact(spec, layer, ptList[0], strikeDelay + 40, false);
    vfxImpact({ elem: 'lightning', variant: null, color: spec.color }, layer, ptList[0], idList[0], strikeDelay + 50);
  }

  // 2. 命中後，以閃電鏈形式彈射到後續目標（最多另外兩個目標，即 targets 1 和 2）
  var maxChainBounces = Math.min(ptList.length, 3);
  for (var i = 1; i < maxChainBounces; i++) {
    var bounceDelay = baseDelay + (n - 1) * hop + i * hop;
    vfxBolt(spec, layer, ptList[i - 1], ptList[i], bounceDelay, { mega: false });
    vfxLightningGroundImpact(spec, layer, ptList[i], bounceDelay + 30, false);
    vfxImpact({ elem: 'lightning', variant: null, color: spec.color }, layer, ptList[i], idList[i], bounceDelay + 40);
  }

  // 如果原本傳入的 targets 超過 3 個，繼續用細弧光彈射剩餘目標
  for (var j = 3; j < ptList.length; j++) {
    var extraDelay = baseDelay + (n - 1) * hop + j * hop;
    vfxBolt(spec, layer, ptList[j - 1], ptList[j], extraDelay, { weak: true });
    vfxImpact({ elem: 'lightning', variant: null, color: spec.color }, layer, ptList[j], idList[j], extraDelay + 40);
  }

  // 3. 若目標不足 3 個（如只有 1 個或 2 個敵人），向畫面其他敵卡補彈射弧光
  if (ptList.length < 3) {
    var scene = layer.parentNode;
    var cards = scene ? scene.querySelectorAll('.enemy-card') : [];
    var lr = layer.getBoundingClientRect();
    var added = 0;
    var needed = 3 - ptList.length;
    var lastPt = ptList[ptList.length - 1];

    for (var c = 0; c < cards.length && added < needed; c++) {
      var r = cards[c].getBoundingClientRect();
      if (!r.width) continue;
      var cpt = { x: r.left - lr.left + r.width / 2, y: r.top - lr.top + r.height / 2 };
      var isExisting = ptList.some(function (p) {
        return Math.abs(p.x - cpt.x) < 6 && Math.abs(p.y - cpt.y) < 6;
      });
      if (isExisting) continue;
      added++;
      var ambientDelay = baseDelay + (n - 1) * hop + (ptList.length - 1 + added) * hop;
      vfxBolt(spec, layer, lastPt, cpt, ambientDelay, { weak: false, mega: false });
      lastPt = cpt;
    }

    while (added < needed) {
      added++;
      var ambAngle = (added === 1 ? -0.85 : 0.85) + (Math.random() * 0.4 - 0.2);
      var ambDist = 70 + Math.random() * 35;
      var groundCpt = {
        x: lastPt.x + Math.cos(ambAngle) * ambDist,
        y: lastPt.y + Math.sin(ambAngle) * ambDist + 15
      };
      var ambDelay = baseDelay + (n - 1) * hop + (ptList.length - 1 + added) * hop;
      vfxBolt(spec, layer, lastPt, groundCpt, ambDelay, { weak: false, mega: false });
      vfxLightningGroundImpact(spec, layer, groundCpt, ambDelay + 30, false);
      lastPt = groundCpt;
    }
  }
}

/* 天罰／單發神雷：一道天雷直劈目標；與 vfxChain 共用 vfxBolt，但沒有後續跳。 */
function vfxSmite(spec, layer, pt, targetId, delayMs) {
  vfxBolt(spec, layer, { x: pt.x + 26, y: -50 }, pt, delayMs, { mega: true });
  vfxLightningGroundImpact(spec, layer, pt, delayMs + 30, false);
  vfxImpact({ elem: 'lightning', variant: null, color: spec.color }, layer, pt, targetId, delayMs + 40);
}

/* ---- 領域：元素化持續特效 ----
   領域是長壽命節點，會由 vfxTrack 以 dur 登記；品質 Reduced 會在入口直接略過，
   避免在非戰鬥頁長時間保留大量動畫。 */
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

/* ---- 我方增益：光環＋上升光點 ----
   只掛在我方錨點，不對敵人建立命中特效。 */
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

/* ---- 敵身詛咒：暗紫符紋迴旋下沉 ----
   bleed／poison 只改圖示與色彩；實際 DoT 由模擬層處理，這裡只負責狀態視覺。 */
function vfxCurse(spec, layer, pt, targetId, delayMs) {
  var curseClass = 'vfx-curse';
  if (spec.variant === 'bleed') curseClass += ' vfx-curse-bleed';
  if (spec.variant === 'poison') curseClass += ' vfx-curse-poison';
  var d = vfxNode(curseClass, layer, spec);
  vfxPlace(d, pt);
  d.style.animationDelay = delayMs + 'ms';
  d.textContent = spec.variant === 'bleed' ? '🩸' : (spec.variant === 'poison' ? '☠️' : (spec.glyph || '☠️'));
  vfxTrack(d, delayMs + 1100);
  vfxHitReact(targetId, spec.elem || (spec.variant === 'bleed' ? null : 'dark'), delayMs + 150, false);
}

/* ---- 進入點：協議 vfx 事件 → 畫面 ----
   這是 DOM 後備／高塔路徑的主分派器。Worker 事件已在 ui.js 進入這裡前完成
   協議轉換；本函式只做目標座標解析、時間換算與視覺函式選擇，不回寫遊戲狀態。 */
function renderCombatVfx(spec) {
  if (!_vfxEnabled || !spec) return;
  if (typeof document === 'undefined' || document.hidden) return;
  var anchorId = (spec.targets && spec.targets.length) ? spec.targets[0] : null;
  var layer = vfxLayer(anchorId);
  if (!layer) return;
  var kind = spec.fxKind;
  var dur = spec.dur > 0 ? spec.dur : 0.5;
  var isThrust = spec.variant === 'thrust' || spec.variant === 'thrust-pierce' ||
    spec.variant === 'thrust-parallel' || spec.variant === 'thrust-octagonal';
  var count = Math.max(1, Math.min(isThrust ? 8 : 5, spec.count || 1));
  var baseDelay = spec.delayMs > 0 ? spec.delayMs : 0;
  var s = {
    fxKind: kind, glyph: spec.glyph || '✨', color: spec.color || '#fff',
    elem: spec.elem || null, cat: spec.cat || null, variant: spec.variant || null, dur: dur,
    travelMs: spec.travelMs || null,
    projectile: !!spec.projectile,
    lineLength: Number(spec.lineLength) > 0 ? Number(spec.lineLength) : null,
    lineWidth: Number(spec.lineWidth) > 0 ? Number(spec.lineWidth) : null,
    laneOffsets: Array.isArray(spec.laneOffsets) ? spec.laneOffsets.slice(0, 3) : null,
    directionCount: Number(spec.directionCount) > 0 ? Number(spec.directionCount) : null
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

  /* 彈幕是 glyph／variant 優先的特殊路徑，先於一般 fxKind 分派，
     因為它需要同一個目標同時建立多條左右交錯的彈道。 */
  if (s.variant === 'arcane-barrage' || (s.glyph === '💫' && s.cat === 'magic')) {
    var barrage = resolveTargets();
    if (!barrage.pts.length) return;
    var barrageFrom = vfxPointOf('pv-float', layer) || vfxOriginPoint(layer);
    for (var bi = 0; bi < barrage.pts.length; bi++) {
      var barrageTravel = (travelMs && travelMs[barrage.idxs[bi]] > 0) ? travelMs[barrage.idxs[bi]] : 0;
      for (var lane = 0; lane < 3; lane++) {
        vfxBarrageProjectile(s, layer, barrageFrom, barrage.pts[bi], -1, lane,
          baseDelay + bi * 40 + lane * 35, barrageTravel);
        vfxBarrageProjectile(s, layer, barrageFrom, barrage.pts[bi], 1, lane,
          baseDelay + bi * 40 + lane * 35, barrageTravel);
      }
    }
    return;
  }

  /* chain 事件的 targets 順序就是彈射路徑；vfxChain 不會自行依距離重排，
     這能確保畫面和模擬層／傷害浮字使用同一條路徑。variant=chain 的舊技能
     可能仍以其他 fxKind 傳入，因此同時檢查 kind 與 variant。 */
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
    vfxChain(s, layer, ch.pts, ch.ids, chBase, chStrikes, travelMs);
    return;
  }

  /* 紫色巨雷／電紋刻印：天頂劈下巨型紫雷＋地面紫色法陣與衝擊波 */
  if (s.variant === 'purple-thunder' || s.variant === 'storm-sigil') {
    var ptList = resolveTargets();
    for (var pti = 0; pti < ptList.pts.length; pti++) {
      vfxPurpleThunder(s, layer, ptList.pts[pti], ptList.ids[pti], baseDelay + pti * 80);
    }
    return;
  }

  /* 純命中事件不畫移動中的攻擊本體，只在各目標位置建立爆點與受擊反饋。 */
  if (kind === 'impact') {
    var im = resolveTargets();
    if (s.variant === 'pillar') {
      /* 火龍捲是地板場域：火焰只建立在場域錨點，targets 只用於受擊反饋。 */
      var pillarPt = im.pts.length ? im.pts[0] : null;
      vfxFirePillar(s, layer, spec.area, pillarPt);
      for (var pvi = 0; pvi < im.pts.length; pvi++) {
        vfxHitReact(im.ids[pvi], s.elem || 'fire', baseDelay, false);
      }
      return;
    }
    for (var ii = 0; ii < im.pts.length; ii++) vfxImpact(s, layer, im.pts[ii], im.ids[ii], baseDelay);
    return;
  }

  /* 詛咒是附著在敵人身上的狀態視覺，依目標錯開少量時間避免同幀重疊。 */
  if (kind === 'curse') {
    var cu = resolveTargets();
    for (var ci = 0; ci < cu.pts.length; ci++) vfxCurse(s, layer, cu.pts[ci], cu.ids[ci], baseDelay + ci * 60);
    return;
  }

  /* 我方增益沒有敵方 targets 時，以第一個錨點或玩家錨點定位。 */
  if (kind === 'selfBuff') {
    var mePt = vfxPointOf(anchorId || 'pv-float', layer);
    if (mePt) vfxSelfBuff(s, layer, mePt, baseDelay);
    return;
  }

  /* aura／rain 需要一個範圍矩形：優先使用棋盤格，沒有格子時才退化到目標卡片。 */
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
      rect = vfxRectAround(fallbackPt, s.variant === 'meteor' ? spec.area : null);
    }
    if (kind === 'aura') {
      if (s.variant === 'cyclone') vfxCyclone(s, layer, rect);
      else if (s.variant === 'firewall') vfxFireWall(s, layer, spec.area, rect);
      else vfxAura(s, layer, rect);
      return;
    }
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

  /* DoT 屍爆／感染引爆需要逐目標命中爆點，而不是一般範圍中心爆發。 */
  if (kind === 'burst' && (s.variant === 'blood-explosion' || s.variant === 'zero-infection')) {
    var dotBurst = resolveTargets();
    for (var dbi = 0; dbi < dotBurst.pts.length; dbi++) {
      vfxImpact(s, layer, dotBurst.pts[dbi], dotBurst.ids[dbi], baseDelay + dbi * 40);
    }
    return;
  }

  /* 旋風與刀光亂舞先畫範圍本體，再為有限數量目標補受擊爆點。 */
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

  // 讀在前、寫在後：先解析我方出手點與所有目標座標（純讀取），再開始生成節點。
  // 這個順序避免每個目標都在 DOM 寫入後觸發一次 forced reflow。
  var rt = resolveTargets();
  var from = vfxOriginPoint(layer);
  var stagger = vfxStagger();

  /* 新版突刺以使用者提供的光槍圖片播放：普通突刺為前方範圍，
     超連刺為三道平行光槍，八方突刺則以八個徑向角度同時播放。 */
  if (kind === 'slash' && (s.variant === 'thrust-pierce' || s.variant === 'thrust-parallel' ||
      s.variant === 'thrust-octagonal' || s.variant === 'thrust')) {
    if (!rt.pts.length) return;
    var thrustLanes = Array.isArray(s.laneOffsets) && s.laneOffsets.length ? s.laneOffsets : [0];
    var thrustDirections = s.variant === 'thrust-octagonal'
      ? Math.max(1, Number(s.directionCount) || 8) : 1;
    var thrustLength = Number(s.lineLength) || 70;
    /* 突刺連段要讓每一道的「向外飛出」看得清楚：7 次時
       6 個間隔 × 220ms + 最後收尾 300ms ≈ 1.62 秒。 */
    var thrustStagger = 220;
    var thrustFrontAngle = Math.atan2(rt.pts[0].y - from.y, rt.pts[0].x - from.x);
    for (var tc = 0; tc < count; tc++) {
      var thrustDelay = baseDelay + tc * thrustStagger;
      var isFinalThrust = tc === count - 1;
      for (var td = 0; td < thrustDirections; td++) {
        var thrustAngle = s.variant === 'thrust-octagonal'
          ? thrustFrontAngle + td * Math.PI * 2 / thrustDirections : thrustFrontAngle;
        for (var tl = 0; tl < thrustLanes.length; tl++) {
          vfxThrustLine(s, layer, from, rt.pts[0], thrustDelay, 0, thrustLength,
            thrustLanes[tl], thrustAngle, isFinalThrust);
        }
      }
      if (!s.projectile) {
        for (var tti = 0; tti < rt.pts.length; tti++) {
          vfxImpact({ elem: s.elem, variant: null, color: s.color }, layer,
            rt.pts[tti], rt.ids[tti], thrustDelay + 100 + tti * 24);
        }
      }
    }
    return;
  }

  /* 震碎斬與迴身雙連斬都重用迴旋斬弧光；迴身雙連斬沿十字四方向飛出。
     命中延遲依弧光實際飛行距離估算，確保刀光抵達時傷害字才出現。 */
  if (kind === 'slash' && (s.variant === 'cleave' || s.variant === 'cleave-shockwave' || s.variant === 'cleave-back' || s.variant === 'cleave-dual' || s.variant === 'cleave-cross' || s.variant === 'cleave-cross-shockwave')) {
    var drawForward = s.variant === 'cleave-shockwave' || s.variant === 'cleave-back' || s.variant === 'cleave-dual';
    var drawBack = s.variant === 'cleave-back' || s.variant === 'cleave-dual';
    var drawCross = s.variant === 'cleave-cross' || s.variant === 'cleave-cross-shockwave';
    var drawStaticForward = s.variant === 'cleave';
    var frontAngle = from && rt.pts.length
      ? Math.atan2(rt.pts[0].y - from.y, rt.pts[0].x - from.x)
      : 0;
    var arcFlightMs = vfxCleaveArcFlightMs(s);
    for (var cc = 0; cc < count; cc++) {
      var cleaveDelay = baseDelay + cc * stagger;
      if (drawStaticForward && from) vfxCleaveArc(s, layer, from, cleaveDelay, frontAngle * 180 / Math.PI);
      if (drawCross && from) {
        for (var cdi = 0; cdi < 4; cdi++) {
          var crossAngle = frontAngle + cdi * Math.PI / 2;
          vfxCleaveArc(s, layer, from, cleaveDelay,
            crossAngle * 180 / Math.PI, null, { angle: crossAngle, length: 120 });
        }
      }
      if (drawForward && from) vfxCleaveArc(s, layer, from, cleaveDelay,
        frontAngle * 180 / Math.PI, null, { angle: frontAngle, length: 120 });
      if (drawBack && from) vfxCleaveArc(s, layer, from, cleaveDelay,
        (frontAngle + Math.PI) * 180 / Math.PI, 'vfx-cleave-arc-back',
        { angle: frontAngle + Math.PI, length: 120 });
    }
    if (!s.projectile) {
      for (var cti = 0; cti < rt.pts.length; cti++) {
        var targetDx = rt.pts[cti].x - (from ? from.x : 0);
        var targetDy = rt.pts[cti].y - (from ? from.y : 0);
        var targetAlong = targetDx * Math.cos(frontAngle) + targetDy * Math.sin(frontAngle);
        var arcHitDelay = 90;
        if (drawCross) {
          var targetDistance = Math.sqrt(targetDx * targetDx + targetDy * targetDy);
          arcHitDelay = Math.round(arcFlightMs * Math.max(0, Math.min(1, targetDistance / 120)));
        } else if (drawForward && targetAlong >= 0) {
          arcHitDelay = Math.round(arcFlightMs * Math.max(0, Math.min(1, targetAlong / 120)));
        } else if (drawBack && targetAlong < 0) {
          arcHitDelay = Math.round(arcFlightMs * Math.max(0, Math.min(1, -targetAlong / 120)));
        }
        for (var ccc = 0; ccc < count; ccc++) {
          var cHitDelay = baseDelay + ccc * stagger + arcHitDelay + cti * 35;
          vfxImpact({ elem: s.elem, variant: null, color: s.color }, layer,
            rt.pts[cti], rt.ids[cti], cHitDelay + 90);
        }
      }
    }
    return;
  }

  /* 疾風斬多段：在近戰目標周圍連續閃出刀光，清楚表現多段斬擊。 */
  if (kind === 'slash' && s.variant === 'gale-slashes') {
    for (var gti = 0; gti < rt.pts.length; gti++) {
      var galeRect = vfxRectAround(rt.pts[gti], { r: 52 });
      vfxBladestorm(s, layer, galeRect, count);
      vfxHitReact(rt.ids[gti], s.elem, baseDelay + 120, false);
    }
    return;
  }

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

/* ---- 時間安全與品質裁切 ----
   vfxNormalizeTiming 只對最容易長時間堆積的隕石事件設安全上限；其他事件
   保留原始 timing，避免意外改變既有技能的視覺節奏。 */
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

/* 將事件轉成目前品質可接受的版本：
   Full 原樣播放；Reduced 固定單段、限制目標數、去除 aura；Off 直接丟棄。
   這是純視覺降載，不應改變 Worker 已經算好的命中與傷害。 */
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

/* 只合併短時間內重複的 impact／basic 事件；chain、技能本體與多段事件不合併，
   否則會破壞彈射順序或讓玩家看不到每段技能的辨識效果。 */
function vfxMergeKey(spec) {
  if (!spec || (spec.fxKind !== 'impact' && spec.cat !== 'basic')) return null;
  var target = spec.targets && spec.targets.length ? spec.targets[0] : '';
  return [spec.fxKind || '', spec.cat || '', spec.elem || '', spec.variant || '', target].join('|');
}

/* 每一幀最多排程一次 flush，優先用 RAF 跟畫面時鐘同步；測試／舊環境才退回 Timer。 */
function vfxScheduleFlush() {
  if (_vfxFlushHandle || !_vfxEventQueue.length) return;
  var flush = function () {
    _vfxFlushHandle = 0;
    vfxFlushQueue();
  };
  if (typeof requestAnimationFrame === 'function') _vfxFlushHandle = requestAnimationFrame(flush);
  else _vfxFlushHandle = setTimeout(flush, 0);
}

/* 消化事件佇列的主迴圈：受品質限制的每幀預算，並丟掉超過 stale 門檻的舊事件。
   事件即使被丟掉也只影響畫面，不影響模擬層的權威結果。 */
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

/* 事件入列時先嘗試在短合併窗內更新同類事件；無法合併時才新增項目，
   佇列撞上限則丟最舊項，避免特效洪峰拖慢輸入與面板操作。 */
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

/* 對外唯一入口：所有模擬層／UI 呼叫都從這裡進入品質裁切與佇列。
   document.hidden 時直接略過，返回前不補播背景期間累積的過期特效。 */
function playCombatVfx(spec) {
  var next = vfxSpecForQuality(spec);
  if (!next || !_vfxEnabled || (typeof document !== 'undefined' && document.hidden)) return;
  vfxEnqueue(next);
}
