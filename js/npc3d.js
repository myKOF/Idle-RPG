/* NPC 3D: table-configured GLB bodies use the shared Three/Pixi adapter.
   Simulation, hit resolution and attack rates remain owned by the worker. */
(function (global) {
  'use strict';
  var VERSION = '20261108-skeleton-king';
  function definition(data) {
    var def = data && data.model3d;
    return def && def.file && def.clips && def.clips.walk && def.clips.die ? def : null;
  }
  async function create(def) {
    var ctrl = await global.Hero3D.create({
      model: def.file + (def.file.indexOf('?') < 0 ? '?' : '&') + 'v=' + VERSION,
      size: 512, span: 6.2, cape: false, pbr: true, outline: false, registerInstance: false,
      locomotionClip: def.clips.walk
    });
    try {
      var clips = def.clips;
      ['idle', 'walk', 'attack1', 'attack2', 'attack3', 'die'].forEach(function (key) {
        if (ctrl.clips.indexOf(clips[key]) < 0) throw new Error('Missing NPC 3D animation: ' + key);
      });
      var body = global.Hero3D.makeBody(ctrl);
      body.npc3d = { controller: ctrl, attackIndex: 0, motionSpeed: 0, clips: {
        idle: { clip: clips.idle, loop: true, still: true },
        walk: { clip: clips.walk, loop: true },
        attack1: { clip: clips.attack1, loop: false },
        attack2: { clip: clips.attack2, loop: false },
        attack3: { clip: clips.attack3, loop: false },
        die: { clip: clips.die, loop: false, hold: true }
      } };
      return body;
    } catch (error) { ctrl.dispose(); throw error; }
  }
  function play(body, semantic, attacksPerSecond) {
    var state = body.npc3d;
    var key = semantic === 'attack' ? 'attack' + (state.attackIndex++ % 3 + 1) : semantic;
    var cfg = state.clips[key];
    if (!cfg) return null;
    body.hero3dPlay(cfg, .5);
    state.semantic = semantic;
    if (semantic === 'walk') applyWalkSpeed(body);
    // Fit the full strike to the existing attack interval; preview slow motion
    // is never applied in combat. Death retains its original duration.
    if (semantic === 'attack') {
      var rate = Number(attacksPerSecond);
      var interval = rate > 0 ? 1 / rate : 1.5;
      body.animationSpeed = .5 * Math.max(1, state.controller.duration(cfg.clip) / (interval * .85));
    }
    return cfg;
  }
  function applyWalkSpeed(body) {
    var state = body.npc3d, ctrl = state.controller;
    var nativeSpeed = ctrl.locomotionMetersPerSecond * ctrl.pxPerMeter * Math.abs(body.scale && body.scale.x || 0);
    if (!(nativeSpeed > 0)) return;
    body.animationSpeed = .5 * state.motionSpeed / nativeSpeed;
  }
  function move(body, distance, dt) {
    var state = body && body.npc3d;
    if (!state || state.disposed || !(dt > 0)) return;
    var speed = Math.max(0, Number(distance) || 0) / dt;
    state.motionSpeed = speed;
    // 出招／死亡的時間保持；只有走路按世界位移及模型顯示比例調速。
    if (state.semantic === 'walk') applyWalkSpeed(body);
  }
  function scale(body, visualScale) {
    return 64 * visualScale / 2 / body.npc3d.controller.pxPerMeter;
  }
  function dispose(body) {
    if (!body || !body.npc3d || body.npc3d.disposed) return;
    body.npc3d.disposed = true;
    body.npc3d.controller.dispose();
    if (body.texture) body.texture.destroy(true);
    if (body.hero3dOutlineTex) body.hero3dOutlineTex.destroy(true);
  }
  global.Npc3D = { definition: definition, create: create, play: play, move: move, scale: scale, dispose: dispose };
})(typeof window !== 'undefined' ? window : this);
