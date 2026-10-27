/* ============================================================
   hero3d.js — 內測用的 3D 主角（即時 3D 骨架動畫）

   戰鬥畫面仍是 Pixi 的 2D 場景。這支檔把一隻 3D 角色（GLB，three.js）畫進一張離屏畫布，
   再當成一張貼圖貼在主角的 Sprite 上，所以站位、鏡頭、陰影、特效層、血條全都沿用原本那一套。
   只換「角色身體怎麼畫」。

   - 只在內測版載入模型：Hero3D.enabled() 要同時滿足 isInternalServer() 與使用者開了開關（localStorage）。
     正式版即使 localStorage 被寫了也回傳 false，不會下載 three.js 或模型。
   - three.js 以 <script type="importmap"> 對應 'three'（見 index.html），第一次 create() 才動態 import，
     沒開 3D 模式就完全不下載。
   - 動畫名稱沿用 2D 序列幀的名稱（idle／walk／attack1／attack2／cast／die／rise），CLIP_FOR 把它們對到 GLB 裡的動畫。
   - 模型與製作方式見 images/models/hero3d/SOURCE.md；程式庫來源與授權見 js/vendor/three/README.md。

   座標：遊戲地面座標 x 向右、y 向畫面下方（朝向觀眾）。three 的地面是 XZ，所以地面 (x, y) 對到 three 的 (x, z)；
   模型的正面是 +Z，朝向地面向量 (dx, dy) 的轉角 = atan2(dx, dy)。
   ============================================================ */
