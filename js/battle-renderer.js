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
  var FX_PERSISTENT_AURA_PRIORITY = 3; // 長駐自身場域在混合技能洪峰中優先保留
  var FX_WATCHDOG_MS = 1000;       // 看門狗掃描間隔
  var METEOR_SIZE_SCALE = 1.30;    // 新版殞石術特效寬度／尺寸增加 30%
  /* 角色的跑速與追擊邏輯已經**不在這裡**：位移由模擬層產生（js/battlefield.js
     bfTickPlayer），顯示層只把座標畫出來。這裡只留一個「面前一個身位」的長度，
     給找不到目標時的特效落點用。 */
  var PLAYER_REACH = 52;
  var ENEMY_CONTACT_GAP = 34;      // 敵人出手時衝到離角色這麼近（＝接觸）
  var ENEMY_MAX_CHARGE = 460;      // 單次衝刺的最大距離，避免從畫面另一頭瞬間貼臉
  var MAX_FLOATS = 60;           // 一般飄字同時存在上限；技能名稱＋傷害不計入
  var FLOAT_MERGE_MS = 160;      // 同目標同類傷害的合併窗（DOM 版邏輯的簡化版）
  var LASTPOS_KEEP_MS = 3000;    // 實體移除後保留座標，讓遲到的飄字仍有落點
  var HIT_JOLT_COOLDOWN_MS = 3000; // 同一單位的受擊抖動冷卻，避免多段傷害連續晃動
  var HIT_JOLT_X = 2.5;          // 受擊抖動水平幅度（px）
  var HIT_JOLT_Y = 1.5;          // 受擊抖動垂直幅度（px）
  var PLAYER_SKILL_FLOAT_SIDE_OFFSET = 120; // 技能名稱／傷害離人物中心的起始左右偏移（px；外移一個戰鬥大格）
  var PLAYER_SKILL_FLOAT_DRIFT = 16;        // 起始後只再向外滑一小段，避免回到人物中心
  var PLAYER_SKILL_FLOAT_LIFE_SEC = 1.05;   // 一般技能名稱／傷害字的顯示時間
  var PLAYER_SKILL_TOTAL_FLOAT_LIFE_SEC = PLAYER_SKILL_FLOAT_LIFE_SEC * 2;

  /* 元素主題色：優先沿用 js/vfx.js 的 VFX_ELEM_THEME，載入順序異常時退回內建表。 */
  var FALLBACK_THEME = {
    light:     { c1: '#ffe47a', c2: '#fffef4', glow: '#fff3a3' },
    dark:      { c1: '#6f2da8', c2: '#1a0c2e', glow: '#913dcc' },
    fire:      { c1: '#e63924', c2: '#ffd447', glow: '#ff6a2a' },
    ice:       { c1: '#4da6ff', c2: '#f2fbff', glow: '#79d8ff' },
    lightning: { c1: '#f2b705', c2: '#fff8b0', glow: '#ffd23f' },
    earth:     { c1: '#ad7444', c2: '#5b3a27', glow: '#c48a55' },
    poison:    { c1: '#4caf2b', c2: '#d8ff8a', glow: '#76d83b' },
    wind:      { c1: '#86efac', c2: '#ffffff', glow: '#b9f6cf' }
  };
  function themeOf(spec) {
    var table = (typeof VFX_ELEM_THEME !== 'undefined' && VFX_ELEM_THEME) || FALLBACK_THEME;
    if (spec && spec.variant === 'thunder-strike') {
      return { c1: '#c084fc', c2: '#fdf4ff', glow: '#9333ea' };
    }
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
    pendingFloats: [],        // Canvas 初始化完成前暫存的玩家／野外浮字
    floatMerge: {},           // mergeKey -> float 物件
    shake: 0,                 // 畫面震動剩餘強度（px）
    sheets: {},               // name -> { tex, manifest, anims: {name: [Texture]} }
    imgTex: {},               // 敵人圖檔快取：src -> Texture | 'loading' | 'failed'
    thrustLanceTex: null,     // 突刺光槍圖片；載入失敗時由 spawnThrustLine 保留程序化退化畫法
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
  function isCanvasFloatTarget(elId) {
    return elId === 'pv-float' || /^mv-float-\d+$/.test(elId || '');
  }
  function enemyFloatTargetAvailable(elId) {
    if (!/^mv-float-\d+$/.test(elId || '')) return true;
    var ent = S.entities[elId];
    if (ent) return ent.state !== 'gone';
    return !S.lastPos[elId];
  }
  function queueFloatUntilReady(ev) {
    if (!isCanvasFloatTarget(ev && ev.elId)) return;
    if (S.pendingFloats.length >= 40) S.pendingFloats.shift();
    S.pendingFloats.push({
      elId: ev.elId, text: ev.text, cls: ev.cls,
      damageValue: ev.damageValue, delayMs: ev.delayMs
    });
  }
  function flushPendingFloats() {
    var pending = S.pendingFloats.splice(0, S.pendingFloats.length);
    for (var i = 0; i < pending.length; i++) onFloat(pending[i]);
  }
  /* 延遲排程（setTimeout）的統一守門：渲染器沒起來、分頁已隱藏，或
     普攻／飛刀彈射的目標已經**離場**時，放棄該段特效。技能命中視覺仍保留，
     但不讓戰鬥結束前排入的普攻／子彈計時器在結束後重新觸發畫面。

     ⚠️ 判定只能收到「離場（gone／實體已移除）」，不得把「垂死（dying／hp<=0）」
     也算成失效——普攻事件會延後 POS_BUFFER_MS 才播，而面板同步早就把被殺的
     敵人標成 dying 了，於是**擊殺的那一刀必定被自己丟掉**：一刀一隻時角色
     幾乎永遠不播普攻動作，畫面上只剩傷害數字在跳。
     垂死的敵人還在畫面上演死亡動畫（死亡定格 2 秒以上），劍氣打在牠身上正是
     擊殺該有的畫面。與飄字的 enemyFloatTargetAvailable 同一條線，兩者一致，
     不會再出現「數字跳出來、卻沒有出手動作」的落差。 */
  function isTargetBoundThunderVfx(spec) {
    return !!spec && (spec.variant === 'thunder-strike' || spec.variant === 'thunder-fall');
  }
  /* 落雷／雷殞是延遲到落點才結算的天降特效。這兩種特效若在等待期間
     目標已死亡，必須整段取消；一般普攻仍沿用「dying 也要播出致死那一刀」
     的舊規則，避免把兩種時序混在一起。 */
  function vfxTargetLiveForSpec(spec, id) {
    if (!isTargetBoundThunderVfx(spec) || typeof id !== 'string') return true;
    if (id === 'pv-float') return !!(S.player && !S.player.dead);
    var ent = S.entities[id];
    if (!ent) {
      /* 落雷不能用 posOf() 的預設座標代替缺失目標；沒有實體就沒有可劈的點。 */
      return false;
    }
    return ent.state !== 'dying' && ent.state !== 'gone';
  }
  function vfxTargetsLive(spec) {
    var ids = spec && Array.isArray(spec.targets) ? spec.targets : [];
    /* 落雷／雷殞是嚴格綁定目標的特效；空清單不可退化成地面落點。 */
    if (!ids.length) return !isTargetBoundThunderVfx(spec);
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      if (spec && (spec.variant === 'thunder-strike' || spec.variant === 'thunder-fall')) {
        if (id === 'pv-float' && (!S.player || S.player.dead)) return false;
        var thunderEnt = S.entities[id];
        if (!thunderEnt) return false;
        if (thunderEnt && (thunderEnt.state === 'dying' || thunderEnt.state === 'gone')) return false;
      }
      if (id === 'pv-float') {
        if (!S.player || !S.player.dead) continue;
        return false;
      }
      var ent = S.entities[id];
      if (!ent) {
        /* 尚未建立的目標允許事件繼續；有 lastPos 代表它曾存在且已離場。 */
        if (S.lastPos[id]) return false;
        continue;
      }
      if (ent.state === 'gone') return false;
    }
    return true;
  }
  function fxGate(spec) {
    if (!S.ready || documentHidden()) return true;
    if (spec && (spec.variant === 'thunder-strike' || spec.variant === 'thunder-fall')) {
      return !vfxTargetsLive(spec);
    }
    if (spec && (spec.cat === 'basic' || spec.variant === 'knife-bounce')) {
      return !vfxTargetsLive(spec);
    }
    return false;
  }
  function shouldAnimatePlayer(spec) {
    return !!spec && spec.cat !== 'enemy' &&
      spec.fxKind !== 'chain' && spec.variant !== 'knife-bounce';
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

  /* 投射物只追蹤單一目標，不重新搜尋敵人：用已有的座標取樣估出速度，
     預判飛行結束時的目標點。這能避免目標往前走時，彈體在舊路徑末端
     看起來像「停在旁邊」；命中半徑則是移動模型誤差的低成本保底。 */
  var PROJECTILE_NEAR_HIT_RADIUS = 24;
  var PROJECTILE_MAX_PREDICTION_SEC = 1.25;
  function projectileTargetVelocity(targetId) {
    var ent = targetId === 'pv-float' ? S.player : S.entities[targetId];
    var samples = ent && ent.samples;
    if (!samples || samples.length < 2) return { x: 0, y: 0 };
    var b = samples[samples.length - 1];
    var a = samples[samples.length - 2];
    var dt = b.t - a.t;
    if (!(dt > 0)) return { x: 0, y: 0 };
    return { x: (b.x - a.x) / dt * 1000, y: (b.y - a.y) / dt * 1000 };
  }
  function projectileTargetStopGap(targetId) {
    if (targetId === 'pv-float') return 0;
    var ent = S.entities[targetId];
    if (!ent) return 0;
    var contact = (typeof BF_CONTACT_DIST === 'number' && BF_CONTACT_DIST > 0) ? BF_CONTACT_DIST : 46;
    var radius = ent.isBoss
      ? ((typeof BF_BOSS_RADIUS === 'number' && BF_BOSS_RADIUS > 0) ? BF_BOSS_RADIUS : 52)
      : ((typeof BF_BODY_RADIUS === 'number' && BF_BODY_RADIUS > 0) ? BF_BODY_RADIUS : 20);
    return contact + radius;
  }
  function projectileTargetPoint(targetId, horizonSec) {
    var current = posOf(targetId);
    var horizon = Math.max(0, Math.min(PROJECTILE_MAX_PREDICTION_SEC, Number(horizonSec) || 0));
    if (!(horizon > 0)) return current;
    var velocity = projectileTargetVelocity(targetId);
    var future = {
      x: current.x + velocity.x * horizon,
      y: current.y + velocity.y * horizon
    };

    /* 敵人逼近玩家時，預判不可穿過模擬層的停步距離；沒有速度或已經在停步點
       時自然維持原座標。玩家本身不套用這個限制。 */
    var stopGap = projectileTargetStopGap(targetId);
    if (stopGap > 0) {
      var player = playerPos();
      var cx = current.x - player.x, cy = current.y - player.y;
      var currentDist = Math.sqrt(cx * cx + cy * cy);
      var speed = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y);
      var toward = (player.x - current.x) * velocity.x + (player.y - current.y) * velocity.y;
      if (speed > 0 && currentDist > stopGap && toward > 0) {
        var move = Math.min(speed * horizon, Math.max(0, currentDist - stopGap));
        future.x = current.x + velocity.x * move / speed;
        future.y = current.y + velocity.y * move / speed;
      }
    }
    return future;
  }
  function projectileNearTarget(x, y, targetId) {
    var target = posOf(targetId);
    var ent = targetId === 'pv-float' ? S.player : S.entities[targetId];
    var radius = Math.max(PROJECTILE_NEAR_HIT_RADIUS,
      ent && ent.hitHeight ? ent.hitHeight * 0.35 : PROJECTILE_NEAR_HIT_RADIUS);
    var dx = x - target.x, dy = y - target.y;
    return dx * dx + dy * dy <= radius * radius;
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

  /* ---- 圓點貼圖（粒子與拖尾共用，一次生成重複使用） ----
     這兩種東西原本每一顆都是 new PIXI.Graphics().circle().fill()。
     實測（scratch/_perf_bench2.html）貴的不是「建立」——每顆只要 0.013ms——
     而是每個 Graphics 都帶自己的一份幾何，彼此無法合批：一次施放幾百顆，
     就是幾百次獨立的繪製提交。改成同一張貼圖的 Sprite 之後全部併成一批，
     顏色差異用 tint 表現，畫面完全一樣。 */
  var _dotTex = null;
  function dotTexture() {
    if (_dotTex) return _dotTex;
    var c = document.createElement('canvas');
    c.width = c.height = 32;
    var g = c.getContext('2d');
    var grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.8, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 32, 32);
    _dotTex = PIXI.Texture.from(c);
    return _dotTex;
  }
  /* 貼圖裡「實心」部分的半徑（16 × 0.8），換算縮放用。
     ⚠️ 柔邊留太寬，粒子看起來就會比原本的硬邊圓大一圈：可見光暈半徑是
     16/DOT_TEX_RADIUS 倍的指定半徑，這裡是 1.25 倍。第一版寫 0.55
     （＝1.8 倍）時，滿場粒子疊加後整片泛白。 */
  var DOT_TEX_RADIUS = 12.8;

  /* ---- 環形貼圖（命中爆點共用） ----
     ⚠️ 這是整個特效層最大的單項成本來源，改動前請先看實測數字。
     原本的命中環是每一幀 clear() 再 circle().stroke() 重畫一次。描邊要重新
     產生一整圈三角形帶，而且逐幀變動的 Graphics 完全無法合批；場上同時有
     數十個環時，中位幀時間就從 1.1ms 漲到 2.6ms（scratch/_perf_bench2.html
     情境 A 對 F）。改成固定貼圖 Sprite，擴張用 scale、消失用 alpha，
     每幀零幾何重建。
     視覺差異：原版的圈會邊擴散邊變細，貼圖版是等比放大。所以貼圖畫的是
     一圈「柔邊光環」而不是硬描邊——柔邊在放大時看不出線寬變化。

     ⚠️ 亮帶寬度一定要做窄，這條踩過一次。原版的描邊只有 1～5px，相對於
     半徑約 13%；第一版把漸層內半徑設成 0.58，亮帶佔了半徑 53%（四倍寬），
     圈的大小其實沒變，但變成一團厚環，一秒幾十發疊起來就在角色身上糊成
     一顆大光球。判斷是否過寬不要靠眼睛，用 scratch/_perf_verify.html
     的亮帶寬度斷言。 */
  var _ringTex = null;
  function ringTexture() {
    if (_ringTex) return _ringTex;
    var c = document.createElement('canvas');
    c.width = c.height = 128;
    var g = c.getContext('2d');
    /* 亮帶只佔最外圈 54.4～64（峰值在 59.2），相對峰值半徑約 16% */
    var grad = g.createRadialGradient(64, 64, 64 * 0.85, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.5, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(64, 64, 64, 0, Math.PI * 2);
    g.fill();
    _ringTex = PIXI.Texture.from(c);
    return _ringTex;
  }
  /* 亮帶峰值所在的半徑。縮放要對齊「看得到的那圈」，不是貼圖邊界——
     用 64（貼圖半徑）會讓實際亮圈比指定半徑小一截。 */
  var RING_TEX_RADIUS = 59.2;

  /* ---- 負載自適應降級 ----
     模擬層產生的事件量沒有上限，顯示層不能假設它很小：飛刀滿階時單次施放
     約 40 次彈射（7 把刀 × 5.4 跳），而第 7 階「神速飛刀」每次爆擊都扣冷卻，
     幾十次爆擊足以把 4 秒冷卻直接清光——所以那不是一次性尖峰，是持續滿載。
     這裡的原則：**裝飾性的東西在高載時先讓位，主體永遠保留**。
     拖尾與粒子屬於裝飾；投射物本體、命中爆點、傷害飄字屬於主體，任何負載
     都照畫，因為那是玩家真正在讀的資訊。 */
  function fxLoad() {
    return S.fx.length / MAX_FX;
  }
  function particleBudget(n) {
    var load = fxLoad();
    if (load >= 0.85) return 0;
    if (load >= 0.6) return Math.max(1, Math.round(n * 0.35));
    return n;
  }
  function trailIntervalSec() {
    var load = fxLoad();
    if (load >= 0.85) return Infinity;   // 高載：完全停畫拖尾
    if (load >= 0.6) return 0.075;
    return 0.03;
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
        ent.data = d;
        /* 攻擊視覺由 doMonsterAttack 的 enemy-attack VFX 事件即時送出。
           不能再從 atkCd 的快照跳升反推：反傷秒殺會讓同一張快照直接變
           成 hp<=0，這裡若只接受 alive 就會把整次攻擊／子彈吃掉。 */
        if (typeof d.atkCd === 'number') {
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

  /* 敵人出手：由模擬層即時送入，而不是等下一張面板快照反推。
     來源實體可能已進入 dying，因此魔法投射物用 sourceId／lastPos 建立起點；
     近戰則即使屍體已開始淡出，仍在玩家身上畫出致死前的攻擊弧光。 */
  function renderEnemyAttackVfx(spec) {
    var targetId = Array.isArray(spec.targets) && spec.targets.length
      ? spec.targets[0] : 'pv-float';
    var sourceId = spec.sourceId || null;
    var from = sourceId ? posOf(sourceId) : null;
    var sourceEnt = sourceId ? S.entities[sourceId] : null;
    var hit = spec.hit !== false;
    var themeSpec = {
      elem: spec.elem || null, cat: 'enemy', color: spec.color || '#ff6b6b',
      variant: spec.variant || null, glyph: spec.glyph || '💢'
    };

    if (spec.variant === 'enemy-projectile') {
      var travel = spec.travelMs && Number(spec.travelMs[0]) > 0
        ? Number(spec.travelMs[0]) : 260;
      var projectileFrom = from || posOf(sourceId || targetId);
      spawnProjectile(targetId, travel, themeSpec, function (pt) {
        if (!hit) return;
        spawnImpact(pt.x, pt.y, themeSpec, false);
        hitReact(targetId, themeSpec.elem, false);
      }, projectileFrom);
      return;
    }

    /* 保留近戰敵人的衝刺／BOSS 攻擊動作；若來源已 dying，這段不依賴
       dying 狀態的 lunge 更新，仍用玩家位置上的弧光表現「先出手」。 */
    if (sourceEnt && sourceEnt.isBoss && sourceEnt.sheetName && sourceEnt.state !== 'dying') {
      playAnim(sourceEnt, 'attack', 'idle');
    }
    if (sourceEnt && sourceEnt.state === 'idle') {
      var pc = playerPos();
      var dx = pc.x - sourceEnt.wx, dy = (pc.y - 26) - sourceEnt.wy;
      var dist = Math.sqrt(dx * dx + dy * dy);
      sourceEnt.lungeDur = Math.max(0.28, Math.min(0.8, 0.24 + dist / 900));
      sourceEnt.lunge = sourceEnt.lungeDur;
    }
    var target = posOf(targetId);
    var angle = from ? Math.atan2(target.y - from.y, target.x - from.x) : 0;
    spawnSlash(target.x, target.y, themeSpec, false, angle);
    if (hit) {
      spawnImpact(target.x, target.y, themeSpec, false);
      hitReact(targetId, themeSpec.elem, false);
    }
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
  function isBloodbladeNoHitJoltSpec(spec) {
    var v = spec && spec.variant;
    return v === 'poison-spread' || v === 'bleed' || v === 'poison' ||
      v === 'bleed-tick' || v === 'poison-tick';
  }
  function hitReact(elId, elem, strong, suppressJolt) {
    var ent = (elId === 'pv-float') ? S.player : S.entities[elId];
    if (!ent) return;
    var theme = themeOf({ elem: elem });
    /* 受擊回饋 = 元素色染色 + 抖動 + 縮放彈跳。
       ⚠️ 不用「tint 白閃」：Pixi 的 tint 是乘法染色，0xffffff 是恆等值，畫不出提亮。 */
    ent.flash = strong ? 0.24 : 0.15;
    ent.flashTint = cssColorToInt(theme.c1, 0xff8888);
    var hitAt = nowMs();
    var canJolt = typeof ent.lastJoltAt !== 'number' ||
      hitAt - ent.lastJoltAt >= HIT_JOLT_COOLDOWN_MS;
    if (!suppressJolt && canJolt) {
      ent.lastJoltAt = hitAt;
      ent.jolt = strong ? 0.18 : 0.12;
      ent.joltX = HIT_JOLT_X;
      ent.joltY = HIT_JOLT_Y;
    }
    if (ent === S.player) return;
    ent.pop = strong ? 0.24 : 0.15;
    ent.popDur = ent.pop;
    if (ent.isBoss && ent.sheetName && ent.state === 'idle' && ent.curAnim !== 'attack') {
      playAnim(ent, 'hurt', 'idle');
    }
  }
  function addShake(px, spec) {
    if (REDUCED_MOTION) return;
    if (!isSpecialScreenShakeSpec(spec)) return;
    S.shake = Math.min(10, Math.max(S.shake, px));
  }

  /* 殞石是明確要求的落地鏡頭效果：不走一般受擊的 reduced-motion 閘門，
     直接推動世界鏡頭，確保每顆殞石到達時都能看到一次畫面位移。 */
  function addMeteorCameraShake() {
    S.shake = Math.min(18, Math.max(S.shake, 14));
  }

  /* 血刃斬（含毒霧感染、死亡屍爆、零日感染）一律不推鏡頭：
     它的爆點是「每個中毒／流血目標各炸一次」，死一片就會連續觸發數十次，
     鏡頭會被震到看不清畫面。blood-explosion／zero-infection 為血刃斬專屬 variant，
     從允許清單移除即可，不影響斷罪引爆等共用 detonate 的技能。 */
  function isSpecialScreenShakeSpec(spec) {
    var v = spec && spec.variant;
    if (isBloodbladeNoHitJoltSpec(spec) ||
        v === 'blood-explosion' || v === 'zero-infection') return false;
    return v === 'meteor' || v === 'pillar' || v === 'purple-thunder' ||
      v === 'storm-sigil' || v === 'detonate' ||
      v === 'nova' || v === 'venomburst' || v === 'vortex';
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
      /* 滿了可讓高優先級事件淘汰較低優先級事件；否則長駐場域會在
         技能洪峰中因為所有低優先級粒子已被清掉而反遭拒收。相同優先級
         不互相淘汰，避免新事件把仍在播放的長駐場域換掉。 */
      var evictIndex = -1;
      var evictPrio = Infinity;
      for (var i = 0; i < S.fx.length; i++) {
        var candidatePrio = S.fx[i].prio || 0;
        if (candidatePrio < fx.prio && candidatePrio < evictPrio) {
          evictIndex = i;
          evictPrio = candidatePrio;
        }
      }
      if (evictIndex >= 0) {
        killFx(S.fx[evictIndex]);
        S.fx.splice(evictIndex, 1);
      } else {
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

  function spawnParticles(x, y, count, theme, speed, radiusScale, targetGuard) {
    if (REDUCED_MOTION) return;
    count = particleBudget(Math.min(count, 14));
    if (count <= 0) return;
    var particleScale = (typeof radiusScale === 'number' && radiusScale > 0) ? radiusScale : 1;
    var c1 = cssColorToInt(theme.c1, 0xffffff);
    var c2 = cssColorToInt(theme.c2, 0xffffff);
    for (var i = 0; i < count; i++) {
      (function () {
        var g = new PIXI.Sprite(dotTexture());
        var r = 1.6 + Math.random() * 2.4;
        g.anchor.set(0.5);
        g.scale.set(r * particleScale / DOT_TEX_RADIUS);
        g.tint = Math.random() < 0.5 ? c1 : c2;
        g.x = x; g.y = y;
        g.blendMode = 'add';
        S.layers.fx.addChild(g);
        var ang = Math.random() * Math.PI * 2;
        var v = (60 + Math.random() * 120) * (speed || 1) * particleScale * 0.55;
        var vx = Math.cos(ang) * v, vy = Math.sin(ang) * v - 40;
        var life = 0.45 + Math.random() * 0.3;
        var t = 0;
        addFx({
          node: g,
          update: function (dt) {
            if (targetGuard && !targetGuard()) return false;
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
  /* 冰晶：四角菱形，而不是一般圓形彈體。飛行中的冰箭與轉入追擊後的冰箭是
     同一個飛行物，外形因此只能有一份（追蹤段不得退化成圓球）。
     scale＝1 為投射物本體尺寸（半高 11px）。 */
  function drawIceShard(g, scale, c1, c2, alpha) {
    var s = Math.max(0.2, Number(scale) || 1);
    var a = (alpha === undefined || alpha === null) ? 1 : Math.max(0, Number(alpha));
    g.poly([-9 * s, 0, 0, -11 * s, 9 * s, 0, 0, 11 * s]).fill({ color: c1, alpha: a })
      .stroke({ color: c2, width: 2, alpha: 0.95 * a });
    return g;
  }

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
      drawIceShard(core, 1, theme.c1, theme.c2, 1);
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
      ? VFX_PROJECTILE_SPEED_MULTIPLIER : 0.6;
  }

  function projectileTravelMs(travelMs, fallbackMs) {
    if (travelMs > 0) return travelMs;
    return (fallbackMs > 0 ? fallbackMs : 300) / projectileSpeedMultiplier();
  }

  /* 一般火球專用的小型平射彈體：不用殞石的 Phaser flare emitter，
     讓 Canvas 與 DOM 都能清楚區分「直線火球」和「天降殞石」。 */
  var FIREBALL_SIZE_SCALE = 3;
  function smallFireballProjectile(theme) {
    var node = new PIXI.Container();
    var c1 = cssColorToInt(theme && theme.c1, 0xf04a19);
    var c2 = cssColorToInt(theme && theme.c2, 0xffd166);
    var s = FIREBALL_SIZE_SCALE;
    var tail = new PIXI.Graphics();
    tail.moveTo(-14 * s, 0).lineTo(-6 * s, -4 * s).lineTo(-3 * s, 0).lineTo(-6 * s, 4 * s).closePath()
      .fill({ color: c1, alpha: 0.9 });
    tail.moveTo(-10 * s, 0).lineTo(-5 * s, -2 * s).lineTo(-4 * s, 0).lineTo(-5 * s, 2 * s).closePath()
      .fill({ color: c2, alpha: 0.95 });
    var core = new PIXI.Graphics();
    core.circle(0, 0, 6.5 * s).fill(c1);
    core.circle(-1.2 * s, -1.2 * s, 3.1 * s).fill(c2);
    node.addChild(tail);
    node.addChild(core);
    var pulse = 0;
    node._fireballUpdate = function (dt) {
      pulse += Math.max(0, Math.min(0.08, dt));
      var flicker = 1 + Math.sin(pulse * 34) * 0.08 + Math.sin(pulse * 61) * 0.04;
      tail.scale.set(flicker, 0.92 + Math.sin(pulse * 47) * 0.10);
      tail.alpha = 0.82 + Math.sin(pulse * 53) * 0.12;
      core.scale.set(0.97 + Math.sin(pulse * 31) * 0.06);
    };
    return node;
  }

  /* 投射物的拋物線離地最高點（像素）。模擬層帶 arcM（米）時換算成世界單位，
     否則沿用原本所有投射物共用的 18px 微弧。 */
  var PROJECTILE_DEFAULT_ARC_PX = 18;
  function projectileArcPx(spec) {
    var m = Number(spec && spec.arcM);
    if (!(m > 0)) return PROJECTILE_DEFAULT_ARC_PX;
    var perM = (typeof BF_SYSTEM_UNITS_PER_METER === 'number' && BF_SYSTEM_UNITS_PER_METER > 0)
      ? BF_SYSTEM_UNITS_PER_METER : 10;
    return m * perM;
  }

  function spawnProjectile(targetId, travelMs, spec, onArrive, fromOverride, pathOverride) {
    var theme = themeOf(spec);
    var from = fromOverride || playerMuzzle();
    var path = pathOverride && Number(pathOverride.length) > 0
      ? { angle: Number(pathOverride.angle) || 0, length: Number(pathOverride.length) }
      : null;
    var node = new PIXI.Container();
    var core;
    var glyphOnly = spec.glyph && (spec.variant === 'glyph' ||
      spec.variant === 'knife' || spec.variant === 'knife-bounce' ||
      (!spec.elem && (spec.cat === 'special' || spec.cat === 'potential' || spec.cat === 'fusion')));
    if (glyphOnly) {
      core = new PIXI.Text({ text: spec.glyph, style: { fontSize: 20 } });
      core.anchor.set(0.5);
    } else if (spec.variant === 'fireball-small' || spec.variant === 'fireball') {
      core = smallFireballProjectile(theme);
    } else {
      core = projectileCore(spec, theme);
    }
    var isSmallFireball = spec.variant === 'fireball-small' || spec.variant === 'fireball';
    if (!isSmallFireball) {
      var isKnifeProjectile = spec.variant === 'knife' || spec.variant === 'knife-bounce';
      var glow = new PIXI.Sprite(glowTexture());
      glow.anchor.set(0.5);
      glow.tint = isKnifeProjectile ? 0xff3850
        : (parseInt(String(theme.glow).replace('#', '0x')) || 0xffffff);
      glow.alpha = isKnifeProjectile ? 0.16 : 0.8;
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
        var targetNow = path ? {
          x: from.x + Math.cos(path.angle) * path.length,
          y: from.y + Math.sin(path.angle) * path.length
        } : posOf(targetId);
        var to = path ? targetNow : projectileTargetPoint(targetId, Math.max(0, dur - t));
        node.x = lerp(from.x, to.x, k);
        /* 火球術依使用者要求走真正直線；其他投射物保留原本的微弧線。
           水流彈的拋物線高度由模擬層的表定值決定（spec.arcM，米）——弧高是設計數值，
           顯示層不得自己挑一個固定 px（AI_RULES 8.3）。沒帶 arcM 就沿用原本的 18px 微弧。 */
        node.y = lerp(from.y, to.y, k) -
          (isSmallFireball ? 0 : Math.sin(k * Math.PI) * projectileArcPx(spec));
        node.rotation = Math.atan2(to.y - from.y, to.x - from.x);
        if (core && core._flameUpdate) core._flameUpdate(dt);
        if (core && core._fireballUpdate) core._fireballUpdate(dt);
        trailAcc += dt;
        if (!isSmallFireball && trailAcc > trailIntervalSec() && !REDUCED_MOTION) {
          trailAcc = 0;
          spawnTrailDot(node.x, node.y, theme);
        }
        if (k >= 1 || (!path && projectileNearTarget(node.x, node.y, targetId))) {
          if (!arrived) {
            arrived = true;
            if (onArrive) onArrive(targetNow);
          }
          return false;
        }
        return true;
      }
    }, 1, dur * 1000 + 600);
  }

  /* 貫穿冰箭是「一支箭沿直線穿過多個目標」，不能把路徑上的每個格子
     當成獨立目標再各自從玩家手上發射，否則畫面會看起來像逐格跳動。 */
  function spawnIcearrowPierce(spec, targets, travelMs, baseDelay, stagger, count) {
    /* 齊射的箭是均等分散開的，某一支的箭道上一個敵人都沒有很正常——
       那支箭仍然要飛出去，因此不能因為 targets 是空的就整個不畫；
       方位與行程由模擬層的 angle／lineLength 帶過來，不從目標反推。 */
    if (!targets.length && !(isFinite(spec.angle) && Number(spec.lineLength) > 0)) return;
    var flight = projectileTravelMs(travelMs, spec.dur ? spec.dur * 1000 : 300);
    for (var c = 0; c < count; c++) {
      (function (cc) {
        setTimeout(function () {
          if (fxGate(spec)) return;
          var from = playerMuzzle();
          var first = targets.length ? posOf(targets[0]) : null;
          var dx = first ? first.x - from.x : 0, dy = first ? first.y - from.y : 0;
          var angle = isFinite(spec.angle) ? Number(spec.angle) : Math.atan2(dy, dx);
          var length = Number(spec.lineLength) > 0 ? Number(spec.lineLength) : Math.sqrt(dx * dx + dy * dy);
          if (!(length > 0)) return;
          spawnProjectile(null, flight, spec, null, from, { angle: angle, length: length });

          var cos = Math.cos(angle), sin = Math.sin(angle);
          for (var ti = 0; ti < targets.length; ti++) {
            var targetId = targets[ti];
            var point = posOf(targetId);
            var along = (point.x - from.x) * cos + (point.y - from.y) * sin;
            var hitAt = Math.round(flight * Math.max(0, Math.min(1, along / length)));
            (function (id, pt, hitDelay) {
              setTimeout(function () {
                if (fxGate(spec)) return;
                spawnImpact(pt.x, pt.y, spec, false);
                hitReact(id, spec.elem, false);
              }, hitDelay);
            })(targetId, point, hitAt);
          }
        }, Math.max(0, baseDelay) + cc * stagger);
      })(c);
    }
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
    var isKnifeBounce = spec.variant === 'knife-bounce';
    var glow = new PIXI.Sprite(glowTexture());
    glow.anchor.set(0.5);
    glow.tint = isKnifeBounce ? 0xff3850
      : (parseInt(String(theme.glow).replace('#', '0x')) || 0xffffff);
    glow.alpha = isKnifeBounce ? 0.15 : 0.75;
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
        var targetNow = posOf(targetId);
        var targetAim = projectileTargetPoint(targetId, Math.max(0, dur - t));
        if (k < 0.38) {
          q = k / 0.38;
          q = q * q * (3 - 2 * q);
          x = lerp(start.x, turn.x, q);
          y = lerp(start.y, turn.y, q);
        } else {
          q = (k - 0.38) / 0.62;
          q = q * q;
          x = lerp(turn.x, targetAim.x, q);
          y = lerp(turn.y, targetAim.y, q);
        }
        var aheadX = k < 0.38 ? turn.x : targetAim.x;
        var aheadY = k < 0.38 ? turn.y : targetAim.y;
        node.x = x; node.y = y;
        node.rotation = Math.atan2(aheadY - y, aheadX - x);
        trailAcc += dt;
        if (trailAcc > Math.max(0.035, trailIntervalSec()) && !REDUCED_MOTION) {
          trailAcc = 0;
          spawnTrailDot(x, y, theme);
        }
        if (k >= 1 || projectileNearTarget(x, y, targetId)) {
          var hit = targetNow;
          spawnImpact(hit.x, hit.y, spec, false);
          hitReact(targetId, spec.elem, false);
          return false;
        }
        return true;
      }
    }, 1);
  }

  function spawnTrailDot(x, y, theme) {
    var g = new PIXI.Sprite(dotTexture());
    var base = 2.2 / DOT_TEX_RADIUS;    // 原本是半徑 2.2 的實心圓，換算成貼圖縮放
    g.anchor.set(0.5);
    g.scale.set(base);
    g.tint = cssColorToInt(theme.c2, 0xffffff);
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
        g.scale.set(base * (1 - t / 0.4));
        return t < 0.28;
      }
    }, 0);
  }

  /* 命中爆點：環 + 粒子 */
  function spawnImpact(x, y, spec, strong, targetGuard) {
    if (targetGuard && !targetGuard()) return;
    var fireExplosion = spec.variant === 'fire-explosion';
    var theme = fireExplosion
      ? { c1: '#c51e0d', c2: '#ffd447', glow: '#ff3b0a' } : themeOf(spec);
    var visualStrong = strong || fireExplosion;
    var t = 0, dur = fireExplosion ? 0.62 : (visualStrong ? 0.4 : 0.26);
    var maxR = fireExplosion ? 30 : (visualStrong ? 15 : 8.5);
    /* 逐幀 clear()＋stroke() 換成貼圖縮放，理由見 ringTexture()。 */
    var ring = new PIXI.Sprite(ringTexture());
    ring.anchor.set(0.5);
    /* ⚠️ 起始尺寸一定要在這裡就設好，不能只寫在 update() 裡。
       特效主迴圈是反向走訪 S.fx（見 tick 的特效段），而投射物命中的爆點是在
       **另一個特效的 update 裡**生出來的（spawnProjectile 的 onArrive）：新的 fx
       push 到陣列尾端時，反向迴圈早就走過那個索引，這一幀保證不會被 update；
       PIXI 的 render 又排在 ticker 的低優先級（跑在 update 之後）。
       少了這一行，命中的第一幀就會把整張 128px 環形貼圖原尺寸畫出去——
       飛刀彈射一次幾十跳，畫面上等於常駐一堆大圈，而且怎麼調 maxR 都沒用。 */
    ring.scale.set(1.3 / RING_TEX_RADIUS);
    ring.tint = cssColorToInt(theme.c1, 0xffffff);
    ring.x = x; ring.y = y;
    S.layers.fx.addChild(ring);
    addFx({
      node: ring,
      update: function (dt) {
        if (targetGuard && !targetGuard()) return false;
        t += dt;
        var k = Math.min(1, t / dur);
        ring.scale.set((1.3 + maxR * k) / RING_TEX_RADIUS);
        ring.alpha = 1 - k;
        return t < dur;
      }
    }, 1);
    spawnParticles(x, y, fireExplosion ? 22 : (strong ? 12 : 6), theme,
      fireExplosion ? 1.35 : (strong ? 0.9 : 0.55), fireExplosion ? 1.45 : 1, targetGuard);
    if (strong) addShake(5, spec);
  }

  /* 斬擊弧線 ——「這支不用改成 Sprite」，已量過（scratch/_perf_bench3.html）
     它和命中環一樣是逐幀 clear() 重繪，而且更貴（兩段 arc stroke），普攻頻率也高，
     直覺會把它當成下一個熱點。實測不是：

       每秒 10／40／80 發   中位 0.20／0.30／0.50 ms，360 幀中超標 0／0／1
       多目標技能一次 40 道 中位 0.80 ms，超標 2／360
       （對照：飛刀彈射的特效層 中位 2.20 ms，超標 14／360）

     原因是逐幀重繪的成本取決於**同時存在幾個**，不是產生頻率。弧線只活
     0.24 秒，速率再高同時數也只到 3～20；彈射鏈當初是幾十個環外加幾百顆
     粒子擠在同一批幀裡，那才是問題。改成旋轉貼圖確實能壓到 0.00 ms，
     但真實速率下省的量在雜訊裡，而且要重畫視覺——不值得冒第二次
     「特效走樣」的風險。spawnPillar 同理（中位 0.20 ms，超標 0～1／360）。

     什麼時候要回來看：如果之後有技能讓弧線同時存在數十個且持續（不是瞬間
     爆發），再跑一次 bench3 重新判斷。 */
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
  /* 迴旋斬的既有大型弧斬；可選擇沿指定方向飛出，敵人位置只畫普通命中反應。 */
  function spawnCleaveArc(x, y, spec, rotation, delaySec, travel) {
    var theme = themeOf(spec);
    var g = new PIXI.Graphics();
    g.x = x; g.y = y;
    g.rotation = typeof rotation === 'number' ? rotation : 0;
    S.layers.fx.addChild(g);
    // 與 DOM 版同步：大型斬擊弧光半徑縮為原值 1/3；一般 spawnImpact 不受影響。
    var rangeScale = Number(spec && spec.rangeScale) > 0 ? Number(spec.rangeScale) : 1;
    var t = -(delaySec || 0), dur = Math.max(0.38, spec.dur || 0.5), R = 86 / 3 * rangeScale;
    var travelAngle = travel && typeof travel.angle === 'number' ? travel.angle : 0;
    var travelDistance = travel && Number(travel.length) > 0 ? Math.max(48, Number(travel.length)) : 0;
    addFx({
      node: g,
      update: function (dt) {
        t += dt;
        g.visible = t >= 0;
        if (t < 0) return true;
        var k = Math.min(1, t / dur);
        if (travelDistance > 0) {
          var eased = k * k * (3 - 2 * k);
          g.x = x + Math.cos(travelAngle) * travelDistance * eased;
          g.y = y + Math.sin(travelAngle) * travelDistance * eased;
        }
        var head = -0.92 + k * 1.95;
        var fade = k > 0.68 ? 1 - (k - 0.68) / 0.32 : 1;
        g.clear();
        g.arc(0, 0, R, head - 1.15, head, false)
          .stroke({ color: theme.c1, width: 14.3 / 3 * rangeScale * fade, alpha: 0.95 * fade, cap: 'round' });
        g.arc(0, 0, R * 0.82, head - 0.95, head, false)
          .stroke({ color: theme.c2, width: 5.2 / 3 * rangeScale * fade, alpha: fade, cap: 'round' });
        return t < dur;
      }
    }, 1);
  }

  function spawnThrustLine(targetId, spec, angleOffset, delaySec, length, laneOffset, angleOverride, isFinal) {
    var theme = themeOf(spec);
    var from = playerMuzzle();
    var to = posOf(targetId);
    var dx = to.x - from.x, dy = to.y - from.y;
    var angle = typeof angleOverride === 'number' ? angleOverride : Math.atan2(dy, dx) + (angleOffset || 0);
    var lineLength = Math.max(48, Number(spec.lineLength) || Number(length) || 70);
    var side = angle + Math.PI / 2;
    var offset = Number(laneOffset) || 0;
    var startX = from.x + Math.cos(side) * offset;
    var startY = from.y + Math.sin(side) * offset;

    /* 正式突刺素材：以圖片的長軸作為飛行軸，並沿路徑從短到長展開。
       圖片載入失敗時才走下方 Graphics 退化畫法，避免整個戰鬥 VFX 消失。 */
    if (S.thrustLanceTex) {
      var bodyLength = isFinal ? lineLength : Math.min(96, Math.max(42, lineLength * 0.34));
      var flightDistance = Math.max(0, lineLength - bodyLength);
      var group = new PIXI.Container();
      group.x = startX; group.y = startY;
      group.rotation = angle - Math.PI / 2;
      var sprite = new PIXI.Sprite(S.thrustLanceTex);
      sprite.anchor.set(0.5, 0);
      sprite.blendMode = 'add';
      var revealMask = new PIXI.Graphics();
      group.addChild(sprite);
      group.addChild(revealMask);
      sprite.mask = revealMask;
      S.layers.fx.addChild(group);
      var st = -(delaySec || 0), sd = isFinal
        ? Math.max(0.24, spec.dur || 0.3)
        : Math.max(0.16, Math.min(0.22, (spec.dur || 0.3) * 0.75));
      var texW = Math.max(1, S.thrustLanceTex.width || 1024);
      var texH = Math.max(1, S.thrustLanceTex.height || 1536);
      var imageWidth = Math.max(28, Number(spec.lineWidth) || 36);
      addFx({
        node: group,
        update: function (dt) {
          st += dt;
          group.visible = st >= 0;
          if (st < 0) return true;
          var k = Math.min(1, st / sd);
          var reveal = isFinal ? (k < 0.4 ? k / 0.4 : 1) : 1;
          var fade = isFinal
            ? (k > 0.8 ? 1 - (k - 0.8) / 0.2 : 1)
            : (k > 0.76 ? 1 - (k - 0.76) / 0.24 : 1);
          var travel = isFinal ? 0 : flightDistance * Math.min(1, k / 0.76);
          group.x = startX + Math.cos(angle) * travel;
          group.y = startY + Math.sin(angle) * travel;
          sprite.scale.set(imageWidth / texW, bodyLength / texH);
          sprite.alpha = fade;
          revealMask.clear();
          revealMask.rect(-imageWidth / 2, 0, imageWidth, bodyLength * reveal).fill(0xffffff);
          return st < sd;
        }
      }, 1);
      return;
    }
    var fallbackBodyLength = isFinal ? lineLength : Math.min(96, Math.max(42, lineLength * 0.34));
    var fallbackFlightDistance = Math.max(0, lineLength - fallbackBodyLength);
    var g = new PIXI.Graphics();
    g.x = startX; g.y = startY; g.rotation = angle;
    S.layers.fx.addChild(g);
    var t = -(delaySec || 0), dur = isFinal
      ? Math.max(0.24, spec.dur || 0.3)
      : Math.max(0.16, Math.min(0.22, (spec.dur || 0.3) * 0.75));
    addFx({
      node: g,
      update: function (dt) {
        t += dt;
        if (t < 0) return true;
        var k = Math.min(1, t / dur);
        var fade = isFinal
          ? (k > 0.8 ? 1 - (k - 0.8) / 0.2 : 1)
          : (k > 0.76 ? 1 - (k - 0.76) / 0.24 : 1);
        var travel = isFinal ? 0 : fallbackFlightDistance * Math.min(1, k / 0.76);
        g.x = startX + Math.cos(angle) * travel;
        g.y = startY + Math.sin(angle) * travel;
        var tip = fallbackBodyLength;
        var centerX = tip * 0.5;
        var shoulderX = tip * 0.32;
        var half = Math.min(15, Math.max(5, tip * 0.22));
        g.clear();
        g.moveTo(0, 0).lineTo(tip, 0)
          .stroke({ color: 0xd8943b, width: 26 * fade, alpha: 0.2 * fade, cap: 'round' });
        g.poly([
          0, 0, shoulderX, -half * 0.45, centerX, -half,
          centerX + tip * 0.12, -half * 0.42, tip, 0,
          centerX + tip * 0.12, half * 0.42, centerX, half,
          shoulderX, half * 0.45
        ]).fill({ color: 0xa86d2d, alpha: 0.88 * fade });
        g.poly([
          0, 0, shoulderX, -half * 0.2, centerX, -half * 0.42,
          centerX + tip * 0.08, -half * 0.16, tip, 0,
          centerX + tip * 0.08, half * 0.16, centerX, half * 0.42,
          shoulderX, half * 0.2
        ]).fill({ color: 0xe1aa54, alpha: 0.9 * fade });
        g.moveTo(0, 0).lineTo(tip, 0)
          .stroke({ color: 0xfff8df, width: 4.5 * fade, alpha: 0.95 * fade, cap: 'round' });
        g.moveTo(0, 0).lineTo(tip, 0)
          .stroke({ color: theme.c2, width: 1.5 * fade, alpha: fade, cap: 'round' });
        g.moveTo(shoulderX, -half * 0.45).lineTo(centerX, -half)
          .lineTo(centerX + tip * 0.12, -half * 0.42)
          .stroke({ color: 0xf3c875, width: 1.2 * fade, alpha: 0.9 * fade, cap: 'round' });
        g.moveTo(shoulderX, half * 0.45).lineTo(centerX, half)
          .lineTo(centerX + tip * 0.12, half * 0.42)
          .stroke({ color: 0x6b421e, width: 1.2 * fade, alpha: 0.85 * fade, cap: 'round' });
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
    if (typeof targetPtOrId === 'string' && isTargetBoundThunderVfx(spec) &&
        !vfxTargetLiveForSpec(spec, targetPtOrId)) return;
    isPurple = !!isPurple || !!(spec && spec.variant === 'thunder-strike');
    var theme = themeOf(spec);
    var g = new PIXI.Graphics();
    S.layers.fx.addChild(g);
    var t = -(delaySec || 0), dur = isPurple ? 0.4 : (isMega ? 0.36 : 0.32), redraws = 0;
    addFx({
      node: g,
      update: function (dt) {
        if (typeof targetPtOrId === 'string' && !vfxTargetLiveForSpec(spec, targetPtOrId)) return false;
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
          spawnImpact(to.x, to.y, spec, !!(isMega || isPurple), function () {
            return typeof targetPtOrId !== 'string' || vfxTargetLiveForSpec(spec, targetPtOrId);
          });
          if (typeof targetPtOrId === 'string') {
            hitReact(targetPtOrId, spec.elem || 'lightning', !!(isMega || isPurple));
          }
          if (isMega || isPurple) {
            addShake(isPurple ? 5 : 3, spec);
          }
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
    /* 泛用 aura 的綠色矩形不是任何風系技能的合法外觀。
       追蹤風刃由 spawnIceField 畫半月刃；其他風系技能由各自的專用畫法處理。
       即使遇到未知／延遲 variant，也不能退回這條方框 fallback。 */
    if (!rect || (spec && spec.elem === 'wind')) return;
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
  /* 火狩（新版技能【火狩】）：釘在玩家身上、持續旋轉的環繞體。
     模擬層送來的 area 帶 r（環繞半徑）／orbR（單團體積半徑）／orbs（團數）／spin（方向）／
     spinRate（弧度／秒），畫面旋轉速度必須沿用模擬層的實際角速度；舊事件沒有 spinRate
     時退回每秒 1 圈，避免快取中的舊事件完全失效。
     顯示層必須沿用同一組數字——這就是模擬層實際判定接觸的圓，畫小了玩家會覺得
     「明明沒碰到卻扣血」。圓心不取 area 的 x／y 而是逐幀讀玩家目前座標：
     火狩本來就跟著玩家跑，用施放當下的座標會整團留在原地。
     同一道（半徑＋方向相同）只保留一個節點：【再生】延長持續時間時模擬層會補送
     同一道的事件，沒有這層合併就會愈疊愈多團。 */
  var FX_ORBIT_MAX_SEC = 12;       // 環繞體的顯示上限（秒）；【再生】可延長，但不無限延長
  var _fireHuntRings = Object.create(null);
  function spawnFireHunt(spec) {
    var a = spec && spec.area;
    if (!a || !isFinite(a.r)) return;
    var ringR = Math.max(6, Number(a.r) || 0);
    var orbR = Math.max(3, Number(a.orbR) || 0);
    var orbs = Math.max(1, Math.min(12, Math.floor(Number(a.orbs) || 1)));
    var ccw = Number(a.spin) < 0;
    var dur = Math.min(FX_ORBIT_MAX_SEC, Math.max(0.5, spec.dur || 4));
    /* 合併鍵要含變體與屬性：火狩與環體電球可能同時存在且半徑相同，
       只用「半徑＋方向」當鍵會讓後來的那一道被誤認成同一道而整組不畫。 */
    var key = (spec.variant || 'firehunt') + ':' + (spec.elem || '') + ':' +
      Math.round(ringR) + ':' + (ccw ? 'ccw' : 'cw');
    var ring = _fireHuntRings[key];
    if (ring && !ring.done && ring.fx && !ring.fx.dead) {
      ring.dur = Math.min(FX_ORBIT_MAX_SEC, Math.max(ring.dur, ring.t + dur));
      ring.orbs = orbs;
      return;
    }

    var theme = themeOf(spec);
    var spinRate = Number(a.spinRate);
    var spin = isFinite(spinRate) && Math.abs(spinRate) > 1e-6
      ? spinRate : (ccw ? -1 : 1) * Math.PI * 2;
    var node = new PIXI.Container();
    S.layers.fx.addChild(node);
    var g = new PIXI.Graphics();
    node.addChild(g);
    ring = { t: 0, dur: dur, orbs: orbs, done: false, fx: null };
    _fireHuntRings[key] = ring;
    var partAcc = 0;
    var ringFx = addFx({
      node: node,
      update: function (dt) {
        ring.t += dt;
        var p = playerPos();
        node.x = p.x; node.y = p.y - 12;      // 略高於腳底，對齊角色貼圖的視覺中心
        var fade = ring.t > ring.dur - 0.4 ? Math.max(0, (ring.dur - ring.t) / 0.4) : 1;
        var base = spin * ring.t;
        g.clear();
        g.circle(0, 0, ringR).stroke({ color: theme.c1, width: 1.5, alpha: 0.18 * fade });
        for (var i = 0; i < ring.orbs; i++) {
          var ang = base + Math.PI * 2 * i / ring.orbs;
          var ox = Math.cos(ang) * ringR;
          var oy = Math.sin(ang) * ringR * 0.62;  // 俯視壓扁，與棋盤的透視一致
          g.circle(ox, oy, orbR).fill({ color: theme.c2, alpha: 0.85 * fade });
          g.circle(ox, oy, orbR * 0.55).fill({ color: theme.c1, alpha: 0.95 * fade });
          // 尾焰拖在行進方向的後方
          g.circle(ox - Math.cos(ang + spin * 0.08) * orbR * 0.8, oy - Math.sin(ang + spin * 0.08) * orbR * 0.5,
            orbR * 0.42).fill({ color: theme.glow || theme.c1, alpha: 0.4 * fade });
        }
        partAcc += dt;
        if (partAcc > 0.12 && !REDUCED_MOTION && fade > 0.5) {
          partAcc = 0;
          var sa = base + Math.PI * 2 * Math.floor(Math.random() * ring.orbs) / ring.orbs;
          spawnRiser(p.x + Math.cos(sa) * ringR, p.y - 12 + Math.sin(sa) * ringR * 0.62, theme, spec.glyph);
        }
        if (ring.t >= ring.dur) {
          ring.done = true;
          if (_fireHuntRings[key] === ring) delete _fireHuntRings[key];
        }
        return ring.t < ring.dur;
      }
    }, FX_PERSISTENT_AURA_PRIORITY, (FX_ORBIT_MAX_SEC + 1) * 1000);
    if (!ringFx) {
      /* 容量真的無法容納時不能留下未追蹤的 ring；否則下一次刷新會誤以為
         畫面上仍有同一道火狩，永遠不再建立節點。 */
      ring.done = true;
      if (_fireHuntRings[key] === ring) delete _fireHuntRings[key];
      return;
    }
    ring.fx = ringFx;
  }

  /* 火牆（新版技能【無限火牆】）：沿傷害矩形長軸排列的直立火焰柱。
     模擬層送來的 area 帶 w／h／a（長、寬、朝向弧度），顯示層必須沿用同一組數字——
     傷害範圍與畫面範圍對不起來，是這類地板技能最難查的一種回報。
     同一道牆的多次傷害事件共用 vfxId，避免每一跳都疊一個矩形框。 */
  var _fireWallFx = Object.create(null);
  var FIRE_WALL_MAX_LIFE_SEC = 4.5;
  function spawnFireWall(spec) {
    var a = spec && spec.area;
    if (!a || !isFinite(a.x) || !isFinite(a.y)) return null;
    var key = a.id || [Math.round(a.x), Math.round(a.y), Math.round(a.w || 0), Math.round(a.h || 0), Math.round(a.a || 0)].join(':');
    var holdMs = Math.max(900, Number(spec.dur || 0.5) * 2400);
    var current = _fireWallFx[key];
    if (current && !current.dead && current.node && !current.node.destroyed) {
      current.x = Number(a.x);
      current.y = Number(a.y);
      current.w = Math.max(10, Number(a.w) || current.w);
      current.h = Math.max(8, Number(a.h) || current.h);
      current.angle = Number(a.a) || 0;
      current.expiresAt = nowMs() + holdMs;
      return current;
    }

    var theme = themeOf(spec);
    var node = new PIXI.Container();
    var g = new PIXI.Graphics();
    node.addChild(g);
    S.layers.zone.addChild(node);
    var fx = {
      node: node, x: Number(a.x), y: Number(a.y), w: Math.max(10, Number(a.w) || 10),
      h: Math.max(8, Number(a.h) || 8), angle: Number(a.a) || 0,
      t: 0, expiresAt: nowMs() + holdMs, key: key, dead: false
    };
    _fireWallFx[key] = fx;
    var particleAt = 0;

    addFx({
      node: node,
      update: function (dt) {
        fx.t += dt;
        node.x = fx.x;
        node.y = fx.y;
        // 柱體永遠由地面向上；方向只用來排列三個柱體，不能旋轉柱體的高度軸。
        node.rotation = 0;
        var fade = fx.expiresAt - nowMs() < 360 ? Math.max(0, (fx.expiresAt - nowMs()) / 360) : 1;
        var w = fx.w;
        var h = fx.h;
        var groundY = h * 0.32;
        var baseDepth = Math.max(10, Math.min(30, h * 0.48));
        // 火牆的長度沿地面橫向延伸，但火焰本體要向上立起，不能只是一條火帶。
        var flameH = Math.max(72, Math.min(180, h * 2.8));
        var phase = fx.t * 5.2;
        var axisAngle = fx.angle;
        var axisX = Math.cos(axisAngle);
        var axisY = Math.sin(axisAngle);
        var perpX = -axisY;
        var perpY = axisX;
        var i;

        g.clear();
        // 貼地黑灰焦痕與橘色熱浪底座，讓直立牆有明確的地面接點。
        var shadowLong = w * 0.5;
        var shadowWide = baseDepth * 0.34;
        var shadowY = groundY + baseDepth * 0.16;
        g.poly([
          -axisX * shadowLong + perpX * shadowWide, shadowY - axisY * shadowLong + perpY * shadowWide,
          axisX * shadowLong + perpX * shadowWide, shadowY + axisY * shadowLong + perpY * shadowWide,
          axisX * shadowLong - perpX * shadowWide, shadowY + axisY * shadowLong - perpY * shadowWide,
          -axisX * shadowLong - perpX * shadowWide, shadowY - axisY * shadowLong - perpY * shadowWide
        ]).fill({ color: 0x30231d, alpha: 0.5 * fade });
        // 三個獨立的火龍捲沿傷害矩形長軸並排；每個柱體仍保持世界座標的垂直噴發。
        var vortexW = Math.max(24, w * 0.34);
        for (var vi = 0; vi < 3; vi++) {
          var vortexOffset = (vi - 1) * w * 0.31;
          var vortexX = axisX * vortexOffset;
          var vortexGroundY = groundY + axisY * vortexOffset;
          var vortexH = flameH * (0.88 + vi * 0.035);
          var vortexPhase = phase + vi * 1.9;
          var silhouette = [];
          for (var vs = 0; vs <= 6; vs++) {
            var vu = vs / 6;
            var vy = vortexGroundY + baseDepth * 0.08 - vortexH * vu;
            var vsway = Math.sin(vortexPhase + vu * 7.2) * vortexW * 0.13 * (1 - vu * 0.45);
            var vhalf = vortexW * (0.52 - vu * 0.12);
            silhouette.push(vortexX + vsway - vhalf, vy);
          }
          for (vs = 6; vs >= 0; vs--) {
            vu = vs / 6;
            vy = vortexGroundY + baseDepth * 0.08 - vortexH * vu;
            vsway = Math.sin(vortexPhase + vu * 7.2) * vortexW * 0.13 * (1 - vu * 0.45);
            vhalf = vortexW * (0.52 - vu * 0.12);
            silhouette.push(vortexX + vsway + vhalf, vy);
          }
          g.poly(silhouette).fill({ color: vi === 1 ? 0xe43b12 : 0xc82b12, alpha: 0.46 * fade });
          for (var ri = 0; ri < 4; ri++) {
            var ribbon = [];
            for (var rs = 0; rs <= 6; rs++) {
              var ru = rs / 6;
              var ry = vortexGroundY + baseDepth * 0.05 - vortexH * ru;
              var rx = vortexX + Math.sin(vortexPhase + ri * 1.55 + ru * 8.6) * vortexW * 0.29 * (1 - ru * 0.38);
              var rw = Math.max(3, vortexW * (0.13 - ru * 0.035));
              ribbon.push(rx - rw, ry);
            }
            for (rs = 6; rs >= 0; rs--) {
              ru = rs / 6;
              ry = vortexGroundY + baseDepth * 0.05 - vortexH * ru;
              rx = vortexX + Math.sin(vortexPhase + ri * 1.55 + ru * 8.6) * vortexW * 0.29 * (1 - ru * 0.38);
              rw = Math.max(3, vortexW * (0.13 - ru * 0.035));
              ribbon.push(rx + rw, ry);
            }
            g.poly(ribbon).fill({ color: ri === 1 ? 0xffd84a : (ri % 2 ? 0xff7618 : 0xffa51d),
              alpha: (ri === 1 ? 0.78 : 0.68) * fade });
          }
          g.ellipse(vortexX, vortexGroundY - vortexH * 0.38, vortexW * 0.18, vortexH * 0.31)
            .fill({ color: 0xffffbd, alpha: 0.3 * fade });
          g.poly([vortexX - vortexW * 0.18, vortexGroundY - vortexH * 0.82,
            vortexX + vortexW * 0.02, vortexGroundY - vortexH * 1.08,
            vortexX + vortexW * 0.2, vortexGroundY - vortexH * 0.88,
            vortexX + vortexW * 0.08, vortexGroundY - vortexH * 0.7])
            .fill({ color: 0xffff7a, alpha: 0.62 * fade });
        }

        // 火牆上方的低煙，不遮住火焰，只用半透明灰褐色顆粒帶出參考圖的煙塵感。
        for (i = 0; i < 9; i++) {
          var smokeU = (i + 0.5) / 9;
          var smokeOffset = -w * 0.43 + w * 0.86 * smokeU;
          var smokeX = axisX * smokeOffset + Math.sin(phase * 0.35 + i) * 5;
          var smokeY = groundY + axisY * smokeOffset - flameH * (0.72 + (i % 3) * 0.08) - Math.sin(phase * 0.48 + i * 1.3) * 4;
          var smokeR = 4 + (i % 3) * 2.2;
          g.circle(smokeX, smokeY, smokeR).fill({ color: i % 2 ? 0x5a5148 : 0x76624d, alpha: 0.13 * fade });
        }

        particleAt += dt;
        if (!REDUCED_MOTION && particleAt > 0.1 && fade > 0.45) {
          particleAt = 0;
          var particleOffset = (Math.random() - 0.5) * w * 0.72;
          spawnParticles(fx.x + axisX * particleOffset,
            fx.y + axisY * particleOffset - flameH * (0.45 + Math.random() * 0.3), 3, theme, 1.2, 0.7);
        }
        if (nowMs() >= fx.expiresAt) {
          fx.dead = true;
          if (_fireWallFx[key] === fx) delete _fireWallFx[key];
          return false;
        }
        return true;
      }
    }, 2, FIRE_WALL_MAX_LIFE_SEC * 1000);
    return fx;
  }

  /* 場域的移動／尺寸只屬於顯示層：模擬層仍以自己的 tick 頻率判定傷害，
     這裡只把兩次權威快照之間的畫面補齊，避免場域一格一格跳動。
     Worker 事件通常每 0.2 秒批次送達；最短補間不能跟著技能的 0.1 秒傷害間隔
     縮成短促的瞬移，否則事件在同一幀到達時，玩家仍會看到一格一格的風刃。 */
  var FIELD_VFX_MIN_MOTION_SEC = 0.12;
  function fieldVfxMotionSec(spec, fallback) {
    var sec = Number(spec && spec.dur);
    return Math.max(FIELD_VFX_MIN_MOTION_SEC, isFinite(sec) && sec > 0 ? sec : fallback);
  }

  /* ---- 追蹤場域（追跡風刃／追蹤冰箭）的畫面位置：指數跟隨 ----
     一則事件＝模擬層的一個節拍，但事件的**到達節奏本身就不平均**。
     同一顆場域的實測到達序列（毫秒／位移）：204/35.1、0/1.6、94/16.9、110/18、
     118/18.5、178/34.9、0/1.6……＝有時一批帶兩步、有時緊接著補一個零頭步、
     有時單步早到。把每則都當成「固定時間內走完的一段補間」時：事件早到就得衝刺、
     晚到就走完停住——用這條真實序列回放，有 13.9% 的畫格完全靜止、另有一批畫格
     是兩倍速。那正是玩家說的「一格一格移動」。

     改用指數跟隨：速度只取決於「離權威座標多遠」（v = 距離 / TAU，並以模擬層
     速度的 MAX_MULT 倍為上限）。目標暫停時自己平滑減速、目標跳一大步時自己加速，
     沒有任何硬停頓；同一條序列回放後靜止畫格降到 4.9%（且最慢的畫格仍在移動，
     剩下的都是風刃真的在轉向）。
     平衡點的落後距離＝速度 × TAU（180px/s 約 25px），小於風刃自身的體積，
     判定圈與畫面仍然重疊。判定位置永遠是模擬層的 area.x/y，這裡只管畫面。 */
  var FIELD_VFX_FOLLOW_TAU_SEC = 0.14;
  var FIELD_VFX_FOLLOW_MAX_MULT = 2;
  function fieldVfxSetFollowTarget(fx, x, y) {
    fx.motionToX = Number(x);
    fx.motionToY = Number(y);
  }
  function fieldVfxFollowStep(fx, dt) {
    var dx = fx.motionToX - fx.x, dy = fx.motionToY - fx.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (!(dist > 0.01) || !(dt > 0)) return;
    var want = dist / FIELD_VFX_FOLLOW_TAU_SEC;
    var cap = (Number(fx.speed) > 0 ? Number(fx.speed) : want) * FIELD_VFX_FOLLOW_MAX_MULT;
    var step = Math.min(dist, Math.min(want, cap) * dt);
    fx.x += dx / dist * step;
    fx.y += dy / dist * step;
  }

  /* 移動場域必須有模擬層發出的穩定 id。座標只能當靜態舊事件的退化鍵；
     若拿座標當追蹤風刃的鍵，每跨過一個整數座標就會重建一顆節點，
     這正是「半月風刃一格一格跳」與多個殘影同時存在的來源。 */
  function fieldVfxKey(area, variant) {
    var id = area && (area.id || area.fieldKey || area.vfxId);
    if (id !== undefined && id !== null && id !== '') return String(id) + ':' + variant;
    if (variant === 'ice-arrow-homing' || variant === 'wind-blade-homing') return null;
    return [Math.round(area && area.x), Math.round(area && area.y)].join(':') + ':' + variant;
  }

  function fieldVfxWindAngle(fx) {
    /* 行進方向＝從畫面目前位置指向權威座標；跟隨模型沒有「這一段的起點」，
       而這個向量本來就是刀鋒正在飛的方向。 */
    var dx = fx.motionToX - fx.x, dy = fx.motionToY - fx.y;
    if (Math.abs(dx) + Math.abs(dy) <= 0.5 && isFinite(fx.destX) && isFinite(fx.destY)) {
      dx = fx.destX - fx.x; dy = fx.destY - fx.y;
    }
    return Math.abs(dx) + Math.abs(dy) > 0.5 ? Math.atan2(dy, dx) : fx.windAngle;
  }

  /* 位置只補間權威 area.x/y；方向也沿著同一個快照方向緩慢轉向，
     不讓半月刃在追擊轉彎時瞬間折角。這只影響畫面，不改傷害判定。 */
  function fieldVfxWindAngleStep(fx, dt) {
    var target = fieldVfxWindAngle(fx);
    if (!isFinite(target)) return 0;
    if (!isFinite(fx.windAngle)) fx.windAngle = target;
    var safeDt = Math.max(0, Number(dt) || 0);
    var k = 1 - Math.exp(-safeDt * 14);
    var delta = Math.atan2(Math.sin(target - fx.windAngle), Math.cos(target - fx.windAngle));
    fx.windAngle += delta * k;
    return fx.windAngle;
  }

  function fieldVfxSetTarget(fx, x, y, w, h, duration) {
    fx.motionFromX = fx.x;
    fx.motionFromY = fx.y;
    fx.motionFromW = fx.w;
    fx.motionFromH = fx.h;
    fx.motionToX = Number(x);
    fx.motionToY = Number(y);
    fx.motionToW = Math.max(1, Number(w));
    fx.motionToH = Math.max(1, Number(h));
    fx.motionT = 0;
    fx.motionDur = Math.max(0.05, Number(duration) || 0.35);
  }

  function fieldVfxSetPositionTarget(fx, x, y, duration) {
    fx.motionFromX = fx.x;
    fx.motionFromY = fx.y;
    fx.motionToX = Number(x);
    fx.motionToY = Number(y);
    fx.motionT = 0;
    fx.motionDur = Math.max(0.05, Number(duration) || 0.35);
  }

  function fieldVfxStep(fx, dt) {
    if (!(fx.motionDur > 0)) return;
    fx.motionT = Math.min(fx.motionDur, fx.motionT + Math.max(0, Number(dt) || 0));
    var k = Math.min(1, fx.motionT / fx.motionDur);
    fx.x = lerp(fx.motionFromX, fx.motionToX, k);
    fx.y = lerp(fx.motionFromY, fx.motionToY, k);
    fx.w = lerp(fx.motionFromW, fx.motionToW, k);
    fx.h = lerp(fx.motionFromH, fx.motionToH, k);
  }

  /* 泥沼／熔岩沼（新版技能 mire）：貼地的橫向長方形場域。
     與火牆同為「按 area.id 合併、每次 tick 續命」的長駐特效，但尺寸直接沿用
     area.w／area.h；只把顯示高度壓成 52%，不改實際方形範圍。毒沼 variant 額外畫深紫色氣流與泡泡。 */
  var _mirePoolFx = Object.create(null);
  var MIRE_POOL_MAX_LIFE_SEC = 14;
  var MIRE_VISUAL_HEIGHT_RATIO = 0.52;
  function spawnMirePool(spec) {
    var a = spec && spec.area;
    if (!a || !isFinite(a.x) || !isFinite(a.y)) return null;
    var lava = spec.variant === 'mire-lava' || spec.variant === 'mire-lava-poison';
    var poison = spec.variant === 'mire-poison' || spec.variant === 'mire-lava-poison';
    var key = (a.id || [Math.round(a.x), Math.round(a.y)].join(':'))
      + (lava ? ':lava' : '') + (poison ? ':poison' : '');
    var holdMs = Math.max(700, Number(spec.dur || 0.5) * 2200);
    var current = _mirePoolFx[key];
    if (current && !current.dead && current.node && !current.node.destroyed) {
      fieldVfxSetTarget(current, Number(a.x), Number(a.y),
        Math.max(20, Number(a.w) || current.w), Math.max(16, Number(a.h) || current.h),
        fieldVfxMotionSec(spec, 0.5));
      current.lava = lava;
      current.poison = poison;
      current.expiresAt = nowMs() + holdMs;
      return current;
    }
    var node = new PIXI.Container();
    var g = new PIXI.Graphics();
    node.addChild(g);
    S.layers.zone.addChild(node);
    var fx = {
      node: node, x: Number(a.x), y: Number(a.y),
      w: Math.max(20, Number(a.w) || 100), h: Math.max(16, Number(a.h) || 100),
      lava: lava, poison: poison, t: 0, expiresAt: nowMs() + holdMs, key: key, dead: false,
      motionFromX: Number(a.x), motionFromY: Number(a.y),
      motionFromW: Math.max(20, Number(a.w) || 100), motionFromH: Math.max(16, Number(a.h) || 100),
      motionToX: Number(a.x), motionToY: Number(a.y),
      motionToW: Math.max(20, Number(a.w) || 100), motionToH: Math.max(16, Number(a.h) || 100),
      motionT: 1, motionDur: 1
    };
    _mirePoolFx[key] = fx;
    var bubbleAt = 0;

    addFx({
      node: node,
      update: function (dt) {
        fx.t += dt;
        fieldVfxStep(fx, dt);
        node.x = fx.x; node.y = fx.y; node.rotation = 0;
        var left = fx.expiresAt - nowMs();
        var fade = left < 420 ? Math.max(0, left / 420) : 1;
        /* 地面判定仍是方形；顯示層只壓低高度，畫成橫向長方形。 */
        var visualH = Math.max(16, fx.h * MIRE_VISUAL_HEIGHT_RATIO);
        var rx = fx.w * 0.5;
        var ry = visualH * 0.5;
        var phase = fx.t * 2.1;
        var body = fx.poison ? 0x4a3020 : (fx.lava ? 0x8a2b0b : 0x4a3a20);
        var rim = fx.poison ? 0x5b2b72 : (fx.lava ? 0xff7a2a : 0x7d6533);
        var glow = fx.poison ? 0x7e3f9a : (fx.lava ? 0xffb347 : 0xa37a48);
        var bubble = fx.poison ? 0x6b2d7c : (fx.lava ? 0xffd282 : 0xc49b68);
        g.clear();
        g.rect(-rx, -ry, fx.w, visualH).fill({ color: body, alpha: 0.5 * fade });
        g.rect(-rx, -ry, fx.w, visualH).stroke({ width: 3, color: rim, alpha: 0.62 * fade });
        // 長方形內的慢速漣漪：只作為泥面流動，不改變場域邊界。
        for (var ri = 0; ri < 3; ri++) {
          var u = ((phase * 0.32 + ri / 3) % 1);
          var rw = rx * (0.28 + u * 0.62), rh = ry * (0.28 + u * 0.62);
          g.rect(-rw, -rh, rw * 2, rh * 2)
            .stroke({ width: 2, color: glow, alpha: (0.34 * (1 - u)) * fade });
        }
        if (fx.poison) {
          // 深紫色氣流在泥面上緩慢橫向流動；使用固定波形避免每幀閃爍。
          for (var ci = 0; ci < 3; ci++) {
            var cy = -ry * 0.48 + ci * ry * 0.46;
            var path = g.moveTo(-rx * 0.78, cy);
            for (var si = 1; si <= 6; si++) {
              var su = si / 6;
              path = path.lineTo(-rx * 0.78 + fx.w * 0.13 * si,
                cy + Math.sin(phase * 0.9 + ci * 1.7 + su * 7) * ry * 0.1);
            }
            path.stroke({ color: 0x6b2d7c, width: 3, alpha: 0.56 * fade });
          }
        }
        // 泡泡：固定相位加上上升量，讓泡泡看起來真的從泥面冒出。
        for (var bi = 0; bi < 6; bi++) {
          var ba = phase * 0.7 + bi * 1.9;
          var brr = 0.28 + ((bi * 0.17 + phase * 0.11) % 0.62);
          var bx = Math.cos(ba) * rx * brr;
          var rise = (fx.t * (14 + bi * 2) + bi * 17) % Math.max(1, ry * 0.55);
          var by = Math.sin(ba) * ry * brr - rise;
          var br = 2.4 + (bi % 3) * 1.4 + Math.sin(phase * 1.7 + bi) * 0.9;
          g.circle(bx, by, Math.max(1, br)).fill({ color: bubble, alpha: 0.34 * fade });
          g.circle(bx, by, Math.max(1, br)).stroke({ color: glow, width: 1.3, alpha: 0.52 * fade });
        }
        bubbleAt += dt;
        if (!REDUCED_MOTION && bubbleAt > 0.28 && fade > 0.4) {
          bubbleAt = 0;
          var bubbleTheme = fx.poison
            ? { c1: '#6b2d7c', c2: '#a855c7', glow: '#7e3f9a' }
            : themeOf(spec);
          spawnParticles(fx.x + (Math.random() - 0.5) * fx.w * 0.6,
            fx.y + (Math.random() - 0.5) * ry * 1.2, 2, bubbleTheme, 0.9, 0.5);
        }
        if (nowMs() >= fx.expiresAt) {
          fx.dead = true;
          if (_mirePoolFx[key] === fx) delete _mirePoolFx[key];
          return false;
        }
        return true;
      }
    }, 2, MIRE_POOL_MAX_LIFE_SEC * 1000);
    return fx;
  }

  /* ---- 冰系／追跡風刃場域（2026-08-17～18）----
     場域全部以模擬層送來的 area 為唯一錨點（不用棋盤格 rect），因此畫面範圍與
     實際判定範圍恆等（AI_RULES 8.3：不得由表現層自行挑一個固定尺寸）：
       暴風雪          blizzard          矩形雲霧＋落雪，跟隨我方
       水龍捲          water-tornado     圓形漏斗，釘在地板
       追蹤冰箭        ice-arrow-homing  菱形冰晶（＝冰箭本體），持續移動
       追跡風刃        wind-blade-homing 小型風刃，持續追蹤
     同一個 area.id 只保留一個節點、每次事件續命；追蹤冰箭／追跡風刃只沿用場域的
     移動邏輯，外形一律沿用飛行物本體（冰箭＝菱形冰晶、風刃＝半月刃），
     不得退化成藍色圓球——那會看起來像另外多射出一種東西。 */
  var _iceFieldFx = Object.create(null);
  var ICE_FIELD_MAX_LIFE_SEC = 14;
  var ICE_FIELD_THEME = { c1: '#7dd3fc', c2: '#e0f2fe', glow: '#22d3ee' };

  /* ===========================================================================
     風系特效（2026-08-18 技能改造第八批）
     ---------------------------------------------------------------------------
     設計文檔指定的外形，逐項對應：
       風刃      wind-blade / wind-blade-small  半月箭頭弧形、淡綠＋白光，沿方位飛出
       追跡風刃  wind-blade-homing              小風刃在場上追擊（走地板場域那條路）
       沿途脈衝  wind-burst                     狂風碎裂的環狀衝擊
       真空斬    wind-slash                     前方半月弧
       迴旋斬    wind-spin                      圍繞周身的一整圈
       虛空斬    void-disc                      綠色白光帶鋸齒的圓盤，順／逆時針各一
       暴風屏障  storm-barrier / storm-god / storm-rip  纏在自身的風殼
     尺寸全部取自模擬層（lineLength 飛行距離、lineWidth 刀寬、bodyLength 刀身厚、
     area.r 半徑、area.grow 每秒擴大量）——這些就是實際判定用的數字，
     顯示層不得自己挑一組（AI_RULES 8.3）。 */

  /* 半月箭頭弧形的輪廓（局部座標以 +x 為行進方向）：
     前緣是一條凸向前的弧、後緣是一條較淺的弧，兩端自然收尖。 */
  function windCrescentPoly(width, body) {
    var half = Math.max(3, width * 0.5);
    var depth = Math.max(3, body);
    var pts = [];
    var steps = 10;
    var i, t;
    for (i = 0; i <= steps; i++) {
      t = -1 + 2 * i / steps;
      pts.push(depth * (1 - t * t), half * t);
    }
    for (i = steps; i >= 0; i--) {
      t = -1 + 2 * i / steps;
      pts.push(depth * 0.26 * (1 - t * t), half * t * 0.9);
    }
    return pts;
  }
  /* 刀身只畫一次（靜態 Graphics）：飛行途中只搬動節點。
     逐幀 clear() 重畫是這個渲染器最貴的動作，能不做就不做。 */
  function drawWindCrescent(g, width, body, theme, alpha) {
    var a = (alpha === undefined) ? 1 : alpha;
    g.poly(windCrescentPoly(width, body))
      .fill({ color: cssColorToInt(theme.c1, 0x86efac), alpha: 0.85 * a });
    g.poly(windCrescentPoly(width * 0.7, body * 0.72))
      .fill({ color: cssColorToInt(theme.c2, 0xffffff), alpha: 0.9 * a });
    g.poly(windCrescentPoly(width, body))
      .stroke({ color: cssColorToInt(theme.c2, 0xffffff), width: 2, alpha: 0.85 * a });
  }

  /* 風刃：沿模擬層的方位直線飛出。路徑上可能一個敵人都沒有（四方向齊射），
     因此方位取事件帶來的 angle，不從 targets 反推。 */
  function spawnWindBlade(spec, targets, baseDelay) {
    var length = Math.max(40, Number(spec.lineLength) || 240);
    var width = Math.max(8, Number(spec.lineWidth) || 40);
    var body = Math.max(5, Number(spec.bodyLength) || width * 0.4);
    var flight = Math.max(120, Number(spec.travelMs && spec.travelMs[0]) || 700);
    setTimeout(function () {
      if (fxGate(spec)) return;
      var theme = themeOf(spec);
      var from = playerMuzzle();
      var angle = isFinite(spec.angle) ? Number(spec.angle)
        : (targets && targets.length
          ? (function () { var p = posOf(targets[0]); return Math.atan2(p.y - from.y, p.x - from.x); })()
          : ((S.player && S.player.facing < 0) ? Math.PI : 0));
      var node = new PIXI.Container();
      var g = new PIXI.Graphics();
      node.addChild(g);
      drawWindCrescent(g, width, body, theme, 1);
      node.x = from.x; node.y = from.y; node.rotation = angle;
      S.layers.fx.addChild(node);
      var t = 0, dur = flight / 1000, trail = 0;
      addFx({
        node: node,
        update: function (dt) {
          t += dt;
          var k = Math.min(1, t / dur);
          node.x = from.x + Math.cos(angle) * length * k;
          node.y = from.y + Math.sin(angle) * length * k;
          node.alpha = k > 0.88 ? Math.max(0, (1 - k) / 0.12) : 1;
          trail += dt;
          if (trail > 0.06 && !REDUCED_MOTION) { trail = 0; spawnTrailDot(node.x, node.y, theme); }
          return k < 1;
        }
      }, 1, flight + 400);
      /* 命中反饋依「目標在路徑上的投影距離」排時間，才會是刀鋒掃過去才亮，
         而不是整條路徑同時亮（比照貫穿冰箭）。 */
      var cos = Math.cos(angle), sin = Math.sin(angle);
      (targets || []).forEach(function (id) {
        var pt = posOf(id);
        var along = (pt.x - from.x) * cos + (pt.y - from.y) * sin;
        var at = Math.round(flight * Math.max(0, Math.min(1, along / length)));
        setTimeout(function () {
          if (fxGate(spec)) return;
          spawnImpact(pt.x, pt.y, spec, false);
          hitReact(id, spec.elem, false);
        }, at);
      });
    }, Math.max(0, baseDelay || 0));
  }

  /* 狂風碎裂的沿途脈衝：以模擬層的圓心與半徑畫一圈擴散的氣浪。 */
  function spawnWindBurst(spec) {
    var a = spec && spec.area;
    if (!a || !isFinite(a.x) || !isFinite(a.y)) return;
    var r = Math.max(12, Number(a.r) || 40);
    var theme = themeOf(spec);
    var node = new PIXI.Graphics();
    node.x = a.x; node.y = a.y - 10;
    S.layers.fx.addChild(node);
    var t = 0, dur = 0.34;
    addFx({
      node: node,
      update: function (dt) {
        t += dt;
        var k = Math.min(1, t / dur);
        node.clear();
        node.ellipse(0, 0, r * (0.45 + k * 0.6), r * (0.45 + k * 0.6) * 0.6)
          .stroke({ color: cssColorToInt(theme.c1, 0x86efac), width: 3, alpha: (1 - k) * 0.9 });
        node.ellipse(0, 0, r * (0.2 + k * 0.5), r * (0.2 + k * 0.5) * 0.6)
          .stroke({ color: cssColorToInt(theme.c2, 0xffffff), width: 1.5, alpha: (1 - k) * 0.7 });
        return k < 1;
      }
    }, 1, dur * 1000 + 200);
  }

  /* 風切擴散：來源敵人 → 每個被傳染的敵人各掠過一道小風刃。
     終點逐幀取目標當下座標（敵人會移動），落點只補一般命中爆點，
     不另外畫範圍圈——擴散本身不造成傷害，沒有可畫的判定範圍。 */
  function spawnWindRendSpread(targets, spec, baseDelay) {
    if (!targets || targets.length < 2) return;
    var fromId = targets[0];
    var travel = projectileTravelMs(spec.travelMs && spec.travelMs[0], 120);
    targets.slice(1).forEach(function (toId, i) {
      setTimeout(function () {
        if (fxGate(spec)) return;
        var theme = themeOf(spec);
        var from = posOf(fromId);
        var node = new PIXI.Container();
        var g = new PIXI.Graphics();
        node.addChild(g);
        /* 小風刃的體積沒有模擬層來源（擴散不是傷害事件），
           因此沿用小型風刃在畫面上的既有比例，不去假造一組判定尺寸。 */
        drawWindCrescent(g, 20, 8, theme, 1);
        node.x = from.x; node.y = from.y;
        S.layers.fx.addChild(node);
        var t = 0, dur = Math.max(0.08, travel / 1000), arrived = false;
        addFx({
          node: node,
          update: function (dt) {
            t += dt;
            var k = Math.min(1, t / dur);
            var to = posOf(toId);
            node.x = from.x + (to.x - from.x) * k;
            node.y = from.y + (to.y - from.y) * k;
            node.rotation = Math.atan2(to.y - from.y, to.x - from.x);
            node.alpha = k > 0.85 ? Math.max(0, (1 - k) / 0.15) : 1;
            if (k >= 1 && !arrived) {
              arrived = true;
              spawnImpact(to.x, to.y, spec, false);
              hitReact(toId, spec.elem || 'wind', false);
            }
            return k < 1;
          }
        }, 1, travel + 400);
      }, Math.max(0, baseDelay || 0) + i * 40);
    });
  }

  /* 真空斬：自身前方揮出的半月弧（不飛行，原地張開後淡出）。 */
  function spawnWindSlash(spec, targets, baseDelay) {
    var radius = Math.max(24, Number(spec.lineLength) || 60);
    setTimeout(function () {
      if (fxGate(spec)) return;
      var theme = themeOf(spec);
      var from = playerMuzzle();
      var angle = (targets && targets.length)
        ? (function () { var p = posOf(targets[0]); return Math.atan2(p.y - from.y, p.x - from.x); })()
        : ((S.player && S.player.facing < 0) ? Math.PI : 0);
      var node = new PIXI.Graphics();
      node.x = from.x; node.y = from.y; node.rotation = angle;
      S.layers.fx.addChild(node);
      var t = 0, dur = 0.32;
      addFx({
        node: node,
        update: function (dt) {
          t += dt;
          var k = Math.min(1, t / dur);
          var reach = radius * (0.55 + k * 0.45);
          node.clear();
          drawWindCrescent(node, reach * 1.25, reach * 0.55, theme, 1 - k * 0.85);
          return k < 1;
        }
      }, 1, dur * 1000 + 200);
      (targets || []).forEach(function (id, ti) {
        setTimeout(function () {
          if (fxGate(spec)) return;
          var pt = posOf(id);
          spawnImpact(pt.x, pt.y, spec, false);
          hitReact(id, spec.elem, false);
        }, 60 + ti * 30);
      });
    }, Math.max(0, baseDelay || 0));
  }

  /* 迴旋斬：圍繞周身的一整圈（設計文檔：風刃變為一圍繞周身的一整圈的特效）。
     半徑就是模擬層這一圈的實際判定半徑。 */
  function spawnWindSpin(spec, baseDelay) {
    var a = spec && spec.area;
    var radius = Math.max(24, (a && Number(a.r)) || Number(spec.lineLength) || 60);
    setTimeout(function () {
      if (fxGate(spec)) return;
      var theme = themeOf(spec);
      var node = new PIXI.Graphics();
      S.layers.fx.addChild(node);
      var c1 = cssColorToInt(theme.c1, 0x86efac);
      var c2 = cssColorToInt(theme.c2, 0xffffff);
      var t = 0, dur = 0.42;
      addFx({
        node: node,
        update: function (dt) {
          t += dt;
          var k = Math.min(1, t / dur);
          var p = playerPos();
          node.x = p.x; node.y = p.y - 12;
          var r = radius * (0.5 + k * 0.5);
          var fade = 1 - k;
          node.clear();
          node.ellipse(0, 0, r, r * 0.62).stroke({ color: c1, width: 4, alpha: 0.75 * fade });
          node.ellipse(0, 0, r * 0.88, r * 0.55).stroke({ color: c2, width: 2, alpha: 0.6 * fade });
          // 圈上的四道刃影，隨著圈一起轉
          for (var i = 0; i < 4; i++) {
            var ang = k * Math.PI * 2 + i * Math.PI / 2;
            var bx = Math.cos(ang) * r, by = Math.sin(ang) * r * 0.62;
            node.ellipse(bx, by, r * 0.16, r * 0.07).fill({ color: c2, alpha: 0.7 * fade });
          }
          return k < 1;
        }
      }, 1, dur * 1000 + 200);
    }, Math.max(0, baseDelay || 0));
  }

  /* 虛空斬：以自身為圓心繞行的鋸齒圓盤，半徑逐秒擴大（area.grow＝每秒擴大的像素）。
     每一道用 area.id 保留自己的節點與初始相位；同一道補播延長事件時才合併。 */
  var _voidDiscs = Object.create(null);
  function spawnVoidDisc(spec) {
    var a = spec && spec.area;
    if (!a || !isFinite(a.r)) return;
    var ccw = Number(a.spin) < 0;
    var key = 'void:' + (a.id || (ccw ? 'ccw' : 'cw'));
    /* 虛空斬的畫面壽命直接跟事件的技能壽命走；不能套用一般領域上限，
       否則未來技能表調長時，特效會比實際場域早消失。 */
    var dur = Math.max(0.5, Number(spec && spec.dur) || 6);
    var disc = _voidDiscs[key];
    if (disc && !disc.done) {
      disc.dur = Math.max(disc.dur, disc.t + dur);
      if (disc.fx) disc.fx.maxLife = Math.max(disc.fx.maxLife || 0, disc.dur * 1000 + 500);
      return;
    }
    var theme = themeOf(spec);
    var spinRate = Number(a.spinRate);
    var spin = isFinite(spinRate) && Math.abs(spinRate) > 1e-6
      ? spinRate : (ccw ? -1 : 1) * Math.PI * 2;
    var startAngle = Number(a.startAng);
    if (!isFinite(startAngle)) startAngle = 0;
    var grow = Math.max(0, Number(a.grow) || 0);
    var bodyR = Math.max(6, Number(a.orbR) || 24);
    var node = new PIXI.Graphics();
    S.layers.fx.addChild(node);
    disc = { t: 0, dur: dur, r: Math.max(8, Number(a.r) || 60), done: false };
    _voidDiscs[key] = disc;
    var c1 = cssColorToInt(theme.c1, 0x86efac);
    var c2 = cssColorToInt(theme.c2, 0xffffff);
    function drawBlade(angle, radius, alpha) {
      var cx = Math.cos(angle) * radius;
      var cy = Math.sin(angle) * radius * 0.62;
      var teeth = 12;
      var poly = [];
      for (var i = 0; i < teeth * 2; i++) {
        var ta = angle * 3 + Math.PI * i / teeth;
        var rr = bodyR * (i % 2 === 0 ? 1 : 0.68);
        poly.push(cx + Math.cos(ta) * rr, cy + Math.sin(ta) * rr * 0.85);
      }
      node.poly(poly).fill({ color: c1, alpha: 0.8 * alpha })
        .stroke({ color: c2, width: 2, alpha: 0.9 * alpha });
      node.circle(cx, cy, bodyR * 0.42).fill({ color: c2, alpha: 0.85 * alpha });
    }
    var fx = addFx({
      node: node,
      update: function (dt) {
        disc.t += dt;
        disc.r += grow * dt;                 // 與模擬層同一個成長速度（平滑，不是每秒跳一次）
        var p = playerPos();
        node.x = p.x; node.y = p.y - 12;
        var fade = disc.t > disc.dur - 0.4 ? Math.max(0, (disc.dur - disc.t) / 0.4) : 1;
        node.clear();
        node.ellipse(0, 0, disc.r, disc.r * 0.62)
          .stroke({ color: c1, width: 1.5, alpha: 0.16 * fade });
        /* 保留最近幾幀的刃影，形成連續螺旋；半徑與角度都回推到各自的時間點，
           因此從開始到 dur 結束都能看見向外擴展，而不是只剩一顆短促的圓盤。 */
        var trailSteps = 5;
        for (var ti = trailSteps; ti >= 0; ti--) {
          var trailDt = Math.min(disc.t, ti * 0.11);
          var trailT = disc.t - trailDt;
          var trailR = Math.max(8, disc.r - grow * trailDt);
          var trailAlpha = ti === 0 ? 1 : 0.18 * (1 - ti / (trailSteps + 1));
          drawBlade(startAngle + spin * trailT, trailR, trailAlpha * fade);
        }
        if (disc.t >= disc.dur) {
          disc.done = true;
          if (_voidDiscs[key] === disc) delete _voidDiscs[key];
        }
        return disc.t < disc.dur;
      }
    }, 2, dur * 1000 + 500);
    disc.fx = fx;
  }

  /* 暴風屏障／暴風神體／暴風撕裂：纏在自身的風殼。
     屏障是常駐的旋風殼、神體再加一層金色風暴、撕裂是每一拍向外掃出的氣刃。 */
  var _stormShells = Object.create(null);
  function spawnStormShell(spec) {
    var variant = spec.variant || 'storm-barrier';
    var dur = Math.min(FX_ORBIT_MAX_SEC, Math.max(0.3, spec.dur || 4));
    var shell = _stormShells[variant];
    if (shell && !shell.done) {
      shell.dur = Math.min(FX_ORBIT_MAX_SEC, Math.max(shell.dur, shell.t + dur));
      return;
    }
    var theme = themeOf(spec);
    var god = (variant === 'storm-god');
    var rip = (variant === 'storm-rip');
    var node = new PIXI.Graphics();
    S.layers.fx.addChild(node);
    shell = { t: 0, dur: dur, done: false };
    _stormShells[variant] = shell;
    var c1 = cssColorToInt(theme.c1, 0x86efac);
    var c2 = cssColorToInt(god ? '#ffe9a3' : theme.c2, 0xffffff);
    addFx({
      node: node,
      update: function (dt) {
        shell.t += dt;
        var p = playerPos();
        node.x = p.x; node.y = p.y - 24;
        var fade = shell.t > shell.dur - 0.4 ? Math.max(0, (shell.dur - shell.t) / 0.4) : 1;
        var ph = shell.t * (god ? 7 : 4.2);
        node.clear();
        if (rip) {
          // 撕裂：一圈向外擴張的氣刃（每一拍一次，短促）
          var k = Math.min(1, shell.t / Math.max(0.1, shell.dur));
          for (var ri = 0; ri < 6; ri++) {
            var ra = ph + ri * Math.PI / 3;
            var rr = 26 + k * 34;
            node.ellipse(Math.cos(ra) * rr, Math.sin(ra) * rr * 0.62, 9, 3.4)
              .fill({ color: c2, alpha: 0.7 * (1 - k) });
          }
          return shell.t < shell.dur;
        }
        // 屏障：三層高度不同的旋風環，繞著角色轉
        for (var i = 0; i < 3; i++) {
          var yy = -6 + i * 16;
          var rx = 30 + Math.sin(ph + i) * 5;
          node.ellipse(0, yy, rx, 9).stroke({ color: i === 1 ? c2 : c1, width: 2.5, alpha: (god ? 0.9 : 0.6) * fade });
          var sa = ph * 1.6 + i * 2.1;
          node.circle(Math.cos(sa) * rx, yy + Math.sin(sa) * 9 * 0.5, god ? 3.6 : 2.6)
            .fill({ color: c2, alpha: 0.9 * fade });
        }
        if (god) {
          node.ellipse(0, 6, 40, 46).stroke({ color: c2, width: 2, alpha: 0.35 * fade });
        }
        if (shell.t >= shell.dur) {
          shell.done = true;
          if (_stormShells[variant] === shell) delete _stormShells[variant];
        }
        return shell.t < shell.dur;
      }
    }, 2, (FX_ORBIT_MAX_SEC + 1) * 1000);
  }

  function spawnIceField(spec) {
    var a = spec && spec.area;
    if (!a || !isFinite(a.x) || !isFinite(a.y)) return null;
    var variant = spec.variant;
    if (variant === 'water-tornado' || variant === 'wind-tornado') {
      return spawnFirePillar(a, spec);
    }
    var isRect = (variant === 'blizzard');
    var isHoming = (variant === 'ice-arrow-homing' || variant === 'wind-blade-homing');
    var w = isRect ? Math.max(24, Number(a.w) || 120) : Math.max(10, (Number(a.r) || 30) * 2);
    var h = isRect ? Math.max(24, Number(a.h) || 120) : w;
    var key = fieldVfxKey(a, variant);
    if (!key) return null;
    var holdMs = Math.max(520, Number(spec.dur || 0.4) * 2400);
    var motionSec = fieldVfxMotionSec(spec, 0.4);
    var current = _iceFieldFx[key];
    if (current && !current.dead && current.node && !current.node.destroyed) {
      current.speed = Number(a.speed) > 0 ? Number(a.speed) : current.speed;
      if (isHoming) {
        /* 追跡風刃的傷害位置由模擬層 area.x/y 定義；畫面只是平滑跟隨這個座標，
           不能另走一條追向未更新 dest 的獨立路徑。 */
        fieldVfxSetFollowTarget(current, Number(a.x), Number(a.y));
        if (isFinite(a.destX) && isFinite(a.destY)) {
          current.destX = Number(a.destX);
          current.destY = Number(a.destY);
        }
      } else if (variant !== 'blizzard') {
        fieldVfxSetTarget(current, Number(a.x), Number(a.y), w, h, motionSec);
      }
      current.expiresAt = nowMs() + holdMs;
      return current;
    }
    var node = new PIXI.Container();
    var g = new PIXI.Graphics();
    node.addChild(g);
    // 暴風雪是壟罩地面的雲霧 → zone 層；水龍捲與冰箭是立體物件 → fx 層
    (isRect ? S.layers.zone : S.layers.fx).addChild(node);
    var fx = {
      node: node, x: Number(a.x), y: Number(a.y), w: w, h: h,
      variant: variant, t: 0, expiresAt: nowMs() + holdMs, key: key, dead: false,
      speed: Number(a.speed) > 0 ? Number(a.speed) : 0,
      destX: isFinite(a.destX) ? Number(a.destX) : null,
      destY: isFinite(a.destY) ? Number(a.destY) : null,
      motionFromX: Number(a.x), motionFromY: Number(a.y), motionFromW: w, motionFromH: h,
      motionToX: Number(a.x), motionToY: Number(a.y), motionToW: w, motionToH: h,
      motionT: 1, motionDur: 1,
      windAngle: null
    };
    _iceFieldFx[key] = fx;
    var flakeAt = 0;
    /* 追蹤中的冰箭／風刃是「飛行物本體」，配色必須與飛出去的那一支相同；
       只有真正的場域（暴風雪／水龍捲）才用場域自己的冰霧色。 */
    var fieldTheme = variant === 'wind-blade-homing' ? themeOf({ elem: 'wind' })
      : (variant === 'ice-arrow-homing' ? themeOf({ elem: 'ice' }) : ICE_FIELD_THEME);
    var c1 = cssColorToInt(fieldTheme.c1, 0x7dd3fc);
    var c2 = cssColorToInt(fieldTheme.c2, 0xe0f2fe);
    var glow = cssColorToInt(fieldTheme.glow, 0x22d3ee);
    /* 冰箭的加色光暈：與飛行中的冰箭同一組（spawnProjectile 的 glow），
       否則同一支箭在轉入追擊的瞬間會突然變暗。 */
    var homingGlow = null;
    if (variant === 'ice-arrow-homing') {
      homingGlow = new PIXI.Sprite(glowTexture());
      homingGlow.anchor.set(0.5);
      homingGlow.tint = glow;
      homingGlow.alpha = 0.8;
      homingGlow.scale.set(0.9);
      homingGlow.blendMode = 'add';
      node.addChildAt(homingGlow, 0);
    }

    addFx({
      node: node,
      update: function (dt) {
        fx.t += dt;
        if (fx.variant === 'blizzard') {
          /* 暴風雪的權威錨點是畫面中的玩家，而不是上一個 0.1 秒事件。
             playerPos() 已經使用角色的渲染內插座標，因此這裡每幀同步即可。 */
          var follow = playerPos();
          if (follow && isFinite(follow.x) && isFinite(follow.y)) {
            fx.x = follow.x;
            fx.y = follow.y;
          }
        } else if (isHoming) {
          /* 傷害場域和追蹤特效共用模擬層的目前位置；畫面只平滑跟隨它，
             不自行追目標，避免顯示位置與實際判定範圍脫節。 */
          fieldVfxFollowStep(fx, dt);
        } else {
          fieldVfxStep(fx, dt);
        }
        node.x = fx.x; node.y = fx.y;
        // 追擊中的飛行物一律朝著自己正在飛的方向（冰箭與風刃同一套）
        node.rotation = isHoming ? fieldVfxWindAngleStep(fx, dt) : 0;
        var left = fx.expiresAt - nowMs();
        var fade = left < 420 ? Math.max(0, left / 420) : 1;
        var phase = fx.t * 2.2;
        if (homingGlow) homingGlow.alpha = 0.8 * fade;
        g.clear();

        if (fx.variant === 'blizzard') {
          /* 藍色雲霧壟罩：地面判定是正方形，顯示比照沼澤壓低高度畫成橫向長方形，
             才不會看起來像一塊立起來的板子。 */
          var visualH = Math.max(20, fx.h * MIRE_VISUAL_HEIGHT_RATIO);
          var rx = fx.w * 0.5, ry = visualH * 0.5;
          g.rect(-rx, -ry, fx.w, visualH).fill({ color: c1, alpha: 0.2 * fade });
          g.rect(-rx, -ry, fx.w, visualH).stroke({ width: 3, color: glow, alpha: 0.5 * fade });
          // 橫向飄動的雲層：固定波形，避免逐幀閃爍
          for (var ci = 0; ci < 3; ci++) {
            var cy = -ry * 0.5 + ci * ry * 0.5;
            var path = g.moveTo(-rx * 0.86, cy);
            for (var si = 1; si <= 7; si++) {
              path = path.lineTo(-rx * 0.86 + fx.w * 0.123 * si,
                cy + Math.sin(phase * 0.7 + ci * 1.6 + si * 0.9) * ry * 0.12);
            }
            path.stroke({ color: c2, width: 2, alpha: 0.34 * fade });
          }
          // 持續降下的冰雪粒子（以固定相位＋落下量表示，不隨幀率改變密度）
          for (var fi = 0; fi < 10; fi++) {
            var fxx = (Math.sin(fi * 2.7) * 0.5) * fx.w * 0.92;
            var fall = (fx.t * (26 + fi * 3) + fi * 23) % Math.max(1, visualH);
            var fyy = -ry + fall;
            g.circle(fxx, fyy, 1.6 + (fi % 3) * 0.7).fill({ color: c2, alpha: 0.6 * fade });
          }
        } else if (fx.variant === 'water-tornado' || fx.variant === 'wind-tornado') {
          /* 水龍捲：由下往上收窄的漏斗，以同心橢圓堆疊表示旋轉。 */
          var tr = fx.w * 0.5;
          g.circle(0, 0, tr).fill({ color: c1, alpha: 0.14 * fade });
          g.circle(0, 0, tr).stroke({ width: 2, color: glow, alpha: 0.5 * fade });
          for (var li = 0; li < 5; li++) {
            var u = li / 5;
            var lr = tr * (1 - u * 0.72);
            var ly = -tr * 1.5 * u;
            var spin = phase * 1.6 + li * 0.8;
            g.ellipse(Math.cos(spin) * lr * 0.16, ly, lr, lr * 0.34)
              .stroke({ width: 2.4, color: li % 2 ? c2 : glow, alpha: (0.62 - u * 0.3) * fade });
          }
        } else if (fx.variant === 'wind-blade-homing') {
          /* 追跡風刃只改變移動方式，不改變外形：小型半月風刃沿目前追蹤方向旋轉。 */
          drawWindCrescent(g, Math.max(8, fx.w), Math.max(5, fx.w * 0.38),
            themeOf({ elem: 'wind' }), fade);
        } else {
          /* 追蹤冰箭＝剛才那支冰箭換了飛法，外形必須仍是冰箭本體的菱形冰晶，
             不能改畫成圓球（那會看起來像另外多射出一種東西）。
             尺寸取模擬層的接觸半徑：菱形半高＝判定半徑。 */
          drawIceShard(g, Math.max(5, fx.w * 0.5) / 11, c1, c2, fade);
        }

        flakeAt += dt;
        if (fx.variant !== 'wind-blade-homing' && !REDUCED_MOTION && flakeAt > 0.3 && fade > 0.4) {
          flakeAt = 0;
          spawnParticles(fx.x + (Math.random() - 0.5) * fx.w * 0.6,
            fx.y + (Math.random() - 0.5) * fx.h * 0.4, 2, fieldTheme, 0.8, 0.5);
        }
        if (nowMs() >= fx.expiresAt) {
          fx.dead = true;
          if (_iceFieldFx[key] === fx) delete _iceFieldFx[key];
          return false;
        }
        return true;
      }
    }, 2, ICE_FIELD_MAX_LIFE_SEC * 1000);
    return fx;
  }

  /* 雷球（新版技能 thunderorb）：會飛的球體場域。
     模擬層每 0.35 秒送一次事件，帶上 area（x／y／r）與同一顆球的 id；
     顯示層按 id 合併節點、每次事件設定最新座標目標，再以事件間隔內插到目標；
     球會不會飛、飛多快仍完全由模擬層決定，顯示層只補畫面，不改傷害範圍。 */
  var _thunderOrbFx = Object.create(null);
  var THUNDER_ORB_MAX_LIFE_SEC = 14;
  var THUNDER_SHOCK_THEME = { c1: '#2563eb', c2: '#dbeafe', glow: '#60a5fa' };
  function spawnThunderOrbField(spec) {
    var a = spec && spec.area;
    if (!a || !isFinite(a.x) || !isFinite(a.y)) return null;
    var key = a.id || [Math.round(a.x), Math.round(a.y)].join(':');
    var holdMs = Math.max(520, Number(spec.dur || 0.35) * 2400);
    var current = _thunderOrbFx[key];
    if (current && !current.dead && current.node && !current.node.destroyed) {
      current.r = Math.max(8, Number(a.r) || current.r);
      fieldVfxSetPositionTarget(current, Number(a.x), Number(a.y),
        fieldVfxMotionSec(spec, 0.35));
      current.expiresAt = nowMs() + holdMs;
      return current;
    }
    var node = new PIXI.Container();
    var g = new PIXI.Graphics();
    node.addChild(g);
    S.layers.fx.addChild(node);
    var fx = {
      node: node, x: Number(a.x), y: Number(a.y), r: Math.max(8, Number(a.r) || 30),
      w: Math.max(8, Number(a.r) || 30), h: Math.max(8, Number(a.r) || 30),
      t: 0, expiresAt: nowMs() + holdMs, key: key, dead: false,
      motionFromX: Number(a.x), motionFromY: Number(a.y),
      motionFromW: Math.max(8, Number(a.r) || 30), motionFromH: Math.max(8, Number(a.r) || 30),
      motionToX: Number(a.x), motionToY: Number(a.y),
      motionToW: Math.max(8, Number(a.r) || 30), motionToH: Math.max(8, Number(a.r) || 30),
      motionT: 1, motionDur: 1
    };
    _thunderOrbFx[key] = fx;
    addFx({
      node: node,
      update: function (dt) {
        fx.t += dt;
        fieldVfxStep(fx, dt);
        node.x = fx.x;
        node.y = fx.y - 10;                 // 略高於腳底，看起來是懸在空中的球
        var left = fx.expiresAt - nowMs();
        var fade = left < 260 ? Math.max(0, left / 260) : 1;
        var r = fx.r;
        var pulse = 1 + Math.sin(fx.t * 9) * 0.06;
        g.clear();
        g.circle(0, 0, r * pulse).fill({ color: 0x1d4ed8, alpha: 0.24 * fade });
        g.circle(0, 0, r * 0.62 * pulse).fill({ color: 0x60a5fa, alpha: 0.5 * fade });
        g.circle(0, 0, r * 0.3 * pulse).fill({ color: 0xffffff, alpha: 0.8 * fade });
        /* 表面電弧：折點以 t 推進（不用亂數，否則每幀重抽會變成閃爍雜訊）。 */
        for (var ai = 0; ai < 4; ai++) {
          var base = fx.t * (2.2 + ai * 0.6) + ai * 1.7;
          var px = Math.cos(base) * r, py = Math.sin(base) * r * 0.72;
          for (var seg = 1; seg <= 3; seg++) {
            var ang = base + seg * (0.9 + Math.sin(fx.t * 3 + ai) * 0.25);
            var rad = r * (1 - seg * 0.18);
            var nx = Math.cos(ang) * rad, ny = Math.sin(ang) * rad * 0.72;
            g.moveTo(px, py).lineTo(nx, ny)
              .stroke({ color: seg === 1 ? 0xffffff : 0x93c5fd, width: Math.max(1, 2 - seg * 0.4), alpha: 0.7 * fade });
            px = nx; py = ny;
          }
        }
        if (nowMs() >= fx.expiresAt) {
          fx.dead = true;
          if (_thunderOrbFx[key] === fx) delete _thunderOrbFx[key];
          return false;
        }
        return true;
      }
    }, 2, THUNDER_ORB_MAX_LIFE_SEC * 1000);
    return fx;
  }

  /* 雷殞天落（thunderorb T7）：巨大雷球從天而降，落地炸出藍色衝擊波。
     與殞石共用「落下時間＝模擬層的 travelMs」的約定，畫面到地與傷害結算同一刻。 */
  function spawnThunderFall(spec, targetId, delaySec) {
    if (typeof targetId === 'string' && !vfxTargetLiveForSpec(spec, targetId)) return;
    var to = (spec.area && isFinite(spec.area.x) && isFinite(spec.area.y))
      ? { x: spec.area.x, y: spec.area.y } : posOf(targetId);
    if (!to || !isFinite(to.x)) return;
    var radius = (spec.area && Number(spec.area.r) > 0) ? Number(spec.area.r) : 90;
    var from = { x: to.x + (Math.random() * 36 - 18), y: to.y - S.H * 0.7 };
    var dur = Math.max(0.35, ((spec.travelMs && spec.travelMs[0]) || 700) / 1000);
    spawnTargetTelegraph(spec, to.x, to.y, radius, delaySec, dur, targetId);
    var node = new PIXI.Container();
    var g = new PIXI.Graphics();
    node.addChild(g);
    S.layers.fx.addChild(node);
    var t = -(Math.max(0, delaySec || 0)), landed = false;
    var targetGuard = typeof targetId === 'string' ? function () {
      return vfxTargetLiveForSpec(spec, targetId);
    } : null;
    var orbR = Math.max(16, radius * 0.32);
    addFx({
      node: node,
      update: function (dt) {
        if (typeof targetId === 'string' && !vfxTargetLiveForSpec(spec, targetId)) return false;
        t += dt;
        if (t < 0) { node.visible = false; return true; }
        node.visible = true;
        var k = Math.min(1, t / dur);
        node.x = lerp(from.x, to.x, k);
        node.y = lerp(from.y, to.y, k);
        g.clear();
        g.circle(0, 0, orbR).fill({ color: 0x1d4ed8, alpha: 0.34 });
        g.circle(0, 0, orbR * 0.62).fill({ color: 0x60a5fa, alpha: 0.62 });
        g.circle(0, 0, orbR * 0.3).fill({ color: 0xffffff, alpha: 0.9 });
        for (var ai = 0; ai < 3; ai++) {
          var ang = t * 7 + ai * 2.1;
          g.moveTo(Math.cos(ang) * orbR, Math.sin(ang) * orbR)
            .lineTo(Math.cos(ang + 2.4) * orbR * 0.7, Math.sin(ang + 2.4) * orbR * 0.7)
            .stroke({ color: 0xffffff, width: 2, alpha: 0.7 });
        }
        if (k >= 1 && !landed) {
          landed = true;
          spawnImpact(to.x, to.y, spec, true, targetGuard);
          spawnFireShockwave(to.x, to.y, radius, THUNDER_SHOCK_THEME, targetGuard);
          addShake(6, spec);
          if (typeof targetId === 'string') hitReact(targetId, spec.elem || 'lightning', true);
        }
        return t < dur + 0.2;
      }
    }, 2, (dur + (delaySec || 0)) * 1000 + 900);
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
    var flame = flameProjectile(theme, scale && scale < 1, METEOR_SIZE_SCALE);
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

  function spawnTargetTelegraph(spec, cx, cy, radius, delaySec, durationSec, targetId) {
    radius = Number(radius);
    if (!isFinite(radius) || radius <= 0) radius = 90;
    radius = Math.max(36, radius);
    var isLightning = spec && spec.variant === 'thunder-fall';
    var colors = isLightning
      ? { fill: 0x2563eb, border: 0x60a5fa }
      : { fill: 0xdc2626, border: 0xf87171 };
    var g = new PIXI.Graphics();
    g.x = cx; g.y = cy;
    S.layers.zone.addChild(g);
    var t = -(Math.max(0, delaySec || 0));
    var dur = Math.max(0.28, durationSec || 0.7);
    addFx({
      node: g,
      update: function (dt) {
        if (typeof targetId === 'string' && !vfxTargetLiveForSpec(spec, targetId)) return false;
        t += dt;
        if (t < 0) { g.visible = false; return true; }
        g.visible = true;
        var k = Math.min(1, t / dur);
        var fade = k > 0.84 ? Math.max(0, (1 - k) / 0.16) : 1;
        var pulse = 1 + Math.sin(t * 5.5) * 0.025;
        g.clear();
        g.ellipse(0, 0, radius * pulse, radius * 0.52 * pulse)
          .fill({ color: colors.fill, alpha: 0.16 * fade })
          .stroke({ color: colors.border, width: 2.5, alpha: 0.82 * fade });
        return t < dur;
      }
    }, 1, (dur + (delaySec || 0)) * 1000 + 500);
  }

  function spawnMeteor(rect, spec) {
    var theme = themeOf(spec);
    var cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
    var run = (typeof VFX_METEOR_DROP_RUN === 'number' && VFX_METEOR_DROP_RUN > 0)
      ? VFX_METEOR_DROP_RUN : 180;
    var rise = run * Math.tan(
      (typeof VFX_METEOR_DROP_ANGLE_RAD === 'number') ? VFX_METEOR_DROP_ANGLE_RAD : Math.PI / 3);
    var mainFrom = { x: cx + run, y: cy - rise };
    var meteorTravel = (spec.travelMs && spec.travelMs[0]) || 500;
    /* 與 DOM vfxMeteor、技能傷害浮字相同：殞石固定慢 30%。 */
    var dur = Math.min(1.15, Math.max(0.7, meteorTravel / 1000 / VFX_METEOR_SPEED_MULTIPLIER));
    var shockTheme = { c1: '#9f1d12', c2: '#f05a13', glow: '#d62f12' };
    spawnTargetTelegraph(spec, cx, cy, rectRadius(rect), 0, dur);
    spawnMeteorProjectile(spec, theme, mainFrom, { x: cx, y: cy }, 1, dur, 0, function () {
      /* 強化爆點本身就是這顆殞石唯一一次 Canvas 鏡頭晃動。 */
      spawnImpact(cx, cy, spec, true);
      /* 把殞石落地震動提高到可見強度；同一個到達回呼只執行一次。 */
      addShake(8, spec);
      addMeteorCameraShake();
      spawnFireShockwave(cx, cy, rectRadius(rect), shockTheme);
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
  function spawnFireShockwave(cx, cy, radius, theme, targetGuard) {
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
        if (targetGuard && !targetGuard()) return false;
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
          /* 橢圓火舌向外噴散，避免震波只像圓點粒子。 */
          g.ellipse(px, py, Math.max(0.5, bp.size * 0.65 * (1 - pk)),
            Math.max(1, bp.size * 1.8 * (1 - pk)))
            .fill({ color: pi % 2 ? theme.c1 : theme.c2, alpha: 0.95 * (1 - pk) });
        }
        return t < dur;
      }
    }, 1);
  }

  /* 火龍捲／火牆消失時的烈焰衝擊，沿用殞石震波的徑向粒子骨架，
     但以獨立色票呈現場域消失的爆炸衝擊波。 */
  function spawnFirePillarShockwave(cx, cy, radius) {
    spawnFireShockwave(cx, cy, radius, {
      c1: '#7d1708', c2: '#ffb21c', glow: '#ff3b0a'
    });
  }

  /* 冰霜新星的範圍本體：傷害判定仍由模擬層的 area.r 負責，
     這裡只用同一個半徑畫成逐幀擴散的圓，避免沿用矩形包絡。 */
  function spawnFrostNovaArea(spec) {
    var a = spec && spec.area;
    var center = a && isFinite(a.x) && isFinite(a.y)
      ? { x: Number(a.x), y: Number(a.y) } : playerPos();
    if (!center || !isFinite(center.x) || !isFinite(center.y)) return;
    var radius = a && Number(a.r) > 0 ? Number(a.r) : 90;
    var theme = themeOf(spec);
    var g = new PIXI.Graphics();
    g.x = center.x;
    g.y = center.y;
    S.layers.zone.addChild(g);
    var t = 0;
    var dur = Math.max(0.32, Math.min(0.8, Number(spec.dur) || 0.5));
    addFx({
      node: g,
      update: function (dt) {
        t += dt;
        var k = Math.min(1, t / dur);
        var ease = k * k * (3 - 2 * k);
        var r = radius * (0.22 + ease * 0.82);
        var alpha = (1 - k) * 0.72;
        g.clear();
        g.circle(0, 0, r).fill({ color: cssColorToInt(theme.c1, 0x7dd3fc), alpha: alpha * 0.24 });
        g.circle(0, 0, r).stroke({ color: cssColorToInt(theme.c2, 0xe0f2fe), width: 3, alpha: alpha });
        g.circle(0, 0, r * 0.72).stroke({ color: cssColorToInt(theme.glow, 0x22d3ee), width: 2, alpha: alpha * 0.62 });
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
        if (t > 0.1 && !node._hit) {
          node._hit = true;
          hitReact(targetId, spec.elem, false, isBloodbladeNoHitJoltSpec(spec));
        }
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
          if (fxGate(spec)) return;
          spawnSlash(rect.x + Math.random() * rect.w, rect.y + Math.random() * rect.h, spec, true);
        }, idx * 90);
      })(i);
    }
  }

  /* 火龍捲（pillar 變體）：真正的地板場域。每次傷害事件只更新同一道火龍捲的
     座標與保留時間，不再以受擊敵人為中心重播一根短矩形光柱。 */
  var _firePillarFx = Object.create(null);
  var FIRE_PILLAR_MAX_LIFE_SEC = 4.5;
  function spawnFirePillar(area, spec) {
    if (!area || !isFinite(area.x) || !isFinite(area.y)) return null;
    var isWater = spec && (spec.variant === 'water-tornado' || spec.variant === 'wind-tornado' || spec.elem === 'ice');
    var key = (area.id || [Math.round(area.x), Math.round(area.y), Math.round(area.r || 0)].join(':')) + (isWater ? ':water' : '');
    var holdMs = Math.max(900, Number(spec.dur || 0.5) * 2400);
    var current = _firePillarFx[key];
    if (current && !current.dead && current.node && !current.node.destroyed) {
      current.x = Number(area.x);
      current.y = Number(area.y);
      current.radius = Math.max(16, Number(area.r) || current.radius);
      current.expiresAt = nowMs() + holdMs;
      return current;
    }

    var theme = isWater ? ICE_FIELD_THEME : themeOf(spec);
    var node = new PIXI.Container();
    var g = new PIXI.Graphics();
    node.addChild(g);
    S.layers.zone.addChild(node);
    var fx = { node: node, x: Number(area.x), y: Number(area.y), radius: Math.max(16, Number(area.r) || 28),
      t: 0, expiresAt: nowMs() + holdMs, key: key, dead: false };
    _firePillarFx[key] = fx;
    var particleAt = 0;

    var baseColor = isWater ? 0x0369a1 : 0x7d1708;
    var strokeColor = isWater ? 0x38bdf8 : 0xff6b19;
    var innerEllipseColor = isWater ? 0x7dd3fc : 0xffb21c;
    var polyColor = isWater ? 0x0284c7 : 0xd93413;
    var ribbonInner = isWater ? 0xf0f9ff : 0xffdf4d;
    var ribbonOdd = isWater ? 0x38bdf8 : 0xff761c;
    var ribbonEven = isWater ? 0x7dd3fc : 0xffa51d;
    var coreColor = isWater ? 0xf0f9ff : 0xffffbd;
    var topFlameColor = isWater ? 0x38bdf8 : 0xff6a17;

    addFx({
      node: node,
      update: function (dt) {
        fx.t += dt;
        node.x = fx.x;
        node.y = fx.y;
        var fade = fx.expiresAt - nowMs() < 360 ? Math.max(0, (fx.expiresAt - nowMs()) / 360) : 1;
        var appear = Math.min(1, fx.t / 0.28);
        var h = Math.max(118, fx.radius * 3.45) * appear;
        var baseW = Math.max(44, fx.radius * 2.2) * appear;
        var topW = Math.max(18, fx.radius * 0.62) * appear;
        var phase = fx.t * 4.2;
        g.clear();

        // 地面圈：把「傷害半徑」直接畫出來，讓玩家看得出場域邊界。
        g.ellipse(0, 4, baseW * 0.58, Math.max(8, fx.radius * 0.34))
          .fill({ color: baseColor, alpha: 0.42 * fade })
          .stroke({ color: strokeColor, width: 2, alpha: 0.78 * fade });
        g.ellipse(0, 0, baseW * 0.46, Math.max(5, fx.radius * 0.2))
          .fill({ color: innerEllipseColor, alpha: 0.32 * fade });

        // 外層火焰/水流軀幹：寬底、收尖頂，並以旋臂抖動取代硬直矩形。
        var silhouette = [
          -baseW * 0.55, 0, -baseW * 0.47, -h * 0.18, -baseW * 0.36, -h * 0.44,
          -topW * 0.52, -h * 0.78, -topW * 0.34, -h, topW * 0.34, -h,
          topW * 0.52, -h * 0.78, baseW * 0.36, -h * 0.44, baseW * 0.47, -h * 0.18,
          baseW * 0.55, 0
        ];
        g.poly(silhouette).fill({ color: polyColor, alpha: 0.52 * fade });

        // 多條向上旋繞的舌流，使用固定段數控制每幀成本。
        for (var ri = 0; ri < 4; ri++) {
          var pts = [];
          var inner = ri === 1 || ri === 2;
          for (var si = 0; si <= 6; si++) {
            var u = si / 6;
            var y = -h * u;
            var sway = Math.sin(phase + ri * 1.55 + u * 8.2) * baseW * (0.22 - u * 0.1);
            var x = sway + Math.cos(phase * 0.7 + ri) * baseW * 0.08;
            var width = Math.max(3, (baseW * (inner ? 0.12 : 0.18)) * (1 - u * 0.7));
            pts.push(x - width, y);
          }
          for (si = 6; si >= 0; si--) {
            u = si / 6;
            y = -h * u;
            sway = Math.sin(phase + ri * 1.55 + u * 8.2) * baseW * (0.22 - u * 0.1);
            x = sway + Math.cos(phase * 0.7 + ri) * baseW * 0.08;
            width = Math.max(3, (baseW * (inner ? 0.12 : 0.18)) * (1 - u * 0.7));
            pts.push(x + width, y);
          }
          g.poly(pts).fill({ color: inner ? ribbonInner : (ri % 2 ? ribbonOdd : ribbonEven),
            alpha: (inner ? 0.82 : 0.7) * fade });
        }

        // 高亮核心與頂端舌尖
        g.ellipse(0, -h * 0.4, Math.max(5, baseW * 0.12), Math.max(18, h * 0.34))
          .fill({ color: coreColor, alpha: 0.62 * fade });
        g.poly([-topW * 0.28, -h * 0.86, -topW * 0.08, -h * 1.12,
          topW * 0.04, -h * 0.92, topW * 0.3, -h * 1.02, topW * 0.18, -h * 0.72])
          .fill({ color: topFlameColor, alpha: 0.82 * fade });

        particleAt += dt;
        if (!REDUCED_MOTION && particleAt > 0.11 && fade > 0.45) {
          particleAt = 0;
          var sparkAngle = Math.random() * Math.PI * 2;
          var sparkX = Math.cos(sparkAngle) * baseW * (0.25 + Math.random() * 0.35);
          spawnParticles(fx.x + sparkX, fx.y - h * (0.35 + Math.random() * 0.5), 3, theme, 1.1, 0.7);
        }
        if (nowMs() >= fx.expiresAt) {
          fx.dead = true;
          if (_firePillarFx[key] === fx) delete _firePillarFx[key];
          return false;
        }
        return true;
      }
    }, 2, FIRE_PILLAR_MAX_LIFE_SEC * 1000);
    return fx;
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
        if (fxGate(spec)) return;
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
        var r = 4 + k * 6.5;
        var a = (1 - k) * 0.95;
        g.clear();
        g.circle(0, 0, r).stroke({ color: 0xffffff, width: 1.2, alpha: a });
        g.circle(0, 0, r * 0.65).stroke({ color: 0xffd23f, width: 0.8, alpha: a * 0.75 });
        return t < dur;
      }
    }, 1);
  }

  function handleChainVfx(targets, spec, baseDelay, stagger) {
    if (!targets.length && !S.player) return;
    /* 連鎖閃電：一則事件＝一段電弧，時間點由模擬層的 delayMs 決定（傷害同一刻）。
       單一目標＝起手那一下（從玩家身上劈出去）；兩個目標＝彈射段（前一個 → 下一個）。 */
    if (spec.variant === 'lightning-chain') {
      if (targets.length >= 2) {
        spawnBolt(targets[0], targets[1], spec, baseDelay / 1000, false, false);
      } else if (targets.length) {
        spawnBolt(playerPos(), targets[0], spec, baseDelay / 1000, false, false);
      }
      return;
    }
    if (spec.variant === 'knife-bounce') {
      var chainStart = baseDelay;
      for (var kb = 1; kb < targets.length; kb++) {
        var hopTravel = projectileTravelMs(spec.travelMs && spec.travelMs[kb], 120);
        (function (hopIndex, startDelay, hopTravel) {
          var fromId = targets[hopIndex - 1];
          var toId = targets[hopIndex];
          setTimeout(function () {
            if (fxGate(spec)) return;
            spawnProjectile(toId, hopTravel, spec, function (pt) {
              spawnImpact(pt.x, pt.y, spec, false);
              hitReact(toId, spec.elem, false);
            }, posOf(fromId));
          }, startDelay);
        })(kb, chainStart, hopTravel);
        chainStart += hopTravel;
      }
      return;
    }
    if (spec.variant === 'poison-spread') {
      var pOriginPos = targets.length > 1 ? posOf(targets[0]) : playerPos();
      var pSpreadTargets = targets.length > 1 ? targets.slice(1) : targets;
      for (var psi = 0; psi < pSpreadTargets.length; psi++) {
        (function (tgtId) {
          setTimeout(function () {
            if (fxGate(spec)) return;
            var pSpec = Object.assign({}, spec, { variant: 'venom', elem: 'poison', arcM: 0 });
            spawnProjectile(tgtId, 80, pSpec, function (pt) {
              spawnImpact(pt.x, pt.y, pSpec, false);
              hitReact(tgtId, 'poison', false, true);
            }, pOriginPos);
          }, baseDelay);
        })(pSpreadTargets[psi]);
      }
      return;
    }
    if (spec.variant === 'water-bounce') {
      var wChainStart = baseDelay;
      for (var wb = 1; wb < targets.length; wb++) {
        var wHopTravel = projectileTravelMs(spec.travelMs && spec.travelMs[wb], 140);
        (function (hopIndex, startDelay, hopTravel) {
          var fromId = targets[hopIndex - 1];
          var toId = targets[hopIndex];
          setTimeout(function () {
            if (fxGate(spec)) return;
            var wSpec = Object.assign({}, spec, { variant: 'waterball', elem: 'ice', arcM: Number(spec.arcM) || 8 });
            spawnProjectile(toId, hopTravel, wSpec, function (pt) {
              spawnImpact(pt.x, pt.y, wSpec, false);
              hitReact(toId, 'ice', false);
            }, posOf(fromId));
          }, startDelay);
        })(wb, wChainStart, wHopTravel);
        wChainStart += wHopTravel;
      }
      return;
    }
    if (spec.variant === 'frost-spread') {
      var fOriginPos = targets.length > 1 ? posOf(targets[0]) : playerPos();
      var fSpreadTargets = targets.length > 1 ? targets.slice(1) : targets;
      for (var fsi = 0; fsi < fSpreadTargets.length; fsi++) {
        (function (tgtId) {
          setTimeout(function () {
            if (fxGate(spec)) return;
            var fSpec = Object.assign({}, spec, { variant: 'frost-bullet', elem: 'ice', arcM: 0 });
            spawnProjectile(tgtId, 80, fSpec, function (pt) {
              spawnImpact(pt.x, pt.y, fSpec, false);
              hitReact(tgtId, 'ice', false);
            }, fOriginPos);
          }, baseDelay);
        })(fSpreadTargets[fsi]);
      }
      return;
    }
    if (spec.variant === 'earth-reflect') {
      for (var eri = 0; eri < targets.length; eri++) {
        (function (tgtId) {
          setTimeout(function () {
            if (fxGate(spec)) return;
            var eSpec = Object.assign({}, spec, { elem: 'light', color: '#ffffff' });
            spawnBeam(tgtId, eSpec);
            var tgtPos = posOf(tgtId);
            spawnImpact(tgtPos.x, tgtPos.y, eSpec, false);
            hitReact(tgtId, 'light', false);
          }, baseDelay);
        })(targets[eri]);
      }
      return;
    }
    if (spec.variant === 'counter-sweep') {
      return;
    }
    /* 風切擴散（暴風屏障 T5）：風切狀態從來源敵人傳染給附近的敵人。
       這是狀態的傳染，不是雷擊——畫成一道小風刃掠過去、落點補一個命中爆點。 */
    if (spec.variant === 'wind-rend-spread') {
      spawnWindRendSpread(targets, spec, baseDelay);
      return;
    }
    /* ---- 以下是【潛能：連鎖閃電】(variant='chain') 的專屬畫法 ----
       天頂大雷＋折射電鏈會用事件本身的屬性色著色，因此任何「沒有自己分支」
       的 chain 事件掉進來，就會以自己的屬性劈出一道天雷：風系＝綠色落雷。
       這裡改成白名單，未知變體退回單純的命中爆點，不再借用雷系畫法。 */
    if (spec.variant && spec.variant !== 'chain' && spec.elem !== 'lightning') {
      targets.forEach(function (id, ti) {
        setTimeout(function () {
          if (fxGate(spec)) return;
          var pt = posOf(id);
          spawnImpact(pt.x, pt.y, spec, false);
          hitReact(id, spec.elem, false, isBloodbladeNoHitJoltSpec(spec));
        }, baseDelay + ti * stagger);
      });
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
    /* 一般技能事件要和內插位置走同一個時鐘，延後 POS_BUFFER_MS 播放；
       敵人出手事件則是「先攻擊、後反傷死亡」的時序本身，不能再等一個
       位置緩衝，否則魔法子彈會在死亡動畫開始後才出現。來源位置會由
       sourceId／lastPos 固定，故不會因省略這段緩衝而隔空飄移。 */
    var isEnemyAttack = spec.cat === 'enemy' && spec.fxKind === 'enemy-attack';
    if (!spec._buffered) {
      spec._buffered = true;
      if (!isEnemyAttack) spec.delayMs = (spec.delayMs || 0) + POS_BUFFER_MS;
    }
    var baseDelay = Math.max(0, spec.delayMs || 0);
    if (baseDelay > 0) {
      setTimeout(function () {
        if (fxGate(spec)) return;
        spec.delayMs = 0;
        onVfx(spec);
      }, baseDelay);
      return;
    }
    if (isEnemyAttack) {
      renderEnemyAttackVfx(spec);
      return;
    }
    /* 舊 Worker 事件可能沒有 variant。風系 aura 沒有可辨識的形狀時直接略過，
       不能把傷害場域畫成綠色棋盤方塊；目前所有合法風系場域都有明確 variant。 */
    if (spec.fxKind === 'aura' && spec.elem === 'wind' && !spec.variant) return;
    var targets = Array.isArray(spec.targets) ? spec.targets.slice(0, 8) : [];
    var rect = areaRect(spec.area);
    var isThrust = spec.variant === 'thrust' || spec.variant === 'thrust-pierce' ||
      spec.variant === 'thrust-parallel' || spec.variant === 'thrust-octagonal';
    var count = Math.min(isThrust ? 8 : 5, Math.max(1, spec.count || 1));
    var stagger = ((typeof VFX_HIT_STAGGER_SEC === 'number') ? VFX_HIT_STAGGER_SEC : 0.09) * 1000;

    /* 只有技能施放事件觸發角色動作；普攻與連鎖／彈射是特效自身的行為，
       不得因每一發子彈或每一段折射重新播放玩家攻擊動畫。 */
    if (shouldAnimatePlayer(spec) && vfxTargetsLive(spec)) {
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
        if (spec.variant === 'wind-blade' || spec.variant === 'wind-blade-small') {
          spawnWindBlade(spec, targets, baseDelay);
          break;
        }
        if (spec.variant === 'ice-arrow-pierce') {
          spawnIcearrowPierce(spec, targets,
            spec.travelMs && spec.travelMs[0], baseDelay, stagger, count);
          break;
        }
        if (spec.variant === 'ice-arrow' && isFinite(spec.angle) && Number(spec.lineLength) > 0) {
          targets.forEach(function (id, ti) {
            var travel = projectileTravelMs(spec.travelMs && spec.travelMs[ti], spec.dur ? spec.dur * 1000 : 300);
            var laneAngle = Number(spec.angle);
            var laneLength = Number(spec.lineLength);
            setTimeout(function () {
              if (fxGate(spec)) return;
              var from = playerMuzzle();
              spawnProjectile(null, travel, spec, function () {
                var pt = posOf(id);
                spawnImpact(pt.x, pt.y, spec, false);
                hitReact(id, spec.elem, false);
              }, from, { angle: laneAngle, length: laneLength });
            }, baseDelay + ti * 40);
          });
          break;
        }
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
                  if (fxGate(spec)) return;
                  var pt = posOf(id);
                  spawnSlash(pt.x, pt.y, spec, true);
                  spawnImpact(pt.x, pt.y, spec, false);
                  hitReact(id, spec.elem, false);
                }, travel + cc * stagger + ti * 40);
                return;
              }
              setTimeout(function () {
                if (fxGate(spec)) return;
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
        if (spec.variant === 'wind-slash') { spawnWindSlash(spec, targets, baseDelay); break; }
        if (spec.variant === 'wind-spin') {
          spawnWindSpin(spec, baseDelay);
          targets.forEach(function (id, ti) {
            setTimeout(function () {
              if (fxGate(spec)) return;
              hitReact(id, spec.elem, false);
            }, baseDelay + 90 + ti * 24);
          });
          break;
        }
        if (spec.variant === 'thrust-pierce' || spec.variant === 'thrust-parallel' ||
            spec.variant === 'thrust-octagonal' || spec.variant === 'thrust') {
          if (!targets.length) break;
          var thrustLanes = Array.isArray(spec.laneOffsets) && spec.laneOffsets.length
            ? spec.laneOffsets : [0];
          var thrustDirections = spec.variant === 'thrust-octagonal'
            ? Math.max(1, Number(spec.directionCount) || 8) : 1;
          var thrustLength = Math.max(48, Number(spec.lineLength) || 70);
          /* 與 DOM VFX 同步：7 次突刺約 1.62 秒播完，保留每道光槍的辨識度。 */
          var thrustStagger = 220;
          var thrustFrontAngle = Math.atan2(posOf(targets[0]).y - playerMuzzle().y,
            posOf(targets[0]).x - playerMuzzle().x);
          for (var trc = 0; trc < count; trc++) {
            var isFinalThrust = trc === count - 1;
            for (var tro = 0; tro < thrustDirections; tro++) {
              var thrustAngle = spec.variant === 'thrust-octagonal'
                ? thrustFrontAngle + tro * Math.PI * 2 / thrustDirections : thrustFrontAngle;
              for (var tl = 0; tl < thrustLanes.length; tl++) {
                spawnThrustLine(targets[0], spec, 0,
                  (baseDelay + trc * thrustStagger) / 1000, thrustLength,
                  thrustLanes[tl], thrustAngle, isFinalThrust);
              }
            }
          }
          if (!spec.projectile) {
            targets.forEach(function (id, ti) {
              setTimeout(function () {
                if (fxGate(spec)) return;
                var pt = posOf(id);
                spawnImpact(pt.x, pt.y, spec, false);
                hitReact(id, spec.elem, false);
              }, baseDelay + 100 + ti * 24);
            });
          }
          break;
        }
        if (spec.variant === 'cleave' || spec.variant === 'cleave-shockwave' || spec.variant === 'cleave-back' || spec.variant === 'cleave-dual' || spec.variant === 'cleave-cross' || spec.variant === 'cleave-cross-shockwave') {
          var drawForward = spec.variant === 'cleave-shockwave' || spec.variant === 'cleave-back' || spec.variant === 'cleave-dual';
          var drawBack = spec.variant === 'cleave-back' || spec.variant === 'cleave-dual';
          var drawCross = spec.variant === 'cleave-cross' || spec.variant === 'cleave-cross-shockwave';
          var drawStaticForward = spec.variant === 'cleave';
          var frontAngle = targets.length
            ? Math.atan2(posOf(targets[0]).y - playerMuzzle().y,
              posOf(targets[0]).x - playerMuzzle().x)
            : ((S.player && S.player.facing < 0) ? Math.PI : 0);
          var arcFlightMs = Math.round(Math.max(0.38, spec.dur || 0.5) * 1000);
          /* 弧光飛行距離：與 DOM 端同一個語意參數（模擬層的 lineLength），沒帶就退回 120px。 */
          var arcLen = Number(spec.lineLength) > 0 ? Number(spec.lineLength) : 120;
          for (var clc = 0; clc < count; clc++) {
            var clDelay = (baseDelay + clc * stagger) / 1000;
            var cleaveFrom = playerMuzzle();
            if (drawStaticForward) spawnCleaveArc(cleaveFrom.x, cleaveFrom.y, spec, frontAngle, clDelay);
            if (drawCross) {
              for (var cdi = 0; cdi < 4; cdi++) {
                spawnCleaveArc(cleaveFrom.x, cleaveFrom.y, spec,
                  frontAngle + cdi * Math.PI / 2, clDelay,
                  { angle: frontAngle + cdi * Math.PI / 2, length: arcLen });
              }
            }
            if (drawForward) spawnCleaveArc(cleaveFrom.x, cleaveFrom.y, spec, frontAngle, clDelay,
              { angle: frontAngle, length: arcLen });
            if (drawBack) spawnCleaveArc(cleaveFrom.x, cleaveFrom.y, spec, frontAngle + Math.PI, clDelay,
              { angle: frontAngle + Math.PI, length: arcLen });
          }
          if (!spec.projectile) {
            targets.forEach(function (id, ti) {
              var cleaveFromForHits = playerMuzzle();
              var targetPt = posOf(id);
              var targetDx = targetPt.x - cleaveFromForHits.x;
              var targetDy = targetPt.y - cleaveFromForHits.y;
              var targetAlong = targetDx * Math.cos(frontAngle) + targetDy * Math.sin(frontAngle);
              var arcHitDelay = 90;
              if (drawCross) {
                var targetDistance = Math.sqrt(targetDx * targetDx + targetDy * targetDy);
                arcHitDelay = Math.round(arcFlightMs * Math.max(0, Math.min(1, targetDistance / arcLen)));
              } else if (drawForward && targetAlong >= 0) {
                arcHitDelay = Math.round(arcFlightMs * Math.max(0, Math.min(1, targetAlong / arcLen)));
              } else if (drawBack && targetAlong < 0) {
                arcHitDelay = Math.round(arcFlightMs * Math.max(0, Math.min(1, -targetAlong / arcLen)));
              }
              for (var clHit = 0; clHit < count; clHit++) {
                (function (hitIndex, hitDelay) {
                  setTimeout(function () {
                    if (fxGate(spec)) return;
                    var pt = posOf(id);
                    spawnImpact(pt.x, pt.y, spec, false);
                    hitReact(id, spec.elem, false);
                  }, baseDelay + hitIndex * stagger + hitDelay + ti * 35);
                })(clHit, arcHitDelay);
              }
            });
          }
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
                if (fxGate(spec)) return;
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
        if (spec.variant === 'frost-nova') {
          spawnFrostNovaArea(spec);
          targets.forEach(function (id, ti) {
            setTimeout(function () {
              if (fxGate(spec)) return;
              var pt = posOf(id);
              spawnImpact(pt.x, pt.y, spec, false);
              hitReact(id, spec.elem, false);
            }, baseDelay + ti * 40);
          });
          break;
        }
        if (spec.variant === 'firepillar-impact') {
          var fireImpactPt = spec.area && isFinite(spec.area.x) && isFinite(spec.area.y)
            ? { x: Number(spec.area.x), y: Number(spec.area.y) }
            : (targets.length ? posOf(targets[0]) : null);
          if (!fireImpactPt) break;
          var fireImpactSpec = Object.assign({}, spec, { variant: 'fire-explosion' });
          spawnImpact(fireImpactPt.x, fireImpactPt.y, fireImpactSpec, true);
          spawnFirePillarShockwave(fireImpactPt.x, fireImpactPt.y,
            spec.area && Number(spec.area.r) > 0 ? Number(spec.area.r) : 60);
          targets.forEach(function (id) { hitReact(id, spec.elem || 'fire', true); });
          break;
        }
        if (spec.variant === 'blood-explosion' || spec.variant === 'zero-infection') {
          targets.forEach(function (id, ti) {
            setTimeout(function () {
              if (fxGate(spec)) return;
              var pt = posOf(id);
              spawnImpact(pt.x, pt.y, spec, true);
              hitReact(id, spec.elem, true);
            }, baseDelay + ti * 40);
          });
          break;
        }
        if (spec.variant === 'wind-burst') {
          /* 狂風碎裂的沿途脈衝也走 burst：圓心與半徑由模擬層帶來，
             範圍內沒有敵人時照樣要看得到氣浪。沒有這條分支時事件會掉到
             下面的泛用結尾，被 spawnAreaFlash 畫成一塊綠色方框——
             那正是玩家看到「風刃在地板留下綠色方塊」的來源。 */
          spawnWindBurst(spec);
          targets.forEach(function (id) { hitReact(id, spec.elem || 'wind', false); });
          break;
        }
        targets.forEach(function (id, ti) {
          setTimeout(function () {
            if (fxGate(spec)) return;
            var pt = posOf(id);
            var fireExplosion = spec.variant === 'fire-explosion';
            var strongBurst = !fireExplosion && (spec.variant === 'nova' || spec.variant === 'detonate');
            /* 火球爆炸要有完整爆點，但鏡頭晃動保留給殞石每顆落地。 */
            spawnImpact(pt.x, pt.y, spec, strongBurst);
            hitReact(id, spec.elem, strongBurst);
          }, ti * 40);
        });
        /* 泛用範圍閃光是矩形：與 spawnAura 同一條規則，風系一律不得用綠色方框
           代表傷害範圍（風系技能各有自己的專用畫法）。 */
        if (!targets.length && rect && spec.elem !== 'wind') spawnAreaFlash(rect, themeOf(spec));
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
        // 落雷術：一則事件＝一道天雷，落下時間與模擬層的落地結算對齊
        if (spec.variant === 'thunder-strike') {
          targets.forEach(function (id, ti) {
            spawnBolt(null, id, spec, (baseDelay + ti * stagger) / 1000, false, true);
          });
          break;
        }
        // 雷殞天落：巨大雷球從天而降＋藍色衝擊波
        if (spec.variant === 'thunder-fall') {
          targets.forEach(function (id, ti) {
            spawnThunderFall(spec, id, (baseDelay + ti * stagger) / 1000);
          });
          break;
        }
        spawnRain(rect, spec);
        targets.forEach(function (id, ti) {
          setTimeout(function () {
            if (fxGate(spec)) return;
            hitReact(id, spec.elem, spec.variant === 'meteor');
          }, (spec.variant === 'meteor' ? 320 : 240) + ti * stagger);
        });
        break;
      case 'aura':
        if (spec.variant === 'firehunt' || spec.variant === 'thunder-orbit') spawnFireHunt(spec);
        else if (spec.variant === 'thunder-orb') spawnThunderOrbField(spec);
        else if (spec.variant === 'firewall') spawnFireWall(spec);
        else if (spec.variant === 'mire' || spec.variant === 'mire-lava' || spec.variant === 'mire-poison' || spec.variant === 'mire-lava-poison') spawnMirePool(spec);
        else if (spec.variant === 'blizzard' || spec.variant === 'water-tornado' || spec.variant === 'wind-tornado' ||
                 spec.variant === 'ice-arrow-homing' || spec.variant === 'wind-blade-homing') spawnIceField(spec);
        else if (spec.variant === 'void-disc') spawnVoidDisc(spec);
        else if (spec.variant === 'storm-barrier' || spec.variant === 'storm-god' ||
                 spec.variant === 'storm-rip') spawnStormShell(spec);
        else if (spec.variant === 'cyclone') spawnCyclone(rect, spec);
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
        if (spec.variant === 'wind-burst') {
          /* 狂風碎裂的沿途脈衝：圓心由模擬層帶來，範圍內沒有敵人時照樣要看得到氣浪。 */
          spawnWindBurst(spec);
          targets.forEach(function (id) { hitReact(id, spec.elem || 'wind', false); });
          break;
        }
        if (spec.variant === 'pillar') {
          /* 地板場域（火龍捲）以 area 為唯一錨點；targets 只負責受擊反饋，
             不可再把火焰畫到每個敵人身上。高塔無座標時才用目標點退化。 */
          var pillarArea = spec.area && isFinite(spec.area.x) && isFinite(spec.area.y)
            ? spec.area
            : (targets.length ? (function () {
                var fallback = posOf(targets[0]);
                return { x: fallback.x, y: fallback.y, r: 28 };
              })() : null);
          if (pillarArea) spawnFirePillar(pillarArea, spec);
          targets.forEach(function (id) { hitReact(id, spec.elem || 'fire', false); });
          break;
        }
        if (spec.variant === 'smite') {
          targets.forEach(function (id, ti) { spawnBolt(null, id, spec, ti * 0.06); });
          break;
        }
        targets.forEach(function (id, ti) {
          setTimeout(function () {
            if (fxGate(spec)) return;
            var pt = posOf(id);
            var strong = spec.variant === 'detonate' || spec.variant === 'nova';
            spawnImpact(pt.x, pt.y, spec, strong);
            hitReact(id, spec.elem, strong, isBloodbladeNoHitJoltSpec(spec));
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
        s.life = cls.indexOf('skill-cast-total') >= 0
          ? PLAYER_SKILL_TOTAL_FLOAT_LIFE_SEC : PLAYER_SKILL_FLOAT_LIFE_SEC;
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
  function isSkillCastFloatEvent(ev) {
    return !!ev && String(ev.cls || '').indexOf('skill-cast') >= 0;
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
    if (!ev) return;
    if (typeof isDamageNumbersEnabled === 'function' && !isDamageNumbersEnabled()) return;
    if (!S.ready) {
      if (!S.failed && S.initStarted) queueFloatUntilReady(ev);
      return;
    }
    if (documentHidden()) return;   // 背景分頁：ui.js 已改走「只記最新」路徑，這裡擋 setTimeout 殘留
    /* 與特效同理：飄字要落在「畫面上那一刻」的實體身上（見 onVfx 的說明）。 */
    if (!ev._buffered) { ev._buffered = true; ev.delayMs = (ev.delayMs || 0) + POS_BUFFER_MS; }
    var delay = Math.max(0, ev.delayMs || 0);
    if (delay > 0) {
      setTimeout(function () {
        if (!enemyFloatTargetAvailable(ev.elId)) return;
        onFloat({ elId: ev.elId, text: ev.text, cls: ev.cls, damageValue: ev.damageValue, _buffered: true });
      }, delay);
      return;
    }
    if (!enemyFloatTargetAvailable(ev.elId)) return;

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
    var skillCastEvent = isSkillCastFloatEvent(ev);
    if (!skillCastEvent) {
      /* 技能名稱＋總傷害是完整的一組提示，不能被一般傷害洪峰淘汰。
         容量只計算非技能飄字；若滿了，找最舊的非技能字移除。 */
      var ordinaryFloatCount = 0;
      for (var oi = 0; oi < S.floats.length; oi++) {
        if (!S.floats[oi].skillCast) ordinaryFloatCount++;
      }
      if (ordinaryFloatCount >= MAX_FLOATS) {
        var oldestIndex = -1;
        for (var fi = 0; fi < S.floats.length; fi++) {
          if (!S.floats[fi].skillCast) { oldestIndex = fi; break; }
        }
        var oldest = oldestIndex >= 0 ? S.floats.splice(oldestIndex, 1)[0] : null;
        if (oldest) {
          killFx(oldest);
          oldest.dead = true;
          /* 與自然到期路徑對稱：合併表的鍵含單調遞增的 mv-float-N，不清會累積 */
          if (oldest.mergeKey && S.floatMerge[oldest.mergeKey] === oldest) delete S.floatMerge[oldest.mergeKey];
        }
      }
    }
    var st = floatStyle(ev.elId, ev.cls, ev.text || '');
    var pt = posOf(ev.elId);
    var playerTarget = ev.elId === 'pv-float' || ev.elId === 'tp-float';
    var playerDamage = playerTarget &&
      (String(ev.cls || '').indexOf('mdmg') >= 0 || /^\s*(爆擊\s*)?-/.test(String(ev.text || '')));
    var skillCast = playerTarget && skillCastEvent;
    var castLeft = String(ev.cls || '').indexOf('skill-cast-left') >= 0;
    var castRight = String(ev.cls || '').indexOf('skill-cast-right') >= 0;
    /* 玩家事件分區：有益效果在角色頭頂藍區，承傷在身體紅區；技能名稱／傷害從人物中心左右約 120px 出現。 */
    if (playerTarget && S.player) {
      if (skillCast) {
        var castOffset = castLeft ? -PLAYER_SKILL_FLOAT_SIDE_OFFSET
          : (castRight ? PLAYER_SKILL_FLOAT_SIDE_OFFSET : 0);
        pt = { x: S.player.root.x + castOffset, y: S.player.root.y - 34 };
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
    var isEnemyDamageFloat = /^mv-float-\d+$/.test(String(ev.elId || '')) &&
      (String(ev.cls || '').indexOf('enemy-attack') >= 0 ||
       String(ev.cls || '').indexOf('enemy-skill') >= 0);
    var isCritFloat = String(ev.cls || '').indexOf('crit') >= 0;
    var f = {
      node: node, t: 0, life: st.life, rise: st.rise, skillCast: skillCast,
      bornAt: nowMs(), hits: 1, total: isFinite(val) ? val : 0,
      prefix: prefixMatch ? prefixMatch[1] : '',
      /* 傷害數字沿用 DOM 的快速回彈：一般字從 0.72 倍起，
         0.12 秒內放大到約 1.1 倍，再回到 1 倍；暴擊只稍微放大峰值。 */
      pop: isEnemyDamageFloat ? 0.12 : (isCritFloat ? 0.18 : 0),
      popStart: isEnemyDamageFloat ? 0.72 : 0.6,
      popPeak: isEnemyDamageFloat ? (isCritFloat ? 1.16 : 1.14) : 1.1,
      fadeTail: isEnemyDamageFloat,
      drift: castLeft ? -PLAYER_SKILL_FLOAT_DRIFT : (castRight ? PLAYER_SKILL_FLOAT_DRIFT : 0)
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
      p.bodyWrap.x += p.jolt > 0 ? (Math.random() * 2 - 1) * (p.joltX || HIT_JOLT_X) : 0;
      p.bodyWrap.y = p.jolt > 0 ? (Math.random() * 2 - 1) * (p.joltY || HIT_JOLT_Y) : 0;
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
      e.root.x = e.wx + (e.dashX || 0);
      if (e.state !== 'dying') {
        e.root.y = e.wy + (e.dashY || 0);
      }
      e.bodyWrap.x = e.jolt > 0 ? (Math.random() * 2 - 1) * (e.joltX || HIT_JOLT_X) : 0;
      e.bodyWrap.y = e.jolt > 0 ? (Math.random() * 2 - 1) * (e.joltY || HIT_JOLT_Y) : 0;
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
    return isCanvasFloatTarget(elId) &&
      (active() || (S.initStarted && !S.ready && !S.failed));
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
        loadFireFlare(),
        PIXI.Assets.load('images/vfx/thrust_lance.png?v=20260815-narrow-rect').then(function (tex) {
          S.thrustLanceTex = tex;
          tex.source.scaleMode = 'linear';
        }).catch(function () { S.thrustLanceTex = null; })
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
      flushPendingFloats();
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

  /* 除了現況快照，還要回報「會不會只增不減」的集合大小。
     2026-08-16 的回報：一旦開始卡頓，死亡重生也不會恢復，只有 F5 有效——
     那是累積型問題，不是負載問題，而負載量測（scratch/_perf_bench2~5）
     全部顯示穩態成本很低。要抓這種東西只能看同一個數字隨時間的走勢，
     所以這裡把每個有嫌疑的集合都列出來，交給 js/lagprobe.js 做成長追蹤。 */
  function status() {
    var L = S.layers || {};
    function kids(layer) { return (layer && layer.children) ? layer.children.length : 0; }
    return {
      ready: S.ready, failed: S.failed,
      size: S.W + 'x' + S.H,
      entities: Object.keys(S.entities).length,
      fx: S.fx.length, floats: S.floats.length,
      paused: S.paused, zone: S.zoneKey,
      /* ---- 洩漏診斷 ---- */
      lastPos: Object.keys(S.lastPos).length,          // 離場實體的殘留座標，應隨 LASTPOS_KEEP_MS 回落
      floatMerge: Object.keys(S.floatMerge).length,    // 合併表，鍵是遞增的 mv-float-N
      pendingFloats: S.pendingFloats.length,           // 初始化前暫存的飄字
      imgTex: Object.keys(S.imgTex).length,            // 敵人圖檔貼圖快取
      /* 顯示串列的實際子節點數。與上面的邏輯集合分開看：
         若 nodes.fx 遠大於 fx，代表有節點沒被回收（孤兒）；
         nodes.entity 只增不減則是屍體沒清掉。 */
      nodes: {
        fx: kids(L.fx), zone: kids(L.zone), entity: kids(L.entity),
        float: kids(L.float), overlay: kids(L.overlay)
      }
    };
  }

  function clearAllFloats() {
    for (var i = S.floats.length - 1; i >= 0; i--) {
      var f = S.floats[i];
      if (!f) continue;
      killFx(f);
      f.dead = true;
      if (f.mergeKey && S.floatMerge[f.mergeKey] === f) delete S.floatMerge[f.mergeKey];
    }
    S.floats.length = 0;
    S.floatMerge = {};
    if (S.layers && S.layers.float) {
      try { S.layers.float.removeChildren(); } catch (e) {}
    }
  }
  var clearDamageFloats = clearAllFloats;

  return {
    init: init,
    active: active,
    wantsFloat: wantsFloat,
    wantsVfx: wantsVfx,
    onFloat: onFloat,
    onVfx: onVfx,
    syncBattle: syncBattle,
    status: status,
    clearDamageFloats: clearDamageFloats,
    clearAllFloats: clearAllFloats,
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
