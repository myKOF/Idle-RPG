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
    light:     { c1: '#ffe47a', c2: '#fffef4', glow: '#fff3a3' },
    dark:      { c1: '#6f2da8', c2: '#1a0c2e', glow: '#913dcc' },
    fire:      { c1: '#e63924', c2: '#ffd447', glow: '#ff6a2a' },
    ice:       { c1: '#4da6ff', c2: '#f2fbff', glow: '#79d8ff' },
    lightning: { c1: '#f2b705', c2: '#fff8b0', glow: '#ffd23f' },
    earth:     { c1: '#ad7444', c2: '#5b3a27', glow: '#c48a55' },
    poison:    { c1: '#4caf2b', c2: '#d8ff8a', glow: '#76d83b' }
  };
  function themeOf(spec) {
    var table = (typeof VFX_ELEM_THEME !== 'undefined' && VFX_ELEM_THEME) || FALLBACK_THEME;
    if (spec && (spec.variant === 'bleed' || spec.variant === 'bleed-tick')) {
      return { c1: '#d92846', c2: '#ffd0d8', glow: '#ff4962' };
    }
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
    playerShieldMax: 0,       // 本次護盾條的分母（由 battle panel 的 shieldMax 提供）
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
    vignette: null,
    deathFog: null,
    deathFogCanvas: null,
    deathFogTex: null,
    fireFlareTex: null,          // Phaser 範例 flares.png 的 white frame（火球／殞石共用）
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
    return { x: area.x - r, y: area.y - r, w: r * 2, h: r * 2, r: r };
  }

  /* 範圍矩形由模擬層的圓形半徑換來；特效必須沿用同一個半徑，不能再套
     另一組固定縮放值，否則 4*4 的傷害範圍與畫面震波會對不起來。 */
  function rectRadius(rect) {
    if (!rect) return 0;
    var r = Number(rect.r);
    if (isFinite(r) && r > 0) return r;
    var w = Math.abs(Number(rect.w));
    var h = Math.abs(Number(rect.h));
    return isFinite(w) && isFinite(h) ? Math.min(w, h) * 0.5 : 0;
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

  /* ---- 位置內插緩衝 ----
     模擬層的座標是 5Hz 的離散取樣，畫面要 60fps 連續播放，中間必須自己補。

     一開始用的是「外推」：估出速度，兩包之間自己往前走，再柔性修正回權威座標。
     實測發現行不通——面板的到達間隔並不穩定（量到 200／300ms 交替），
     而渲染幀時間也會抖，於是「補了多少」與「該補多少」永遠對不齊，
     修正項每包都在追趕或回拉，畫面上就是移動忽快忽慢。

     改用內插緩衝（遊戲連線同步的標準做法）：畫面固定播放 POS_BUFFER_MS 之前
     的狀態，在兩個真實取樣之間線性內插。位置因此是「當下時刻的純函數」——
     掉幀、封包早到晚到都不影響播放速度，速度完全等於模擬層的速度。
     代價是畫面比模擬層晚 POS_BUFFER_MS，但敵人、我方、鏡頭一起延遲，
     而且這是自動戰鬥、玩家不用瞄準，看不出來。

     緩衝長度要蓋得住最大的到達間隔（實測 300ms），否則會播到沒有資料的地方。 */
  var POS_BUFFER_MS = 240;
  var POS_MAX_EXTRAP_MS = 240;   // 資料斷了才短暫外推，避免整個畫面凍住
  var POS_KEEP = 16;             // 每個實體保留幾個取樣（5Hz × 16 ≈ 3 秒）

  function posTrack(ent, x, y) {
    if (!ent.samples) ent.samples = [];
    var t = nowMs();
    var last = ent.samples[ent.samples.length - 1];
    if (last && t - last.t < 1) { last.x = x; last.y = y; return; }   // 同一毫秒內連續兩包
    ent.samples.push({ t: t, x: x, y: y });
    while (ent.samples.length > POS_KEEP) ent.samples.shift();
  }

  /* 取 renderT 這一刻該畫在哪。夾在兩個取樣之間就內插；
     比最舊的還舊（剛生出來）就用最舊的；比最新的還新（資料斷了）就短暫外推。 */
  function posSolve(ent, renderT) {
    var sm = ent.samples;
    if (!sm || !sm.length) return { x: ent.wx, y: ent.wy };
    if (sm.length === 1 || renderT <= sm[0].t) return { x: sm[0].x, y: sm[0].y };
    var newest = sm[sm.length - 1];
    if (renderT >= newest.t) {
      var prev = sm[sm.length - 2];
      var span = newest.t - prev.t;
      var over = Math.min(renderT - newest.t, POS_MAX_EXTRAP_MS);
      if (span <= 0) return { x: newest.x, y: newest.y };
      var k = over / span;
      return { x: newest.x + (newest.x - prev.x) * k, y: newest.y + (newest.y - prev.y) * k };
    }
    for (var i = sm.length - 1; i > 0; i--) {
      var b = sm[i], a = sm[i - 1];
      if (renderT >= a.t && renderT <= b.t) {
        var f = (b.t - a.t) > 0 ? (renderT - a.t) / (b.t - a.t) : 1;
        return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
      }
    }
    return { x: newest.x, y: newest.y };
  }

  /* 目前這一幀要播放的時刻。 */
  function renderClock() { return nowMs() - POS_BUFFER_MS; }

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

  /* 讀取 Phaser 範例使用的 flares.png，裁出 atlas 中名為 white 的 128×128 frame。
     範例的「火焰」不是單一素材，而是這張柔光粒子被連續發射、縮小、染色後的
     疊影；Canvas 版也沿用同一張圖，避免 DOM 與 Pixi 的火球輪廓再次分家。 */
  function loadFireFlare() {
    return PIXI.Assets.load('images/flares.png').then(function (tex) {
      tex.source.scaleMode = 'linear';
      S.fireFlareTex = new PIXI.Texture({
        source: tex.source,
        frame: new PIXI.Rectangle(392, 2, 128, 128)
      });
    });
  }

  function flareSprite(theme, x, y, scaleX, scaleY, tint, alpha, node) {
    var sp = new PIXI.Sprite(S.fireFlareTex || glowTexture());
    sp.anchor.set(0.5);
    sp.x = x;
    sp.y = y;
    sp.scale.set(scaleX, scaleY);
    sp.tint = cssColorToInt(tint, 0xffffff);
    sp.alpha = alpha;
    sp.blendMode = 'add';
    node.addChild(sp);
    return sp;
  }

  /* Phaser emitter 的 Canvas 移植：lifespan 2400、scale 0.70→0、speed 100、
     advance 2000，粒子顏色沿四色色票以 quad.out 方式插值；局部方向是飛行反方向
     ±10°，等價於範例向上 -100°～-80° 發射後再旋轉到投射物軸線。 */
  var PIXI_FLARE_COLORS = [0xfacc22, 0xf89800, 0xf83600, 0x9f0404];
  function flameColorIntAt(progress) {
    var q = Math.max(0, Math.min(1, progress));
    q = 1 - (1 - q) * (1 - q);
    var pos = q * (PIXI_FLARE_COLORS.length - 1);
    var idx = Math.min(PIXI_FLARE_COLORS.length - 2, Math.floor(pos));
    var local = pos - idx;
    var a = PIXI_FLARE_COLORS[idx], b = PIXI_FLARE_COLORS[idx + 1];
    var ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
    var br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
    return (Math.round(ar + (br - ar) * local) << 16) |
      (Math.round(ag + (bg - ag) * local) << 8) |
      Math.round(ab + (bb - ab) * local);
  }

  function flameProjectile(theme, small, sizeScale) {
    var node = new PIXI.Container();
    var size = (typeof sizeScale === 'number' ? sizeScale : 1) * (small ? 0.58 : 1);
    var count = REDUCED_MOTION ? (small ? 8 : 14) : (small ? 14 : 26);
    var interval = 2 / count;
    var particles = [];
    var accumulator = 0;

    function spawn(age) {
      var sp = flareSprite(theme, 0, 0, 0.70 * size, 0.70 * size, 0xfacc22, 1, node);
      sp._age = age;
      sp._angle = Math.PI + (Math.random() * 20 - 10) * Math.PI / 180;
      sp._startScale = 0.70 * size;
      particles.push(sp);
    }

    /* Phaser advance:2000：先把過去兩秒已發射的粒子補進畫面。 */
    for (var i = 0; i < count; i++) spawn((i + 0.5) * interval);
    node._flameStop = false;
    node._flameUpdate = function (dt) {
      var safeDt = Math.max(0, Math.min(0.08, dt));
      if (!node._flameStop) {
        accumulator += safeDt;
        while (accumulator >= interval) {
          accumulator -= interval;
          spawn(0);
        }
      }
      for (var pi = particles.length - 1; pi >= 0; pi--) {
        var p = particles[pi];
        p._age += safeDt * (node._flameStop ? 2.5 : 1);
        if (p._age >= 2.4) {
          if (p.parent) node.removeChild(p);
          p.destroy();
          particles.splice(pi, 1);
          continue;
        }
        var life = p._age / 2.4;
        var distance = 100 * p._age;
        var scale = p._startScale * Math.cos(life * Math.PI * 0.5);
        p.x = Math.cos(p._angle) * distance;
        p.y = Math.sin(p._angle) * distance;
        p.scale.set(scale, scale);
        p.tint = flameColorIntAt(life);
        p.alpha = Math.max(0, (1 - life) * (node._flameStop ? 0.7 : 1));
      }
    };
    return node;
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
      wx: 0, wy: 0,                   // 畫面上的世界座標（內插後的結果）
      samples: null,                  // 模擬層座標的取樣緩衝（見 posTrack/posSolve）
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
    posTrack(ent, sp.x, sp.y);
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

  var BOSS_BAR_Y = 68; // 避開頂部任務快捷列（y: 8~42），讓 BOSS 標籤與血條完整顯示

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
    c.x = S.W / 2; c.y = BOSS_BAR_Y;
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
    vitals.y = 8;
    S.layers.playerHud.addChild(vitals);
    var hpText = new PIXI.Text({
      text: '',
      style: {
        fontFamily: 'sans-serif', fontSize: 9, fontWeight: 'bold',
        fill: '#ffffff', stroke: { color: '#000000', width: 2 }
      }
    });
    hpText.anchor.set(0.5, 0.5);
    hpText.y = 8 + 5;
    S.layers.playerHud.addChild(hpText);
    var mpText = new PIXI.Text({
      text: '',
      style: {
        fontFamily: 'sans-serif', fontSize: 8, fontWeight: 'bold',
        fill: '#dbeafe', stroke: { color: '#000000', width: 2 }
      }
    });
    mpText.anchor.set(0.5, 0.5);
    mpText.y = 8 + 16;
    S.layers.playerHud.addChild(mpText);

    /* 復活倒數：技能與狀態列都收進彈出面板後，倒地資訊只剩畫面上這一條 */
    var reviveText = new PIXI.Text({
      text: '',
      style: {
        fontFamily: 'sans-serif', fontSize: 24, fontWeight: 'bold',
        fill: '#ff9b9b', stroke: { color: '#000000', width: 4 }
      }
    });
    reviveText.anchor.set(0.5, 1);
    reviveText.y = -104;   // 顯示在角色頭頂上方
    reviveText.visible = false;
    /* 倒數是 HUD，不放進會旋轉的角色 root，也讓死亡迷霧不會蓋掉文字。 */
    S.layers.overlay.addChild(reviveText);

    root.x = 0; root.y = 0;
    root.zIndex = 0;
    S.layers.entity.addChild(root);
    S.player = {
      id: 'pv-float', root: root, body: body, bodyWrap: bodyWrap,
      vitals: vitals, hpText: hpText, mpText: mpText, reviveText: reviveText,
      hud: S.layers.playerHud,
      sheetName: 'player', curAnim: 'idle', baseAnim: 'idle',
      hitHeight: 70, walking: false, dead: false, stillFor: 99, fallK: 0,
      flash: 0, jolt: 0, lunge: 0, facing: 1,
      /* 世界座標。samples 是模擬層座標的取樣緩衝，wx/wy 是內插後畫出來的位置；
         鏡頭對準 wx/wy，所以角色永遠在畫面正中央。 */
      wx: 0, wy: 0, samples: null,
      vitalsShown: '', deathFogK: 0, deathFogDuration: 1, deathFogDrawnK: -1
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
    /* 護盾可能大於最大生命；用 shieldMax 才能讓 200% → 100% 的護盾也能
       從滿格逐步縮短，而不是被 hpMax 當分母鎖在 100%。 */
    var shieldMax = S.playerShieldMax > 0 ? S.playerShieldMax : Math.max(0, v.shield || 0);
    var sig = Math.round(hp) + '/' + Math.round(hpMax) + '|' + Math.round(mp) + '/' +
      Math.round(mpMax) + '|' + Math.round(v.shield || 0) + '/' + Math.round(shieldMax);
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
      var sp = Math.max(0.05, Math.min(1, sh / Math.max(1, shieldMax)));
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
    var panelPlayer = field.player;
    if (panelPlayer && typeof panelPlayer.shieldMax === 'number' && isFinite(panelPlayer.shieldMax)) {
      S.playerShieldMax = Math.max(0, panelPlayer.shieldMax);
    }

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
        /* 模擬層每個 tick 都在移動敵人，但面板 5Hz 才送一次：
           把座標存進內插緩衝，由 tickWorld 依播放時刻取出中間值（見 posSolve）。 */
        if (d.pos && isFinite(d.pos.x)) posTrack(ent, d.pos.x, d.pos.y);
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
      /* 復活倒數住在 FIELD 上（js/combat.js：FIELD.reviveCd = REVIVE_DELAY），
         不在玩家實體上。舊版讀 field.player.reviveCd，那個欄位根本不存在，
         於是 dead 永遠是 false——倒地動作與倒數都不會出現。 */
      var reviveLeft = Number(field.reviveCd) || 0;
      var dead = reviveLeft > 0;
      if (dead !== p.dead) {
        /* 倒地與起身都要有過程：瞬間翻 90 度看起來像穿模，不像被打倒。
           實際的角度由 tickWorld 逐幀補間（見 p.fallK）。 */
        p.dead = dead;
        p.deathFogK = 0;
        p.deathFogDuration = Math.max(1, reviveLeft);
        updateDeathFog(p.deathFogK);
        if (S.deathFog) S.deathFog.visible = dead;
        if (S.vignette) S.vignette.visible = !dead;
        if (dead) {
          p.lunge = 0;
          playAnim(p, 'idle');
        } else {
          playAnim(p, 'idle');
        }
      }
      /* 倒地倒數：狀態列收進彈出面板後，畫面上只剩這一條告訴玩家發生什麼事。
         面板 5Hz 才來一次，這裡照快照時間扣掉已經過的秒數（同 ui.js 的做法）。 */
      if (p.reviveText) {
        p.reviveText.visible = dead;
        if (dead) {
          var left = (typeof uiCountdownRemain === 'function')
            ? uiCountdownRemain(reviveLeft, panel.gt) : reviveLeft;
          p.reviveText.text = '💀 復活倒數 ' + Math.max(1, Math.ceil(Math.max(0, left)));
        }
      }
      /* 我方座標由模擬層給（FIELD.playerPos ←→ js/battlefield.js bfPlayerPos）。
         與敵人一樣估速度做外推，把 5Hz 的取樣補成逐幀連續；
         走路／站立動畫改看「實際有沒有位移」，不再猜「場上有沒有敵人」。 */
      var pp = field.playerPos;
      if (pp && isFinite(pp.x) && isFinite(pp.y)) {
        if (!p.samples || !p.samples.length) { p.wx = pp.x; p.wy = pp.y; }   // 第一次直接就位
        posTrack(p, pp.x, pp.y);
      }
    }

    /* 空場提示只剩高塔那一句。野外的「搜索敵人中…」已移除：
       角色本來就在往前走，空場是過場而不是狀態，不需要文字說明。 */
    if (S.emptyText) {
      S.emptyText.visible = !!S.towerActive && !anyLive;
      if (S.emptyText.visible && S.emptyText.text !== '（高塔戰鬥中…）') S.emptyText.text = '（高塔戰鬥中…）';
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
  function projectileCore(spec, theme) {
    var core = new PIXI.Graphics();
    var elem = spec && spec.elem;
    if (spec && (spec.variant === 'knife' || spec.variant === 'knife-bounce')) {
      core.moveTo(-14, 0).lineTo(-4, -5).lineTo(14, 0).lineTo(-4, 5).closePath()
        .fill(theme.c1)
        .stroke({ color: theme.c2, width: 2, alpha: 0.95 });
      return core;
    }
    if (elem === 'lightning') {
      /* 雷電不是圓球：用金黃色折線＋白色芯線，與 DOM 版的雷紋形狀一致。 */
      core.moveTo(-13, -5).lineTo(-5, 4).lineTo(1, -4).lineTo(8, 5).lineTo(13, -2)
        .stroke({ color: theme.c1, width: 5, alpha: 0.95, cap: 'round', join: 'round' });
      core.moveTo(-13, -5).lineTo(-5, 4).lineTo(1, -4).lineTo(8, 5).lineTo(13, -2)
        .stroke({ color: theme.c2, width: 1.8, alpha: 1, cap: 'round', join: 'round' });
      return core;
    }
    if (elem === 'ice') {
      /* 冰晶：四角菱形，而不是一般圓形彈體。 */
      core.poly([-9, 0, 0, -11, 9, 0, 0, 11]).fill(theme.c1)
        .stroke({ color: theme.c2, width: 2, alpha: 0.95 });
      return core;
    }
    if (elem === 'earth') {
      /* 大地：土色方塊，內縮一層亮面增加立體感。 */
      core.rect(-8, -8, 16, 16).fill(theme.c1)
        .stroke({ color: theme.c2, width: 2, alpha: 0.9 });
      core.rect(-4, -5, 7, 6).fill({ color: theme.c2, alpha: 0.55 });
      return core;
    }
    if (elem === 'poison') {
      /* 毒液：下垂液滴輪廓，核心仍保留亮綠高光。 */
      core.poly([-2, -9, 7, -1, 4, 7, -3, 8, -8, 1]).fill(theme.c1)
        .stroke({ color: theme.c2, width: 1.5, alpha: 0.9 });
      core.circle(-2, -2, 2.5).fill(theme.c2);
      return core;
    }
    /* 火球術核心放大到原本約兩倍；一般元素投射物維持原尺寸。 */
    var r = spec.variant === 'meteor' ? 10 :
      (spec.variant === 'fireball' ? 13 : (spec.cat === 'basic' ? 5 : 6.5));
    core.circle(0, 0, r).fill(theme.c1);
    core.circle(0, 0, r * 0.55).fill(theme.c2);
    return core;
  }

  function projectileSpeedMultiplier() {
    return (typeof VFX_PROJECTILE_SPEED_MULTIPLIER === 'number' && VFX_PROJECTILE_SPEED_MULTIPLIER > 0)
      ? VFX_PROJECTILE_SPEED_MULTIPLIER : 0.75;
  }

  function projectileTravelMs(travelMs, fallbackMs) {
    if (travelMs > 0) return travelMs;
    return (fallbackMs > 0 ? fallbackMs : 300) / projectileSpeedMultiplier();
  }

  function spawnProjectile(targetId, travelMs, spec, onArrive, fromOverride) {
    var theme = themeOf(spec);
    var from = fromOverride || playerMuzzle();
    var node = new PIXI.Container();
    var core;
    var glyphOnly = spec.glyph && (spec.variant === 'glyph' ||
      spec.variant === 'knife' || spec.variant === 'knife-bounce' ||
      (!spec.elem && (spec.cat === 'special' || spec.cat === 'potential' || spec.cat === 'fusion')));
    if (glyphOnly) {
      core = new PIXI.Text({ text: spec.glyph, style: { fontSize: 20 } });
      core.anchor.set(0.5);
    } else if (spec.variant === 'fireball') {
      /* 火球不再用圓形 Graphics：改用 Phaser white flare emitter，尺寸為 65%。 */
      core = flameProjectile(theme, false, 0.65);
    } else {
      core = projectileCore(spec, theme);
    }
    if (spec.variant !== 'fireball') {
      var glow = new PIXI.Sprite(glowTexture());
      glow.anchor.set(0.5);
      glow.tint = parseInt(String(theme.glow).replace('#', '0x')) || 0xffffff;
      glow.alpha = 0.8;
      glow.scale.set(0.9);
      glow.blendMode = 'add';
      node.addChild(glow);
    }
    node.addChild(core);
    node.x = from.x; node.y = from.y;
    S.layers.fx.addChild(node);

    var dur = Math.max(60, projectileTravelMs(travelMs, spec.dur ? spec.dur * 1000 : 300)) / 1000;
    var t = 0, trailAcc = 0, arrived = false;
    addFx({
      node: node,
      update: function (dt) {
        t += dt;
        var k = Math.min(1, t / dur);
        var to = posOf(targetId);
        node.x = lerp(from.x, to.x, k);
        /* 火球術依使用者要求走真正直線；其他投射物保留原本的微弧線。 */
        node.y = lerp(from.y, to.y, k) -
          (spec && spec.variant === 'fireball' ? 0 : Math.sin(k * Math.PI) * 18);
        node.rotation = Math.atan2(to.y - from.y, to.x - from.x);
        if (core && core._flameUpdate) core._flameUpdate(dt);
        trailAcc += dt;
        if (spec.variant !== 'fireball' && trailAcc > 0.03 && !REDUCED_MOTION) {
          trailAcc = 0;
          spawnTrailDot(node.x, node.y, theme);
        }
        if (k >= 1) {
          if (!arrived) {
            arrived = true;
            if (onArrive) onArrive(posOf(targetId));
          }
          if (spec && spec.variant === 'fireball') {
            if (core) core._flameStop = true;
            return t < dur + 0.4;
          }
          return false;
        }
        return true;
      }
    }, 1, dur * 1000 + 600);
  }
  /* 奧術彈幕：六顆光球先向玩家左右後方散開，過彎後以加速度追向目標。 */
  function spawnBarrageMissile(targetId, spec, side, lane, delaySec, travelMs) {
    var theme = themeOf(spec);
    var origin = playerMuzzle();
    var rear = (S.player && S.player.facing < 0) ? 1 : -1;
    var start = {
      x: origin.x + rear * 14 + side * (10 + lane * 8),
      y: origin.y + 8 + lane * 7
    };
    var turn = {
      x: start.x + rear * (34 + lane * 10) + side * (48 + lane * 18),
      y: start.y - 16 - lane * 8
    };
    var node = new PIXI.Container();
    var core = projectileCore(spec, theme);
    var glow = new PIXI.Sprite(glowTexture());
    glow.anchor.set(0.5);
    glow.tint = parseInt(String(theme.glow).replace('#', '0x')) || 0xffffff;
    glow.alpha = 0.75;
    glow.scale.set(0.72);
    glow.blendMode = 'add';
    node.addChild(glow); node.addChild(core);
    node.x = start.x; node.y = start.y;
    S.layers.fx.addChild(node);

    var dur = Math.max(0.42 / projectileSpeedMultiplier(),
      projectileTravelMs(travelMs, spec.dur ? spec.dur * 1000 : 360) / 1000);
    var t = -(delaySec || 0), trailAcc = 0;
    addFx({
      node: node,
      update: function (dt) {
        t += dt;
        if (t < 0) { node.visible = false; return true; }
        node.visible = true;
        var k = Math.min(1, t / dur);
        var x, y, q;
        if (k < 0.38) {
          q = k / 0.38;
          q = q * q * (3 - 2 * q);
          x = lerp(start.x, turn.x, q);
          y = lerp(start.y, turn.y, q);
        } else {
          q = (k - 0.38) / 0.62;
          q = q * q;
          var target = posOf(targetId);
          x = lerp(turn.x, target.x, q);
          y = lerp(turn.y, target.y, q);
        }
        var targetNow = posOf(targetId);
        var aheadX = k < 0.38 ? turn.x : targetNow.x;
        var aheadY = k < 0.38 ? turn.y : targetNow.y;
        node.x = x; node.y = y;
        node.rotation = Math.atan2(aheadY - y, aheadX - x);
        trailAcc += dt;
        if (trailAcc > 0.035 && !REDUCED_MOTION) {
          trailAcc = 0;
          spawnTrailDot(x, y, theme);
        }
        if (k >= 1) {
          var hit = posOf(targetId);
          spawnImpact(hit.x, hit.y, spec, false);
          hitReact(targetId, spec.elem, false);
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
  function spawnSlash(x, y, spec, big, rotation) {
    var theme = themeOf(spec);
    var g = new PIXI.Graphics();
    g.x = x; g.y = y;
    g.rotation = typeof rotation === 'number' ? rotation : (-0.5 + Math.random());
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

  /* 新版技能直線刀光：固定 70 個系統距離單位（7 米），從玩家向目標方向貫穿。
     angleOffset 用於終極突刺的左右 30 度刀線，以及迴身斬的 180 度後斬。 */
  /* 迴旋斬的施放點大型弧斬；敵人位置只畫普通命中反應。 */
  function spawnCleaveArc(x, y, spec, rotation, delaySec) {
    var theme = themeOf(spec);
    var g = new PIXI.Graphics();
    g.x = x; g.y = y;
    g.rotation = typeof rotation === 'number' ? rotation : 0;
    S.layers.fx.addChild(g);
    var t = -(delaySec || 0), dur = Math.max(0.38, spec.dur || 0.5), R = 86;
    addFx({
      node: g,
      update: function (dt) {
        t += dt;
        g.visible = t >= 0;
        if (t < 0) return true;
        var k = Math.min(1, t / dur);
        var head = -0.92 + k * 1.95;
        var fade = k > 0.68 ? 1 - (k - 0.68) / 0.32 : 1;
        g.clear();
        g.arc(0, 0, R, head - 1.15, head, false)
          .stroke({ color: theme.c1, width: 11 * fade, alpha: 0.95 * fade, cap: 'round' });
        g.arc(0, 0, R * 0.82, head - 0.95, head, false)
          .stroke({ color: theme.c2, width: 4 * fade, alpha: fade, cap: 'round' });
        return t < dur;
      }
    }, 1);
  }

  var CLEAVE_WAVE_SPEED_RATIO = 0.3;
  function cleaveWaveDurationSec() {
    return Math.max(0.9, projectileTravelMs(0, 300) / 1000 / CLEAVE_WAVE_SPEED_RATIO);
  }
  function spawnCleaveWave(spec, angle, delaySec, length) {
    var theme = themeOf(spec);
    var from = playerMuzzle();
    var node = new PIXI.Graphics();
    node.x = from.x; node.y = from.y; node.rotation = angle;
    S.layers.fx.addChild(node);
    var dur = cleaveWaveDurationSec();
    var t = -(delaySec || 0), trailAcc = 0;
    var lineLength = Math.max(48, Number(length) || 120);
    addFx({
      node: node,
      update: function (dt) {
        t += dt;
        node.visible = t >= 0;
        if (t < 0) return true;
        var k = Math.min(1, t / dur);
        var eased = k * k * (3 - 2 * k);
        node.x = from.x + Math.cos(angle) * lineLength * eased;
        node.y = from.y + Math.sin(angle) * lineLength * eased;
        var fade = k > 0.78 ? 1 - (k - 0.78) / 0.22 : 1;
        node.alpha = fade;
        node.clear();
        node.arc(0, 0, 30, -1.12, 1.12, false)
          .stroke({ color: theme.c1, width: 10 * fade, alpha: 0.95 * fade, cap: 'round' });
        node.arc(0, 0, 22, -0.9, 0.9, false)
          .stroke({ color: theme.c2, width: 3.5 * fade, alpha: fade, cap: 'round' });
        trailAcc += dt;
        if (trailAcc > 0.035 && !REDUCED_MOTION) {
          trailAcc = 0;
          spawnTrailDot(node.x - Math.cos(angle) * 16, node.y - Math.sin(angle) * 16, theme);
        }
        return t < dur;
      }
    }, 1, dur * 1000 + 300);
  }

  function spawnThrustLine(targetId, spec, angleOffset, delaySec, length) {
    var theme = themeOf(spec);
    var from = playerMuzzle();
    var to = posOf(targetId);
    var dx = to.x - from.x, dy = to.y - from.y;
    var angle = Math.atan2(dy, dx) + (angleOffset || 0);
    var g = new PIXI.Graphics();
    g.x = from.x; g.y = from.y; g.rotation = angle;
    S.layers.fx.addChild(g);
    var t = -(delaySec || 0), dur = 0.28;
    var lineLength = Math.max(48, Number(length) || 70);
    addFx({
      node: g,
      update: function (dt) {
        t += dt;
        if (t < 0) return true;
        var k = Math.min(1, t / dur);
        var grow = k < 0.2 ? k / 0.2 : 1;
        var fade = k > 0.58 ? 1 - (k - 0.58) / 0.42 : 1;
        g.clear();
        g.moveTo(0, 0).lineTo(lineLength * grow, 0)
          .stroke({ color: theme.c1, width: 10 * fade, alpha: 0.9 * fade, cap: 'round' });
        g.moveTo(2, 0).lineTo(lineLength * grow, 0)
          .stroke({ color: theme.c2, width: 3.5 * fade, alpha: fade, cap: 'round' });
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

  /* 閃電折線（連鎖/天雷/巨型紫雷） */
  function boltPath(g, x0, y0, x1, y1, theme, alpha, isMega, isPurple) {
    var seg = isMega || isPurple ? 8 : 6;
    var pts = [[x0, y0]];
    var dx = x1 - x0, dy = y1 - y0;
    var dist = Math.sqrt(dx * dx + dy * dy) || 1;
    var nx = -dy / dist, ny = dx / dist;
    var maxJitter = Math.min(36, dist * 0.28);

    for (var i = 1; i < seg; i++) {
      var k = i / seg;
      var jitter = (Math.random() * 2 - 1) * maxJitter;
      pts.push([
        lerp(x0, x1, k) + nx * jitter,
        lerp(y0, y1, k) + ny * jitter
      ]);
    }
    pts.push([x1, y1]);

    var c1 = isPurple ? 0xc084fc : (parseInt(String(theme.c1).replace('#', '0x')) || 0xffd93d);
    var cGlow = isPurple ? 0x9333ea : (parseInt(String(theme.glow).replace('#', '0x')) || 0xffb703);
    var cCore = isPurple ? 0xfdf4ff : 0xffffff;

    var last = pts.length - 1;
    // 1. 外層光暈
    for (i = 0; i < last; i++) {
      var q = i / last;
      var outerWidth = isPurple ? (22 - 13 * q) : (isMega ? (18 - 12 * q) : (13 - 10.5 * q));
      g.moveTo(pts[i][0], pts[i][1]).lineTo(pts[i + 1][0], pts[i + 1][1])
        .stroke({ color: cGlow, width: Math.max(3, outerWidth * 1.3), alpha: alpha * 0.6, cap: 'round', join: 'round' });
    }
    // 2. 中層主色電漿
    for (i = 0; i < last; i++) {
      var q2 = i / last;
      var midWidth = isPurple ? (14 - 9 * q2) : (isMega ? (11 - 7 * q2) : (7 - 4.5 * q2));
      g.moveTo(pts[i][0], pts[i][1]).lineTo(pts[i + 1][0], pts[i + 1][1])
        .stroke({ color: c1, width: Math.max(1.8, midWidth), alpha: alpha * 0.95, cap: 'round', join: 'round' });
    }
    // 3. 內層極致白芯
    for (i = 0; i < last; i++) {
      var coreQ = i / last;
      var coreWidth = isPurple ? (5.5 - 3.2 * coreQ) : (isMega ? (4.8 - 3 * coreQ) : (3 - 2 * coreQ));
      g.moveTo(pts[i][0], pts[i][1]).lineTo(pts[i + 1][0], pts[i + 1][1])
        .stroke({ color: cCore, width: Math.max(0.8, coreWidth), alpha: alpha, cap: 'round', join: 'round' });
    }

    // 4. 分叉電弧（針對 mega 或 purple）
    if ((isMega || isPurple) && pts.length > 4) {
      var bIdx = 2;
      var sp = pts[bIdx];
      var bp1 = [sp[0] + nx * 24 + (Math.random() * 8 - 4), sp[1] + ny * 24 + 14];
      var bp2 = [bp1[0] + nx * 16, bp1[1] + 18];
      g.moveTo(sp[0], sp[1]).lineTo(bp1[0], bp1[1]).lineTo(bp2[0], bp2[1])
        .stroke({ color: c1, width: 2.2, alpha: alpha * 0.85, cap: 'round' });
    }
  }

  function resolvePos(p) {
    if (p && typeof p.x === 'number' && typeof p.y === 'number') return p;
    return posOf(p);
  }

  function spawnBolt(fromPtOrId, targetPtOrId, spec, delaySec, isMega, isPurple) {
    var theme = themeOf(spec);
    var g = new PIXI.Graphics();
    S.layers.fx.addChild(g);
    var t = -(delaySec || 0), dur = isPurple ? 0.4 : (isMega ? 0.36 : 0.32), redraws = 0;
    addFx({
      node: g,
      update: function (dt) {
        t += dt;
        if (t < 0) return true;
        var to = resolvePos(targetPtOrId);
        var from = fromPtOrId ? resolvePos(fromPtOrId) : { x: to.x + (Math.random() * 40 - 20), y: to.y - S.H * 0.65 };
        redraws += dt;
        if (redraws > 0.03 || g._empty !== false) {
          g._empty = false;
          redraws = 0;
          g.clear();
          boltPath(g, from.x, from.y, to.x, to.y, theme, Math.max(0, 1 - t / dur), !!isMega, !!isPurple);
        }
        if (t >= dur * 0.25 && !g._hit) {
          g._hit = true;
          spawnImpact(to.x, to.y, spec, !!(isMega || isPurple));
          if (typeof targetPtOrId === 'string') {
            hitReact(targetPtOrId, spec.elem || 'lightning', !!(isMega || isPurple));
          }
          if (isMega || isPurple) addShake(isPurple ? 5 : 3);
        }
        return t < dur;
      }
    }, 1);
  }

  /* 巨型紫色電雷 ＆ 紫色雷印法陣（電紋刻印） */
  function spawnPurpleThunder(targetId, spec, delaySec) {
    var purpleSpec = Object.assign({}, spec, { elem: 'lightning', variant: 'purple-thunder', color: '#c084fc' });
    var theme = { c1: '#c084fc', c2: '#fdf4ff', glow: '#9333ea' };
    var to = posOf(targetId);
    var from = { x: to.x + (Math.random() * 30 - 15), y: to.y - S.H * 0.7 };

    // 1. 巨型紫雷劈下
    spawnBolt(from, targetId, purpleSpec, delaySec, true, true);

    // 2. 紫色雷印法陣（旋轉與收縮烙印）
    var g = new PIXI.Graphics();
    g.x = to.x; g.y = to.y;
    S.layers.fx.addChild(g);
    var t = -(delaySec || 0), dur = 0.65;
    addFx({
      node: g,
      update: function (dt) {
        t += dt;
        if (t < 0) return true;
        var curTo = posOf(targetId);
        g.x = curTo.x; g.y = curTo.y;
        var k = Math.min(1, t / dur);
        var scale = k < 0.2 ? (0.8 + k / 0.2 * 0.4) : (1.2 * (1 - (k - 0.2) / 0.8 * 0.7));
        var alpha = k < 0.15 ? k / 0.15 : (1 - (k - 0.15) / 0.85);
        g.clear();
        g.rotation = t * 6;
        // 外圈雷印
        g.circle(0, 0, 28 * scale)
          .stroke({ color: 0xc084fc, width: 2, alpha: alpha * 0.9 });
        // 內圈符文四芒星
        var r = 16 * scale;
        g.moveTo(-r, 0).lineTo(r, 0).moveTo(0, -r).lineTo(0, r)
          .stroke({ color: 0xfdf4ff, width: 2.5, alpha: alpha });
        g.circle(0, 0, 6 * scale)
          .fill({ color: 0x9333ea, alpha: alpha * 0.7 });
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
    if (!rect) {
      var targetId = spec.targets && spec.targets.length ? spec.targets[0] : null;
      var target = targetId ? posOf(targetId) : null;
      rect = target && isFinite(target.x) && isFinite(target.y)
        ? { x: target.x - 96, y: target.y - 120, w: 192, h: 240 }
        : { x: S.W * 0.4, y: S.H * 0.2, w: S.W * 0.4, h: S.H * 0.5 };
    }
    var theme = themeOf(spec);
    if (spec.variant === 'meteor') {
      spawnMeteor(rect, spec);
      return;
    }
    var n = REDUCED_MOTION ? 2 : 5;
    for (var i = 0; i < n; i++) {
      (function (idx) {
        var node;
        if (spec.elem) {
          node = projectileCore(spec, theme);
          node.scale.set(0.82);
        } else {
          node = new PIXI.Text({ text: spec.glyph || '❄', style: { fontSize: 16 } });
          node.anchor.set(0.5);
        }
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
  function spawnMeteorProjectile(spec, theme, from, to, scale, dur, delaySec, onArrive) {
    var node = new PIXI.Container();
    /* 隕石只保留 Phaser white flare emitter，不再額外疊一層非範例光暈。 */
    var flame = flameProjectile(theme, scale && scale < 1, 1);
    node.addChild(flame);
    node.scale.set(scale || 1);
    node.x = from.x; node.y = from.y;
    node.rotation = Math.atan2(to.y - from.y, to.x - from.x);
    S.layers.fx.addChild(node);
    var t = -(Math.max(0, delaySec || 0)), arrived = false;
    addFx({
      node: node,
      update: function (dt) {
        t += dt;
        if (t < 0) { node.visible = false; return true; }
        node.visible = true;
        var k = Math.min(1, t / dur);
        node.x = lerp(from.x, to.x, k);
        node.y = lerp(from.y, to.y, k);
        if (flame && flame._flameUpdate) flame._flameUpdate(dt);
        if (k >= 1) {
          if (!arrived) {
            arrived = true;
            if (onArrive) onArrive(to.x, to.y);
          }
          if (flame) flame._flameStop = true;
          return t < dur + 0.45;
        }
        return true;
      }
    }, scale && scale < 1 ? 0 : 2, dur * 1000 + (delaySec || 0) * 1000 + 800);
  }

  function spawnMeteor(rect, spec) {
    var theme = themeOf(spec);
    var cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
    var run = Math.max(150, Math.min(230, rect.h + 120));
    var rise = run * Math.tan(Math.PI / 3);
    var mainFrom = { x: cx + run, y: cy - rise };
    var meteorTravel = (spec.travelMs && spec.travelMs[0]) || 500;
    /* 與 DOM vfxMeteor、技能傷害浮字相同：殞石固定慢 30%。 */
    var dur = Math.min(1.15, Math.max(0.7, meteorTravel / 1000 / 0.70));
    spawnMeteorProjectile(spec, theme, mainFrom, { x: cx, y: cy }, 1, dur, 0, function () {
      spawnImpact(cx, cy, spec, true);
      spawnFireShockwave(cx, cy, rectRadius(rect), theme);
      addShake(8);
    });
    var smallOffsets = [-0.22, -0.04, 0.16, 0.32];
    var smallTheme = { c1: '#ef4b16', c2: '#ffd166', glow: '#ff7a1a' };
    for (var si = 0; si < smallOffsets.length; si++) {
      var ratio = 0.78 + si * 0.12;
      var smallFrom = {
        x: cx + run * ratio,
        y: cy - rise * ratio + smallOffsets[si] * run
      };
      var delaySec = (36 + si * 42) / 1000;
      var smallDur = Math.max(0.18, dur - delaySec - 0.02);
      spawnMeteorProjectile(spec, smallTheme, smallFrom, { x: cx, y: cy }, 0.52, smallDur, delaySec, null);
    }
  }
  function spawnFireShockwave(cx, cy, radius, theme) {
    var g = new PIXI.Graphics();
    g.x = cx; g.y = cy;
    S.layers.fx.addChild(g);
    var t = 0, dur = 0.86;
    radius = Number(radius);
    if (!isFinite(radius) || radius <= 0) radius = 80;
    var burst = [];
    var burstCount = REDUCED_MOTION ? 9 : 18;
    for (var bi = 0; bi < burstCount; bi++) {
      burst.push({
        angle: Math.PI * 2 * (bi / burstCount) + (bi % 3) * 0.12,
        distance: radius * (0.42 + (bi % 5) * 0.075),
        size: 2 + (bi % 3) * 1.2,
        delay: (bi % 5) * 0.018
      });
    }
    addFx({
      node: g,
      update: function (dt) {
        t += dt;
        var k = t / dur;
        g.clear();
        var flashK = Math.min(1, t / 0.18);
        g.ellipse(0, 0, 11 + radius * 0.22 * flashK, 5 + radius * 0.07 * flashK)
          .fill({ color: theme.c2, alpha: 0.3 * (1 - flashK) });
        for (var ri = 0; ri < 3; ri++) {
          var rk = Math.max(0, Math.min(1, (k - ri * 0.075) / 0.925));
          if (rk <= 0) continue;
          var ringAlpha = 0.92 * (1 - rk);
          g.ellipse(0, 0, 10 + radius * rk * (0.78 + ri * 0.16),
            4 + radius * rk * (0.22 + ri * 0.05))
            .stroke({ color: ri === 0 ? theme.c2 : theme.c1,
              width: Math.max(1, 5 - rk * 4), alpha: ringAlpha });
        }
        for (var pi = 0; pi < burst.length; pi++) {
          var bp = burst[pi];
          var pk = Math.max(0, Math.min(1, (t - bp.delay) / 0.62));
          if (pk <= 0) continue;
          var px = Math.cos(bp.angle) * bp.distance * pk;
          var py = Math.sin(bp.angle) * bp.distance * pk * 0.48 + 28 * pk * pk - 10;
          g.circle(px, py, Math.max(0.5, bp.size * (1 - pk)))
            .fill({ color: pi % 2 ? theme.c1 : theme.c2, alpha: 0.95 * (1 - pk) });
        }
        return t < dur;
      }
    }, 1);
  }

  /* 我方增益／敵身詛咒 */
  function spawnAreaFlash(rect, theme) {
    if (!rect) return;
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

  /* 連續橫向穿梭折射閃電鏈（復刻截圖效果：在敵人間連續折射穿梭） */
  function spawnContinuousChainLightning(nodeList, spec) {
    if (!nodeList || nodeList.length < 2) return;
    var theme = themeOf(spec);
    var g = new PIXI.Graphics();
    S.layers.fx.addChild(g);
    var t = 0, dur = 0.42, redraws = 0;

    // 為所有彈射節點生成光圈與爆點
    nodeList.forEach(function (pos, idx) {
      setTimeout(function () {
        if (fxGate()) return;
        spawnNodeRing(pos.x, pos.y, theme);
        spawnImpact(pos.x, pos.y, spec, idx === 0);
      }, idx * 55);
    });

    addFx({
      node: g,
      update: function (dt) {
        t += dt;
        if (t < 0) return true;
        redraws += dt;
        if (redraws > 0.035 || g._empty !== false) {
          g._empty = false;
          redraws = 0;
          g.clear();
          var alpha = Math.max(0, 1 - (t / dur) * 0.85);

          // 繪製連續橫向穿梭折線
          for (var segIdx = 0; segIdx < nodeList.length - 1; segIdx++) {
            var pA = resolvePos(nodeList[segIdx]);
            var pB = resolvePos(nodeList[segIdx + 1]);
            var dx = pB.x - pA.x, dy = pB.y - pA.y;
            var dist = Math.sqrt(dx * dx + dy * dy) || 1;
            var nx = -dy / dist, ny = dx / dist;
            var maxJitter = Math.min(26, dist * 0.28);
            var segs = Math.max(4, Math.min(7, Math.round(dist / 32)));

            var pts = [[pA.x, pA.y]];
            for (var si = 1; si < segs; si++) {
              var k = si / segs;
              var jitter = (Math.random() * 2 - 1) * maxJitter;
              pts.push([
                pA.x + dx * k + nx * jitter,
                pA.y + dy * k + ny * jitter
              ]);
            }
            pts.push([pB.x, pB.y]);

            // 1. 外層厚光暈
            for (var i = 0; i < pts.length - 1; i++) {
              g.moveTo(pts[i][0], pts[i][1]).lineTo(pts[i + 1][0], pts[i + 1][1])
                .stroke({ color: 0xfffbe0, width: 14, alpha: alpha * 0.45, cap: 'round', join: 'round' });
            }
            // 2. 中層主電漿色
            for (var j = 0; j < pts.length - 1; j++) {
              g.moveTo(pts[j][0], pts[j][1]).lineTo(pts[j + 1][0], pts[j + 1][1])
                .stroke({ color: 0xffd23f, width: 6.5, alpha: alpha * 0.92, cap: 'round', join: 'round' });
            }
            // 3. 內層極致白芯
            for (var m = 0; m < pts.length - 1; m++) {
              g.moveTo(pts[m][0], pts[m][1]).lineTo(pts[m + 1][0], pts[m + 1][1])
                .stroke({ color: 0xffffff, width: 2.6, alpha: alpha, cap: 'round', join: 'round' });
            }
          }
        }
        return t < dur;
      }
    }, 1);
  }

  function spawnNodeRing(x, y, theme) {
    var g = new PIXI.Graphics();
    g.x = x; g.y = y;
    S.layers.fx.addChild(g);
    var t = 0, dur = 0.38;
    addFx({
      node: g,
      update: function (dt) {
        t += dt;
        var k = Math.min(1, t / dur);
        var r = 12 + k * 20;
        var a = (1 - k) * 0.95;
        g.clear();
        g.circle(0, 0, r).stroke({ color: 0xffffff, width: 2.4, alpha: a });
        g.circle(0, 0, r * 0.65).stroke({ color: 0xffd23f, width: 1.6, alpha: a * 0.75 });
        return t < dur;
      }
    }, 1);
  }

  function handleChainVfx(targets, spec, baseDelay, stagger) {
    if (!targets.length && !S.player) return;
    if (spec.variant === 'knife-bounce' || spec.variant === 'poison-spread') {
      for (var kb = 1; kb < targets.length; kb++) {
        (function (hopIndex) {
          var fromId = targets[hopIndex - 1];
          var toId = targets[hopIndex];
          var travel = projectileTravelMs(spec.travelMs && spec.travelMs[hopIndex], 120);
          setTimeout(function () {
            if (fxGate()) return;
            spawnProjectile(toId, travel, spec, function (pt) {
              spawnImpact(pt.x, pt.y, spec, false);
              hitReact(toId, spec.elem, false);
            }, posOf(fromId));
          }, baseDelay + (hopIndex - 1) * stagger);
        })(kb);
      }
      return;
    }

    var firstId = targets.length ? targets[0] : 'pv-float';
    var firstPos = posOf(firstId);

    // 1. 首目標劈下天頂大型天雷
    spawnBolt(null, firstId, spec, 0, true, false);

    // 2. 尋找並組成連續折射穿梭鏈（首目標 -> 另外 2 個敵人）
    var chainList = [firstId];
    for (var ti = 1; ti < targets.length && chainList.length < 3; ti++) {
      if (chainList.indexOf(targets[ti]) < 0) chainList.push(targets[ti]);
    }
    if (chainList.length < 3) {
      var entKeys = Object.keys(S.entities);
      entKeys.sort(function (a, b) {
        var pa = posOf(a), pb = posOf(b);
        var da = (pa.x - firstPos.x) * (pa.x - firstPos.x) + (pa.y - firstPos.y) * (pa.y - firstPos.y);
        var db = (pb.x - firstPos.x) * (pb.x - firstPos.x) + (pb.y - firstPos.y) * (pb.y - firstPos.y);
        return da - db;
      });
      for (var ek = 0; ek < entKeys.length && chainList.length < 3; ek++) {
        if (chainList.indexOf(entKeys[ek]) < 0) chainList.push(entKeys[ek]);
      }
    }

    // 3. 收集目標座標清單
    var chainPosList = chainList.map(function (id) { return posOf(id); });

    // 若場上只有 1 個或 2 個敵人，在周圍生成延伸折射點
    if (chainPosList.length < 3) {
      var lastP = chainPosList[chainPosList.length - 1];
      var needed = 3 - chainPosList.length;
      for (var amb = 0; amb < needed; amb++) {
        var angle = (amb === 0 ? -0.85 : 0.85) + (Math.random() * 0.4 - 0.2);
        var dist = 75 + Math.random() * 35;
        var ambP = {
          x: lastP.x + Math.cos(angle) * dist,
          y: lastP.y + Math.sin(angle) * dist + 15
        };
        chainPosList.push(ambP);
        lastP = ambP;
      }
    }

    // 4. 觸發連續折射電鏈（在目標之間高速橫向穿梭折射）
    spawnContinuousChainLightning(chainPosList, spec);
  }

  /* ============ VFX 事件分派（協議 v17 spec → Canvas 畫法） ============ */
  function onVfx(spec) {
    if (!S.ready || !spec) return;
    /* 背景分頁不畫特效（與 DOM 版 vfxSetEnabled(false) 同精神）；
       setTimeout 排進來的延遲段也會走到這裡被擋掉。 */
    if (documentHidden()) return;
    /* 事件要和畫面走同一個時鐘：位置是延後 POS_BUFFER_MS 播放的，
       特效若照原速播，就會在「敵人畫面上還沒走到」的時候先打出來——
       看起來就是隔空攻擊。延遲量與位置緩衝相同，兩者必定對齊。 */
    if (!spec._buffered) { spec._buffered = true; spec.delayMs = (spec.delayMs || 0) + POS_BUFFER_MS; }
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

    if (spec.variant === 'arcane-barrage' || (spec.glyph === '💫' && spec.cat === 'magic')) {
      targets.forEach(function (id, ti) {
        var travel = projectileTravelMs(spec.travelMs && spec.travelMs[ti], spec.dur ? spec.dur * 1000 : 420);
        for (var lane = 0; lane < 3; lane++) {
          spawnBarrageMissile(id, spec, -1, lane, (baseDelay + ti * 40 + lane * 35) / 1000, travel);
          spawnBarrageMissile(id, spec, 1, lane, (baseDelay + ti * 40 + lane * 35) / 1000, travel);
        }
      });
      return;
    }

    if (spec.fxKind === 'chain' || spec.variant === 'chain') {
      handleChainVfx(targets, spec, baseDelay, stagger);
      return;
    }

    switch (spec.fxKind) {
      case 'projectile':
        targets.forEach(function (id, ti) {
          var travel = projectileTravelMs(spec.travelMs && spec.travelMs[ti], spec.dur ? spec.dur * 1000 : 300);
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
        if (spec.variant === 'thrust-pierce' || spec.variant === 'thrust-triple' || spec.variant === 'thrust') {
          if (!targets.length) break;
          var thrustOffsets = spec.variant === 'thrust-triple'
            ? [0, -30 * Math.PI / 180, 30 * Math.PI / 180] : [0];
          for (var trc = 0; trc < count; trc++) {
            for (var tro = 0; tro < thrustOffsets.length; tro++) {
              spawnThrustLine(targets[0], spec, thrustOffsets[tro],
                (baseDelay + trc * stagger) / 1000, 70);
            }
          }
          targets.forEach(function (id, ti) {
            setTimeout(function () {
              if (fxGate()) return;
              var pt = posOf(id);
              spawnImpact(pt.x, pt.y, spec, false);
              hitReact(id, spec.elem, false);
            }, baseDelay + 100 + ti * 24);
          });
          break;
        }
        if (spec.variant === 'cleave' || spec.variant === 'cleave-shockwave' || spec.variant === 'cleave-back' || spec.variant === 'cleave-dual') {
          var drawForward = spec.variant === 'cleave-shockwave' || spec.variant === 'cleave-dual';
          var drawBack = spec.variant === 'cleave-back' || spec.variant === 'cleave-dual';
          var frontAngle = targets.length
            ? Math.atan2(posOf(targets[0]).y - playerMuzzle().y,
              posOf(targets[0]).x - playerMuzzle().x)
            : ((S.player && S.player.facing < 0) ? Math.PI : 0);
          for (var clc = 0; clc < count; clc++) {
            var clDelay = (baseDelay + clc * stagger) / 1000;
            var cleaveFrom = playerMuzzle();
            spawnCleaveArc(cleaveFrom.x, cleaveFrom.y, spec, frontAngle, clDelay);
            if (drawForward) spawnCleaveWave(spec, frontAngle, clDelay, 120);
            if (drawBack) spawnCleaveArc(cleaveFrom.x, cleaveFrom.y, spec, frontAngle + Math.PI, clDelay);
          }
          targets.forEach(function (id, ti) {
            var cleaveFromForHits = playerMuzzle();
            var targetPt = posOf(id);
            var targetDx = targetPt.x - cleaveFromForHits.x;
            var targetDy = targetPt.y - cleaveFromForHits.y;
            var targetAlong = targetDx * Math.cos(frontAngle) + targetDy * Math.sin(frontAngle);
            var waveHitDelay = drawForward
              ? Math.round(cleaveWaveDurationSec() * 1000 * Math.max(0, Math.min(1, targetAlong / 120)))
              : 90;
            for (var clHit = 0; clHit < count; clHit++) {
              (function (hitIndex, hitDelay) {
                setTimeout(function () {
                  if (fxGate()) return;
                  var pt = posOf(id);
                  spawnImpact(pt.x, pt.y, spec, false);
                  hitReact(id, spec.elem, false);
                }, baseDelay + hitIndex * stagger + hitDelay + ti * 35);
              })(clHit, waveHitDelay);
            }
          });
          break;
        }
        if (spec.variant === 'gale-slashes') {
          targets.forEach(function (id) {
            var pt = posOf(id);
            spawnBladestorm({ x: pt.x - 52, y: pt.y - 52, w: 104, h: 104 }, spec);
            hitReact(id, spec.elem, false);
          });
          break;
        }
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
        if (spec.variant === 'blood-explosion' || spec.variant === 'zero-infection') {
          targets.forEach(function (id, ti) {
            setTimeout(function () {
              if (fxGate()) return;
              var pt = posOf(id);
              spawnImpact(pt.x, pt.y, spec, true);
              hitReact(id, spec.elem, true);
            }, baseDelay + ti * 40);
          });
          break;
        }
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
        if (spec.variant === 'purple-thunder' || spec.variant === 'storm-sigil') {
          targets.forEach(function (id, ti) {
            spawnPurpleThunder(id, spec, ti * 0.08);
          });
          break;
        }
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
        handleChainVfx(targets, spec, baseDelay, stagger);
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
    if (elId === 'pv-float' || elId === 'tp-float') {
      /* 我方身上的字：**紅色是「我方被扣血」的專屬顏色**，其他一律不得用紅。
         舊版是看「有沒有 player-event 這個類別」來決定紅不紅，但吸血／吸魔／
         岩甲護盾走的是 floatText（沒有那個類別），於是回血也被塗成紅色，
         玩家看到滿畫面紅字會以為自己在狂掉血。改成看語意分類。 */
      if (cls.indexOf('skill-cast') >= 0) {
        s.fill = '#ffd43b'; s.size = 20; s.rise = 0;
        s.life = cls.indexOf('skill-cast-total') >= 0 ? 3 : 1.05;
        return s;
      }
      var isDamageToUs = cls.indexOf('mdmg') >= 0 || /^\s*(爆擊\s*)?-/.test(text);
      if (isDamageToUs) {
        s.fill = '#ff6b6b'; s.size = 16;
        if (isCrit) { s.size += 4; s.fill = '#ff3b3b'; }
        return s;
      }
      if (cls.indexOf('heal') >= 0) { s.fill = '#6dfb8f'; return s; }              // 回血：綠
      if (cls.indexOf('mp') >= 0) { s.fill = '#5fb2ff'; return s; }                // 回魔：藍
      if (cls.indexOf('shield') >= 0) { s.fill = '#8fd8ff'; s.size = 14; return s; } // 護盾：淺藍
      if (cls.indexOf('dodge') >= 0 || cls.indexOf('defend') >= 0) { s.fill = '#9aa5b1'; s.size = 13; return s; }
      if (cls.indexOf('debuff') >= 0) { s.fill = '#c58cff'; return s; }            // 中了負面：紫
      if (cls.indexOf('buff') >= 0 || cls.indexOf('attack') >= 0) { s.fill = '#ffd75e'; return s; }
      if (/^\+/.test(text)) { s.fill = '#6dfb8f'; return s; }                      // 沒標類別但是 +：當回復
      s.fill = '#9ecbff';
      return s;
    }
    /* 敵方側：普攻白、技能金、暴擊放大。時間與 rise 對齊 CSS DOM 路徑，
       讓 ?canvas=0 前後的傷害數字有相同的「彈出→上浮→淡出」節奏。 */
    if (text === 'MISS' || cls.indexOf('miss') >= 0) {
      s.fill = '#9aa5b1'; s.size = 13; s.life = 0.62;
      return s;
    }
    var isSkillDamage = cls.indexOf('enemy-skill') >= 0;
    var isAttackDamage = cls.indexOf('enemy-attack') >= 0;
    if (isSkillDamage) { s.fill = '#ffd75e'; s.size = 17; }
    if (isCrit) {
      s.fill = '#ffb347'; s.size = isHigh ? 26 : 21; s.rise = 44; s.life = 0.76;
      if (isHigh) s.fill = '#ff7b3c';
    }
    if (isSkillDamage || isAttackDamage) {
      s.rise = isSkillDamage ? 42 : 38;
      s.life = isSkillDamage ? (isCrit ? 0.8 : 0.74) : (isCrit ? 0.72 : 0.68);
      if (isHigh && isCrit) s.life *= 2;
    }
    return s;
  }
  function floatMergeKey(elId, cls) {
    /* 與 DOM 版同精神：同目標、同類別在短窗內合併成一個滾動數字 */
    var base = (cls || '').replace(/crit-high-roll/, '').trim();
    return elId + '|' + base;
  }
  /* 找一個不會壓到別人的位置。
     同一瞬間常有三四個字落在同一點（傷害、護盾吸收、吸血、吸魔），
     舊版只給 ±18px 的隨機抖動，數字一多必然疊成一團看不清楚。
     這裡改成實際做碰撞檢查：疊到了就往上讓一行，讓滿了就往旁邊挪一欄。 */
  function placeFloatNode(node, baseX, baseY) {
    node.x = baseX + (Math.random() * 16 - 8);
    node.y = baseY;
    var w = node.width || 20, h = node.height || 16;
    var lane = 0;
    for (var pass = 0; pass < 12; pass++) {
      var hit = null;
      for (var i = S.floats.length - 1, seen = 0; i >= 0 && seen < 16; i--, seen++) {
        var o = S.floats[i];
        if (!o || o.dead || !o.node || o.node.destroyed) continue;
        var ow = o.node.width || 20, oh = o.node.height || 16;
        /* anchor 是 (0.5, 1)：x 是中心、y 是底邊 */
        if (Math.abs(o.node.x - node.x) >= (w + ow) / 2 - 2) continue;
        if (node.y - h >= o.node.y || o.node.y - oh >= node.y) continue;
        hit = o; break;
      }
      if (!hit) break;
      node.y = hit.node.y - (hit.node.height || 16) - 3;
      if (baseY - node.y > 96) {           // 這一欄疊太高了，換一欄重來
        lane++;
        node.x = baseX + (lane % 2 ? 1 : -1) * (34 + Math.floor(lane / 2) * 30);
        node.y = baseY;
      }
    }
  }

  function onFloat(ev) {
    if (!S.ready || !ev) return;
    if (documentHidden()) return;   // 背景分頁：ui.js 已改走「只記最新」路徑，這裡擋 setTimeout 殘留
    /* 與特效同理：飄字要落在「畫面上那一刻」的實體身上（見 onVfx 的說明）。 */
    if (!ev._buffered) { ev._buffered = true; ev.delayMs = (ev.delayMs || 0) + POS_BUFFER_MS; }
    var delay = Math.max(0, ev.delayMs || 0);
    if (delay > 0) {
      setTimeout(function () {
        onFloat({ elId: ev.elId, text: ev.text, cls: ev.cls, damageValue: ev.damageValue, _buffered: true });
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
    var playerTarget = ev.elId === 'pv-float' || ev.elId === 'tp-float';
    var playerDamage = playerTarget &&
      (String(ev.cls || '').indexOf('mdmg') >= 0 || /^\s*(爆擊\s*)?-/.test(String(ev.text || '')));
    var skillCast = playerTarget && String(ev.cls || '').indexOf('skill-cast') >= 0;
    /* 玩家事件分區：有益效果在角色頭頂藍區，承傷在身體紅區；技能名稱從身體中心出現。 */
    if (playerTarget && S.player) {
      if (skillCast) {
        pt = { x: S.player.root.x, y: S.player.root.y - 34 };
      } else if (playerDamage) {
        pt = { x: S.player.root.x + (Math.random() * 60 - 30),
          y: S.player.root.y - 12 + Math.random() * 30 };
      } else {
        pt = { x: S.player.root.x + (Math.random() * 72 - 36),
          y: S.player.root.y - 96 + Math.random() * 26 };
      }
    }
    var node = new PIXI.Text({
      text: ev.text || '',
      style: {
        fontFamily: 'sans-serif', fontSize: st.size, fontWeight: st.weight,
        fill: st.fill, stroke: { color: st.stroke, width: Math.max(2, st.size / 6) }
      }
    });
    node.anchor.set(0.5, 1);
    placeFloatNode(node, pt.x, pt.y - 8);
    S.layers.float.addChild(node);
    var prefixMatch = /^([^0-9]*)/.exec(ev.text || '');
    var castLeft = String(ev.cls || '').indexOf('skill-cast-left') >= 0;
    var castRight = String(ev.cls || '').indexOf('skill-cast-right') >= 0;
    var isEnemyDamageFloat = /^mv-float-\d+$/.test(String(ev.elId || '')) &&
      (String(ev.cls || '').indexOf('enemy-attack') >= 0 ||
       String(ev.cls || '').indexOf('enemy-skill') >= 0);
    var isCritFloat = String(ev.cls || '').indexOf('crit') >= 0;
    var f = {
      node: node, t: 0, life: st.life, rise: st.rise,
      bornAt: nowMs(), hits: 1, total: isFinite(val) ? val : 0,
      prefix: prefixMatch ? prefixMatch[1] : '',
      /* 傷害數字沿用 DOM 的快速回彈：一般字從 0.72 倍起，
         0.12 秒內放大到約 1.1 倍，再回到 1 倍；暴擊只稍微放大峰值。 */
      pop: isEnemyDamageFloat ? 0.12 : (isCritFloat ? 0.18 : 0),
      popStart: isEnemyDamageFloat ? 0.72 : 0.6,
      popPeak: isEnemyDamageFloat ? (isCritFloat ? 1.16 : 1.14) : 1.1,
      fadeTail: isEnemyDamageFloat,
      drift: castLeft ? -72 : (castRight ? 72 : 0)
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
    var rClock = renderClock();      // 這一幀要播放的模擬時刻（見內插緩衝）

  /* ---- 玩家：把模擬層算好的座標畫出來 ----
     跑向誰、跑多快、停在哪，全部是模擬層的事（js/battlefield.js bfTickPlayer）。
     顯示層在這裡只做兩件事：把 5Hz 的取樣補成逐幀連續（外推，作法同敵人），
     以及決定面向與走路動畫。
     ⚠️ 不要讓角色在這裡自己移動。顯示層自作主張的位移不會回饋給模擬層，
     敵人卻是照模擬層座標畫的，於是「看到的距離」與「打得到的距離」會分家。 */
    var p = S.player;
    if (p && dt > 0) {
      /* 倒地／起身：fallK 0＝站著、1＝完全倒下。倒下快一點（被打倒），
         起身慢一點（撐起來），中間帶一點回彈，看起來才像個動作。 */
      var fallTarget = p.dead ? 1 : 0;
      var fallSpeed = p.dead ? 3.2 : 2.4;
      if (p.fallK !== fallTarget) {
        var stepK = fallSpeed * dt;
        p.fallK = (p.fallK < fallTarget) ? Math.min(fallTarget, p.fallK + stepK)
                                         : Math.max(fallTarget, p.fallK - stepK);
      }
      if (p.fallK > 0) {
        var ease = p.fallK * p.fallK * (3 - 2 * p.fallK);            // smoothstep
        var bounce = Math.sin(Math.min(1, p.fallK) * Math.PI) * 0.12;  // 倒下與起身途中的一點回彈
        /* 只翻轉角色本體；血條、法力條與文字都留在 root 上保持水平。 */
        p.bodyWrap.rotation = -(Math.PI / 2) * ease * p.facing - bounce * p.facing;
        p.body.tint = 0x777777;
      } else if (p.bodyWrap.rotation !== 0) {
        p.bodyWrap.rotation = 0;
        p.body.tint = 0xffffff;
      }
      if (p.dead) {
        p.deathFogK = Math.min(1, (p.deathFogK || 0) + dt / Math.max(1, p.deathFogDuration || 1));
        updateDeathFog(p.deathFogK);
      }

      var moving = false;
      if (!p.dead) {
        var pAt = posSolve(p, rClock);
        var pdx = pAt.x - p.wx, pdy = pAt.y - p.wy;
        p.wx = pAt.x; p.wy = pAt.y;
        var pStep = Math.sqrt(pdx * pdx + pdy * pdy);
        /* 動畫遲滯：一有位移就立刻切走路，但要連續靜止一小段才切回站立。
           少了這段，位移在門檻上下抖動時走路／站立會逐幀互閃，
           看起來就像一下走路一下跑步。 */
        if (pStep > 0.5 * dt * 60) p.stillFor = 0;
        else p.stillFor = (p.stillFor || 0) + dt;
        moving = p.stillFor < 0.22;
        if (pStep > 0.6) p.facing = pdx < 0 ? -1 : 1;
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
      if (p.hud) {
        p.hud.x = p.root.x;
        p.hud.y = p.root.y;
      }
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
    if (p && p.reviveText && p.reviveText.visible) {
      /* reviveText 在 overlay 上，跟著鏡頭中的玩家位置更新但永遠保持水平。 */
      p.reviveText.x = world.x + p.root.x;
      p.reviveText.y = world.y + p.root.y - 104;
    }

    /* 敵人 */
    for (var id in S.entities) {
      if (!Object.prototype.hasOwnProperty.call(S.entities, id)) continue;
      var e = S.entities[id];
      if (dt <= 0) continue;

      /* 站位與逼近由模擬層決定（js/battlefield.js 座標制），面板只有 5Hz。
         這裡照內插緩衝播放（見 posSolve）：畫面比模擬層晚一點點，
         換來完全等速的移動——這是「一格一格跳」與「忽快忽慢」的共同解。 */
      var eAt = posSolve(e, rClock);
      var edx = eAt.x - e.wx, edy = eAt.y - e.wy;
      e.wx = eAt.x; e.wy = eAt.y;
      var movedLen = Math.sqrt(edx * edx + edy * edy);

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
        if (f.drift) f.node.x += (f.drift / f.life) * dt;
        /* 傷害字要像影片一樣一出現就可讀，只在最後四分之一淡出；
           其他 Canvas 浮字保留原本的淡入／淡出曲線。 */
        f.node.alpha = f.fadeTail
          ? (fk > 0.75 ? 1 - (fk - 0.75) / 0.25 : 1)
          : (fk < 0.15 ? fk / 0.15 : (1 - (fk - 0.15) / 0.85));
        if (f.pop > 0) {
          var pk = Math.min(1, f.t / f.pop);
          var popK = pk < 0.55 ? pk / 0.55 : 1 - (pk - 0.55) / 0.45;
          var popScale = pk < 0.55
            ? f.popStart + (f.popPeak - f.popStart) * popK
            : 1 + (f.popPeak - 1) * popK;
          f.node.scale.set(popScale);
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
    /* 玩家三條狀態條必須在所有敵人、敵方血條／名稱與傷害浮字之上，
       但仍跟著 world 一起移動，避免被任何戰鬥表現層蓋住。 */
    var playerHud = new PIXI.Container();
    var overlay = new PIXI.Container();
    world.addChild(zone); world.addChild(entity); world.addChild(fx); world.addChild(floatLayer);
    world.addChild(playerHud);
    app.stage.addChild(bg);
    app.stage.addChild(world);
    app.stage.addChild(overlay);
    S.bgLayer = bg;

    /* 死亡時獨立覆蓋黑色暗角：中心透明區由大逐步縮小，外圍因此像淡紅色視野迷霧
       從四周壓向倒地的玩家。用螢幕座標層，避免鏡頭移動時迷霧跟著世界漂移。 */
    var deathFogCanvas = document.createElement('canvas');
    deathFogCanvas.width = deathFogCanvas.height = 512;
    var deathFog = new PIXI.Sprite(PIXI.Texture.from(deathFogCanvas));
    deathFog.visible = false;
    overlay.addChild(deathFog);
    S.deathFogCanvas = deathFogCanvas;
    S.deathFogTex = deathFog.texture;
    S.deathFog = deathFog;

    /* 空場提示（只在高塔戰期間顯示；野外的「搜索敵人中…」已移除） */
    var emptyText = new PIXI.Text({
      text: '（高塔戰鬥中…）',
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

    S.layers = {
      world: world, zone: zone, entity: entity, fx: fx, float: floatLayer,
      playerHud: playerHud, overlay: overlay
    };
    drawDeathFog(0);
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
  function drawDeathFog(k) {
    if (!S.deathFogCanvas || !S.deathFogTex) return;
    k = Math.max(0, Math.min(1, Number(k) || 0));
    /* 以正方形貼圖等比覆蓋畫布，讓中心視野保持圓形；內圈半徑隨 k 收縮。 */
    var c = S.deathFogCanvas;
    var g = c.getContext('2d');
    var center = c.width / 2;
    var inner = (0.42 - 0.40 * k) * center;
    var outer = inner + (0.20 - 0.04 * k) * center;
    g.clearRect(0, 0, c.width, c.height);
    var grad = g.createRadialGradient(center, center, inner, center, center, outer);
    grad.addColorStop(0, 'rgba(180, 0, 20, 0)');
    /* 最高不透明度 10%，保留紅色警示感但不遮住戰鬥畫面。 */
    grad.addColorStop(0.45, 'rgba(180, 0, 20, 0.03)');
    grad.addColorStop(0.78, 'rgba(180, 0, 20, 0.07)');
    grad.addColorStop(1, 'rgba(180, 0, 20, 0.10)');
    g.fillStyle = grad;
    g.fillRect(0, 0, c.width, c.height);
    if (S.deathFogTex.source && typeof S.deathFogTex.source.update === 'function') {
      S.deathFogTex.source.update();
    } else if (typeof S.deathFogTex.update === 'function') {
      S.deathFogTex.update();
    }
  }
  function updateDeathFog(k) {
    var p = S.player;
    if (!p || !S.deathFog) return;
    k = Math.max(0, Math.min(1, Number(k) || 0));
    /* 不必每個 rAF 都重繪 Canvas；約 60 段已足夠讓 5 秒動畫平順。 */
    var bucket = Math.round(k * 60) / 60;
    if (p.deathFogDrawnK === bucket) return;
    p.deathFogDrawnK = bucket;
    drawDeathFog(bucket);
  }
  function layoutScene() {
    if (!S.layers) return;
    /* 地板鋪滿畫布再多一格，鏡頭移動時邊緣不會露出底色 */
    if (S.groundTile) { S.groundTile.width = S.W + 256; S.groundTile.height = S.H + 256; S.groundTile.x = -128; S.groundTile.y = -128; }
    if (S.vignette) { S.vignette.width = S.W; S.vignette.height = S.H; }
    if (S.deathFog) {
      var fogSize = Math.max(S.W, S.H);
      S.deathFog.width = fogSize;
      S.deathFog.height = fogSize;
      S.deathFog.x = (S.W - fogSize) / 2;
      S.deathFog.y = (S.H - fogSize) / 2;
    }
    if (S.emptyText) { S.emptyText.x = S.W * 0.62; S.emptyText.y = S.H * 0.5; }
    if (S.pauseVeil) {
      S.pauseVeil.bg.clear();
      S.pauseVeil.bg.rect(0, 0, S.W, S.H).fill({ color: 0x000000, alpha: 0.45 });
      S.pauseVeil.text.x = S.W / 2; S.pauseVeil.text.y = S.H / 2;
    }
    if (S.bossBar) { S.bossBar.root.x = S.W / 2; S.bossBar.root.y = BOSS_BAR_Y; }
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
      S.playerShieldMax = 0;
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
        loadSheet('boss', 'images/sprites/boss_generic'),
        loadFireFlare()
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
        player: p ? {
          x: Math.round(p.wx), y: Math.round(p.wy), walking: !!p.walking, facing: p.facing, anim: p.curAnim,
          /* 倒地驗證用：dead 是否觸發、倒下進度、實際旋轉角度、倒數文字 */
          dead: !!p.dead, fallK: +(p.fallK || 0).toFixed(2),
          rotDeg: Math.round((p.bodyWrap.rotation || 0) * 180 / Math.PI),
          reviveText: (p.reviveText && p.reviveText.visible) ? String(p.reviveText.text) : null
        } : null,
        home: playerPos(),
        entities: Object.keys(S.entities).map(function (id) {
          var e = S.entities[id];
          return { id: id, x: Math.round(e.wx), y: Math.round(e.wy), state: e.state, lunge: +(e.lunge || 0).toFixed(2), magic: !!(e.data && e.data.magic) };
        })
      };
    }
  };
})();
