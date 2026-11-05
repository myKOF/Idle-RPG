'use strict';
/* Pure, deterministic celebration choreography shared by VFX Core in Editor and game.
   Geometry and timing are migrated from the former renderer; all authored choices live in the preset. */
var VFXCelebration = (function () {
  function lvClamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function lvEaseOut(k) { return 1 - (1 - k) * (1 - k); }
  function lvEaseInOut(k) { return k * k * (3 - 2 * k); }
  function color(v) { return parseInt(v.slice(1), 16); }
  function Group() { this.kind='group'; this.children=[]; this.x=0; this.y=0; this.alpha=1; this.visible=true;
    this.scale={x:1,y:1,set:function(x,y){this.x=x;this.y=y===undefined?x:y;}}; }
  Group.prototype.addChild=function(){ for(var i=0;i<arguments.length;i++)this.children.push(arguments[i]); };
  function Shape(kind) { Group.call(this); this.kind=kind; this.blendMode='add'; this.tint=0xffffff; }
  Shape.prototype=Object.create(Group.prototype);
  var AURA_FIELDS=['part','bodyY','gatherSec','burstAt','vortexAt','gatherCount','gatherReduced','sparkCount','sparkReduced',
    'vortexCount','vortexReduced','trailCount','trailReduced','gatherRadius','gatherRadiusSpread','sparkSpeed','sparkSpeedSpread','vortexRadius','vortexTop','vortexEnd','colors'];
  var TEXT_FIELDS=['part','textKey','style','startY','rise','riseSec','glowColor','glowMinX','glowWidthFactor','glowScaleY'];
  function validate(c) {
    var errors=[],fields=c&&c.part==='aura'?AURA_FIELDS:c&&c.part==='text'?TEXT_FIELDS:null;
    if(!fields)return ['celebration.part must be aura or text'];
    Object.keys(c).forEach(function(k){if(fields.indexOf(k)<0)errors.push('unknown celebration.'+k);});
    fields.forEach(function(k){if(c[k]===undefined)errors.push('missing celebration.'+k);});
    fields.forEach(function(k){if(['part','colors','style','textKey','glowColor'].indexOf(k)>=0)return;
      if(typeof c[k]!=='number'||!isFinite(c[k])||Math.abs(c[k])>10000)errors.push('invalid celebration.'+k);});
    if(c.part==='aura') {
      ['gatherCount','gatherReduced','sparkCount','sparkReduced','vortexCount','vortexReduced','trailCount','trailReduced'].forEach(function(k){if(c[k]<0||c[k]>2000||c[k]%1)errors.push('invalid count '+k);});
      if(c.vortexCount*c.trailCount>12000||c.vortexReduced*c.trailReduced>12000)errors.push('too many celebration trail nodes');
      ['gatherSec','gatherRadius','sparkSpeed','vortexRadius'].forEach(function(k){if(!(c[k]>0))errors.push(k+' must be positive');});
      if(c.burstAt<0||c.vortexAt<0)errors.push('negative phase time');
      var keys=['ground','core','flash','ring','wave','ivory','gold','white','pale','amber'];
      if(!c.colors||Object.keys(c.colors).length!==keys.length)errors.push('invalid celebration colors');
      keys.forEach(function(k){if(!c.colors||!/^#[0-9a-f]{6}$/i.test(c.colors[k]))errors.push('invalid color '+k);});
    } else {
      if(typeof c.textKey!=='string'||!c.textKey.length||c.textKey.length>128)errors.push('invalid textKey');
      if(!/^#[0-9a-f]{6}$/i.test(c.glowColor))errors.push('invalid glowColor');
      if(!(c.riseSec>0))errors.push('text riseSec must be positive');
      var s=c.style;
      if(!s||typeof s.fontFamily!=='string'||s.fontFamily.length>256||!(s.fontSize>0&&s.fontSize<=512)||!s.stroke||!(s.stroke.width>=0&&s.stroke.width<=64))errors.push('invalid celebration text style');
      if(s) {
        Object.keys(s).forEach(function(k){if(['fontFamily','fontSize','fontWeight','fill','stroke','dropShadow'].indexOf(k)<0)errors.push('unknown text style '+k);});
        if(!/^#[0-9a-f]{6}$/i.test(s.fill)||['normal','bold','100','200','300','400','500','600','700','800','900'].indexOf(s.fontWeight)<0)errors.push('invalid text fill/weight');
        if(s.stroke) {
          if(!/^#[0-9a-f]{6}$/i.test(s.stroke.color)||['round','bevel','miter'].indexOf(s.stroke.join)<0||Object.keys(s.stroke).some(function(k){return ['color','width','join'].indexOf(k)<0;}))errors.push('invalid text stroke');
        }
        var shadow=s.dropShadow;
        if(shadow) {
          if(!/^#[0-9a-f]{6}$/i.test(shadow.color)||Object.keys(shadow).some(function(k){return ['color','alpha','blur','distance','angle'].indexOf(k)<0;}))errors.push('invalid text shadow');
          ['alpha','blur','distance','angle'].forEach(function(k){if(typeof shadow[k]!=='number'||!isFinite(shadow[k])||Math.abs(shadow[k])>1000)errors.push('invalid shadow '+k);});
          if(shadow.alpha<0||shadow.alpha>1||shadow.blur<0)errors.push('invalid shadow alpha/blur');
        }
      }
    }
    return errors;
  }
  function aura(c,random,reduced) {
    var C = new Group();
    var parts = new Group();
    var gTex = 'glow', dTex = 'dot', rTex = 'ring';
    function mk(tex, tint) {
      var sp = new Shape(tex);
      sp.blendMode = 'add'; sp.tint = tint; sp.visible = false;
      return sp;
    }
    var BODY = c.bodyY;
    var groundGlow = mk(gTex, color(c.colors.ground));
    var core = mk(gTex, color(c.colors.core));
    var flash = mk(gTex, color(c.colors.flash));
    var gatherRing = mk(rTex, color(c.colors.ring));
    var waveGround = mk(rTex, color(c.colors.ring));
    var waveGround2 = mk(rTex, color(c.colors.wave));
    var waveBody = mk(rTex, color(c.colors.wave));
    C.addChild(groundGlow, waveGround, waveGround2, core, gatherRing, waveBody, flash, parts);

    var GATHER = reduced ? c.gatherReduced : c.gatherCount, SPARKS = reduced ? c.sparkReduced : c.sparkCount;
    var gather = [], sparks = [], i;
    for (i = 0; i < GATHER; i++) {
      var sp = mk(dTex, i % 3 === 0 ? color(c.colors.ivory) : color(c.colors.gold));
      parts.addChild(sp);
      gather.push({ sp: sp, a0: random() * Math.PI * 2, r0: c.gatherRadius + random() * c.gatherRadiusSpread,
        spin: 1.6 + random() * 1.4, size: 0.32 + random() * 0.4,
        late: random() * 0.18 });
    }
    for (i = 0; i < SPARKS; i++) {
      var sk = mk(dTex, i % 3 === 0 ? color(c.colors.white) : (i % 3 === 1 ? color(c.colors.pale) : color(c.colors.amber)));
      parts.addChild(sk);
      var ang = Math.PI * 2 * (i / SPARKS) + (random() - 0.5) * 0.35;
      sparks.push({ sp: sk, ang: ang, v: c.sparkSpeed + random() * c.sparkSpeedSpread, size: 0.3 + random() * 0.45,
        life: 0.55 + random() * 0.35, lift: 20 + random() * 40 });
    }
    /* 氣旋粒子：每顆粒子沿錐面螺旋上升，帶 TRAIL 個落後的拖尾點（同一條解析軌跡在較早時刻的位置） */
    var VN = reduced ? c.vortexReduced : c.vortexCount, TRAIL = reduced ? c.trailReduced : c.trailCount, vort = [];
    var VCOL = [color(c.colors.gold), color(c.colors.pale), color(c.colors.ivory), color(c.colors.amber), color(c.colors.white)];
    var vbody = [mk(gTex, color(c.colors.core)), mk(gTex, color(c.colors.pale))];
    for (i = 0; i < vbody.length; i++) C.addChild(vbody[i]);
    for (i = 0; i < VN; i++) {
      var vp = { h0: random(), spd: 0.55 + random() * 0.7, th0: random() * Math.PI * 2,
        w: (random() - 0.5) * 3, rs: 0.55 + random() * 0.6, size: 0.35 + random() * 0.55, sp: [] };
      var tint = VCOL[i % VCOL.length];
      for (var ki = 0; ki < TRAIL; ki++) { var ts = mk(dTex, tint); parts.addChild(ts); vp.sp.push(ts); }
      vort.push(vp);
    }

    var t=0;
    var BASE_R=c.vortexRadius, TOP_Y=c.vortexTop, END_Y=c.vortexEnd;
    function ring(sp,radius,flatten,alpha){sp.visible=alpha>.01;if(!sp.visible)return;var s=radius/59.2;sp.scale.set(s,s*flatten);sp.alpha=alpha;}
    function update(time){
        t = time;
        /* ---- 聚光 ---- */
        var gk = lvClamp01(t / c.gatherSec);
        for (var gi = 0; gi < gather.length; gi++) {
          var g = gather[gi];
          var k = lvClamp01((t - g.late) / (c.gatherSec - g.late));
          if (k <= 0 || k >= 1) { g.sp.visible = false; continue; }
          var e = k * k;
          var r = g.r0 * (1 - e);
          var ang2 = g.a0 + k * g.spin;
          g.sp.visible = true;
          g.sp.x = Math.cos(ang2) * r;
          g.sp.y = BODY + Math.sin(ang2) * r * 0.62;
          g.sp.scale.set(g.size * (0.6 + 0.8 * k) * 1.3);
          g.sp.alpha = Math.min(1, k * 4) * (1 - Math.pow(k, 6));
        }
        gatherRing.y = BODY;
        ring(gatherRing, 130 - 120 * lvEaseOut(gk), 0.62, t < c.burstAt ? (0.25 + 0.7 * gk) : 0);
        /* 核心光球：聚光期間漸亮，爆散後淡掉 */
        var coreAlpha = t < c.burstAt ? (0.2 + 0.8 * gk) : Math.max(0, 1 - (t - c.burstAt) / 0.45);
        core.visible = coreAlpha > 0.01;
        core.y = BODY;
        core.scale.set(0.5 + 1.6 * gk + (t > c.burstAt ? (t - c.burstAt) * 2 : 0));
        core.alpha = coreAlpha;
        /* ---- 爆散 ---- */
        var bt = t - c.burstAt;
        if (bt > 0 && bt < 0.55) {
          var fk = bt / 0.55;
          flash.visible = true; flash.y = BODY;
          flash.scale.set(2.2 + 4.2 * lvEaseOut(fk));
          flash.alpha = (1 - fk) * (1 - fk) * 0.95;
        } else flash.visible = false;
        if (bt > 0) {
          var w1 = lvClamp01(bt / 0.7), w2 = lvClamp01((bt - 0.12) / 0.7), w3 = lvClamp01(bt / 0.5);
          waveGround.y = waveGround2.y = -2;
          waveBody.y = BODY;
          ring(waveGround, 12 + 150 * lvEaseOut(w1), 0.34, (1 - w1) * 0.9);
          ring(waveGround2, 12 + 118 * lvEaseOut(w2), 0.34, w2 > 0 ? (1 - w2) * 0.8 : 0);
          ring(waveBody, 10 + 100 * lvEaseOut(w3), 0.8, (1 - w3) * 0.75);
        }
        for (var si = 0; si < sparks.length; si++) {
          var s = sparks[si];
          var sk2 = lvClamp01(bt / s.life);
          if (bt <= 0 || sk2 >= 1) { s.sp.visible = false; continue; }
          var dist = s.v * (1 - Math.pow(1 - sk2, 2.2)) * s.life;
          s.sp.visible = true;
          s.sp.x = Math.cos(s.ang) * dist;
          s.sp.y = BODY + Math.sin(s.ang) * dist * 0.7 - s.lift * sk2;
          s.sp.scale.set(s.size * (1.4 - sk2));
          s.sp.alpha = 1 - sk2 * sk2;
        }
        /* ---- 氣旋（粒子） ---- */
        var cs = t - c.vortexAt;
        groundGlow.visible = false;
        vbody[0].visible = vbody[1].visible = false;
        for (var vi0 = 0; vi0 < vort.length; vi0++) for (var vk0 = 0; vk0 < TRAIL; vk0++) vort[vi0].sp[vk0].visible = false;
        if (cs > 0 && cs < 1.35) {
          var spanAt = function (tt) {
            var growK = lvEaseOut(lvClamp01(tt / c.gatherSec));
            var riseK = lvEaseInOut(lvClamp01((tt - 0.55) / 0.75));
            return { top: TOP_Y * growK, bottom: END_Y * riseK, riseK: riseK,
              master: lvClamp01(tt / 0.15) * (1 - lvClamp01((riseK - 0.72) / 0.28)),
              rb: BASE_R * (1 - 0.4 * riseK) };
          };
          var sp0 = spanAt(cs);
          groundGlow.visible = sp0.master > 0.01;
          groundGlow.y = sp0.bottom;
          groundGlow.scale.set(2.0 - 0.7 * sp0.riseK, 0.7 - 0.25 * sp0.riseK);
          groundGlow.alpha = 0.6 * sp0.master;
          /* 柔光氣團：讓氣旋有體積 */
          var midY = (sp0.top + sp0.bottom) / 2, spanH = Math.max(10, sp0.bottom - sp0.top);
          for (var bi = 0; bi < 2; bi++) {
            var bb = vbody[bi];
            bb.visible = sp0.master > 0.01;
            bb.x = 0; bb.y = midY;
            bb.scale.set((sp0.rb * (bi ? 0.9 : 1.7)) / 32, spanH / 64 * (bi ? 1.1 : 1.3));
            bb.alpha = sp0.master * (bi ? 0.28 : 0.22);
          }
          for (var vi = 0; vi < vort.length; vi++) {
            var v = vort[vi];
            var rawHead = v.h0 + v.spd * cs;
            for (var vk = 0; vk < TRAIL; vk++) {
              var tt = cs - vk * 0.02;
              if (tt <= 0) continue;
              var raw = v.h0 + v.spd * tt;
              if (Math.floor(raw) !== Math.floor(rawHead)) continue;   // 拖尾不跨越循環邊界
              var hh = raw - Math.floor(raw);
              var sp = spanAt(tt);
              var rad = (sp.rb * Math.pow(1 - hh, 0.75) + 3) * v.rs;
              var th = v.th0 + (7.5 + v.w) * tt + hh * 3.2;
              var x = Math.cos(th) * rad;
              var y = sp.bottom + (sp.top - sp.bottom) * hh + Math.sin(th) * rad * 0.34;
              var depth = (Math.sin(th) + 1) * 0.5;
              var env = Math.min(1, hh / 0.08) * (1 - lvClamp01((hh - 0.8) / 0.2));
              var q = v.sp[vk];
              q.visible = true;
              q.x = x; q.y = y;
              q.scale.set(v.size * (1 - 0.1 * vk) * (1 - hh * 0.45) * (0.8 + 0.5 * depth));
              q.alpha = sp.master * env * (0.3 + 0.7 * depth) * (1 - vk / TRAIL);
            }
          }
        }
    }
    return function(time){update(time);return C;};
  }
  function text(c,life) {
    var C=new Group(),glow=new Shape('glow'),label=new Shape('text');
    glow.tint=color(c.glowColor);glow.fitText={min:c.glowMinX,factor:c.glowWidthFactor,y:c.glowScaleY};
    label.blendMode='normal';label.textKey=c.textKey;label.style=c.style;C.addChild(glow,label);
    return function(k){
      var rise=lvEaseOut(lvClamp01(k/c.riseSec));C.y=c.startY-c.rise*rise;
      var sc=k<.2?.3+.98*lvEaseOut(k/.2):k<.38?1.28-.28*lvEaseInOut((k-.2)/.18):1+.07*((k-.38)/life);
      C.scale.set(sc);var fade=1-lvClamp01((k-(life-.45))/.45);C.alpha=Math.min(1,k/.08)*fade;
      glow.alpha=.55+.25*Math.sin(k*9);return C;
    };
  }
  function prepare(c,random,reduced,duration){var errors=validate(c);if(errors.length)throw new Error(errors.join('; '));return c.part==='aura'?aura(c,random,reduced):text(c,duration);}
  return {validate:validate,prepare:prepare};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=VFXCelebration;
