'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { extractFunction } = require('./helpers/battle-scene.cjs');
const settle = () => new Promise(resolve => setImmediate(resolve));

test('序章停止既有音效，結束後連續升級只播放一聲', async () => {
  const sources = [], timers = [], renderedLevels = [];
  let resolveFlight;
  const node = () => ({ connect() {}, disconnect() { this.disconnected = true; } });
  const parameter = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {} });
  class AudioContext {
    constructor() { this.state = 'running'; this.currentTime = 1; this.destination = {}; }
    decodeAudioData(bytes, resolve) { resolve({ duration: 1 }); }
    createBufferSource() {
      const source = { ...node(), start() {}, stop() { this.stopped = true; this.onended?.(); } };
      sources.push(source);
      return source;
    }
    createGain() { return { ...node(), gain: parameter() }; }
    createDynamicsCompressor() {
      return { ...node(), threshold: {}, knee: {}, ratio: {}, attack: {}, release: {} };
    }
  }
  const context = vm.createContext({
    window: { AudioContext, OfflineAudioContext: function () {} },
    document: { hidden: false, addEventListener() {} },
    fetch: async () => ({ arrayBuffer: async () => new ArrayBuffer(0) }),
    setTimeout: fn => timers.push(fn), setInterval: () => 1, clearInterval() {},
    BattleRenderer: { onLevelUp: event => renderedLevels.push(event.level) },
    SfxSynth: {
      def: id => ({ kind: id }),
      render: id => id === 'flight' ? new Promise(resolve => { resolveFlight = resolve; }) : Promise.resolve({ duration: 1 })
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js/sfx.js'), 'utf8'), context);
  const ui = fs.readFileSync(path.join(__dirname, '..', 'js/ui.js'), 'utf8');
  vm.runInContext(extractFunction(ui, 'handleWorkerUiEvents'), context);
  const levelUp = (...levels) => context.handleWorkerUiEvents(levels.map(level => ({ kind: 'levelup', level })));
  const audio = context.Sfx;
  audio.preload(); await settle();
  levelUp(2);
  assert.ok(audio.playCast('oneshot', 2));
  assert.ok(audio.skillRole({ sfx: { ground: 'loop' } }, 'ground'));
  await settle();
  assert.equal(sources.length, 3);
  audio.playGroup('basicHit', 100);
  audio.playCast('loop', 1);
  audio.playSynth('flight');
  audio.setIntroActive(true);
  assert.ok(sources.every(source => source.stopped && source.disconnected));
  levelUp(3);
  assert.equal(sources.length, 3);
  assert.equal(audio.playGroup('basicHit', 100), false);
  assert.equal(audio.playCast('oneshot', 0), false);
  assert.equal(audio.skillRole({ sfx: { ground: 'loop' } }, 'ground'), false);
  audio.setIntroActive(false);
  timers.splice(0).forEach(fn => fn());
  resolveFlight({ duration: 1 }); await settle();
  assert.equal(sources.length, 3);
  renderedLevels.length = 0;
  levelUp(2, 3, 4);
  levelUp(5);
  assert.equal(sources.length, 4);
  assert.deepEqual(renderedLevels, [2, 3, 4, 5]);
  sources[3].onended();
  assert.equal(sources.length, 4, '重疊的升級事件不排隊補播');
  levelUp(6);
  assert.equal(sources.length, 5, '上一聲結束後可再次播放');
});
