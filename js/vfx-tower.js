'use strict';
/* ============================================================
   vfx-tower.js — 高塔的 VFX Preset 表面（第二個 Pixi 疊層）

   高塔與野外是兩種完全不同的版面：
     野外 = 俯視戰場，實體有世界座標，事件帶 area（圓心與半徑就是判定範圍）
     高塔 = DOM 卡片版面（202px 玩家卡 ＋ VS ＋ BOSS 卡），實體沒有座標，
            因此 bfPos 回 null、sgAreaAround 回 null ⇒ **高塔的事件 area 一律是 null**

   所以這一層做兩件事：
     1. 把 DOM 卡片換算成一組座標（人像中心＝身體、人像下緣＝腳底），餵給同一個 Adapter
     2. 套一組高塔專用的尺寸規則（見 TOWER_PROFILE）——Preset 是照戰場尺寸畫的，
        天降從 y=-500 落下、場域名目半徑 100（直徑 200px），直接放到 202px 的卡片上會爆框

   為什麼不共用 battle-renderer 的那個 Pixi Application：
   它掛在野外的棋盤景上、有自己的相機與世界容器，而高塔是另一塊 DOM、另一套座標系。
   共用一個 stage 等於要在同一個相機底下維護兩套互不相干的座標，那比多開一個 App 更難維護。

   接不起來（PIXI 沒載、Core 缺件、素材索引抓不到）就整批回 false，
   由 js/vfx.js 的 DOM 畫法接手——與野外「缺主要角色就退回舊畫法」同一條規則。
   ============================================================ */

