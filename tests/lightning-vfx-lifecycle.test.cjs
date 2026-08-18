/* 落雷／雷殞的延遲特效不能在目標死亡後繼續播放。
   這裡驗證兩條渲染路徑都有「落雷專用」取消守門，且不把一般普攻的 dying
   致死一擊規則一併改掉。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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
