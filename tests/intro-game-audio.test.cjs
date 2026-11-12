'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const settle = () => new Promise(resolve => setImmediate(resolve));

test('序章停止戰鬥檔案、單次與循環音效，收起後不補播已排程或正在解碼的事件', async () => {
  const sources = [], timers = [];
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
    SfxSynth: {
      def: id => ({ kind: id }),
      render: id => id === 'flight' ? new Promise(resolve => { resolveFlight = resolve; }) : Promise.resolve({ duration: 1 })
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js/sfx.js'), 'utf8'), context);
  const audio = context.Sfx;
  audio.preload(); await settle();
  assert.ok(audio.play('levelUp'));
  assert.ok(audio.playCast('oneshot', 2));
  assert.ok(audio.skillRole({ sfx: { ground: 'loop' } }, 'ground'));
  await settle();
  assert.equal(sources.length, 3);
  audio.playGroup('basicHit', 100);
  audio.playCast('loop', 1);
  audio.playSynth('flight');
  audio.setIntroActive(true);
  assert.ok(sources.every(source => source.stopped && source.disconnected));
  assert.equal(audio.play('levelUp'), false);
  assert.equal(audio.playGroup('basicHit', 100), false);
  assert.equal(audio.playCast('oneshot', 0), false);
  assert.equal(audio.skillRole({ sfx: { ground: 'loop' } }, 'ground'), false);
  audio.setIntroActive(false);
  timers.splice(0).forEach(fn => fn());
  resolveFlight({ duration: 1 }); await settle();
  assert.equal(sources.length, 3);
  assert.ok(audio.play('levelUp'));
  assert.equal(sources.length, 4);
});
