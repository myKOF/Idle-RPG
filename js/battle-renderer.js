'use strict';
/* ============ PixiJS 即時戰鬥渲染器（僅主執行緒） ============
   「DOM/CSS 做 UI、Canvas/WebGL 做戰鬥表現」混合方案的 Canvas 側。
   把野外戰鬥的敵人卡片 DOM + js/vfx.js 的 DOM 特效換成類倖存者風格的即時畫面：
   敵人從右側進場走向站位、受擊閃光抖動、死亡消散；玩家與 BOSS 用序列幀動畫。

   資料來源三條，全部唯讀（模擬層一行都不動，存檔與平衡零影響）：
     1. PANEL battle（約 5Hz）：敵人集合（cell 格位、floatSel 穩定身分、hp/atkCd）→ 實體 reconcile
     2. TICK view：paused / towerActive 等純量
     3. FLOAT / VFX 事件（由 ui.js 分流進來）：傷害飄字與技能特效，沿用協議 v17 欄位
        （fxKind / elem / cat / variant / travelMs / delayMs），定址一律 mv-float-N / pv-float。

   高塔戰（tb-* / tp-* 定址）維持原本的 DOM 表現，不進本渲染器。
   後備：?canvas=0、PIXI 載入失敗或 WebGL 不可用時 init() 回傳 false，
   ui.js 會維持原 DOM 戰鬥畫面，所有舊路徑原封不動。

   序列幀資源（正式圖直接替換同名檔案即可，幀數不同就改同名 .json）：
     images/sprites/player.png + player.json          玩家（idle/walk/attack1~3）
     images/sprites/boss_generic.png + boss_generic.json  野外 BOSS（idle/attack/hurt） */

