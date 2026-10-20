/* 落雷／雷殞的延遲特效不能在目標死亡後繼續播放。
   這裡驗證兩條渲染路徑都有「落雷專用」取消守門，且不把一般普攻的 dying
   致死一擊規則一併改掉。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const VFXCore = require('../js/vfx-core.js');
const VFXRuntime = require('../js/vfx-runtime.js');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert.ok(start >= 0, `找不到函式 ${name}`);
  let depth = 0;
  let opened = false;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') { depth++; opened = true; }
    else if (source[i] === '}') {
      depth--;
      if (opened && depth === 0) return source.slice(start, i + 1);
    }
  }
  assert.fail(`函式 ${name} 未完整結束`);
}

test('Canvas 落雷與雷殞在目標死亡後取消延遲中的特效', () => {
  const renderer = read('js/battle-renderer.js');

  assert.match(renderer, /function isTargetBoundThunderVfx\(spec\)/);
  assert.match(renderer, /spec\.variant === 'thunder-strike' \|\| spec\.variant === 'thunder-fall'/);
  assert.match(renderer, /function vfxTargetLiveForSpec\(spec, id\)/);
  assert.match(renderer, /ent\.state !== 'dying' && ent\.state !== 'gone'/);
  assert.match(renderer, /if \(spec && \(spec\.variant === 'thunder-strike' \|\| spec\.variant === 'thunder-fall'\)\) \{\s*return !vfxTargetsLive\(spec\);/);
  assert.match(renderer, /typeof targetPtOrId === 'string' && !vfxTargetLiveForSpec\(spec, targetPtOrId\)/);
  assert.match(renderer, /spawnTargetTelegraph\(spec, to\.x, to\.y, radius, delaySec, dur, targetId\)/);
  assert.match(renderer, /typeof targetId === 'string' && !vfxTargetLiveForSpec\(spec, targetId\)/);
  assert.match(renderer, /function spawnImpact\(x, y, spec, strong, targetGuard\)/);
});

test('Canvas 落雷沒有目標座標時直接取消，不退回玩家前方地面', () => {
  const renderer = read('js/battle-renderer.js');
  const context = {
    S: { entities: {}, lastPos: {}, player: { dead: false } }
  };
  vm.runInNewContext([
    extractFunction(renderer, 'isTargetBoundThunderVfx'),
    extractFunction(renderer, 'vfxTargetLiveForSpec'),
    extractFunction(renderer, 'vfxTargetsLive')
  ].join('\n'), context);

  assert.equal(context.vfxTargetsLive({ variant: 'thunder-strike', targets: [] }), false,
    '空目標的落雷事件不得繼續進入 Canvas 分派');
  assert.equal(context.vfxTargetLiveForSpec({ variant: 'thunder-fall' }, 'missing-target'), false,
    '沒有 Canvas 實體的目標不得用預設座標落雷');

  context.S.entities['live-target'] = { state: 'alive' };
  assert.equal(context.vfxTargetLiveForSpec({ variant: 'thunder-strike' }, 'live-target'), true,
    '仍存在的有效目標照常允許落雷');
  const tribulation = { variant: 'heaven-tribulation-strike', area: { x: 10, y: 20, r: 80 }, targets: ['removed-target'] };
  assert.equal(context.vfxTargetsLive(tribulation), true, '天劫已固定落點，目標死亡後仍須顯示第二道雷');
  assert.equal(context.vfxTargetLiveForSpec(tribulation, 'removed-target'), true);
  assert.equal(context.vfxTargetsLive({ cat: 'basic', targets: ['missing-target'] }), true,
    '一般普攻仍保留尚未建立目標的相容行為');

  assert.doesNotMatch(renderer, /if \(!targets\.length\) spawnThunderFall\(spec, null/,
    '雷殞不可在空目標時生成無錨點特效');
});

test('DOM 落雷元件共用目標守門，死亡後移除雷柱、落點與爆點', () => {
  const vfx = read('js/vfx.js');

  assert.match(vfx, /function vfxTargetIsLive\(targetId\)/);
  assert.match(vfx, /card\.classList\.contains\('is-dead'\)/);
  assert.match(vfx, /function vfxTargetGuard\(targetId\)/);
  assert.match(vfx, /function vfxTrack\(node, ms, targetGuard\)/);
  assert.match(vfx, /requestAnimationFrame\(checkTarget\)/);
  assert.match(vfx, /function vfxSmite\(spec, layer, pt, targetId, delayMs, travelMs\)/);
  assert.match(vfx, /var targetGuard = vfxTargetGuard\(targetId\)/);
  assert.match(vfx, /vfxLightningGroundImpact\(spec, layer, pt, delayMs \+ 30, false, targetGuard\)/);
  assert.match(vfx, /delayMs \+ 40, targetGuard\)/);
});


test('Canvas 雷鏈飛行不被死亡取消，但死亡目標不播命中特效', () => {
 const renderer=read('js/battle-renderer.js');
 const c={S:{ready:true,player:{dead:false},entities:{
  from:{state:'dying',data:{hp:0}},to:{state:'idle',data:{hp:10}}
 }},documentHidden:()=>false};
 vm.runInNewContext([extractFunction(renderer,'chainTargetAlive'),extractFunction(renderer,'fxGate')].join('\n'),c);
 const spec={fxKind:'chain',variant:'lightning-chain',targets:['from','to']};
 assert.equal(c.fxGate(spec),false);
 c.S.entities.to.data.hp=0;assert.equal(c.fxGate(spec),false);
 c.S.entities.to.data.hp=10;c.S.entities.to.state='dying';assert.equal(c.fxGate(spec),false);
 delete c.S.entities.to;assert.equal(c.fxGate(spec),false);
 assert.equal(c.fxGate({...spec,targets:[]}),true);
 assert.equal(c.fxGate({fxKind:'impact',variant:'lightning-chain-hit',targets:['from']}),true);
});

test('CHAIN-END 清場訊號不經顯示緩衝或死亡守門，Worker保留鏈編號',()=>{
 const events=[];const c={S:{ready:true,vfxrt:{tryPlay:s=>events.push(s)}}};
 const rsrc=read('js/battle-renderer.js');
 vm.runInNewContext(['canvasActorId','normalizeTowerVfxIds','onVfx'].map(n=>extractFunction(rsrc,n)).join(';'),c);
 c.onVfx({variant:'lightning-chain-end',targets:[],area:{chainId:'one'},vfx:{}});
 assert.equal(events.length,1);
 const wire=[];const w={_diag(){},SHIM_DIAG:{ui:0},shimPushEvent:(k,e)=>wire.push(e)};
 vm.runInNewContext(extractFunction(read('js/worker/shim.js'),'playCombatVfx'),w);
 w.playCombatVfx(events[0]);assert.equal(wire[0].area.chainId,'one');assert.equal(wire[0].variant,'lightning-chain-end');
 w.playCombatVfx({variant:'lightning-chain',area:{chainId:'one',homingSpeed:700},lineLength:180});
 assert.equal(wire[1].area.homingSpeed,700);assert.equal(wire[1].lineLength,180);
 w.playCombatVfx({fxKind:'rain',variant:'heaven-tribulation-strike',targets:['gone'],area:{x:10,y:20,r:80},hit:false,vfx:{attack:'bolt-sky-purple',hit:'hit-thunder-purple'}});
 assert.equal(wire[2].variant,'heaven-tribulation-strike');
 assert.equal(wire[2].area.r,80);assert.equal(wire[2].hit,false);
 assert.equal(wire[2].vfx.attack,'bolt-sky-purple');
});

// 使用正式 onVfx、Runtime、Core 與 Preset，只替換時鐘及繪圖節點以觀察播放。
function thunderRenderer() {
  const renderer = read('js/battle-renderer.js');
  const nodes = [], played = [], pending = [];
  let now = 0;
  const backend = {
    createNode(spec) { const node = { spec, frames: [] }; nodes.push(node); return node; },
    updateNode(node, transform) { node.frames.push({ ...transform }); },
    destroyNode() {}, destroy() {}
  };
  const point = { x: 120, y: 200 };
  const c = {
    S: { ready: true, entities: { target: { state: 'idle' } }, player: { dead: false } },
    POS_BUFFER_MS: Number(/var POS_BUFFER_MS = (\d+)/.exec(renderer)[1]),
    endedWaterTornadoes: {}, normalizeTowerVfxIds() {}, documentHidden: () => false,
    laterFrame(fn, ms) { pending.push({ fn, at: now + ms }); }
  };
  const adapter = VFXRuntime.create({
    core: VFXCore, resolver: { has: () => true, resolve: id => '/' + id },
    fxBackend: backend, billboardBackend: backend,
    ctx: { posOf: () => point, footOf: () => point, playerPos: () => point,
      chainPoint: id => c.S.entities[id] ? point : null }
  });
  adapter.registerPresets(['bolt-thunderstrike-bluewhite', 'hit-thunder-blue']
    .map(id => JSON.parse(read('vfx/presets/' + id + '.json'))));
  c.S.vfxrt = { tryPlay(spec) { played.push({ at: now, variant: spec.variant }); return adapter.tryPlay(spec); } };
  vm.createContext(c);
  for (const name of ['isTargetBoundThunderVfx', 'vfxTargetLiveForSpec', 'vfxTargetsLive', 'fxGate', 'onVfx']) {
    vm.runInContext(extractFunction(renderer, name), c);
  }
  function advance(ms) {
    const end = now + ms;
    while (now < end - 1e-6) {
      const nextDue = Math.min(...pending.map(item => item.at));
      const next = Math.min(end, now + 10, nextDue);
      adapter.update((next - now) / 1000);
      now = next;
      for (let i = 0; i < pending.length;) {
        if (pending[i].at > now) { i++; continue; }
        pending.splice(i, 1)[0].fn();
      }
    }
  }
  return { c, adapter, nodes, played, pending, advance,
    send: spec => c.onVfx({ ...spec, targets: ['target'] }) };
}

const THUNDER_BODY = { fxKind: 'rain', variant: 'thunder-strike', travelMs: [129],
  vfx: { attack: 'bolt-thunderstrike-bluewhite', hit: 'hit-thunder-blue' } };

test('落雷本體在致死結算前可見，獨立命中依權威事件播放且不加位置緩衝', () => {
  const r = thunderRenderer();
  try {
    r.send(THUNDER_BODY);
    assert.deepEqual(r.played, [{ at: 0, variant: 'thunder-strike' }]);
    r.advance(80);
    assert.ok(r.nodes.some(n => n.spec.assetUrl?.endsWith('spark_05.png') &&
      n.frames.some(t => t.alpha > 0 && t.scaleY > 0)), '正式素材的雷柱在落地前已有可見圖層');
    assert.equal(r.adapter.stats().played, 1, '起飛只播本體，不提前播放藍色命中');
    r.advance(49);
    r.c.S.entities.target.state = 'dying';
    r.send({ fxKind: 'impact', variant: 'thunder-impact', preserveDeadTargets: true, vfx: THUNDER_BODY.vfx });
    assert.deepEqual(r.played.map(p => p.at), [0, 129]);
    assert.equal(r.adapter.stats().played, 2);
    r.advance(1500);
    assert.equal(r.adapter.stats().fx.activeEffects + r.adapter.stats().billboard.activeEffects, 0);
    assert.equal(r.pending.length, 0, '沒有死亡後補播雷柱的延遲回呼');
  } finally { r.adapter.destroy(); }
});

test('落雷保留明確施放延遲與死亡／缺失目標取消，其他技能仍使用位置緩衝', () => {
  for (const state of ['idle', 'dying', 'missing']) {
    const r = thunderRenderer();
    try {
      r.send({ ...THUNDER_BODY, delayMs: 50 });
      r.advance(49);
      assert.equal(r.played.length, 0);
      if (state === 'missing') delete r.c.S.entities.target;
      else r.c.S.entities.target.state = state;
      r.advance(1);
      assert.equal(r.played.length, state === 'idle' ? 1 : 0, state);
      r.advance(500);
      assert.equal(r.pending.length, 0);
    } finally { r.adapter.destroy(); }
  }
  const r = thunderRenderer();
  try {
    r.c.S.entities.target.state = 'dying';
    r.send(THUNDER_BODY);
    assert.equal(r.played.length, 0, '收到時已死亡不啟動本體');
    r.c.S.entities.target.state = 'idle';
    r.send({ fxKind: 'impact', variant: 'ordinary-impact', vfx: { hit: 'hit-thunder-blue' } });
    r.advance(r.c.POS_BUFFER_MS - 1);
    assert.equal(r.played.length, 0);
    r.advance(1);
    assert.equal(r.played.length, 1, '其他技能保留原本的顯示緩衝');
  } finally { r.adapter.destroy(); }
});

test('Worker 未指定倍率的零值仍顯示原尺寸落雷，正倍率繼續按指定大小播放', () => {
  const widths = [];
  for (const multiplier of [undefined, .5, 2]) {
    const wire = [];
    const c = { _diag() {}, SHIM_DIAG: { ui: 0 }, shimPushEvent: (kind, spec) => wire.push(spec) };
    vm.runInNewContext(extractFunction(read('js/worker/shim.js'), 'playCombatVfx'), c);
    c.playCombatVfx({ ...THUNDER_BODY, sizeMult: multiplier });
    assert.equal(wire[0].sizeMult, multiplier || 0, '使用正式 Worker 的未指定倍率編碼');
    const r = thunderRenderer();
    try {
      r.send(wire[0]);
      r.advance(80);
      const core = r.nodes.find(n => n.spec.assetUrl?.endsWith('spark_05.png'));
      const visible = core?.frames.filter(t => t.visible !== false && t.alpha > 0 && t.scaleY > 0);
      assert.ok(visible?.length, 'Worker 的 sizeMult=' + wire[0].sizeMult + ' 必須有可見雷柱');
      widths.push(visible.at(-1).scaleX);
    } finally { r.adapter.destroy(); }
  }
  assert.ok(Math.abs(widths[1] / widths[0] - .5) < 1e-6);
  assert.ok(Math.abs(widths[2] / widths[0] - 2) < 1e-6);
});

test('永恒雷獄舊重施與新接續的真實Worker事件皆有可見落雷且傷害等落地', () => {
  const events = [], hits = [], repeats = [];
  const c = { console, Math: Object.create(Math), setTimeout() {}, clearTimeout() {},
    document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } },
    UI: { dirty: {} }, blog() {}, floatText() {} };
  c.window = c;
  vm.createContext(c);
  for (const file of ['util', 'data', 'status', 'formula', 'battlefield', 'combat', 'skills', 'skills2']) {
    vm.runInContext(read('js/' + file + '.js'), c, { filename: file });
  }
  c.G = { player: { gold: 0, skills2: { levels: { thunderstrike: [10, 10, 10, 10, 10, 10, 10] },
    ult: { thunderstrike: { pick: c.sgUltIndexOfId('thunderstrike', 'eternalThunderPrison'), lv: 1 } } },
    loadout: ['sg:thunderstrike'] }, stage: { current: 1 } };
  c.SKILLS2.thunderstrike.ult[2].fx = { sec: 3, secPer: 0.3, gap: 1, gapPer: -0.05 };
  c.getStats = () => ({ atk: 1000, matk: 500, hp: 1000, mp: 1000000, level: 10, cdr: 0,
    passives: {}, legendaryEffects: {}, legendaryEffectMults: {}, elemDmgUp: {} });
  c._diag = () => {};
  c.SHIM_DIAG = { ui: 0 };
  c.shimPushEvent = (kind, spec) => events.push({ at: c.GT, spec });
  vm.runInContext(extractFunction(read('js/worker/shim.js'), 'playCombatVfx'), c);
  c.enemyEventFloatTarget = () => 'target';
  c.playerEventFloatTarget = sel => sel;
  c.trackDps = c.recordRunDamage = c.floatEnemyEvent = c.floatPlayerEvent = () => {};
  c.resolveHit = (attacker, target) => {
    hits.push(c.GT);
    target.hp -= 100;
    return { dmg: 100, crit: false, miss: false, killed: false };
  };
  c.applySkillFinalDamageMultiplier = () => {};
  c.Math.random = () => .999;
  c.GT = 0;
  const p = { hp: 1000, mp: 1000000, skillCds: {}, effects: {}, buffs: {}, dots: [] };
  const target = { hp: 1e9, maxHp: 1e9, name: 'target', level: 1, pos: { x: 20, y: 0 },
    effects: {}, buffs: {}, dots: [], resist: {}, ctrlRes: 0 };
  const ctx = { pEnt: p, getEnemies: () => [target], floatSel: 'mv-float', onDeaths() {}, onDamage() {} };
  const cast = c.castSkill2;
  c.castSkill2 = (...args) => {
    const before = events.length;
    const result = cast(...args);
    if (args[4]?.repeat) repeats.push({ at: c.GT, result, events: events.slice(before) });
    return result;
  };
  assert.ok(c.castSkill2(p, [target], 'thunderstrike', 'mv-float'));
  const paid = p.mp, cd = p.skillCds['sg:thunderstrike'];
  assert.equal(paid, 990000, '表定首次消耗不變');
  assert.equal(hits.length, 0);
  for (let i = 1; i <= 350; i++) {
    c.GT = i / 100;
    c.tickSkill2(.01, ctx);
  }
  assert.equal(hits[0], .13, '原權威落地結算時點不變');
  assert.deepEqual(repeats.map(r => r.at), [.95, 1.9, 2.85]);
  assert.equal(p.mp, paid, '重施免費');
  assert.equal(p.skillCds['sg:thunderstrike'], cd, '重施不重設冷卻');
  assert.equal(c.SKILL2_RT.ultRepeat.thunderstrike, undefined, '表定時間結束後停止重施');
  for (const event of [events[0], ...repeats.map(r => r.events.find(e => e.spec.variant === 'thunder-strike'))]) {
    assert.ok(event);
    assert.equal(event.spec.vfx.attack, 'bolt-thunderstrike-bluewhite');
    assert.equal(event.spec.travelMs[0], 129);
    const r = thunderRenderer();
    try {
      r.send(event.spec);
      assert.equal(r.adapter.stats().played, 1, '實際初次與重施事件都立即接入正式雷柱');
      assert.equal(r.pending.length, 0);
      assert.equal(event.spec.sizeMult, 0);
      r.advance(80);
      assert.ok(r.nodes.some(n => n.spec.assetUrl?.endsWith('spark_05.png') &&
        n.frames.some(t => t.visible !== false && t.alpha > 0 && t.scaleY > 0)), '正式 Worker 初次／重施雷柱可見');
    } finally { r.adapter.destroy(); }
  }
  assert.ok(events.some(e => e.spec.variant === 'thunder-impact' && e.spec.vfx.hit === 'hit-thunder-blue'));
  // 新接續配置穿過同一個正式 Worker shim、Renderer、Runtime 與 Core。
  c.resetSkill2RT();
  c.GT = 0; events.length = 0; hits.length = 0; repeats.length = 0;
  c.SKILLS2.thunderstrike.ult[2].fx = { count: 2, countPer: 0.2, m: 30 };
  c.SKILLS2.thunderstrike.tiers[5].fx.chance = 0;
  c.SKILLS2.thunderstrike.tiers[5].fx.chancePer = 0;
  const pool = [target, ...['second', 'third'].map((name, i) => ({ ...target, name,
    pos: { x: 220 + i * 220, y: 0 }, buffs: {}, effects: {}, dots: [] }))];
  const chainTargets = [];
  c.enemyEventFloatTarget = ent => ent.name;
  c.resolveHit = (attacker, victim) => {
    hits.push(c.GT); chainTargets.push(victim.name);
    return { dmg: 100, crit: false, miss: false, killed: false };
  };
  const out = { dmg: 0, killed: false };
  c.sgQueueThunderBolt(p, c.getStats(), c.SKILLS2.thunderstrike,
    [10, 10, 10, 10, 10, 10, 10], 1000, target, pool, 'mv-float', out, 0, 0);
  c.sgArmUltRepeat('thunderstrike');
  assert.equal(c.SKILL2_RT.ultRepeat.thunderstrike, undefined);
  for (let i = 1; i <= 100; i++) {
    c.GT = i / 100;
    c.sgTickMeteors({ pEnt: p, getEnemies: () => pool, onDeaths() {}, onDamage() {} });
  }
  assert.deepEqual(chainTargets, ['target', 'second', 'third']);
  assert.deepEqual(hits, [.13, .26, .39]);
  assert.equal(out._pendingProjectiles, 0);
  assert.equal(p.mp, paid); assert.equal(p.skillCds['sg:thunderstrike'], cd);
  const bolts = events.filter(e => e.spec.variant === 'thunder-strike');
  assert.equal(bolts.length, 3);
  for (const event of bolts) {
    const r = thunderRenderer();
    try {
      for (const victim of pool) r.c.S.entities[victim.name] = { state: 'idle' };
      assert.equal(event.spec.travelMs[0], 129);
      assert.equal(event.spec.vfx.attack, 'bolt-thunderstrike-bluewhite');
      r.send(event.spec); r.advance(80);
      assert.equal(r.adapter.stats().played, 1);
      assert.ok(r.nodes.some(n => n.spec.assetUrl?.endsWith('spark_05.png') &&
        n.frames.some(t => t.visible !== false && t.alpha > 0 && t.scaleY > 0)), '接續落雷的正式素材可見');
    } finally { r.adapter.destroy(); }
  }
});
