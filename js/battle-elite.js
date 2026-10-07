'use strict';
/* ============================================================
   battle-elite.js — 菁英敵人的畫面標記（只在主執行緒載入，掛在 BattleRenderer 上）
   ------------------------------------------------------------
   模擬層（js/elite.js）把「這隻有哪些詞條、現在處於什麼狀態」放在敵人資料上：
     data.affixes   詞條 id 陣列（只有菁英有）
     data._fx       目前的狀態旗標：shield／invuln／reflect／enrage／rage
     data._gid      群組編號（同一群共用；小兵與召喚物也有）
     data._gRole    leader／elite／minion／summon／split
   這一支只負責畫：
     1. 腳下的群組環（同一群同一個顏色，一眼看出誰跟誰是一夥）
     2. 頭頂的詞條圖示列與狀態圖示（護盾、無敵、反射、狂暴）
     3. 狀態光環（無敵＝金、護盾＝青、反射＝白、狂暴＝紅），一直脈動，好認
     4. 生命鏈結：同一群帶「生命鏈結」的成員之間畫一條粉紅色的脈動連線
   技能本身的預警、爆發、彈體都是模擬層送來的 Preset 事件（js/elite.js），不在這裡。
   ============================================================ */
var BattleElite = (function () {
  var GROUP_COLORS = [0xff7a7a, 0x7ad4ff, 0xffd45e, 0x9cff8a, 0xd89cff, 0xff9a5a, 0x5ae0c8, 0xff7ad0];
  var STATE_ICON = { shield: '🛡️', invuln: '🔰', reflect: '🪞', enrage: '😡', rage: '🩸' };
  var STATE_COLOR = { invuln: 0xffe28a, shield: 0x8fd8ff, reflect: 0xffffff, enrage: 0xff4a3a, rage: 0xff4a3a };
  var STATE_ORDER = ['invuln', 'reflect', 'shield', 'enrage', 'rage'];

  function groupColor(gid) { return GROUP_COLORS[Math.abs(Math.floor(Number(gid) || 0)) % GROUP_COLORS.length]; }
  function cssToInt(css, fallback) {
    var v = parseInt(String(css || '').replace('#', '0x'));
    return isFinite(v) ? v : fallback;
  }
  function affixList(data) {
    return (data && Array.isArray(data.affixes)) ? data.affixes : [];
  }
  function badgeText(data) {
    var ids = affixList(data);
    var out = '';
    for (var i = 0; i < ids.length; i++) {
      var def = (typeof ELITE_AFFIXES !== 'undefined') ? ELITE_AFFIXES[ids[i]] : null;
      if (def) out += def.emoji;
    }
    return out;
  }
  function stateKey(data) {
    var fx = (data && Array.isArray(data._fx)) ? data._fx : [];
    return fx.join(',');
  }

  function create(o) {
    var PIXI = o.PIXI;
    var layer = o.layer;                 // 與敵人同一層：座標系與 ent.root 相同
    var linkG = new PIXI.Graphics();
    linkG.zIndex = -1e7;                 // 壓在所有實體底下、地面之上
    layer.addChild(linkG);
    var clock = 0;

    function build(ent) {
      var d = ent.data;
      var deco = { sig: '', stateSig: null, ring: null, stateRing: null, badge: null, state: null };
      var big = d.isBoss ? 1.6 : (d.elite ? 1.0 : 0.62);
      deco.r = 30 * big * (ent.visScale || 1);
      var ring = new PIXI.Graphics();
      ring.y = 2;
      ent.view.addChildAt(ring, 0);
      deco.ring = ring;
      var stateRing = new PIXI.Graphics();
      stateRing.y = 2;
      stateRing.visible = false;
      ent.view.addChildAt(stateRing, 1);
      deco.stateRing = stateRing;
      if (affixList(d).length) {
        var badge = new PIXI.Text({
          text: badgeText(d), style: { fontSize: 15, fontFamily: 'sans-serif' }
        });
        badge.anchor.set(0.5, 1);
        badge.y = -(66 * (ent.visScale || 1)) - 14;
        ent.view.addChild(badge);
        deco.badge = badge;
      }
      var state = new PIXI.Text({
        text: '', style: { fontSize: 13, fontFamily: 'sans-serif' }
      });
      state.anchor.set(0.5, 1);
      state.y = -(66 * (ent.visScale || 1)) - 32;
      ent.view.addChild(state);
      deco.state = state;
      drawStatic(ent, deco);
      var scale = 1;
      var ids = affixList(d);
      for (var i = 0; i < ids.length; i++) {
        var def = (typeof ELITE_AFFIXES !== 'undefined') ? ELITE_AFFIXES[ids[i]] : null;
        if (def && def.arch === 'giant' && def.scale > 1) scale = Math.max(scale, def.scale);
      }
      if (scale > 1 && ent.body && ent.body.scale) {
        ent.body.scale.x *= scale; ent.body.scale.y *= scale;
        deco.giant = scale;
        deco.r *= scale;
      }
      return deco;
    }
    function drawStatic(ent, deco) {
      var d = ent.data;
      var gc = groupColor(d._gid);
      var r = deco.r;
      var g = deco.ring;
      g.clear();
      var elite = !!d.elite;
      g.ellipse(0, 0, r, r * 0.38).stroke({ color: elite ? cssToInt(d._elColor, gc) : gc, width: elite ? 2.5 : 1.5, alpha: elite ? 0.9 : 0.6 });
      if (elite) g.ellipse(0, 0, r * 0.82, r * 0.31).stroke({ color: gc, width: 1.5, alpha: 0.7 });
      deco.sig = d._gid + '|' + d._elColor + '|' + (d.elite ? 1 : 0);
    }
    function drawState(ent, deco, nowMs) {
      var d = ent.data;
      var fx = (d && Array.isArray(d._fx)) ? d._fx : [];
      var key = fx.join(',');
      if (key !== deco.stateSig) {
        deco.stateSig = key;
        var icons = '';
        for (var i = 0; i < STATE_ORDER.length; i++) if (fx.indexOf(STATE_ORDER[i]) >= 0) icons += STATE_ICON[STATE_ORDER[i]];
        deco.state.text = icons;
        deco.stateColor = 0;
        for (var j = 0; j < STATE_ORDER.length; j++) {
          if (fx.indexOf(STATE_ORDER[j]) >= 0) { deco.stateColor = STATE_COLOR[STATE_ORDER[j]]; break; }
        }
      }
      var sr = deco.stateRing;
      if (!deco.stateColor) { sr.visible = false; return; }
      sr.visible = true;
      var pulse = 0.5 + 0.5 * Math.sin(nowMs / 170);
      var r = deco.r * (1.15 + 0.12 * pulse);
      sr.clear();
      sr.ellipse(0, 0, r, r * 0.4).stroke({ color: deco.stateColor, width: 3, alpha: 0.55 + 0.4 * pulse });
      sr.ellipse(0, 0, r * 0.78, r * 0.31).fill({ color: deco.stateColor, alpha: 0.1 + 0.12 * pulse });
    }

    function update(entities, dt, nowMs) {
      clock = nowMs;
      var groups = null;
      for (var id in entities) {
        if (!Object.prototype.hasOwnProperty.call(entities, id)) continue;
        var ent = entities[id];
        if (!ent || !ent.data || ent.state === 'gone') continue;
        var d = ent.data;
        var interesting = d._gid !== undefined || affixList(d).length;
        if (!interesting) continue;
        if (!ent.eliteDeco) ent.eliteDeco = build(ent);
        var deco = ent.eliteDeco;
        var sig = d._gid + '|' + d._elColor + '|' + (d.elite ? 1 : 0);
        if (sig !== deco.sig) drawStatic(ent, deco);
        if (deco.badge) {
          var txt = badgeText(d);
          if (deco.badge.text !== txt) deco.badge.text = txt;
        }
        drawState(ent, deco, nowMs);
        var dead = ent.state === 'dying' || d.hp <= 0;
        deco.ring.alpha = dead ? 0.25 : 0.55 + 0.35 * (0.5 + 0.5 * Math.sin(nowMs / 420 + (d._gid || 0)));
        if (!dead && affixList(d).indexOf('lifelink') >= 0) {
          (groups || (groups = {}))[d._gid] = (groups[d._gid] || []);
          groups[d._gid].push(ent);
        }
      }
      linkG.clear();
      var linkOn = (typeof ELITE_GROUP === 'undefined') || Number(ELITE_GROUP.linkBeam) !== 0;
      if (groups && linkOn) {
        var pulse = 0.5 + 0.5 * Math.sin(nowMs / 230);
        for (var gid in groups) {
          var list = groups[gid];
          for (var a = 0; a < list.length; a++) {
            for (var b = a + 1; b < list.length; b++) {
              var x1 = list[a].root.x, y1 = list[a].root.y - 22, x2 = list[b].root.x, y2 = list[b].root.y - 22;
              linkG.moveTo(x1, y1).lineTo(x2, y2).stroke({ color: 0xff7ad0, width: 4, alpha: 0.18 + 0.12 * pulse });
              linkG.moveTo(x1, y1).lineTo(x2, y2).stroke({ color: 0xffd0f0, width: 1.5, alpha: 0.55 + 0.35 * pulse });
            }
          }
        }
      }
    }

    function destroy() {
      if (linkG && !linkG.destroyed) linkG.destroy();
    }
    return { update: update, destroy: destroy, _groupColor: groupColor };
  }

  return { create: create, groupColor: groupColor, STATE_ICON: STATE_ICON };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = BattleElite;