var VFXTower = (function () {

  /* 高塔專用尺寸規則。三個係數各自對應一種「Preset 名目尺寸 → 卡片版面」的換算：
       scale     角色身上的東西（受擊／施放／狀態光環）。Preset 名目身高 60px，
                 卡片人像 72px（BOSS 84px），所以 1.0 已經接近，不另外放大。
       areaScale 帶 area 的東西（範圍爆發、場域、環繞）。名目半徑 100＝直徑 200px，
                 而一張卡片只有 202px 寬 → 收到約半徑 55px。
       skyScale  天降（fxKind rain）。Preset 從 y=-500 落到原點，卡片可用高度約 140px。
     這三個數字是「看得順眼」的起點，不是量出來的物理值——目視 QA 之後直接調這裡。 */
  var TOWER_PROFILE = {
    scale: 1,
    areaScale: 0.55,
    skyScale: 0.28,
    /* 高塔的事件沒有 area，場域類因此沒有半徑可用。給它一個名目半徑，
       畫成卡片底部的橢圓；0 就會維持退回舊畫法。 */
    groundR: 70
  };

  var BODY_RATIO = 0.5;      // 人像框內的「身體中心」高度比例
  var TOWER_IDS = { player: 'tp-float', boss: 'tb-float' };

  var S = {
    app: null, adapter: null, canvas: null, scene: null,
    booting: false, failed: false, obs: null
  };

  function scene() {
    var box = document.getElementById('tower-fight');
    if (!box || box.style.display === 'none') return null;
    return box.querySelector('.battle-scene');
  }
  /* 分頁不在高塔時整個面板是 display:none，所有 DOM 矩形都會量到 0——
     那時候接手等於把特效全部畫在原點而且沒人看得到，還順便把 DOM 退路擋掉。
     有尺寸才算「畫得出來」。 */
  function visibleScene() {
    var host = scene();
    if (!host) return null;
    var r = host.getBoundingClientRect();
    return (r.width > 1 && r.height > 1) ? host : null;
  }

  /* 事件目標 → 卡片上的那個人像元素。找不到就退回整張卡片。 */
  function bodyEl(elId) {
    var layer = document.getElementById(elId);
    var card = (layer && layer.closest) ? layer.closest('.combatant') : null;
    if (!card) return null;
    return card.querySelector('.cb-icon') || card.querySelector('#tb-emoji') || card;
  }

  /* DOM 矩形 → 疊層本地座標（疊層與 .battle-scene 等大且對齊）。 */
  function localRect(el) {
    if (!el || !S.scene) return null;
    var r = el.getBoundingClientRect();
    var base = S.scene.getBoundingClientRect();
    if (!(r.width > 0) && !(r.height > 0)) return null;
    return { x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height };
  }

  function centreOf(elId) {
    var r = localRect(bodyEl(elId));
    if (!r) return { x: 0, y: 0 };
    return { x: r.x + r.w / 2, y: r.y + r.h * BODY_RATIO };
  }
  function footOf(elId) {
    var r = localRect(bodyEl(elId));
    if (!r) return { x: 0, y: 0 };
    return { x: r.x + r.w / 2, y: r.y + r.h };
  }

  /* 高塔只有兩個定址：tp-float（我方）與 tb-float（BOSS）。
     野外的 mv-float-N／pv-float 不會走到這裡（ui.js 依 targets 分流）。 */
  function ctx() {
    return {
      posOf: centreOf,
      footOf: footOf,
      playerPos: function () { return centreOf(TOWER_IDS.player); },
      projectileTargetPoint: function (id) { return centreOf(id); }
    };
  }

  function towerTargets(spec) {
    var ids = Array.isArray(spec && spec.targets) ? spec.targets : [];
    for (var i = 0; i < ids.length; i++) {
      if (ids[i] === TOWER_IDS.boss || ids[i] === TOWER_IDS.player) return true;
    }
    return false;
  }

  function sizeCanvas() {
    if (!S.app || !S.scene || !S.canvas) return;
    var r = S.scene.getBoundingClientRect();
    if (!(r.width > 1 && r.height > 1)) return;      // 面板收起來時不要把畫布縮成 1×1
    var w = Math.round(r.width);
    var h = Math.round(r.height);
    if (S.app.renderer.width === w && S.app.renderer.height === h) return;
    S.app.renderer.resize(w, h);
    S.canvas.style.width = '100%';
    S.canvas.style.height = '100%';
  }

  /* 疊層：蓋滿 .battle-scene、不吃滑鼠、壓在 DOM 浮字（z-index 5）之下，
     傷害數字必須看得見，特效不能把它蓋掉。 */
  function mount(app) {
    var host = scene();
    if (!host) return false;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    var c = app.canvas;
    c.className = 'tower-vfx-canvas';
    c.style.position = 'absolute';
    c.style.left = '0';
    c.style.top = '0';
    c.style.width = '100%';
    c.style.height = '100%';
    c.style.pointerEvents = 'none';
    c.style.zIndex = '3';
    host.appendChild(c);
    S.scene = host;
    S.canvas = c;
    return true;
  }

  function boot() {
    if (S.booting || S.failed || S.adapter) return;
    if (typeof PIXI === 'undefined' || typeof VFXCore === 'undefined' ||
        typeof VFXPixiBackend === 'undefined' || typeof VFXRuntime === 'undefined') {
      S.failed = true;
      return;
    }
    if (!visibleScene()) return;          // 高塔還沒開（或分頁不在高塔），等下一則事件
    S.booting = true;
    var app = new PIXI.Application();
    app.init({
      backgroundAlpha: 0, antialias: true, autoDensity: true,
      width: 640, height: 240, preference: 'webgl'
    }).then(function () {
      if (!mount(app)) throw new Error('找不到高塔的 .battle-scene');
      sizeCanvas();
      var zone = new PIXI.Container();
      var fx = new PIXI.Container();
      app.stage.addChild(zone);
      app.stage.addChild(fx);
      return fetch('vfx/shipped-assets.json')
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (index) {
          if (!index) throw new Error('抓不到 vfx/shipped-assets.json');
          var adapter = VFXRuntime.create({
            resolver: VFXCore.createIndexResolver(index, index.baseUrl || 'images/vfx/assets'),
            fxBackend: VFXPixiBackend.createBackend({ container: fx }),
            zoneBackend: VFXPixiBackend.createBackend({ container: zone }),
            ctx: ctx(),
            profile: TOWER_PROFILE
          });
          return VFXRuntime.loadPresets(VFXRuntime.collectPresetIds())
            .then(function (presets) {
              adapter.registerPresets(presets);
              S.app = app;
              S.adapter = adapter;
              app.ticker.add(function (ticker) {
                sizeCanvas();
                adapter.update(Math.min(0.05, (ticker.deltaMS || 16.7) / 1000));
              });
              if (typeof ResizeObserver === 'function' && S.scene) {
                S.obs = new ResizeObserver(sizeCanvas);
                S.obs.observe(S.scene);
              }
              console.info('[vfx-tower] 高塔 VFX Preset 疊層已接上（' + presets.length + ' 份 preset）。');
            });
        });
    }).catch(function (err) {
      S.failed = true;
      try { if (app && app.destroy) app.destroy(true, { children: true }); } catch (e) {}
      console.warn('[vfx-tower] 疊層組裝失敗，高塔維持 DOM 舊畫法：',
        err && err.message ? err.message : err);
    }).then(function () { S.booting = false; });
  }

  /* ui.js 的事件分流會先問這一支：回 true＝已接手，false＝交給 js/vfx.js 的 DOM 畫法。 */
  function onVfx(spec) {
    if (!spec || !towerTargets(spec)) return false;
    if (!S.adapter) { boot(); return false; }
    if (!visibleScene()) return false;    // 高塔已關閉或分頁不在高塔
    return S.adapter.tryPlay(spec);
  }

  /* 狀態光環：與野外一樣靠面板快照 reconcile（事件答不出「現在還在不在」）。
     由 renderTowerFight 每次重繪時呼叫。 */
  function sync(player, boss) {
    if (!S.adapter || !visibleScene()) return;
    var out = [];
    function push(key, ent) {
      if (!key || !ent || typeof statusEntries !== 'function') return;
      var list = statusEntries(ent);
      var sids = [];
      for (var i = 0; i < list.length; i++) if (list[i] && list[i].sid) sids.push(list[i].sid);
      out.push({ key: key, sids: sids });
    }
    push(TOWER_IDS.player, player);
    push(TOWER_IDS.boss, boss);
    S.adapter.syncStatuses(out);
  }

  /* 高塔結束（撤退／勝負／換頁）：清掉畫面上還在跑的東西，但保留 App 與已載入的 preset，
     下一場不必重新抓 150 份 JSON。 */
  function stop() {
    if (S.adapter) S.adapter.clear();
  }

  function status() {
    return {
      ready: !!S.adapter, failed: S.failed,
      profile: TOWER_PROFILE,
      stats: S.adapter ? S.adapter.stats() : null
    };
  }

  return { onVfx: onVfx, sync: sync, stop: stop, status: status, PROFILE: TOWER_PROFILE };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = VFXTower;
}