(function (global) {
  'use strict';

  var STORE_KEY = 'idle-rpg.hero3d.v1';
  var MODEL_URL = 'images/models/hero3d/sunbrand-knight.glb';
  var GLTF_URL = 'js/vendor/three/loaders/GLTFLoader.js';

  /* 2D 動作名 → GLB 動畫。2D 沒有的情況（受擊）不需要；施法與第三招借用攻擊動作。
     rise（起身）把 Death 倒著播。 */
  /* 攻擊動作只播「有用的那一段」：Meshy 的揮劍動作前有約 0.9 秒蓄力、後有 1.3 秒以上的收招空檔，
     整段照播會比攻擊間隔長很多（Attack1 2.4 秒、Attack2 3.2 秒）。單位是動作內的秒數（原速）：
       start：從這裡開始播（跳過大半蓄力，只留看得出「舉劍」的 0.3 秒）
       hit：劍真正揮到的時刻（Attack2 有兩下，取第一下）
       end：動作到這裡就算播完（之後是回到待機的空檔）
     數值是從 GLB 的劍骨骼逐幀位移量出來的（見 images/models/hero3d/SOURCE.md）。 */
  var CLIP_FOR = {
    idle:    { clip: 'CombatIdle', loop: true },
    walk:    { clip: 'Run', loop: true },
    attack1: { clip: 'Attack1', loop: false, start: 0.62, hit: 0.92, end: 1.75 },
    attack2: { clip: 'Attack2', loop: false, start: 0.37, hit: 0.67, end: 1.75 },
    attack3: { clip: 'Attack1', loop: false, start: 0.62, hit: 0.92, end: 1.75 },
    cast:    { clip: 'Attack2', loop: false, start: 0.37, hit: 0.67, end: 1.2 },
    die:     { clip: 'Death', loop: false, hold: true },
    rise:    { clip: 'Death', loop: false, reverse: true }
  };

  /* 離屏畫布與鏡頭。畫布 SIZE 像素涵蓋 SPAN 公尺（揮劍、倒地躺平時劍會伸出去，留夠邊）。
     鏡頭仰角 ELEV_DEG：2D 場景的地面縱向壓縮 0.5＝sin(30°)，用同一個仰角 3D 角色的透視才與地面一致。 */
  var SIZE = 288;
  var SPAN = 3.6;
  var ELEV_DEG = 30;
  var TARGET_Y = 1.0;            // 鏡頭對準的高度（公尺）
  var YAW_TAU_SEC = 0.09;        // 轉向的時間常數：越小轉越快
  var FADE_SEC = 0.12;           // 動作之間的交叉淡入

  var EMISSIVE = 0x2a2418;       // 自發光底色（乘上貼圖）：暗處的金屬不死黑，又不蓋掉光照的明暗

  /* 貼圖調色：Meshy 出的金色偏暗偏灰、銀色邊飾不夠白，縮到遊戲裡的大小（約 100 像素高）就全糊成一片暗黃。
     金色調亮調飽和、銀色拉白、披風的藍略微提亮，讓三種顏色在小圖上分得開。 */
  function gradeTexture(THREE, src) {
    var img = src.image;
    var c = global.document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    var cx = c.getContext('2d');
    cx.drawImage(img, 0, 0);
    var d = cx.getImageData(0, 0, c.width, c.height), p = d.data;
    for (var i = 0; i < p.length; i += 4) {
      var r = p[i] / 255, g = p[i + 1] / 255, b = p[i + 2] / 255;
      var mx = Math.max(r, g, b), mn = Math.min(r, g, b), dl = mx - mn;
      var v = mx, s = mx ? dl / mx : 0, h = 0;
      if (dl) {
        if (mx === r) h = ((g - b) / dl) % 6; else if (mx === g) h = (b - r) / dl + 2; else h = (r - g) / dl + 4;
        h *= 60; if (h < 0) h += 360;
      }
      if (h > 25 && h < 65 && s > 0.25) { v = Math.min(1, v * 1.32 + 0.05); s = Math.min(1, s * 1.12); }        // 金
      else if (s < 0.22 && v > 0.45) { v = Math.min(1, v * 1.2 + 0.08); s *= 0.4; }                              // 銀
      else if (h > 190 && h < 260 && s > 0.25) { v = Math.min(1, v * 1.35); }                                    // 披風
      var C = v * s, X = C * (1 - Math.abs((h / 60) % 2 - 1)), m = v - C, R, G, B;
      if (h < 60) { R = C; G = X; B = 0; } else if (h < 120) { R = X; G = C; B = 0; }
      else if (h < 180) { R = 0; G = C; B = X; } else if (h < 240) { R = 0; G = X; B = C; }
      else if (h < 300) { R = X; G = 0; B = C; } else { R = C; G = 0; B = X; }
      p[i] = (R + m) * 255; p[i + 1] = (G + m) * 255; p[i + 2] = (B + m) * 255;
    }
    cx.putImageData(d, 0, 0);
    var t = new THREE.CanvasTexture(c);
    t.flipY = src.flipY;
    t.colorSpace = src.colorSpace;
    t.anisotropy = 4;
    return t;
  }

  function isInternal() {
    return typeof isInternalServer === 'function' && isInternalServer();
  }
  function stored() {
    try { return global.localStorage.getItem(STORE_KEY) === '1'; } catch (e) { return false; }
  }
  /* 是否使用 3D 主角：只有內測版、且使用者開了開關。 */
  function enabled() { return isInternal() && stored(); }
  function setEnabled(on) {
    try {
      if (on) global.localStorage.setItem(STORE_KEY, '1');
      else global.localStorage.removeItem(STORE_KEY);
    } catch (e) { /* 存不了就維持原狀 */ }
  }

  function absUrl(path) { return new URL(path, global.document.baseURI).href; }

  async function create(opts) {
    opts = opts || {};
    var THREE = await import('three');
    var gltfMod = await import(absUrl(GLTF_URL));
    var gltf = await new gltfMod.GLTFLoader().loadAsync(absUrl(opts.model || MODEL_URL));

    var canvas = global.document.createElement('canvas');
    var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(SIZE, SIZE, false);
    renderer.setClearColor(0x000000, 0);

    var scene = new THREE.Scene();
    /* 光照：環境光壓低一點、主光加強讓盔甲有明暗，背後再補一盞冷色邊緣光把人物從背景分出來
       （戰鬥畫面特效多、背景雜，只靠環境光整個人會糊成一片）。 */
    scene.add(new THREE.AmbientLight(0xffffff, 1.35));
    var sun = new THREE.DirectionalLight(0xfff4e0, 2.0);
    sun.position.set(-2, 4, 3);
    scene.add(sun);
    var rim = new THREE.DirectionalLight(0xbfe4ff, 1.7);
    rim.position.set(2.5, 2.5, -3);
    scene.add(rim);

    var pivot = new THREE.Group();     // 面向轉在這一層
    pivot.add(gltf.scene);
    scene.add(pivot);
    var gradedMap = null;
    gltf.scene.traverse(function (o) {
      if (o.isSkinnedMesh || o.isMesh) o.frustumCulled = false;  // 蒙皮網格的包圍盒不隨動畫更新，會被誤剔除
      if (o.isMesh && o.material && o.material.isMeshStandardMaterial) {
        /* 手繪貼圖：金屬度與粗糙度沒有貼圖，標準材質會因為缺環境光偏暗，用 Lambert 保持貼圖原色。
           貼圖先調色（見 gradeTexture），再把同一張當自發光貼圖，讓金屬在暗處也不會死黑。 */
        if (!gradedMap) gradedMap = gradeTexture(THREE, o.material.map);
        o.material = new THREE.MeshLambertMaterial({
          map: gradedMap, emissiveMap: gradedMap, emissive: new THREE.Color(EMISSIVE), transparent: false
        });
      }
    });

    var cam = new THREE.OrthographicCamera(-SPAN / 2, SPAN / 2, SPAN / 2, -SPAN / 2, 0.1, 60);
    var e = ELEV_DEG * Math.PI / 180;
    cam.position.set(0, TARGET_Y + Math.sin(e) * 12, Math.cos(e) * 12);
    cam.lookAt(0, TARGET_Y, 0);

    var mixer = new THREE.AnimationMixer(gltf.scene);
    var actions = {};
    gltf.animations.forEach(function (c) { actions[c.name] = mixer.clipAction(c); });

    var ctrl = {
      canvas: canvas,
      size: SIZE,
      /* 腳底在畫布裡的縱向位置（0＝上緣、1＝下緣）：正交鏡頭下，高度 h 的點離中心 (h − TARGET_Y)·cos(仰角) 公尺 */
      anchorY: 0.5 + TARGET_Y * Math.cos(e) / SPAN,
      pxPerMeter: SIZE / SPAN,
      clip: '',
      onFinished: null,
      yaw: Math.PI / 2,              // 預設面向右（與 2D 的 defaultDirection 0 一致）
      yawTarget: Math.PI / 2,
      speed: 1
    };
    var current = null, currentCfg = null, finishedFired = false;

    /* 一次播放只通知一次「播完」：有 end 的動作在 end 就算完，不必等整段 clip 的 finished 事件 */
    function fireFinished() {
      if (finishedFired) return;
      finishedFired = true;
      if (typeof ctrl.onFinished === 'function') ctrl.onFinished(ctrl.clip);
    }
    mixer.addEventListener('finished', function (ev) {
      if (ev.action === current) fireFinished();
    });

    /* 播放一個動作；cfg 同 CLIP_FOR 的項目。同一個循環動作重複要求時不重來。 */
    ctrl.play = function (cfg, fade) {
      var next = actions[cfg.clip];
      if (!next) return false;
      if (next === current && cfg.loop) return true;
      var prev = current;
      next.reset();
      next.enabled = true;
      next.setLoop(cfg.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      next.clampWhenFinished = !cfg.loop;       // 放完停在最後一格，直到被換掉（死亡要停在躺下）
      next.timeScale = cfg.reverse ? -1 : 1;
      next.time = cfg.reverse ? next.getClip().duration : (cfg.start || 0);
      next.setEffectiveWeight(1);
      next.play();
      if (prev && prev !== next && fade !== 0) next.crossFadeFrom(prev, fade == null ? FADE_SEC : fade, false);
      else if (prev && prev !== next) prev.stop();
      current = next;
      currentCfg = cfg;
      finishedFired = false;
      ctrl.clip = cfg.clip;
      return true;
    };
    ctrl.duration = function (clip) {
      var a = actions[clip || ctrl.clip];
      return a ? a.getClip().duration : 0;
    };
    /* 目前這個動作原速要播多久（有 start／end 的只算那一段）與劍揮到的時刻（距離開始播的秒數） */
    ctrl.spanSec = function () {
      if (!currentCfg) return 0;
      return currentCfg.end ? currentCfg.end - (currentCfg.start || 0) : ctrl.duration();
    };
    ctrl.hitSec = function () {
      return currentCfg && currentCfg.hit ? currentCfg.hit - (currentCfg.start || 0) : 0;
    };
    /* 停在這個動作的某個位置（0..1）。倒著播的動作（起身）0 是「最後一格」：fraction 從 0 走到 1 就是倒著播。 */
    ctrl.seek = function (fraction) {
      if (!current) return;
      if (currentCfg && currentCfg.reverse) fraction = 1 - fraction;
      var d = current.getClip().duration;
      current.paused = false;
      current.time = Math.max(0, Math.min(1, fraction)) * d;
      current.paused = true;
      mixer.update(0);
    };
    ctrl.faceVector = function (dx, dy) {
      if (!dx && !dy) return;
      ctrl.yawTarget = Math.atan2(dx, dy);
    };
    ctrl.update = function (dt) {
      mixer.timeScale = ctrl.speed;
      mixer.update(dt);
      if (current && currentCfg && currentCfg.end && !currentCfg.reverse && current.time >= currentCfg.end) fireFinished();
      var d = ((ctrl.yawTarget - ctrl.yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      ctrl.yaw += d * (1 - Math.exp(-dt / YAW_TAU_SEC));
      pivot.rotation.y = ctrl.yaw;
      renderer.render(scene, cam);
    };
    ctrl.dispose = function () {
      mixer.stopAllAction();
      renderer.dispose();
      gltf.scene.traverse(function (o) {
        if (o.geometry) o.geometry.dispose();
        if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
      });
    };
    ctrl.clips = Object.keys(actions);
    ctrl.update(0);
    global.Hero3D.instance = ctrl;   // 除錯與驗證用（在 console 看畫布、手動播動作）
    return ctrl;
  }

  /* 把 3D 角色包成一個長得像 AnimatedSprite 的 Pixi Sprite：battle-renderer 對主角身體用到的那幾個成員
     （playing／update／animationSpeed／loop／onComplete／gotoAndStop／totalFrames／tint）都有，
     其餘程式不必知道身體是 2D 還是 3D。
     animationSpeed 的語意與 2D 相同「某個動作的播放速度」，但 3D 動作有自己的長度，所以換算成相對「名目速度」的倍率。 */
  function makeBody(ctrl) {
    var PIXI = global.PIXI;
    var tex = PIXI.Texture.from(ctrl.canvas);
    tex.source.scaleMode = 'linear';
    var sp = new PIXI.Sprite(tex);
    sp.anchor.set(0.5, ctrl.anchorY);
    sp.hero3d = ctrl;
    /* 穿透式輪廓（battle-renderer 的 makeOutlineSprite／syncOutline 畫在特效層之上，讓人物被特效蓋住時還找得到）：
       2D 角色有逐幀的輪廓圖，3D 沒有，所以每幀從 3D 畫布的剪影即時算一圈——白色，顏色由輪廓精靈上色。 */
    var oc = global.document.createElement('canvas');
    oc.width = oc.height = ctrl.size;
    var ox = oc.getContext('2d');
    var otex = PIXI.Texture.from(oc);
    otex.source.scaleMode = 'linear';
    sp.hero3dOutlineTex = otex;
    var OUTLINE_R = 2;   // 畫布像素；畫布縮到遊戲裡約 0.7 倍，所以螢幕上約 1.4 像素寬
    function drawOutline() {
      ox.globalCompositeOperation = 'source-over';
      ox.clearRect(0, 0, oc.width, oc.height);
      for (var a = 0; a < 8; a++) {
        ox.drawImage(ctrl.canvas, Math.round(Math.cos(a * Math.PI / 4) * OUTLINE_R), Math.round(Math.sin(a * Math.PI / 4) * OUTLINE_R));
      }
      ox.globalCompositeOperation = 'source-in';
      ox.fillStyle = '#fff';
      ox.fillRect(0, 0, oc.width, oc.height);
      ox.globalCompositeOperation = 'destination-out';
      ox.drawImage(ctrl.canvas, 0, 0);       // 挖掉本體，只剩外圈
      ox.globalCompositeOperation = 'source-over';
      otex.source.update();
    }
    sp.playing = true;
    sp.loop = true;
    sp.onComplete = null;
    var nominal = 0.5, factor = 1;
    Object.defineProperty(sp, 'animationSpeed', {
      get: function () { return nominal * factor; },
      set: function (v) { factor = nominal > 0 && isFinite(v) ? v / nominal : 1; ctrl.speed = factor; }
    });
    Object.defineProperty(sp, 'textures', { get: function () { return [tex]; }, set: function () { /* 2D 專用，3D 不用 */ } });
    Object.defineProperty(sp, 'totalFrames', { get: function () { return Math.max(1, Math.round(ctrl.duration() * 24)); } });
    Object.defineProperty(sp, 'currentFrame', { get: function () { return 0; } });
    /* 這個動作原速播完要多少毫秒（攻擊動作以此算要加速多少才塞得進攻擊間隔）；有 start／end 的只算有用的那一段 */
    Object.defineProperty(sp, 'naturalMs', { get: function () { return ctrl.spanSec() * 1000; } });
    /* 劍揮到的時刻：原速下距離開始播多少毫秒（施法要讓它對上技能釋放的時刻） */
    Object.defineProperty(sp, 'hitMs', { get: function () { return ctrl.hitSec() * 1000; } });

    ctrl.onFinished = function () {
      if (typeof sp.onComplete === 'function') sp.onComplete();
    };
    /* 名目速度＝2D 那個動作的 animationSpeed，之後外部乘上的倍數就是 3D 的播放倍率 */
    sp.hero3dPlay = function (cfg, nominalSpeed) {
      nominal = nominalSpeed > 0 ? nominalSpeed : 0.5;
      factor = 1;
      ctrl.speed = 1;
      return ctrl.play(cfg);
    };
    sp.hero3dFace = function (dx, dy) { ctrl.faceVector(dx, dy); };
    sp.gotoAndStop = function (n) {
      var total = sp.totalFrames;
      ctrl.seek(total > 1 ? n / (total - 1) : 0);
      sp.update(null, 0);
    };
    sp.gotoAndPlay = function () { /* 3D 以 hero3dPlay 開始播放 */ };
    sp.update = function (ticker, dtOverride) {
      var dt = dtOverride != null ? dtOverride : Math.min(0.05, Math.max(0, (ticker && ticker.deltaMS) || 16.7) / 1000);
      ctrl.update(dt);
      tex.source.update();
      drawOutline();
    };
    return sp;
  }

  global.Hero3D = {
    enabled: enabled,
    setEnabled: setEnabled,
    create: create,
    makeBody: makeBody,
    CLIP_FOR: CLIP_FOR,
    /* 畫布像素 → 螢幕像素的縮放，使 1.8 公尺高的角色約等於 2D 騎士的畫面高度（約 100px） */
    displayScale: function (ctrl) { return 100 / 1.8 / ctrl.pxPerMeter; }
  };
})(typeof window !== 'undefined' ? window : this);