var BattleRenderer = (function () {

  /* ---- 開關 ---- */
  function disabledByQuery() {
    return typeof location !== 'undefined' && /[?&]canvas=0(&|$)/.test(location.search || '');
  }
  var REDUCED_MOTION = (typeof matchMedia === 'function') &&
    matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---- 常數 ---- */
  var MAX_FX = 140;              // 特效物件上限（與 DOM 版 VFX_MAX_NODES 同精神）
  var FX_HARD_LIFETIME_MS = 3000;  // 特效節點的硬性壽命（牆鐘）；領域類另外指定
  var FX_AURA_MAX_SEC = 6;         // 領域／旋風類的顯示上限（秒）——原本吃技能的實際持續時間，
                                   // 長效領域會讓那塊半透明方框在畫面上留很久，看起來像沒清乾淨
  var FX_WATCHDOG_MS = 1000;       // 看門狗掃描間隔
  /* 角色的跑速與追擊邏輯已經**不在這裡**：位移由模擬層產生（js/battlefield.js
     bfTickPlayer），顯示層只把座標畫出來。這裡只留一個「面前一個身位」的長度，
     給找不到目標時的特效落點用。 */
  var PLAYER_REACH = 52;
  var ENEMY_CONTACT_GAP = 34;      // 敵人出手時衝到離角色這麼近（＝接觸）
  var ENEMY_MAX_CHARGE = 460;      // 單次衝刺的最大距離，避免從畫面另一頭瞬間貼臉
  var MAX_FLOATS = 60;           // 同時存在的飄字上限
  var FLOAT_MERGE_MS = 160;      // 同目標同類傷害的合併窗（DOM 版邏輯的簡化版）
  var LASTPOS_KEEP_MS = 3000;    // 實體移除後保留座標，讓遲到的飄字仍有落點

  /* 元素主題色：優先沿用 js/vfx.js 的 VFX_ELEM_THEME，載入順序異常時退回內建表。 */
  var FALLBACK_THEME = {
    fire:      { c1: '#ff9a3c', c2: '#ff3c1e', glow: '#ffb347' },
    ice:       { c1: '#9bd7ff', c2: '#2e9bd6', glow: '#c9ecff' },
    lightning: { c1: '#ffe75e', c2: '#b17aff', glow: '#fff3a0' },
    poison:    { c1: '#9ee65e', c2: '#3f9e2e', glow: '#c6ff8a' },
    light:     { c1: '#fff2b0', c2: '#ffd75e', glow: '#ffffff' },
    dark:      { c1: '#b17aff', c2: '#4a2a7a', glow: '#d9b3ff' },
    earth:     { c1: '#d6b06a', c2: '#8a6a3a', glow: '#e8cf9a' }
  };
  function themeOf(spec) {
    var table = (typeof VFX_ELEM_THEME !== 'undefined' && VFX_ELEM_THEME) || FALLBACK_THEME;
    var t = spec && spec.elem && table[spec.elem];
    if (t) return t;
    var c = (spec && spec.color) || '#9ecbff';
    return { c1: c, c2: c, glow: c };
  }

  /* ---- 內部狀態 ---- */
  var S = {
    app: null, host: null,
    ready: false, failed: false, initStarted: false,
    layers: null,             // ground / zone / entity / fx / float / overlay
    W: 0, H: 0,
    paused: false,
    towerActive: false,
    zoneKey: '',
    player: null,             // 玩家實體
    bossBar: null,            // 場上 BOSS 的頂部大血條
    entities: {},             // floatSel -> enemy entity
    lastPos: {},              // floatSel -> { x, y, at }（實體移除後短暫保留）
    fx: [],                   // 特效物件 { update(dt)->bool 活著, node, prio }
    floats: [],               // 飄字物件
    floatMerge: {},           // mergeKey -> float 物件
    shake: 0,                 // 畫面震動剩餘強度（px）
    sheets: {},               // name -> { tex, manifest, anims: {name: [Texture]} }
    imgTex: {},               // 敵人圖檔快取：src -> Texture | 'loading' | 'failed'
    groundTile: null,
    watchdogTimer: 0,
    emptyText: null,
    pauseVeil: null,
    resizeObs: null
  };

  /* ---- 小工具 ---- */
  function documentHidden() {
    return typeof document !== 'undefined' && document.hidden;
  }
  /* 延遲排程（setTimeout）的統一守門：渲染器沒起來或分頁已隱藏就放棄該段特效。
     外層 onVfx 進場時擋過一次，但 stagger/延遲段可能在隱藏之後才到期，得再擋。 */
  function fxGate() {
    return !S.ready || documentHidden();
  }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function cssColorToInt(c, fallback) {
    var v = parseInt(String(c || '').replace('#', '0x'));
    return isFinite(v) ? v : fallback;
  }
  function nowMs() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }
  function fmtNum(n) { return (typeof fmt === 'function') ? fmt(n) : String(Math.floor(n)); }

  /* ---- 世界座標 ----
     棋盤（BF_COLS×BF_ROWS，預設 4×4）鋪在畫面右側 62%，col 1 靠玩家。
     玩家站左側約 17% 寬、垂直置中。實體座標一律以「腳底」為原點。 */
  /* 玩家站畫面正中央；敵人從四面八方逼近。
     棋盤格 (col,row) 對應到「以玩家為圓心」的極座標：
       col → 距離環（col 1 最靠近玩家，與 bfCellDistance 的語意一致）
       row → 方位角（順時鐘均分一圈）
     ⚠️ 只用「row 決定角度、每環固定錯開半格」會排出四條旋臂（風車），一眼就看得出是公式。
     所以每一格再套一份**由格位算出來的固定抖動**：角度與半徑各偏移一點，
     看起來像隨機散開，但同一格永遠落在同一個位置（不會逐幀跳動、AoE 落點也才算得準）。
     模擬層只認 (col,row)、不知道畫面怎麼擺，所以版型可以在這裡自由決定。 */
  function boardMetrics() {
    var cols = (typeof BF_COLS === 'number' && BF_COLS > 0) ? BF_COLS : 4;
    var rows = (typeof BF_ROWS === 'number' && BF_ROWS > 0) ? BF_ROWS : 4;
    var c = playerPos();
    var rx = Math.max(90, S.W * 0.5 - 52);
    var ry = Math.max(72, Math.min(S.H * 0.5 - 62, rx * 0.74));
    return { cols: cols, rows: rows, cx: c.x, cy: c.y, rx: rx, ry: ry };
  }
  /* 名目格尺寸：只拿來決定精靈與血條大小，不參與定位 */
  function cellSize() {
    var m = boardMetrics();
    return { w: Math.max(52, m.rx / m.cols * 1.15), h: Math.max(46, m.ry / m.rows * 1.35) };
  }
  /* 密度縮放：容量越大，每隻可用的空間越小，精靈與血條就要跟著縮。 */
  function densityScale() {
    var m = boardMetrics();
    var w = m.rx * 2 / m.cols, h = m.ry * 2 / m.rows;
    return Math.max(0.5, Math.min(1, Math.min(w / 82, h / 78)));
  }

  /* 範圍技的落點：模擬層給圓（世界絕對座標），換成畫面矩形供既有特效沿用。 */
  function areaRect(area) {
    if (!area) return null;
    var r = isFinite(area.r) ? area.r : Math.max(S.W, S.H);
    return { x: area.x - r, y: area.y - r, w: r * 2, h: r * 2 };
  }

  /* 玩家的世界座標。鏡頭永遠對準他，所以他在畫面上永遠置中——
     置中是鏡頭跟隨的結果，不是把角色釘死在畫面中間。 */
  function playerPos() {
    var p = S.player;
    if (p && typeof p.wx === 'number') return { x: p.wx, y: p.wy };
    return { x: 0, y: 0 };
  }
  /* 投射物起點：跟著玩家目前位置（近戰突進時玩家會離開原位） */
  function playerMuzzle() {
    var p = playerPos();
    return { x: p.x, y: p.y - 52 };
  }
  /* elId → 目前世界座標（實體活著追實體，死了用殘留座標，再不行用棋盤中央） */
  function posOf(elId) {
    if (elId === 'pv-float' && S.player) return { x: S.player.root.x, y: S.player.root.y - 46 };
    var ent = S.entities[elId];
    if (ent) return { x: ent.root.x, y: ent.root.y - ent.hitHeight * 0.55 };
    var last = S.lastPos[elId];
    if (last && nowMs() - last.at < LASTPOS_KEEP_MS) return { x: last.x, y: last.y };
    /* 目標已經不在（延遲期間被打死、或生成當下就被秒殺沒來得及建實體）：
       退到「角色面前一個身位」。不能退到陣型中心——中心就是玩家自己，
       斬擊與爆點會直接炸在自己身上。 */
    var pp = playerPos();
    var face = (S.player && S.player.facing < 0) ? -1 : 1;
    return { x: pp.x + face * (PLAYER_REACH + 14), y: pp.y - 24 };
  }

  /* 面板 5Hz，兩包之間的位置要靠外推補出來，而外推速度＝位移 ÷ 經過時間。
     這裡的「經過時間」必須用模擬層的時鐘（panel.gt），不能用封包到達的時間差：
     封包到達會抖（同一批訊息常常擠在一起送），用它算出來的速度就會忽大忽小，
     畫面上就是移動忽快忽慢。gt 是模擬層拍快照的時刻，位移與它必定成正比。

     另外，停下來的那一包要立刻把速度歸零，否則會照舊速度衝過頭再被拉回來，
     那一下回拉看起來就是頓一下。 */
  function trackVelocity(ent, x, y, gt) {
    var dgt = (isFinite(gt) && isFinite(ent.posGt)) ? (gt - ent.posGt) : NaN;
    if (!isFinite(dgt) || dgt <= 0.001 || dgt > 1) {
      var nowT = nowMs();
      dgt = ent.posAt ? Math.max(0.05, Math.min(0.5, (nowT - ent.posAt) / 1000)) : NaN;
      ent.posAt = nowT;
    } else {
      ent.posAt = nowMs();
    }
    var dx = x - ent.tx, dy = y - ent.ty;
    if (isFinite(dgt)) {
      if (Math.sqrt(dx * dx + dy * dy) < 0.5) {
        ent.velX = 0; ent.velY = 0;              // 這一包沒動＝停下來了
      } else {
        /* 輕度平滑：模擬層 10Hz、面板 5Hz，取樣本身還是有一點抖動。 */
        ent.velX = ent.velX * 0.3 + (dx / dgt) * 0.7;
        ent.velY = ent.velY * 0.3 + (dy / dgt) * 0.7;
      }
    }
    ent.posGt = gt;
    ent.tx = x; ent.ty = y;
  }

  /* ---- 序列幀載入 ----
     幀定義 JSON：{ image, frameWidth, frameHeight, anims: { name: { row, frames, fps, loop } } }
     正式圖替換時只要維持這個結構即可，程式不用改。 */
  function loadSheet(name, base) {
    return fetch(base + '.json?v=' + Date.now()).then(function (r) {
      if (!r.ok) throw new Error('manifest http ' + r.status);
      return r.json();
    }).then(function (manifest) {
      return PIXI.Assets.load(base + '.png').then(function (tex) {
        tex.source.scaleMode = 'nearest';   // 像素風：放大不要糊
        var anims = {};
        var fw = manifest.frameWidth, fh = manifest.frameHeight;
        for (var key in manifest.anims) {
          if (!Object.prototype.hasOwnProperty.call(manifest.anims, key)) continue;
          var a = manifest.anims[key];
          var frames = [];
          for (var i = 0; i < a.frames; i++) {
            frames.push(new PIXI.Texture({
              source: tex.source,
              frame: new PIXI.Rectangle(i * fw, a.row * fh, fw, fh)
            }));
          }
          anims[key] = frames;
        }
        S.sheets[name] = { manifest: manifest, anims: anims };
      });
    });
  }

  /* 建立一個序列幀動畫精靈。anchor 腳底置中。 */
  function makeAnimSprite(sheetName, animName) {
    var sheet = S.sheets[sheetName];
    if (!sheet || !sheet.anims[animName]) return null;
    var meta = sheet.manifest.anims[animName];
    var sp = new PIXI.AnimatedSprite(sheet.anims[animName]);
    sp.animationSpeed = (meta.fps || 8) / 60;
    sp.loop = !!meta.loop;
    sp.anchor.set(0.5, 0.92);   // 腳底稍微上收，陰影疊得進去
    sp.play();
    return sp;
  }
  function playAnim(entity, animName, backTo) {
    var sheet = S.sheets[entity.sheetName];
    if (!sheet || !sheet.anims[animName] || !entity.body) return;
    if (entity.curAnim === animName && sheet.manifest.anims[animName].loop) return;
    var meta = sheet.manifest.anims[animName];
    entity.curAnim = animName;
    entity.body.textures = sheet.anims[animName];
    entity.body.animationSpeed = (meta.fps || 8) / 60;
    entity.body.loop = !!meta.loop;
    entity.body.gotoAndPlay(0);
    if (!meta.loop) {
      entity.body.onComplete = function () {
        entity.curAnim = '';
        /* 讀「當下」的 baseAnim 而非呼叫時捕捉的 backTo：出招期間狀態可能已翻
           （例如這一擊清了場、walking 變 true），用過期值會站樁滑行。 */
        playAnim(entity, entity.baseAnim || backTo || 'idle');
      };
    } else {
      entity.body.onComplete = null;
    }
  }

  /* ---- 柔光貼圖（發亮用，一次生成重複使用） ---- */
  var _glowTex = null;
  function glowTexture() {
    if (_glowTex) return _glowTex;
    var c = document.createElement('canvas');
    c.width = c.height = 64;
    var g = c.getContext('2d');
    var grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.28)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    _glowTex = PIXI.Texture.from(c);
    return _glowTex;
  }

  /* ---- 地面 ----
     可四方連續的地板貼圖，以 TilingSprite 平鋪，tilePosition 跟著鏡頭反向捲動＝貼在世界座標上。
     圖檔在 images/ground/（tools/gen_ground_tiles.py 產生，正式圖直接換同名檔案即可）：
       ground_<地圖識別碼>.png 優先，沒有就用 ground_default.png，
       兩者都載不到才退回下面這張程序化的暫代圖。 */
  function groundFallbackTexture() {
    var c = document.createElement('canvas');
    c.width = c.height = 96;
    var g = c.getContext('2d');
    g.fillStyle = '#3a3a42';
    g.fillRect(0, 0, 96, 96);
    g.fillStyle = 'rgba(255,255,255,0.06)';
    for (var y = 0; y < 4; y++) {
      for (var x = 0; x < 4; x++) {
        g.beginPath();
        g.arc(x * 24 + ((y % 2) ? 12 : 0) + 6, y * 24 + 6, 1.7, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.strokeStyle = 'rgba(0,0,0,0.18)';
    g.lineWidth = 1;
    g.strokeRect(0.5, 0.5, 95, 95);
    return PIXI.Texture.from(c);
  }
  var _groundTexCache = {};
  function loadGroundTexture(zoneKey) {
    var name = zoneKey ? ('ground_' + zoneKey) : 'ground_default';
    if (_groundTexCache[name] === 'failed') return;
    if (_groundTexCache[name]) { applyGroundTexture(_groundTexCache[name]); return; }
    _groundTexCache[name] = 'loading';
    PIXI.Assets.load('images/ground/' + name + '.png').then(function (tex) {
      _groundTexCache[name] = tex;
      if (S.zoneKey === zoneKey || name === 'ground_default') applyGroundTexture(tex);
    }).catch(function () {
      _groundTexCache[name] = 'failed';
      if (name !== 'ground_default') loadGroundTexture(null);   // 退回通用底圖
    });
  }
  function applyGroundTexture(tex) {
    if (!S.groundTile || S.groundTile.destroyed || !tex || typeof tex === 'string') return;
    S.groundTile.texture = tex;
    S.groundTile.tint = 0xffffff;   // 用圖本身的顏色，不再靠染色
  }
  function syncZone(zoneKey) {
    if (zoneKey === S.zoneKey) return;
    S.zoneKey = zoneKey;
    loadGroundTexture(zoneKey);
  }

  /* ============ 實體 ============ */

  /* 敵人本體的視覺（emoji 文字或圖檔精靈）。回傳 display object，腳底置中。 */
  function makeMobBody(data, scale) {
    if (data.img && S.imgTex[data.img] && S.imgTex[data.img] !== 'loading' && S.imgTex[data.img] !== 'failed') {
      var sp = new PIXI.Sprite(S.imgTex[data.img]);
      sp.anchor.set(0.5, 1);
      var target = 64 * scale;
      var k = target / Math.max(sp.texture.width, sp.texture.height);
      sp.scale.set(k);
      return sp;
    }
    var t = new PIXI.Text({
      text: data.emoji || '👾',
      style: { fontFamily: 'sans-serif', fontSize: Math.round(40 * scale), align: 'center' }
    });
    t.anchor.set(0.5, 0.94);
    return t;
  }
  /* 圖檔敵人：背景載圖，載到後把場上同圖敵人的本體換成圖片精靈 */
  function requestMobImage(src) {
    if (!src || S.imgTex[src]) return;
    S.imgTex[src] = 'loading';
    PIXI.Assets.load('images/' + src).then(function (tex) {
      S.imgTex[src] = tex;
      for (var id in S.entities) {
        if (!Object.prototype.hasOwnProperty.call(S.entities, id)) continue;
        var e = S.entities[id];
        if (e.data && e.data.img === src && !e.isBoss && e.state !== 'dying') refreshMobBody(e);
      }
    }).catch(function () { S.imgTex[src] = 'failed'; });
  }
  function refreshMobBody(e) {
    var next = makeMobBody(e.data, e.visScale);
    if (!next) return;
    var idx = e.bodyWrap.getChildIndex(e.body);
    e.body.destroy();
    e.body = next;
    e.bodyWrap.addChildAt(next, idx);
  }

  /* 敵人狀態列（buff/debuff 圖示）：借用 ui.js 的 entStatus() 產字串再剝掉標籤 */
  var _statusStrip = null;
  function statusTextOf(data) {
    if (typeof entStatus !== 'function') return '';
    if (!_statusStrip) _statusStrip = document.createElement('div');
    try {
      _statusStrip.innerHTML = entStatus(data);
      var txt = _statusStrip.textContent || '';
      return txt.length > 14 ? txt.slice(0, 14) : txt;
    } catch (e) { return ''; }
  }

  function makeEnemy(data) {
    var isBoss = !!data.isBoss;
    var isElite = !isBoss && !!data.elite;
    /* 密度縮放：棋盤格數越多，每隻可用的空間越小，整體跟著縮 */
    var dScale = densityScale();
    var visScale = (isBoss ? 1 : (isElite ? 1.28 : 1)) * dScale;

    var root = new PIXI.Container();
    var sz = cellSize();

    /* 陰影 */
    var shadow = new PIXI.Graphics();
    var shw = (isBoss ? sz.w * 1.4 : sz.w * 0.5) * 0.5;
    shadow.ellipse(0, 0, shw, shw * 0.32).fill({ color: 0x000000, alpha: 0.35 });
    root.addChild(shadow);

    /* 菁英光環 */
    if (isElite) {
      var glow = new PIXI.Sprite(glowTexture());
      glow.anchor.set(0.5);
      glow.tint = 0xb17aff;
      glow.alpha = 0.55;
      glow.scale.set(1.7);
      glow.y = -24;
      glow.blendMode = 'add';
      root.addChild(glow);
    }

    /* 本體（受擊抖動/縮放/旋轉都作用在 bodyWrap 上，陰影與血條不跟著晃） */
    var bodyWrap = new PIXI.Container();
    var body;
    var sheetName = '';
    if (isBoss && S.sheets.boss) {
      sheetName = 'boss';
      body = makeAnimSprite('boss', 'idle');
      var targetH = sz.h * 2.1;
      body.scale.set(targetH / body.texture.height);
    } else {
      body = makeMobBody(data, visScale);
      if (data.img) requestMobImage(data.img);
    }
    bodyWrap.addChild(body);
    root.addChild(bodyWrap);

    /* 菁英標記 */
    if (isElite) {
      var mark = new PIXI.Text({
        text: '💀', style: { fontSize: 14 }
      });
      mark.anchor.set(0.5, 1);
      mark.y = -58 * visScale;
      root.addChild(mark);
    }

    /* 血條 + 名字（在腳下，不干擾本體動作） */
    var barW = isBoss ? sz.w * 1.5 : (isElite ? 60 : 48) * dScale;
    var hpBar = new PIXI.Graphics();
    hpBar.y = 7;
    root.addChild(hpBar);

    var elemEmoji = (data.attr && typeof ELEM_INFO !== 'undefined' && ELEM_INFO[data.attr])
      ? ELEM_INFO[data.attr].emoji : '';
    /* 名條與狀態列同樣依密度縮放；格數多的時候不縮，字會糊成一片連在一起。
       字級有下限 8px，再小就完全看不出寫什麼了。 */
    var nameSize = Math.max(8, Math.round((isBoss ? 14 : 11) * dScale));
    var statusSize = Math.max(8, Math.round(11 * dScale));
    var name = new PIXI.Text({
      text: 'Lv.' + data.level + ' ' + elemEmoji + (data.name || ''),
      style: {
        fontFamily: 'sans-serif', fontSize: nameSize, fontWeight: 'bold',
        fill: isBoss ? '#ffb3b3' : (isElite ? '#d9b3ff' : '#cfd6e4'),
        stroke: { color: '#000000', width: 3 }
      }
    });
    name.anchor.set(0.5, 0);
    name.y = 8 + 6 * dScale;
    name.alpha = 0.92;
    root.addChild(name);

    var status = new PIXI.Text({
      text: '',
      style: { fontFamily: 'sans-serif', fontSize: statusSize, fill: '#ffffff', stroke: { color: '#000', width: 2 } }
    });
    status.anchor.set(0.5, 0);
    status.y = (isBoss ? 32 : 28) * Math.max(0.7, dScale);
    root.addChild(status);

    var ent = {
      id: data.floatSel, data: data,
      root: root, bodyWrap: bodyWrap, body: body, shadow: shadow,
      hpBar: hpBar, nameText: name, statusText: status,
      sheetName: sheetName, curAnim: sheetName ? 'idle' : '', baseAnim: 'idle',
      isBoss: isBoss, isElite: isElite, visScale: visScale,
      barW: barW, hitHeight: isBoss ? sz.h * 1.9 : 64 * visScale,
      wx: 0, wy: 0,                   // 畫面上的世界座標（外推後的結果）
      tx: 0, ty: 0,                   // 模擬層最新的權威座標
      velX: 0, velY: 0, posAt: 0, posGt: NaN,   // 外推用：速度與上一次取樣的模擬時刻
      state: 'entering',              // entering → idle → dying → gone
      bobPhase: Math.random() * Math.PI * 2,
      wobble: 0.7 + Math.random() * 0.5,
      bornAt: nowMs(),
      hpShown: -1, shieldShown: -1,
      /* 進場長度直接吃模擬層的 _enterCd：走到定位的那一刻，牠在模擬層也剛好
         變成可攻擊／可被攻擊，畫面與規則必定同步（見 js/combat.js 進場倒數）。 */
      enterDur: Math.max(0.1, Number(data._enterCd) || 0.45),
      enterT: 0,
      lastAtkCd: (typeof data.atkCd === 'number') ? data.atkCd : 0,
      lunge: 0,                        // 攻擊突進：0~1 進度（朝玩家撲擊）
      lungeDur: 0,
      flash: 0,                        // 受擊染色剩餘秒數
      jolt: 0,                          // 受擊抖動剩餘秒數
      dieAt: 0
    };

    /* 站位完全由模擬層決定（座標制）：pos 是世界絕對座標，直接就位。 */
    var home = playerPos();
    var sp = (data && data.pos && isFinite(data.pos.x)) ? data.pos : { x: home.x + 220, y: home.y };
    ent.wx = sp.x; ent.wy = sp.y;
    ent.tx = sp.x; ent.ty = sp.y;
    root.x = ent.wx; root.y = ent.wy;
    root.zIndex = ent.wy;

    S.layers.entity.addChild(root);
    drawHpBar(ent);
    return ent;
  }

  function drawHpBar(ent) {
    var d = ent.data;
    var hp = Math.max(0, d.hp), max = Math.max(1, d.maxHp);
    var sh = Math.max(0, d.shield || 0);
    if (ent.hpShown === hp && ent.shieldShown === sh) return;
    ent.hpShown = hp; ent.shieldShown = sh;
    var w = ent.barW, h = ent.isBoss ? 8 : 5;
    var g = ent.hpBar;
    g.clear();
    g.roundRect(-w / 2 - 1, -1, w + 2, h + 2, 2).fill({ color: 0x000000, alpha: 0.72 });
    var pct = Math.max(0, Math.min(1, hp / max));
    if (pct > 0) {
      var color = ent.isBoss ? 0xd9484f : (ent.isElite ? 0xc75dff : 0xe74c3c);
      g.roundRect(-w / 2, 0, w * pct, h, 1.5).fill(color);
    }
    if (sh > 0.5) {
      var spct = Math.max(0.04, Math.min(1, sh / max));
      g.roundRect(-w / 2, -3, w * spct, 2, 1).fill({ color: 0x8ecbff, alpha: 0.9 });
    }
    /* BOSS 頂部大血條同步 */
    if (ent.isBoss && S.bossBar) drawBossBar(ent);
  }

  function ensureBossBar(ent) {
    if (S.bossBar) return;
    var c = new PIXI.Container();
    var g = new PIXI.Graphics();
    var label = new PIXI.Text({
      text: '',
      style: {
        fontFamily: 'sans-serif', fontSize: 15, fontWeight: 'bold',
        fill: '#ffd7d7', stroke: { color: '#000', width: 4 }
      }
    });
    label.anchor.set(0.5, 0);
    label.y = -22;
    c.addChild(g); c.addChild(label);
    c.x = S.W / 2; c.y = 30;
    S.layers.overlay.addChild(c);
    S.bossBar = { root: c, g: g, label: label, forId: ent.id };
  }
  function drawBossBar(ent) {
    var bar = S.bossBar;
    if (!bar || bar.forId !== ent.id) return;
    var d = ent.data;
    var w = S.W * 0.56, h = 13;
    var pct = Math.max(0, Math.min(1, d.hp / Math.max(1, d.maxHp)));
    bar.g.clear();
    bar.g.roundRect(-w / 2 - 2, -2, w + 4, h + 4, 4).fill({ color: 0x000000, alpha: 0.7 })
      .stroke({ color: 0x8b0000, width: 2, alpha: 0.9 });
    if (pct > 0) bar.g.roundRect(-w / 2, 0, w * pct, h, 3).fill(0xd9484f);
    bar.label.text = '👑 Lv.' + d.level + ' ' + (d.name || 'BOSS') +
      '　' + fmtNum(Math.max(0, d.hp)) + ' / ' + fmtNum(d.maxHp);
  }
  function removeBossBar(forId) {
    if (S.bossBar && S.bossBar.forId === forId) {
      S.bossBar.root.destroy({ children: true });
      S.bossBar = null;
    }
  }

  /* ---- 玩家 ---- */
  var PLAYER_BAR_W = 88;

  function makePlayer() {
    var root = new PIXI.Container();
    var shadow = new PIXI.Graphics();
    shadow.ellipse(0, 0, 24, 8).fill({ color: 0x000000, alpha: 0.4 });
    root.addChild(shadow);
    var bodyWrap = new PIXI.Container();
    var body = makeAnimSprite('player', 'idle');
    body.scale.set(1.09);   // 原 1.55，縮小約 30%
    bodyWrap.addChild(body);
    root.addChild(bodyWrap);

    /* 生命／法力條：跟著角色走，畫在腳下（與敵人同一套視覺語言） */
    var vitals = new PIXI.Graphics();
    vitals.y = 6;
    root.addChild(vitals);
    var hpText = new PIXI.Text({
      text: '',
      style: {
        fontFamily: 'sans-serif', fontSize: 9, fontWeight: 'bold',
        fill: '#ffffff', stroke: { color: '#000000', width: 2 }
      }
    });
    hpText.anchor.set(0.5, 0.5);
    hpText.y = 6 + 5;
    root.addChild(hpText);
    var mpText = new PIXI.Text({
      text: '',
      style: {
        fontFamily: 'sans-serif', fontSize: 8, fontWeight: 'bold',
        fill: '#dbeafe', stroke: { color: '#000000', width: 2 }
      }
    });
    mpText.anchor.set(0.5, 0.5);
    mpText.y = 6 + 16;
    root.addChild(mpText);

    /* 復活倒數：技能與狀態列都收進彈出面板後，倒地資訊只剩畫面上這一條 */
    var reviveText = new PIXI.Text({
      text: '',
      style: {
        fontFamily: 'sans-serif', fontSize: 13, fontWeight: 'bold',
        fill: '#ff9b9b', stroke: { color: '#000000', width: 3 }
      }
    });
    reviveText.anchor.set(0.5, 1);
    reviveText.y = -76;   // 跟著角色縮小後的身高
    reviveText.visible = false;
    root.addChild(reviveText);

    root.x = 0; root.y = 0;
    root.zIndex = 0;
    S.layers.entity.addChild(root);
    S.player = {
      id: 'pv-float', root: root, body: body, bodyWrap: bodyWrap,
      vitals: vitals, hpText: hpText, mpText: mpText, reviveText: reviveText,
      sheetName: 'player', curAnim: 'idle', baseAnim: 'idle',
      hitHeight: 70, walking: false, dead: false, stillFor: 99,
      flash: 0, jolt: 0, lunge: 0, facing: 1,
      /* 世界座標。tx/ty 是模擬層給的權威座標，wx/wy 是逐幀外推後畫出來的位置；
         鏡頭對準 wx/wy，所以角色永遠在畫面正中央。 */
      wx: 0, wy: 0, tx: 0, ty: 0, velX: 0, velY: 0, posAt: 0, posGt: NaN,
      vitalsShown: ''
    };
    drawPlayerVitals();
  }

  /* 生命／法力條（資料來自 5Hz 的 TICK view，不必等面板） */
  function drawPlayerVitals() {
    var p = S.player;
    if (!p || !p.vitals || p.vitals.destroyed) return;
    var v = S.vitals;
    if (!v) return;
    var hpMax = Math.max(1, v.hpMax || 1), mpMax = Math.max(1, v.mpMax || 1);
    var hp = Math.max(0, v.hp || 0), mp = Math.max(0, v.mp || 0);
    var sig = Math.round(hp) + '/' + Math.round(hpMax) + '|' + Math.round(mp) + '/' +
      Math.round(mpMax) + '|' + Math.round(v.shield || 0);
    if (p.vitalsShown === sig) return;
    p.vitalsShown = sig;

    var w = PLAYER_BAR_W, hpH = 10, mpH = 7, gap = 2;
    var g = p.vitals;
    g.clear();
    g.roundRect(-w / 2 - 1, -1, w + 2, hpH + gap + mpH + 2, 2).fill({ color: 0x000000, alpha: 0.78 });
    var hpPct = Math.max(0, Math.min(1, hp / hpMax));
    if (hpPct > 0) g.roundRect(-w / 2, 0, w * hpPct, hpH, 1.5).fill(0xc0392b);
    var mpPct = Math.max(0, Math.min(1, mp / mpMax));
    if (mpPct > 0) g.roundRect(-w / 2, hpH + gap, w * mpPct, mpH, 1.5).fill(0x2f7fd0);
    var sh = Math.max(0, v.shield || 0);
    if (sh > 0.5) {
      var sp = Math.max(0.05, Math.min(1, sh / hpMax));
      g.roundRect(-w / 2, -4, w * sp, 3, 1).fill({ color: 0x8ecbff, alpha: 0.95 });
    }
    p.hpText.text = fmtNum(hp) + ' / ' + fmtNum(hpMax);
    p.mpText.text = fmtNum(mp) + ' / ' + fmtNum(mpMax);
  }

  /* 出手動作。近戰不再「瞬間衝過去再彈回原位」——角色平常就會跑向目標
     （見 tickWorld 的追擊移動），出手時只播揮擊動作與一點前傾。 */
  function playerAttackAnim(kind, targetId) {
    var p = S.player;
    if (!p || p.dead) return;
    var melee = kind !== 'cast';
    var name = melee ? ('attack' + (1 + Math.floor(Math.random() * 3))) : 'attack2';
    p.baseAnim = p.walking ? 'walk' : 'idle';
    playAnim(p, name, p.baseAnim);
    p.lunge = melee ? 0.18 : 0.12;
  }

  /* ============ reconcile（PANEL battle，約 5Hz） ============ */
  function syncBattle(panel) {
    if (!S.ready || !panel) return;
    var field = panel.field || {};
    var stage = panel.stage || {};
    syncZone(stage.zone || '');

    /* 殘留座標表清理：鍵是單調遞增的 mv-float-N，過期即刪，不清會無限增長 */
    for (var lp in S.lastPos) {
      if (Object.prototype.hasOwnProperty.call(S.lastPos, lp) &&
          nowMs() - S.lastPos[lp].at > LASTPOS_KEEP_MS) delete S.lastPos[lp];
    }

    var list = Array.isArray(field.monsters) ? field.monsters : (field.monster ? [field.monster] : []);
    var seen = {};
    var anyLive = false;

    for (var i = 0; i < list.length; i++) {
      var d = list[i];
      if (!d || !d.floatSel) continue;
      var alive = d.hp > 0;
      var dyingHold = !alive && d._rewarded && Number(d._deathClearCd) > 0;
      if (!alive && !dyingHold) continue;
      seen[d.floatSel] = true;
      if (alive) anyLive = true;

      var ent = S.entities[d.floatSel];
      /* 身分指紋：mv-float-N 在 Worker 重啟後會從 0 重新發號（workerRestarting 已整批清，
         這裡是最後一道保險）。同 id 但名字/等級/階級對不上＝其實是另一隻怪；
         垂死中的實體被活體資料頂替也一樣——砍掉重建，不要讓舊外觀頂著新數值演下去。 */
      if (ent && (ent.data.name !== d.name || ent.data.level !== d.level ||
                  ent.isBoss !== !!d.isBoss || ent.isElite !== (!d.isBoss && !!d.elite) ||
                  (alive && ent.state === 'dying'))) {
        destroyEntity(d.floatSel);
        ent = null;
      }
      if (!ent) {
        if (!alive) continue;               // 只為活著的敵人建實體
        ent = makeEnemy(d);
        S.entities[d.floatSel] = ent;
        if (ent.isBoss) ensureBossBar(ent);
      } else {
        var prevCd = ent.lastAtkCd;
        ent.data = d;
        /* 攻擊偵測：atkCd 是倒數計時，出手時會加回 1/aspd → 數值跳升就是攻擊了 */
        if (typeof d.atkCd === 'number') {
          if (alive && ent.state === 'idle' && d.atkCd > prevCd + 0.15) enemyAttackAnim(ent);
          ent.lastAtkCd = d.atkCd;
        }
        /* 模擬層每個 tick 都在移動敵人，但面板 5Hz 才送一次。
           記下新的權威座標，並用「與上一次的位移÷間隔」估出速度，
           讓 tickWorld 在兩次更新之間自己把中間的位置補出來（見外推）。
           我方與敵人現在都是絕對座標，兩邊各自外推，不會互相拖著跑。 */
        if (d.pos && isFinite(d.pos.x)) trackVelocity(ent, d.pos.x, d.pos.y, panel.gt);
      }
      drawHpBar(ent);
      var stTxt = statusTextOf(d);
      if (ent.statusText.text !== stTxt) ent.statusText.text = stTxt;
      if (!alive && ent.state !== 'dying' && ent.state !== 'gone') startDeath(ent, true);
    }

    /* 從快照消失的實體：死了走死亡動畫，沒死（換關/切地圖）走快速淡出 */
    for (var id in S.entities) {
      if (!Object.prototype.hasOwnProperty.call(S.entities, id)) continue;
      var e = S.entities[id];
      /* 保險絲：垂死動畫由 rAF 推進，分頁被節流時可能停在半路——
         reconcile 這條路不受節流，超時就直接清，杜絕實體堆積。
         例外：玩家主動暫停且分頁可見時屍體是刻意凍結的，不算堆積。 */
      if (e.state === 'dying' && nowMs() - e.dieAt > 3000 &&
          (!S.paused || documentHidden())) {
        destroyEntity(id);
        continue;
      }
      if (seen[id]) continue;
      if (e.state !== 'dying' && e.state !== 'gone') {
        startDeath(e, e.data && e.data.hp <= 0);
      }
    }

    /* 玩家：復活倒數 → 倒地；沒有活敵 → 走路推進 */
    var p = S.player;
    if (p) {
      var fp = field.player || {};
      var reviveLeft = Number(fp.reviveCd) || 0;
      var dead = reviveLeft > 0;
      if (dead !== p.dead) {
        p.dead = dead;
        p.root.rotation = dead ? -Math.PI / 2 : 0;
        p.body.tint = dead ? 0x777777 : 0xffffff;
        if (dead) { p.lunge = 0; }
        else playAnim(p, 'idle');
      }
      /* 倒地倒數：狀態列收進彈出面板後，畫面上只剩這一條告訴玩家發生什麼事。
         面板 5Hz 才來一次，這裡照快照時間扣掉已經過的秒數（同 ui.js 的做法）。 */
      if (p.reviveText) {
        p.reviveText.visible = dead;
        if (dead) {
          var left = (typeof uiCountdownRemain === 'function')
            ? uiCountdownRemain(reviveLeft, panel.gt) : reviveLeft;
          p.reviveText.text = '💀 復活中 ' + (Math.round(Math.max(0, left) * 10) / 10) + 's';
          p.reviveText.rotation = Math.PI / 2;   // 角色倒地時 root 轉了 90°，字要轉回來
        }
      }
      /* 我方座標由模擬層給（FIELD.playerPos ←→ js/battlefield.js bfPlayerPos）。
         與敵人一樣估速度做外推，把 5Hz 的取樣補成逐幀連續；
         走路／站立動畫改看「實際有沒有位移」，不再猜「場上有沒有敵人」。 */
      var pp = field.playerPos;
      if (pp && isFinite(pp.x) && isFinite(pp.y)) {
        if (!p.posAt) { p.wx = pp.x; p.wy = pp.y; p.tx = pp.x; p.ty = pp.y; }  // 第一次直接就位
        trackVelocity(p, pp.x, pp.y, panel.gt);
      }
      if (dead || S.towerActive) { p.velX = 0; p.velY = 0; }
    }

    /* 空場提示（高塔戰期間野外空場是常態，提示語照 DOM 版分開）。
       屍體還在淡出時不顯示：畫面上明明有東西卻寫「搜索敵人中」很怪。 */
    if (S.emptyText) {
      var hasAnyEntity = false;
      for (var ek in S.entities) {
        if (Object.prototype.hasOwnProperty.call(S.entities, ek)) { hasAnyEntity = true; break; }
      }
      S.emptyText.visible = !anyLive && !hasAnyEntity;
      var emptyMsg = S.towerActive ? '（高塔戰鬥中…）' : '🔍 搜索敵人中…';
      if (S.emptyText.text !== emptyMsg) S.emptyText.text = emptyMsg;
    }
  }

  /* 敵人出手：物理系衝進接觸距離再揮，魔法系原地放投射物（需求：物理近戰、魔法遠程）。
     ⚠️ 模擬層沒有攻擊距離的概念——不管站在哪一格都打得到玩家。
     所以「打得到」這件事在畫面上必須由這裡負責：出手就是整隻衝到玩家身前，
     否則遠處那圈敵人看起來就是在隔空互毆。 */
  function enemyAttackAnim(ent) {
    if (ent.isBoss && ent.sheetName) playAnim(ent, 'attack', 'idle');
    if (ent.data && ent.data.magic) {
      var from = { x: ent.root.x, y: ent.root.y - ent.hitHeight * 0.5 };
      spawnProjectile('pv-float', 260, {
        elem: ent.data.attr || null, cat: 'enemy', color: '#c084fc'
      }, function (pt) {
        spawnImpact(pt.x, pt.y, { elem: ent.data.attr || null, color: '#c084fc' }, false);
      }, from);
      return;
    }
    /* 衝刺時間隨距離拉長，遠的那隻才不會像瞬移過來 */
    var pc = playerPos();
    var dx = pc.x - ent.wx, dy = (pc.y - 26) - ent.wy;
    var dist = Math.sqrt(dx * dx + dy * dy);
    ent.lungeDur = Math.max(0.28, Math.min(0.8, 0.24 + dist / 900));
    ent.lunge = ent.lungeDur;
  }

  function startDeath(ent, realDeath) {
    /* 背景分頁：rAF 停擺、死亡動畫不會播也不會被清，直接移除。
       不這樣做的話，掛機幾小時的垂死實體會無上限累積在記憶體裡。 */
    if (documentHidden()) {
      if (ent.isBoss) removeBossBar(ent.id);
      destroyEntity(ent.id);
      return;
    }
    ent.state = 'dying';
    ent.dieAt = nowMs();
    ent.realDeath = !!realDeath;
    S.lastPos[ent.id] = { x: ent.root.x, y: ent.root.y - ent.hitHeight * 0.55, at: nowMs() };
    if (ent.isBoss) {
      removeBossBar(ent.id);
      if (ent.sheetName) {
        ent.baseAnim = 'hurt';   // onComplete 讀 baseAnim；垂死期間 hurt 循環播放
        playAnim(ent, 'hurt', 'hurt');
      }
    }
    if (realDeath && !REDUCED_MOTION) {
      spawnParticles(ent.root.x, ent.root.y - ent.hitHeight * 0.4,
        ent.isBoss ? 16 : 7, themeOf({ elem: ent.data && ent.data.attr }), ent.isBoss ? 3.2 : 2.2);
    }
  }

  function destroyEntity(id) {
    var ent = S.entities[id];
    if (!ent) return;
    S.lastPos[id] = { x: ent.root.x, y: ent.root.y - ent.hitHeight * 0.55, at: nowMs() };
    ent.root.destroy({ children: true });
    delete S.entities[id];
  }

  /* ============ 受擊反應（FLOAT / VFX impact 觸發） ============ */
  function hitReact(elId, elem, strong) {
    var ent = (elId === 'pv-float') ? S.player : S.entities[elId];
    if (!ent) return;
    var theme = themeOf({ elem: elem });
    /* 受擊回饋 = 元素色染色 + 抖動 + 縮放彈跳。
       ⚠️ 不用「tint 白閃」：Pixi 的 tint 是乘法染色，0xffffff 是恆等值，畫不出提亮。 */
    ent.flash = strong ? 0.24 : 0.15;
    ent.flashTint = cssColorToInt(theme.c1, 0xff8888);
    ent.jolt = strong ? 0.26 : 0.16;
    if (ent === S.player) return;
    ent.pop = strong ? 0.24 : 0.15;
    ent.popDur = ent.pop;
    if (ent.isBoss && ent.sheetName && ent.state === 'idle' && ent.curAnim !== 'attack') {
      playAnim(ent, 'hurt', 'idle');
    }
    if (strong) addShake(4);
  }
  function addShake(px) {
    if (REDUCED_MOTION) return;
    S.shake = Math.min(10, Math.max(S.shake, px));
  }

  /* ============ 特效系統 ============ */
  function addFx(fx, prio, maxLifeMs) {
    fx.prio = prio || 0;
    /* 硬性壽命（牆鐘）。每個特效的 update() 自己會算完就收，但那是靠 rAF 推的：
       分頁切到背景、瀏覽器節流、或某個 update 因為外部狀態卡住不回 false，
       節點就會永遠留在畫面上。這條時限與 update 無關，時間到一律清掉。 */
    fx.bornAt = nowMs();
    fx.maxLife = maxLifeMs || FX_HARD_LIFETIME_MS;
    if (S.fx.length >= MAX_FX) {
      /* 滿了先踢低優先級（粒子），跟 DOM 版先踢非 aura 的精神一致 */
      for (var i = 0; i < S.fx.length; i++) {
        if (S.fx[i].prio <= 0) { killFx(S.fx[i]); S.fx.splice(i, 1); break; }
      }
      if (S.fx.length >= MAX_FX) {
        /* 拒收就要就地銷毀：呼叫端都是先 addChild 再 addFx，
           不銷毀的話節點會永遠凍在舞台上（沒有任何清除路徑會再碰到它）。 */
        killFx(fx);
        return null;
      }
    }
    S.fx.push(fx);
    return fx;
  }
  function killFx(fx) {
    if (fx.node && !fx.node.destroyed) fx.node.destroy({ children: true });
    fx.dead = true;
  }

  /* 全部清空：分頁切背景、Worker 重啟、暫停解除後的補救都用這支。 */
  function clearAllFx() {
    for (var i = 0; i < S.fx.length; i++) killFx(S.fx[i]);
    S.fx.length = 0;
    sweepOrphanFxNodes();
  }

  /* 孤兒節點清掃：特效層裡任何「沒有被 S.fx 追蹤」的顯示物件一律移除。
     這是最後一道保險——不管是哪條路徑漏掉了回收（例外、提早 return、
     未來新增的特效忘了走 addFx），畫面都不會殘留一堆小圖示與圈點。 */
  function sweepOrphanFxNodes() {
    if (!S.layers) return;
    var tracked = [];
    for (var i = 0; i < S.fx.length; i++) if (S.fx[i].node) tracked.push(S.fx[i].node);
    var layers = [S.layers.fx, S.layers.zone];
    for (var li = 0; li < layers.length; li++) {
      var layer = layers[li];
      if (!layer || !layer.children) continue;
      for (var ci = layer.children.length - 1; ci >= 0; ci--) {
        var child = layer.children[ci];
        if (tracked.indexOf(child) >= 0) continue;
        if (!child.destroyed) child.destroy({ children: true });
        else layer.removeChildAt(ci);
      }
    }
  }

  /* 看門狗：用 setInterval（牆鐘）而不是 rAF。rAF 在背景分頁會停擺，
     正是特效卡住不消失的那個情境，所以清理不能掛在同一條時間軸上。 */
  function fxWatchdog() {
    if (!S.ready) return;
    var now = nowMs();
    for (var i = S.fx.length - 1; i >= 0; i--) {
      var fx = S.fx[i];
      if (fx.dead || (now - fx.bornAt) > fx.maxLife) {
        killFx(fx);
        S.fx.splice(i, 1);
      }
    }
    sweepOrphanFxNodes();
  }

  function spawnParticles(x, y, count, theme, speed) {
    if (REDUCED_MOTION) return;
    count = Math.min(count, 14);
    for (var i = 0; i < count; i++) {
      (function () {
        var g = new PIXI.Graphics();
        var r = 1.6 + Math.random() * 2.4;
        g.circle(0, 0, r).fill(Math.random() < 0.5 ? theme.c1 : theme.c2);
        g.x = x; g.y = y;
        g.blendMode = 'add';
        S.layers.fx.addChild(g);
        var ang = Math.random() * Math.PI * 2;
        var v = (60 + Math.random() * 120) * (speed || 1) * 0.55;
        var vx = Math.cos(ang) * v, vy = Math.sin(ang) * v - 40;
        var life = 0.45 + Math.random() * 0.3;
        var t = 0;
        addFx({
          node: g,
          update: function (dt) {
            t += dt;
            vy += 260 * dt;
            g.x += vx * dt; g.y += vy * dt;
            g.alpha = Math.max(0, 1 - t / life);
            return t < life;
          }
        }, 0);
      })();
    }
  }

  /* 投射物：追蹤目標實體（等速、travelMs 由協議帶來） */
  function spawnProjectile(targetId, travelMs, spec, onArrive, fromOverride) {
    var theme = themeOf(spec);
    var from = fromOverride || playerMuzzle();
    var node = new PIXI.Container();
    var core;
    if (spec.glyph && (spec.fxKind === 'projectile' || spec.variant === 'glyph')) {
      core = new PIXI.Text({ text: spec.glyph, style: { fontSize: 20 } });
      core.anchor.set(0.5);
    } else {
      core = new PIXI.Graphics();
      var r = spec.variant === 'meteor' ? 10 : (spec.cat === 'basic' ? 5 : 6.5);
      core.circle(0, 0, r).fill(theme.c1);
      core.circle(0, 0, r * 0.55).fill('#ffffff');
    }
    var glow = new PIXI.Sprite(glowTexture());
    glow.anchor.set(0.5);
    glow.tint = parseInt(String(theme.glow).replace('#', '0x')) || 0xffffff;
    glow.alpha = 0.8;
    glow.scale.set(0.9);
    glow.blendMode = 'add';
    node.addChild(glow); node.addChild(core);
    node.x = from.x; node.y = from.y;
    S.layers.fx.addChild(node);

    var dur = Math.max(60, travelMs || (spec.dur ? spec.dur * 1000 : 300)) / 1000;
    var t = 0, trailAcc = 0;
    addFx({
      node: node,
      update: function (dt) {
        t += dt;
        var k = Math.min(1, t / dur);
        var to = posOf(targetId);
        node.x = lerp(from.x, to.x, k);
        node.y = lerp(from.y, to.y, k) - Math.sin(k * Math.PI) * 18; // 微弧線
        node.rotation = Math.atan2(to.y - from.y, to.x - from.x);
        trailAcc += dt;
        if (trailAcc > 0.03 && !REDUCED_MOTION) {
          trailAcc = 0;
          spawnTrailDot(node.x, node.y, theme);
        }
        if (k >= 1) {
          if (onArrive) onArrive(posOf(targetId));
          return false;
        }
        return true;
      }
    }, 1);
  }
  function spawnTrailDot(x, y, theme) {
    var g = new PIXI.Graphics();
    g.circle(0, 0, 2.2).fill(theme.c2);
    g.x = x; g.y = y;
    g.alpha = 0.7;
    g.blendMode = 'add';
    S.layers.fx.addChild(g);
    var t = 0;
    addFx({
      node: g,
      update: function (dt) {
        t += dt;
        g.alpha = 0.7 * (1 - t / 0.28);
        g.scale.set(1 - t / 0.4);
        return t < 0.28;
      }
    }, 0);
  }

  /* 命中爆點：環 + 粒子 */
  function spawnImpact(x, y, spec, strong) {
    var theme = themeOf(spec);
    var ring = new PIXI.Graphics();
    ring.x = x; ring.y = y;
    S.layers.fx.addChild(ring);
    var t = 0, dur = strong ? 0.4 : 0.26;
    var maxR = strong ? 46 : 26;
    addFx({
      node: ring,
      update: function (dt) {
        t += dt;
        var k = Math.min(1, t / dur);
        ring.clear();
        ring.circle(0, 0, 4 + maxR * k)
          .stroke({ color: theme.c1, width: Math.max(1, 5 * (1 - k)), alpha: 1 - k });
        return t < dur;
      }
    }, 1);
    spawnParticles(x, y, strong ? 12 : 6, theme, strong ? 2.6 : 1.6);
    if (strong) addShake(5);
  }

  /* 斬擊弧線 */
  function spawnSlash(x, y, spec, big) {
    var theme = themeOf(spec);
    var g = new PIXI.Graphics();
    g.x = x; g.y = y;
    g.rotation = -0.5 + Math.random();
    S.layers.fx.addChild(g);
    var t = 0, dur = 0.24, R = big ? 54 : 36;
    addFx({
      node: g,
      update: function (dt) {
        t += dt;
        var k = Math.min(1, t / dur);
        var sweep = -Math.PI * 0.7 + k * Math.PI * 1.1;
        g.clear();
        g.arc(0, 0, R, sweep - 0.9, sweep, false)
          .stroke({ color: theme.c1, width: 7 * (1 - k * 0.6), alpha: 1 - k, cap: 'round' });
        g.arc(0, 0, R * 0.8, sweep - 0.7, sweep, false)
          .stroke({ color: '#ffffff', width: 3 * (1 - k), alpha: 0.8 * (1 - k), cap: 'round' });
        return t < dur;
      }
    }, 1);
  }

  /* 光束 */
  function spawnBeam(targetId, spec) {
    var theme = themeOf(spec);
    var from = playerMuzzle();
    var g = new PIXI.Graphics();
    S.layers.fx.addChild(g);
    var t = 0, dur = Math.max(0.3, (spec.dur || 0.45));
    addFx({
      node: g,
      update: function (dt) {
        t += dt;
        var k = Math.min(1, t / dur);
        var to = posOf(targetId);
        var alpha = k < 0.2 ? k / 0.2 : (1 - (k - 0.2) / 0.8);
        var w = 10 * (1 - k * 0.5);
        g.clear();
        g.moveTo(from.x, from.y).lineTo(to.x, to.y)
          .stroke({ color: theme.c1, width: w, alpha: alpha * 0.9, cap: 'round' });
        g.moveTo(from.x, from.y).lineTo(to.x, to.y)
          .stroke({ color: '#ffffff', width: Math.max(1, w * 0.4), alpha: alpha, cap: 'round' });
        return t < dur;
      }
    }, 1);
  }

  /* 閃電折線（連鎖/天雷） */
  function boltPath(g, x0, y0, x1, y1, theme, alpha) {
    var seg = 6;
    var pts = [[x0, y0]];
    for (var i = 1; i < seg; i++) {
      var k = i / seg;
      pts.push([
        lerp(x0, x1, k) + (Math.random() * 22 - 11),
        lerp(y0, y1, k) + (Math.random() * 22 - 11)
      ]);
    }
    pts.push([x1, y1]);
    g.moveTo(pts[0][0], pts[0][1]);
    for (i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.stroke({ color: theme.c1, width: 4, alpha: alpha, cap: 'round', join: 'round' });
    g.moveTo(pts[0][0], pts[0][1]);
    for (i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.stroke({ color: '#ffffff', width: 1.6, alpha: alpha, cap: 'round', join: 'round' });
  }
  function spawnBolt(fromPt, targetId, spec, delaySec) {
    var theme = themeOf(spec);
    var g = new PIXI.Graphics();
    S.layers.fx.addChild(g);
    var t = -(delaySec || 0), dur = 0.24, redraws = 0;
    addFx({
      node: g,
      update: function (dt) {
        t += dt;
        if (t < 0) return true;
        var to = posOf(targetId);
        var from = fromPt || { x: to.x + (Math.random() * 60 - 30), y: to.y - S.H * 0.55 };
        redraws += dt;
        if (redraws > 0.05 || g._empty !== false) {
          g._empty = false;
          redraws = 0;
          g.clear();
          boltPath(g, from.x, from.y, to.x, to.y, theme, Math.max(0, 1 - t / dur));
        }
        if (t >= dur * 0.4 && !g._hit) {
          g._hit = true;
          spawnImpact(to.x, to.y, spec, false);
          hitReact(targetId, spec.elem || 'lightning', false);
        }
        return t < dur;
      }
    }, 1);
  }

  /* 領域（aura）：覆蓋棋盤格範圍，持續 dur 秒 */
  function spawnAura(rect, spec) {
    if (!rect) return;
    var theme = themeOf(spec);
    var node = new PIXI.Container();
    var g = new PIXI.Graphics();
    node.addChild(g);
    S.layers.zone.addChild(node);
    /* 顯示時間刻意不吃技能的實際持續時間：長效領域會讓這塊半透明方框在畫面上
       留很久，看起來就像沒清乾淨的殘留物。收尾再淡出，不要直接消失。 */
    var t = 0, dur = Math.min(FX_AURA_MAX_SEC, Math.max(1, spec.dur || 4));
    var partAcc = 0;
    addFx({
      node: node,
      update: function (dt) {
        t += dt;
        var fade = t > dur - 0.5 ? Math.max(0, (dur - t) / 0.5) : 1;
        var pulse = (0.16 + Math.sin(t * 3.2) * 0.05) * fade;
        g.clear();
        g.roundRect(rect.x + 3, rect.y + 3, rect.w - 6, rect.h - 6, 10)
          .fill({ color: theme.c2, alpha: pulse })
          .stroke({ color: theme.c1, width: 2, alpha: (0.5 + Math.sin(t * 3.2) * 0.2) * fade });
        partAcc += dt;
        if (partAcc > 0.3 && !REDUCED_MOTION && fade > 0.5) {
          partAcc = 0;
          spawnRiser(rect.x + Math.random() * rect.w, rect.y + rect.h * (0.4 + Math.random() * 0.6), theme, spec.glyph);
        }
        return t < dur;
      }
    }, 2, dur * 1000 + 500);
  }
  function spawnRiser(x, y, theme, glyph) {
    var node;
    if (glyph && Math.random() < 0.4) {
      node = new PIXI.Text({ text: glyph, style: { fontSize: 13 } });
      node.anchor.set(0.5);
    } else {
      node = new PIXI.Graphics();
      node.circle(0, 0, 2).fill(theme.c1);
      node.blendMode = 'add';
    }
    node.x = x; node.y = y;
    S.layers.fx.addChild(node);
    var t = 0;
    addFx({
      node: node,
      update: function (dt) {
        t += dt;
        node.y -= 34 * dt;
        node.alpha = 1 - t / 0.9;
        return t < 0.9;
      }
    }, 0);
  }

  /* 天降（rain）＋流星（meteor 變體） */
  function spawnRain(rect, spec) {
    if (!rect) { rect = { x: S.W * 0.4, y: S.H * 0.2, w: S.W * 0.4, h: S.H * 0.5 }; }
    var theme = themeOf(spec);
    if (spec.variant === 'meteor') {
      spawnMeteor(rect, spec);
      return;
    }
    var n = REDUCED_MOTION ? 2 : 5;
    for (var i = 0; i < n; i++) {
      (function (idx) {
        var node = new PIXI.Text({ text: spec.glyph || '❄', style: { fontSize: 16 } });
        node.anchor.set(0.5);
        var tx = rect.x + Math.random() * rect.w;
        var ty = rect.y + Math.random() * rect.h;
        /* 起點在目標正上方（世界座標）：鏡頭會移動，不能再用「畫面頂端」當天空 */
        var sky = ty - S.H * 0.6;
        node.x = tx + 40; node.y = sky;
        S.layers.fx.addChild(node);
        var t = -(idx * 0.08), dur = 0.5;
        addFx({
          node: node,
          update: function (dt) {
            t += dt;
            if (t < 0) return true;
            var k = Math.min(1, t / dur);
            node.x = lerp(tx + 40, tx, k);
            node.y = lerp(sky, ty, k);
            if (k >= 1) { spawnImpact(tx, ty, spec, false); return false; }
            return true;
          }
        }, 1);
      })(i);
    }
  }
  function spawnMeteor(rect, spec) {
    var theme = themeOf(spec);
    var cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
    var node = new PIXI.Container();
    var core = new PIXI.Graphics();
    core.circle(0, 0, 13).fill(theme.c1);
    core.circle(0, 0, 7).fill('#ffffff');
    var glow = new PIXI.Sprite(glowTexture());
    glow.anchor.set(0.5); glow.scale.set(2.2); glow.blendMode = 'add';
    glow.tint = 0xffb347;
    node.addChild(glow); node.addChild(core);
    var mSky = cy - S.H * 0.7;   // 目標上方的世界座標；鏡頭會動，不能用畫面頂端
    node.x = cx + 180; node.y = mSky;
    S.layers.fx.addChild(node);
    var t = 0, dur = Math.min(0.45, Math.max(0.2, (spec.travelMs && spec.travelMs[0] || 350) / 1000));
    addFx({
      node: node,
      update: function (dt) {
        t += dt;
        var k = Math.min(1, t / dur);
        node.x = lerp(cx + 180, cx, k);
        node.y = lerp(mSky, cy, k);
        if (!REDUCED_MOTION && Math.random() < 0.6) spawnTrailDot(node.x, node.y, theme);
        if (k >= 1) {
          spawnImpact(cx, cy, spec, true);
          spawnAreaFlash(rect, theme);
          addShake(8);
          return false;
        }
        return true;
      }
    }, 2);
  }
  function spawnAreaFlash(rect, theme) {
    var g = new PIXI.Graphics();
    S.layers.zone.addChild(g);
    var t = 0, dur = 0.5;
    addFx({
      node: g,
      update: function (dt) {
        t += dt;
        var k = t / dur;
        g.clear();
        g.roundRect(rect.x, rect.y, rect.w, rect.h, 10)
          .fill({ color: theme.c1, alpha: 0.32 * (1 - k) });
        return t < dur;
      }
    }, 1);
  }

  /* 我方增益／敵身詛咒 */
  function spawnSelfBuff(spec) {
    var p = playerPos();
    var theme = themeOf(spec);
    var g = new PIXI.Graphics();
    g.x = p.x; g.y = p.y;
    S.layers.fx.addChild(g);
    var t = 0, dur = 0.7;
    addFx({
      node: g,
      update: function (dt) {
        t += dt;
        var k = Math.min(1, t / dur);
        g.clear();
        g.ellipse(0, -8 - k * 40, 40 * (1 - k * 0.3), 12 * (1 - k * 0.3))
          .stroke({ color: theme.c1, width: 3, alpha: 1 - k });
        return t < dur;
      }
    }, 1);
    spawnRiser(p.x - 14, p.y - 30, theme, spec.glyph);
    spawnRiser(p.x + 14, p.y - 44, theme, spec.glyph);
  }
  function spawnCurse(targetId, spec, delaySec) {
    var theme = themeOf(spec);
    var node = new PIXI.Text({
      text: spec.glyph || '🌀',
      style: { fontSize: 22 }
    });
    node.anchor.set(0.5);
    S.layers.fx.addChild(node);
    var t = -(delaySec || 0), dur = 0.9;
    addFx({
      node: node,
      update: function (dt) {
        t += dt;
        node.visible = t >= 0;
        if (t < 0) return true;
        var to = posOf(targetId);
        node.x = to.x; node.y = to.y - 14 - t * 16;
        node.alpha = 1 - t / dur;
        node.rotation = Math.sin(t * 8) * 0.3;
        if (t > 0.1 && !node._hit) { node._hit = true; hitReact(targetId, spec.elem, false); }
        return t < dur;
      }
    }, 1);
  }

  /* 旋風／劍刃風暴（cyclone / bladestorm 變體） */
  function spawnCyclone(rect, spec) {
    if (!rect) return;
    var theme = themeOf(spec);
    var node = new PIXI.Container();
    node.x = rect.x + rect.w / 2; node.y = rect.y + rect.h / 2;
    S.layers.fx.addChild(node);
    var blades = [];
    for (var i = 0; i < 3; i++) {
      var b = new PIXI.Graphics();
      b.arc(0, 0, Math.min(rect.w, rect.h) * 0.32, -0.8, 0.4)
        .stroke({ color: theme.c1, width: 5, alpha: 0.9, cap: 'round' });
      b.rotation = i * (Math.PI * 2 / 3);
      node.addChild(b);
      blades.push(b);
    }
    var t = 0, dur = Math.min(FX_AURA_MAX_SEC, Math.max(0.8, spec.dur || 1.6));
    addFx({
      node: node,
      update: function (dt) {
        t += dt;
        node.rotation += dt * 9;
        node.alpha = t > dur - 0.3 ? (dur - t) / 0.3 : 1;
        return t < dur;
      }
    }, 2, dur * 1000 + 500);
  }
  function spawnBladestorm(rect, spec) {
    if (!rect) return;
    var n = REDUCED_MOTION ? 2 : 5;
    for (var i = 0; i < n; i++) {
      (function (idx) {
        setTimeout(function () {
          if (fxGate()) return;
          spawnSlash(rect.x + Math.random() * rect.w, rect.y + Math.random() * rect.h, spec, true);
        }, idx * 90);
      })(i);
    }
  }

  /* 火柱（pillar 變體） */
  function spawnPillar(targetId, spec, delaySec) {
    var theme = themeOf(spec);
    var g = new PIXI.Graphics();
    S.layers.fx.addChild(g);
    var t = -(delaySec || 0), dur = 0.55;
    addFx({
      node: g,
      update: function (dt) {
        t += dt;
        if (t < 0) return true;
        var to = posOf(targetId);
        var k = Math.min(1, t / dur);
        var grow = k < 0.3 ? k / 0.3 : 1;
        var fade = k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1;
        var h = 120 * grow, w = 26 * grow;
        g.clear();
        g.roundRect(to.x - w / 2, to.y - h, w, h, 8).fill({ color: theme.c2, alpha: 0.5 * fade });
        g.roundRect(to.x - w * 0.25, to.y - h * 0.92, w * 0.5, h * 0.9, 6).fill({ color: theme.c1, alpha: 0.8 * fade });
        if (!g._hit && k > 0.25) {
          g._hit = true;
          hitReact(targetId, spec.elem || 'fire', true);
          spawnParticles(to.x, to.y - 20, 8, theme, 2);
        }
        return t < dur;
      }
    }, 1);
  }

  /* ============ VFX 事件分派（協議 v17 spec → Canvas 畫法） ============ */
  function onVfx(spec) {
    if (!S.ready || !spec) return;
    /* 背景分頁不畫特效（與 DOM 版 vfxSetEnabled(false) 同精神）；
       setTimeout 排進來的延遲段也會走到這裡被擋掉。 */
    if (documentHidden()) return;
    var baseDelay = Math.max(0, spec.delayMs || 0);
    if (baseDelay > 0) {
      setTimeout(function () { spec.delayMs = 0; onVfx(spec); }, baseDelay);
      return;
    }
    var targets = Array.isArray(spec.targets) ? spec.targets.slice(0, 8) : [];
    var rect = areaRect(spec.area);
    var count = Math.min(5, Math.max(1, spec.count || 1));
    var stagger = ((typeof VFX_HIT_STAGGER_SEC === 'number') ? VFX_HIT_STAGGER_SEC : 0.09) * 1000;

    /* 玩家出手動作（非敵方事件都算玩家出招）。
       物理（普攻／物理技）用接觸型特效時＝近戰，角色會撲到目標身前再揮；
       魔法與投射／光束／天降類＝原地施法，由投射物負責跑完距離。 */
    if (spec.cat !== 'enemy') {
      var contactFx = spec.fxKind === 'slash' || spec.fxKind === 'impact' || spec.fxKind === 'burst';
      var meleeCat = spec.cat === 'basic' || spec.cat === 'phys';
      var firstTarget = targets.length ? targets[0] : null;
      if (firstTarget) {
        /* 出手當下先面向目標；跑不跑過去由模擬層決定，這裡只管朝向。 */
        var tp = posOf(firstTarget);
        S.player.facing = (tp.x < S.player.root.x) ? -1 : 1;
      }
      if (meleeCat && contactFx && firstTarget) {
        playerAttackAnim('melee', firstTarget);
      } else {
        playerAttackAnim(spec.cat === 'magic' || spec.fxKind === 'rain' || spec.fxKind === 'beam' ? 'cast' : 'melee');
      }
    }

    switch (spec.fxKind) {
      case 'projectile':
        targets.forEach(function (id, ti) {
          var travel = (spec.travelMs && spec.travelMs[ti]) || (spec.dur ? spec.dur * 1000 : 300);
          for (var c = 0; c < count; c++) {
            (function (cc) {
              /* 普攻不發射飛行子彈：它在畫面上已經是近戰（角色會跑到目標身前再揮），
                 再飛一道劍氣過去會變成「明明貼著臉還射子彈」。
                 模擬層送來的仍是 projectile（高塔那邊是靜態場景，飛行劍氣在那裡才合理），
                 所以只在這裡改畫法，不動協議也不動 DOM 後備路徑。
                 延遲仍沿用 travelMs——傷害數字用同一個延遲，刀到＝數字跳。 */
              if (spec.cat === 'basic') {
                setTimeout(function () {
                  if (fxGate()) return;
                  var pt = posOf(id);
                  spawnSlash(pt.x, pt.y, spec, true);
                  spawnImpact(pt.x, pt.y, spec, false);
                  hitReact(id, spec.elem, false);
                }, travel + cc * stagger + ti * 40);
                return;
              }
              setTimeout(function () {
                if (fxGate()) return;
                spawnProjectile(id, travel, spec, function (pt) {
                  spawnImpact(pt.x, pt.y, spec, spec.variant === 'detonate');
                  hitReact(id, spec.elem, spec.variant === 'detonate');
                });
              }, cc * stagger + ti * 40);
            })(c);
          }
        });
        break;
      case 'slash':
        targets.forEach(function (id, ti) {
          for (var c = 0; c < count; c++) {
            (function (cc) {
              setTimeout(function () {
                if (fxGate()) return;
                var pt = posOf(id);
                if (spec.variant === 'claw') {
                  spawnSlash(pt.x - 6, pt.y - 6, spec, false);
                  spawnSlash(pt.x + 6, pt.y + 2, spec, false);
                } else {
                  spawnSlash(pt.x, pt.y, spec, spec.variant === 'swordwave');
                }
                hitReact(id, spec.elem, false);
              }, cc * stagger + ti * 40);
            })(c);
          }
        });
        break;
      case 'burst':
        targets.forEach(function (id, ti) {
          setTimeout(function () {
            if (fxGate()) return;
            var pt = posOf(id);
            spawnImpact(pt.x, pt.y, spec, spec.variant === 'nova' || spec.variant === 'detonate');
            hitReact(id, spec.elem, spec.variant === 'nova' || spec.variant === 'detonate');
          }, ti * 40);
        });
        if (!targets.length && rect) spawnAreaFlash(rect, themeOf(spec));
        break;
      case 'beam':
        targets.forEach(function (id) {
          spawnBeam(id, spec);
          hitReact(id, spec.elem, false);
        });
        break;
      case 'rain':
        spawnRain(rect, spec);
        targets.forEach(function (id, ti) {
          setTimeout(function () {
            if (fxGate()) return;
            hitReact(id, spec.elem, spec.variant === 'meteor');
          }, (spec.variant === 'meteor' ? 320 : 240) + ti * stagger);
        });
        break;
      case 'aura':
        if (spec.variant === 'cyclone') spawnCyclone(rect, spec);
        else if (spec.variant === 'bladestorm') spawnBladestorm(rect, spec);
        else spawnAura(rect, spec);
        break;
      case 'selfBuff':
        spawnSelfBuff(spec);
        break;
      case 'curse':
        targets.forEach(function (id, ti) { spawnCurse(id, spec, ti * 0.05); });
        break;
      case 'chain':
        /* targets 順序即彈跳路徑：天雷打第一個，之後逐跳 */
        if (targets.length) {
          spawnBolt(null, targets[0], spec, 0);
          for (var h = 1; h < targets.length; h++) {
            (function (hh) {
              var fromId = targets[hh - 1];
              setTimeout(function () {
                if (fxGate()) return;
                spawnBolt(posOf(fromId), targets[hh], spec, 0);
              }, 90 * hh);
            })(h);
          }
        }
        break;
      case 'impact':
      default:
        if (spec.variant === 'pillar') {
          targets.forEach(function (id, ti) { spawnPillar(id, spec, ti * 0.06); });
          break;
        }
        if (spec.variant === 'smite') {
          targets.forEach(function (id, ti) { spawnBolt(null, id, spec, ti * 0.06); });
          break;
        }
        targets.forEach(function (id, ti) {
          setTimeout(function () {
            if (fxGate()) return;
            var pt = posOf(id);
            var strong = spec.variant === 'detonate' || spec.variant === 'nova';
            spawnImpact(pt.x, pt.y, spec, strong);
            hitReact(id, spec.elem, strong);
          }, ti * 40);
        });
        break;
    }
  }

  /* ============ 傷害飄字 ============ */
  function floatStyle(elId, cls, text) {
    cls = cls || '';
    var s = { size: 15, fill: '#ffffff', stroke: '#000000', weight: 'bold', rise: 44, life: 0.9 };
    var isCrit = cls.indexOf('crit') >= 0;
    var isHigh = cls.indexOf('crit-high-roll') >= 0;
    if (elId === 'pv-float') {
      /* 玩家側：受傷紅、回復綠、其他事件藍白 */
      if (cls.indexOf('player-event') >= 0) {
        if (/^\+/.test(text)) { s.fill = '#7dff9a'; }
        else if (cls.indexOf('defend') >= 0 || cls.indexOf('dodge') >= 0) { s.fill = '#9aa5b1'; s.size = 13; }
        else { s.fill = '#9ecbff'; }
      } else {
        s.fill = '#ff6b6b'; s.size = 16;
      }
      if (isCrit) { s.size += 4; s.fill = '#ff4747'; }
      return s;
    }
    /* 敵方側：普攻白、技能金、暴擊放大 */
    if (text === 'MISS' || cls.indexOf('miss') >= 0) {
      s.fill = '#9aa5b1'; s.size = 13; s.life = 0.7;
      return s;
    }
    if (cls.indexOf('skill') >= 0) { s.fill = '#ffd75e'; s.size = 17; }
    if (isCrit) {
      s.fill = '#ffb347'; s.size = isHigh ? 26 : 21; s.rise = 58; s.life = 1.15;
      if (isHigh) s.fill = '#ff7b3c';
    }
    return s;
  }
  function floatMergeKey(elId, cls) {
    /* 與 DOM 版同精神：同目標、同類別在短窗內合併成一個滾動數字 */
    var base = (cls || '').replace(/crit-high-roll/, '').trim();
    return elId + '|' + base;
  }
  function onFloat(ev) {
    if (!S.ready || !ev) return;
    if (documentHidden()) return;   // 背景分頁：ui.js 已改走「只記最新」路徑，這裡擋 setTimeout 殘留
    var delay = Math.max(0, ev.delayMs || 0);
    if (delay > 0) {
      setTimeout(function () {
        onFloat({ elId: ev.elId, text: ev.text, cls: ev.cls, damageValue: ev.damageValue });
      }, delay);
      return;
    }
    var val = Number(ev.damageValue);
    var mergeable = isFinite(val) && val > 0 && /^[-+]?/.test(ev.text || '') && (ev.cls || '').indexOf('player-event') < 0;
    if (mergeable) {
      var key = floatMergeKey(ev.elId, ev.cls);
      var exist = S.floatMerge[key];
      if (exist && !exist.dead && nowMs() - exist.bornAt < FLOAT_MERGE_MS && exist.hits < 8) {
        exist.total += val;
        exist.hits++;
        exist.node.text = exist.prefix + fmtNum(exist.total);
        exist.t = Math.min(exist.t, exist.life * 0.3);   // 延壽，讓連段看得完
        return;
      }
    }
    if (S.floats.length >= MAX_FLOATS) {
      var oldest = S.floats.shift();
      if (oldest) {
        killFx(oldest);
        oldest.dead = true;
        /* 與自然到期路徑對稱：合併表的鍵含單調遞增的 mv-float-N，不清會累積 */
        if (oldest.mergeKey && S.floatMerge[oldest.mergeKey] === oldest) delete S.floatMerge[oldest.mergeKey];
      }
    }
    var st = floatStyle(ev.elId, ev.cls, ev.text || '');
    var pt = posOf(ev.elId);
    /* 玩家身上的字（護盾吸收、回復、承傷）往上抬到頭頂再高一截：
       貼著身體會把角色整個蓋住，尤其護盾吸收那種長字串。 */
    if (ev.elId === 'pv-float') pt = { x: pt.x, y: pt.y - 62 };
    var node = new PIXI.Text({
      text: ev.text || '',
      style: {
        fontFamily: 'sans-serif', fontSize: st.size, fontWeight: st.weight,
        fill: st.fill, stroke: { color: st.stroke, width: Math.max(2, st.size / 6) }
      }
    });
    node.anchor.set(0.5, 1);
    node.x = pt.x + (Math.random() * 36 - 18);
    node.y = pt.y - 8 + (Math.random() * 14 - 7);
    S.layers.float.addChild(node);
    var prefixMatch = /^([^0-9]*)/.exec(ev.text || '');
    var f = {
      node: node, t: 0, life: st.life, rise: st.rise,
      bornAt: nowMs(), hits: 1, total: isFinite(val) ? val : 0,
      prefix: prefixMatch ? prefixMatch[1] : '',
      pop: (ev.cls || '').indexOf('crit') >= 0 ? 0.18 : 0
    };
    S.floats.push(f);
    if (mergeable) {
      f.mergeKey = floatMergeKey(ev.elId, ev.cls);
      S.floatMerge[f.mergeKey] = f;
    }
  }

  /* ============ 每幀更新 ============ */
  function tickWorld(ticker) {
    var dt = Math.min(0.05, (ticker.deltaMS || 16.7) / 1000);
    if (S.paused) dt = 0;
    var t = nowMs();

  /* ---- 玩家：把模擬層算好的座標畫出來 ----
     跑向誰、跑多快、停在哪，全部是模擬層的事（js/battlefield.js bfTickPlayer）。
     顯示層在這裡只做兩件事：把 5Hz 的取樣補成逐幀連續（外推，作法同敵人），
     以及決定面向與走路動畫。
     ⚠️ 不要讓角色在這裡自己移動。顯示層自作主張的位移不會回饋給模擬層，
     敵人卻是照模擬層座標畫的，於是「看到的距離」與「打得到的距離」會分家。 */
    var p = S.player;
    if (p && dt > 0) {
      var moving = false;
      if (!p.dead) {
        var pPredX = p.velX * dt, pPredY = p.velY * dt;
        p.wx += pPredX;
        p.wy += pPredY;
        var pCorrK = Math.min(1, dt * 6);
        var pCorrX = (p.tx - p.wx) * pCorrK, pCorrY = (p.ty - p.wy) * pCorrK;
        p.wx += pCorrX;
        p.wy += pCorrY;
        var pStep = Math.sqrt((pPredX + pCorrX) * (pPredX + pCorrX) + (pPredY + pCorrY) * (pPredY + pCorrY));
        /* 動畫遲滯：一有位移就立刻切走路，但要連續靜止一小段才切回站立。
           少了這段，位移在門檻上下抖動時走路／站立會逐幀互閃，
           看起來就像一下走路一下跑步。 */
        if (pStep > 0.5 * dt * 60) p.stillFor = 0;
        else p.stillFor = (p.stillFor || 0) + dt;
        moving = p.stillFor < 0.22;
        if (pStep > 0.6) p.facing = (pPredX + pCorrX) < 0 ? -1 : 1;
      }
      if (moving !== p.walking) {
        p.walking = moving;
        p.baseAnim = moving ? 'walk' : 'idle';
        if (!p.curAnim || p.curAnim === 'idle' || p.curAnim === 'walk') playAnim(p, p.baseAnim);
      }
      if (p.lunge > 0) {
        p.lunge = Math.max(0, p.lunge - dt);
        p.bodyWrap.x = Math.sin((0.18 - p.lunge) / 0.18 * Math.PI) * 14 * p.facing;
      } else {
        p.bodyWrap.x = 0;
      }
      p.root.x = p.wx;
      p.root.y = p.wy;
      p.root.zIndex = p.wy;
      /* 面向目標：序列幀只有朝右一版，往左打就水平翻面 */
      if (!p.dead) p.bodyWrap.scale.x = p.facing < 0 ? -1 : 1;
      updateFlashJolt(p, dt);
      drawPlayerVitals();
    }

    /* ---- 鏡頭：即時對準玩家 ----
       world 整層平移，玩家因此永遠在畫面正中央；地板是螢幕座標，
       靠 tilePosition 反向捲動假裝自己釘在世界上。 */
    var world = S.layers.world;
    var cam = playerPos();
    if (S.shake > 0.2 && dt > 0) S.shake *= Math.pow(0.0025, dt);
    else if (dt > 0) S.shake = 0;
    var shx = S.shake > 0.2 ? (Math.random() * 2 - 1) * S.shake : 0;
    var shy = S.shake > 0.2 ? (Math.random() * 2 - 1) * S.shake * 0.6 : 0;
    world.x = S.W / 2 - cam.x + shx;
    world.y = S.H / 2 - cam.y + shy;
    if (S.groundTile) {
      /* 貼圖是可四方連續的，所以取一個週期的餘數就好。角色的世界座標會隨著
         推進一路長大（一場下來幾十萬），直接丟給 tilePosition 會踩到 float32
         的精度上限，地板開始抖；取餘數之後畫面完全一樣，數值永遠是小數。 */
      var gtx = S.groundTile.texture;
      var perX = (gtx && gtx.width) || 128, perY = (gtx && gtx.height) || 128;
      S.groundTile.tilePosition.x = -(cam.x % perX) + shx;
      S.groundTile.tilePosition.y = -(cam.y % perY) + shy;
    }

    /* 敵人 */
    for (var id in S.entities) {
      if (!Object.prototype.hasOwnProperty.call(S.entities, id)) continue;
      var e = S.entities[id];
      if (dt <= 0) continue;

      /* 站位與逼近由模擬層決定（js/battlefield.js 座標制），但**面板只有 5Hz**：
         每 200ms 才來一個新座標。單純「追過去」會變成每 200ms 走一段就停，
         也就是一格一格跳；玩家是渲染器自己逐幀算的，所以只有敵人在抖。

         解法是外推：用前後兩次面板算出速度，兩次更新之間自己按速度前進，
         再用一個柔性修正把誤差拉回權威座標。等於把 5Hz 的取樣補成逐幀連續。 */
      var predX = e.velX * dt, predY = e.velY * dt;
      e.wx += predX;
      e.wy += predY;
      var corrK = Math.min(1, dt * 6);
      var corrX = (e.tx - e.wx) * corrK, corrY = (e.ty - e.wy) * corrK;
      e.wx += corrX;
      e.wy += corrY;
      var movedLen = Math.sqrt((predX + corrX) * (predX + corrX) + (predY + corrY) * (predY + corrY));

      if (e.state === 'entering' || movedLen > 0.6 * dt * 60) {
        /* 走路擺動：小怪左右搖 + 輕微縮放跳動（類倖存者小怪步態） */
        e.bodyWrap.rotation = Math.sin(t / 90 * e.wobble) * 0.08;
        e.bodyWrap.scale.y = 1 + Math.sin(t / 80 * e.wobble) * 0.045;
      } else if (e.state === 'idle') {
        /* 待機呼吸：縮放 + 微搖，讓場面一直是活的 */
        e.bobPhase += dt * (2 + e.wobble);
        e.bodyWrap.scale.y = 1 + Math.sin(e.bobPhase) * 0.035;
        e.bodyWrap.rotation = Math.sin(e.bobPhase * 0.7) * 0.03;
      }

      if (e.state === 'entering') {
        e.enterT += dt;
        if (e.enterT >= e.enterDur) e.state = 'idle';
      }

      if (e.state === 'idle') {
        /* 出手時往玩家撲一下（純表演；模擬層已經確認打得到才會出手）。 */
        if (e.lunge > 0) {
          e.lunge = Math.max(0, e.lunge - dt);
          var dur = e.lungeDur || 0.3;
          var lk = Math.sin((1 - e.lunge / dur) * Math.PI);
          var pc = playerPos();
          var ldx = pc.x - e.wx, ldy = (pc.y - 26) - e.wy;
          var ldist = Math.sqrt(ldx * ldx + ldy * ldy) || 1;
          var reach = Math.min(Math.max(0, ldist - ENEMY_CONTACT_GAP), ENEMY_MAX_CHARGE) * lk;
          e.dashX = ldx / ldist * reach;
          e.dashY = ldy / ldist * reach;
        } else {
          e.dashX = 0; e.dashY = 0;
        }
      }

      if (e.state === 'dying') {
        /* 死亡進度用 dt 累積：暫停時屍體凍結，不會在解除暫停時瞬間消失 */
        e.dieT = (e.dieT || 0) + dt;
        var dieT = e.dieT;
        if (e.realDeath) {
          /* 死亡：壓扁 + 淡出 + 微沉 */
          var dk = Math.min(1, dieT / 0.6);
          e.bodyWrap.scale.y = 1 - dk * 0.5;
          e.bodyWrap.scale.x = 1 + dk * 0.18;
          e.root.alpha = 1 - dk;
          e.root.y = e.wy + dk * 6;
          if (dk >= 1) { destroyEntity(id); continue; }
        } else {
          /* 非死亡消失（換關）：快速淡出 */
          e.root.alpha -= dt * 4;
          if (e.root.alpha <= 0) { destroyEntity(id); continue; }
        }
      }

      updateFlashJolt(e, dt);
      e.root.x = e.wx + (e.dashX || 0) + (e.jolt > 0 ? (Math.random() * 2 - 1) * 5 : 0);
      if (e.state !== 'dying') {
        e.root.y = e.wy + (e.dashY || 0) + (e.jolt > 0 ? (Math.random() * 2 - 1) * 3 : 0);
      }
      e.root.zIndex = e.root.y + (e.isBoss ? 1000 : 0);
    }

    /* ---- 互斥推擠 ----
       全部朝角色擠過去，不推開就會整群疊成一坨。推完形成一圈人牆，
       擠不進內圈的自然被排到外圈——這是「站位」唯一的來源，沒有預先算好的格子。 */
    /* 特效 */
    if (dt > 0) {
      for (var i = S.fx.length - 1; i >= 0; i--) {
        var fx = S.fx[i];
        var alive = false;
        if (!fx.dead) {
          try { alive = fx.update(dt); } catch (err) { alive = false; }
        }
        if (!alive) {
          killFx(fx);
          S.fx.splice(i, 1);
        }
      }
      /* 飄字 */
      for (i = S.floats.length - 1; i >= 0; i--) {
        var f = S.floats[i];
        f.t += dt;
        var fk = Math.min(1, f.t / f.life);
        f.node.y -= (f.rise / f.life) * dt;
        f.node.alpha = fk < 0.15 ? fk / 0.15 : (1 - (fk - 0.15) / 0.85);
        if (f.pop > 0) {
          var pk = Math.min(1, f.t / f.pop);
          f.node.scale.set(0.6 + 0.4 * pk + (1 - pk) * 0.5);
        }
        if (fk >= 1) {
          f.dead = true;
          f.node.destroy();
          S.floats.splice(i, 1);
          /* 合併表逐項清理：鍵是單調遞增的 mv-float-N，不清會無限增長 */
          if (f.mergeKey && S.floatMerge[f.mergeKey] === f) delete S.floatMerge[f.mergeKey];
        }
      }
    }
  }

  function updateFlashJolt(ent, dt) {
    if (ent.flash > 0) {
      ent.flash = Math.max(0, ent.flash - dt);
      /* 整個窗口都用元素色染（等同 DOM 版 vfx-hit-<elem>），結束復原 */
      if (ent.flash > 0) setBodyTint(ent, ent.flashTint || 0xff8888, true);
      else setBodyTint(ent, 0xffffff, false);
    }
    if (ent.jolt > 0) ent.jolt = Math.max(0, ent.jolt - dt);
    /* 受擊縮放彈跳：作用在 root（含血條一起彈），快去快回 */
    if (ent.pop > 0 && ent.root && !ent.root.destroyed) {
      ent.pop = Math.max(0, ent.pop - dt);
      var pk = 1 - ent.pop / (ent.popDur || 0.15);
      ent.root.scale.set(1 + Math.sin(pk * Math.PI) * 0.13);
      if (ent.pop <= 0) ent.root.scale.set(1);
    }
  }
  function setBodyTint(ent, color, boost) {
    var b = ent.body;
    if (!b || b.destroyed) return;
    if (ent.dead) return;                     // 玩家倒地保持灰色
    b.tint = color;
    b.alpha = boost ? 0.95 : 1;
  }

  /* ============ 佈景 ============ */
  function buildScene() {
    var app = S.app;
    /* 三層結構（鏡頭跟隨角色）：
         bg     螢幕座標。地板用 TilingSprite 鋪滿畫布，tilePosition 反向跟著鏡頭捲動，
                看起來就是釘在世界上的地板；暗角也在這層。
         world  世界座標。實體、特效、飄字都放這裡，整層依鏡頭平移
                （所以角色永遠在畫面中央，是鏡頭跟著他，不是他被釘在中間）。
         overlay 螢幕座標。BOSS 血條、空場提示、暫停遮罩。 */
    var bg = new PIXI.Container();
    var ground = new PIXI.TilingSprite({ texture: groundFallbackTexture(), width: S.W, height: S.H });
    bg.addChild(ground);
    S.groundTile = ground;
    loadGroundTexture(null);

    /* 暗角 */
    var vig = new PIXI.Sprite(vignetteTexture());
    vig.width = S.W; vig.height = S.H;
    bg.addChild(vig);
    S.vignette = vig;

    var world = new PIXI.Container();
    var zone = new PIXI.Container();
    var entity = new PIXI.Container();
    entity.sortableChildren = true;
    var fx = new PIXI.Container();
    var floatLayer = new PIXI.Container();
    var overlay = new PIXI.Container();
    world.addChild(zone); world.addChild(entity); world.addChild(fx); world.addChild(floatLayer);
    app.stage.addChild(bg);
    app.stage.addChild(world);
    app.stage.addChild(overlay);
    S.bgLayer = bg;

    /* 空場提示 */
    var emptyText = new PIXI.Text({
      text: '🔍 搜索敵人中…',
      style: { fontFamily: 'sans-serif', fontSize: 15, fill: '#8b93a3', stroke: { color: '#000', width: 3 } }
    });
    emptyText.anchor.set(0.5);
    emptyText.visible = false;
    overlay.addChild(emptyText);
    S.emptyText = emptyText;

    /* 暫停遮罩 */
    var veil = new PIXI.Container();
    var veilBg = new PIXI.Graphics();
    veil.addChild(veilBg);
    var veilText = new PIXI.Text({
      text: '⏸ 戰鬥已暫停',
      style: { fontFamily: 'sans-serif', fontSize: 22, fontWeight: 'bold', fill: '#e8ecf4', stroke: { color: '#000', width: 4 } }
    });
    veilText.anchor.set(0.5);
    veil.addChild(veilText);
    veil.visible = false;
    overlay.addChild(veil);
    S.pauseVeil = { root: veil, bg: veilBg, text: veilText };

    S.layers = { world: world, zone: zone, entity: entity, fx: fx, float: floatLayer, overlay: overlay };
    layoutScene();
  }
  /* 暗角：用一張放射漸層貼圖拉伸覆蓋畫布。
     原本是層層描邊，換成有紋理的地板後那些邊會變成一塊生硬的暗色方框。 */
  var _vignetteTex = null;
  function vignetteTexture() {
    if (_vignetteTex) return _vignetteTex;
    var c = document.createElement('canvas');
    c.width = c.height = 256;
    var g = c.getContext('2d');
    var grad = g.createRadialGradient(128, 128, 40, 128, 128, 150);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.62, 'rgba(0,0,0,0.10)');
    grad.addColorStop(1, 'rgba(0,0,0,0.55)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    _vignetteTex = PIXI.Texture.from(c);
    return _vignetteTex;
  }
  function layoutScene() {
    if (!S.layers) return;
    /* 地板鋪滿畫布再多一格，鏡頭移動時邊緣不會露出底色 */
    if (S.groundTile) { S.groundTile.width = S.W + 256; S.groundTile.height = S.H + 256; S.groundTile.x = -128; S.groundTile.y = -128; }
    if (S.vignette) { S.vignette.width = S.W; S.vignette.height = S.H; }
    if (S.emptyText) { S.emptyText.x = S.W * 0.62; S.emptyText.y = S.H * 0.5; }
    if (S.pauseVeil) {
      S.pauseVeil.bg.clear();
      S.pauseVeil.bg.rect(0, 0, S.W, S.H).fill({ color: 0x000000, alpha: 0.45 });
      S.pauseVeil.text.x = S.W / 2; S.pauseVeil.text.y = S.H / 2;
    }
    if (S.bossBar) { S.bossBar.root.x = S.W / 2; }
    /* 槽位每幀由 tickWorld 依玩家位置重算，這裡不需要再覆寫實體座標 */
  }

  /* ============ 尺寸與解析度 ============ */
  function uiShellScale() {
    var stage = document.getElementById('ui-stage');
    if (!stage) return 1;
    var v = parseFloat(getComputedStyle(stage).getPropertyValue('--ui-scale'));
    return (isFinite(v) && v > 0) ? v : 1;
  }
  function resize() {
    if (!S.app || !S.host) return;
    var w = S.host.clientWidth, h = S.host.clientHeight;
    if (w < 40 || h < 40) return;
    if (w === S.W && h === S.H && S._lastRes === currentResolution()) return;
    S.W = w; S.H = h;
    S._lastRes = currentResolution();
    try {
      S.app.renderer.resolution = S._lastRes;
    } catch (e) { /* 某些環境不允許動 resolution，維持初始值即可 */ }
    S.app.renderer.resize(w, h);
    layoutScene();
  }
  function currentResolution() {
    var dpr = (typeof devicePixelRatio === 'number' && devicePixelRatio > 0) ? devicePixelRatio : 1;
    return Math.max(1, Math.min(2.5, dpr * uiShellScale()));
  }

  /* ============ Bridge 訂閱 ============ */
  function subscribe() {
    if (typeof WorkerBridge === 'undefined') return;
    WorkerBridge.on(MSG_OUT.TICK, function (msg) {
      var view = msg && msg.view;
      if (!view) return;
      S.towerActive = !!view.towerActive;
      /* 玩家血魔條的資料源：高頻視圖就有 hp/hpMax/mp/mpMax/shield，不必等面板 */
      S.vitals = {
        hp: view.hp, hpMax: view.hpMax, mp: view.mp, mpMax: view.mpMax, shield: view.shield
      };
      var paused = !!view.paused;
      if (paused !== S.paused) {
        S.paused = paused;
        if (S.pauseVeil) S.pauseVeil.root.visible = paused;
      }
    });
    WorkerBridge.on(MSG_OUT.PANEL, function (msg) {
      if (msg && msg.name === 'battle') syncBattle(msg.data);
    });
    /* 分頁切到背景：rAF 停擺，這時候還活著的特效會整批凍在畫面上，
       回到前景時就是一堆殘留的小圖示與圈點。乾脆直接清掉（與 DOM 版
       handleVisibilityChange 呼叫 vfxSetEnabled(false) 的處置一致）。 */
    document.addEventListener('visibilitychange', function () {
      if (documentHidden()) clearAllFx();
    });

    WorkerBridge.on('workerRestarting', function () {
      /* Worker 重啟＝所有舊身分作廢：FIELD_ENEMY_FLOAT_SEQ 是 Worker 內全域，
         重啟後從 mv-float-0 重新發號，舊實體若留著會被新怪的同名 id 誤認成
         「同一隻」而只更新血量、不換外觀（BOSS 大血條也會掛錯對象）。
         全部清掉，等新 Worker 的第一張 battle 面板重建。 */
      clearAllFx();
      for (var j = 0; j < S.floats.length; j++) killFx(S.floats[j]);
      S.floats.length = 0;
      S.floatMerge = {};
      S.lastPos = {};
      for (var id in S.entities) {
        if (Object.prototype.hasOwnProperty.call(S.entities, id)) destroyEntity(id);
      }
      if (S.bossBar) { S.bossBar.root.destroy({ children: true }); S.bossBar = null; }
    });
  }

  /* ============ 對外介面 ============ */
  function active() { return S.ready && !S.failed; }
  function wantsFloat(elId) {
    return active() && (elId === 'pv-float' || /^mv-float-\d+$/.test(elId || ''));
  }
  function wantsVfx(spec) {
    if (!active() || !spec) return false;
    var targets = spec.targets;
    if (Array.isArray(targets)) {
      for (var i = 0; i < targets.length; i++) {
        var id = targets[i] || '';
        if (id === 'tb-float' || id === 'tp-float') return false;   // 高塔 → DOM 路徑
      }
    }
    return true;
  }

  function init(host) {
    if (S.initStarted) return Promise.resolve(active());
    S.initStarted = true;
    if (disabledByQuery() || typeof PIXI === 'undefined' || !host) {
      S.failed = true;
      return Promise.resolve(false);
    }
    S.host = host;
    var app = new PIXI.Application();
    return app.init({
      backgroundAlpha: 0,
      antialias: true,
      resolution: currentResolution(),
      autoDensity: true,
      width: Math.max(64, host.clientWidth || 640),
      height: Math.max(64, host.clientHeight || 480),
      preference: 'webgl'
    }).then(function () {
      return Promise.all([
        loadSheet('player', 'images/sprites/player'),
        loadSheet('boss', 'images/sprites/boss_generic')
      ]);
    }).then(function () {
      S.app = app;
      app.canvas.className = 'battle-canvas';
      host.insertBefore(app.canvas, host.firstChild || null);
      S.W = Math.max(64, host.clientWidth || 640);
      S.H = Math.max(64, host.clientHeight || 480);
      buildScene();
      makePlayer();
      subscribe();
      app.ticker.add(tickWorld);
      if (typeof ResizeObserver === 'function') {
        S.resizeObs = new ResizeObserver(function () { resize(); });
        S.resizeObs.observe(host);
      }
      window.addEventListener('resize', resize, { passive: true });
      S.watchdogTimer = setInterval(fxWatchdog, FX_WATCHDOG_MS);
      S.ready = true;
      /* 開機時 battle 面板可能已經在手上（bridge 比渲染器先跑），先同步一次 */
      if (typeof peekUiPanelData === 'function') {
        var panel = peekUiPanelData('battle');
        if (panel) syncBattle(panel);
      }
      console.info('[battle-renderer] PixiJS 戰鬥渲染器已啟動（' +
        app.renderer.name + '，' + S.W + '×' + S.H + '）。網址加 ?canvas=0 可退回 DOM 戰鬥畫面。');
      return true;
    }).catch(function (err) {
      console.warn('[battle-renderer] 初始化失敗，退回 DOM 戰鬥畫面：', err && err.message ? err.message : err);
      S.failed = true;
      try { if (app && app.destroy) app.destroy(true, { children: true }); } catch (e) {}
      return false;
    });
  }

  function status() {
    return {
      ready: S.ready, failed: S.failed,
      size: S.W + 'x' + S.H,
      entities: Object.keys(S.entities).length,
      fx: S.fx.length, floats: S.floats.length,
      paused: S.paused, zone: S.zoneKey
    };
  }

  return {
    init: init,
    active: active,
    wantsFloat: wantsFloat,
    wantsVfx: wantsVfx,
    onFloat: onFloat,
    onVfx: onVfx,
    syncBattle: syncBattle,
    status: status,
    /* 測試／除錯用：取 Pixi Application（headless 驗證時手動推 ticker、抽畫面）
       與內部狀態快照。正式流程不得依賴。 */
    _app: function () { return S.app; },
    _debug: function () {
      var p = S.player;
      return {
        player: p ? { x: Math.round(p.wx), y: Math.round(p.wy), walking: !!p.walking, facing: p.facing, anim: p.curAnim } : null,
        home: playerPos(),
        entities: Object.keys(S.entities).map(function (id) {
          var e = S.entities[id];
          return { id: id, x: Math.round(e.wx), y: Math.round(e.wy), state: e.state, lunge: +(e.lunge || 0).toFixed(2), magic: !!(e.data && e.data.magic) };
        })
      };
    }
  };
})();
