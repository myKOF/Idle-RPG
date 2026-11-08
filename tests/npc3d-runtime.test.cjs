'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js/npc3d.js'), 'utf8');
const def = { file: 'images/models/npc3d/boss1.glb', clips: {
  idle: 'Walk', walk: 'Walk', attack1: 'Attack1', attack2: 'Attack2', attack3: 'Attack3', die: 'Die'
} };
function fixture(clips = ['Walk', 'Attack1', 'Attack2', 'Attack3', 'Die']) {
  const calls = [], destroyed = { ctrl: 0, texture: 0, outline: 0 };
  const ctrl = { clips, pxPerMeter: 100, duration: key => key === 'Attack1' ? 6 : 3,
    dispose: () => destroyed.ctrl++ };
  const body = { texture: {destroy: () => destroyed.texture++},
    hero3dOutlineTex: {destroy: () => destroyed.outline++},
    hero3dPlay: cfg => { body.animationSpeed = .5; calls.push(cfg); } };
  let options;
  const context = { Hero3D: {create: async opts => { options = opts; return ctrl; }, makeBody: () => body} };
  vm.runInNewContext(source, context);
  return { api: context.Npc3D, body, ctrl, calls, destroyed, get options() { return options; } };
}
test('only explicitly configured NPCs request a model and share the approved material renderer', async () => {
  const f = fixture();
  assert.equal(f.api.definition({}), null);
  assert.equal(f.api.definition({model3d:def}), def);
  const body = await f.api.create(def);
  assert.equal(body, f.body);
  assert.match(f.options.model, /boss1\.glb\?v=/);
  assert.equal(f.options.cape, false, 'baked NPC cloth must not use the hero cloth solver');
  assert.equal(f.options.pbr, true);
  assert.equal(f.options.registerInstance, false, 'NPC cannot replace the player debug controller');
});
test('idle holds Walk first pose, movement resumes Walk, all three attacks cycle, death holds', async () => {
  const f = fixture(); await f.api.create(def);
  assert.equal(f.api.play(f.body,'idle').still, true);
  assert.equal(f.api.play(f.body,'walk').still, undefined);
  for (const clip of ['Attack1','Attack2','Attack3','Attack1']) {
    assert.equal(f.api.play(f.body,'attack',2).clip, clip);
    assert.ok(f.body.animationSpeed > .5);
  }
  const death = f.api.play(f.body,'die');
  assert.equal(death.clip,'Die'); assert.equal(death.hold,true);
  assert.equal(f.body.animationSpeed,.5,'death uses its native duration');
  assert.equal(f.api.scale(f.body,5),1.6);
});
test('missing clips release the controller and repeated disposal releases resources once', async () => {
  const bad = fixture(['Walk']);
  await assert.rejects(bad.api.create(def),/Missing NPC 3D animation/);
  assert.equal(bad.destroyed.ctrl,1);
  const f=fixture(); await f.api.create(def);
  f.api.dispose(f.body);f.api.dispose(f.body);
  assert.deepEqual(f.destroyed,{ctrl:1,texture:1,outline:1});
});

test('walk-only models hold a standing pose for missing attacks and fade from a held death pose', async () => {
  const f=fixture(['Walk']);
  await f.api.create({file:def.file,clips:{walk:'Walk'}});
  const attack=f.api.play(f.body,'attack',1);
  assert.equal(attack.clip,'Walk');assert.equal(attack.loop,false);assert.equal(attack.end,1/60);
  const cast=f.api.play(f.body,'cast',1,2);
  assert.equal(cast.end,1/60);
  const death=f.api.play(f.body,'die');assert.equal(death.hold,true);assert.equal(death.end,1/60);
});
test('a late asynchronous model cannot replace a removed or reused enemy', async () => {
  const battle=fs.readFileSync(path.join(root,'js/battle-renderer.js'),'utf8');
  const snippet=battle.slice(battle.indexOf('  function requestNpc3d(e)'),battle.indexOf('  function adoptNpcSprite(e)'));
  let resolve,disposed=0,destroyed=0;
  const e={id:'tb-float',data:{model3d:def},state:'idle'};
  const S={entities:{'tb-float':e}};
  const context={S,Npc3D:{definition:()=>def,create:()=>new Promise(r=>resolve=r),dispose:()=>disposed++},console};
  vm.runInNewContext(snippet,context);
  context.requestNpc3d(e);
  S.entities[e.id]={id:e.id};
  resolve({destroy:()=>destroyed++});
  await new Promise(r=>setImmediate(r));
  assert.equal(disposed,1);assert.equal(destroyed,1);
  assert.equal(e.npc3d,undefined);
});
