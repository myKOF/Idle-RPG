'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const config = { music: 'music.wav', sfx: 'sfx.wav' };
const settle = () => new Promise(resolve => setImmediate(resolve));

function env(options = {}) {
  const sources = [], gains = [], fetched = [], subscribers = [];
  const values = { mute: false, musicVolume: 50, sfxVolume: 50 };
  let offset = 13250;
  class Context {
    constructor() { this.state = options.suspended ? 'suspended' : 'running'; this.currentTime = 10; this.destination = {}; }
    resume() { if (options.resumeFails) return Promise.reject(Error('blocked')); this.state = 'running'; return Promise.resolve(); }
    decodeAudioData() { return Promise.resolve({ duration: 30 }); }
    createBufferSource() {
      const source = { connect() {}, disconnect() { this.disconnected = true; }, start(at, time) { this.offset = time; }, stop() { this.stopped = true; } };
      sources.push(source); return source;
    }
    createGain() { const gain = { gain: { value: 0, setTargetAtTime(v) { this.value = v; } }, connect() {}, disconnect() { this.disconnected = true; } }; gains.push(gain); return gain; }
  }
  const context = {
    window: { AudioContext: Context }, document: { hidden: false },
    navigator: { userActivation: { hasBeenActive: options.activated !== false } },
    fetch(url) { fetched.push(url); return options.fetch ? options.fetch(url) : Promise.resolve({ ok: !options.networkFails, arrayBuffer() { return Promise.resolve(new ArrayBuffer(0)); } }); },
    GameSettings: { get: name => values[name], sfxGain: () => values.mute ? 0 : values.sfxVolume / 50, subscribe: fn => subscribers.push(fn) }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/intro-audio.js'), 'utf8'), context);
  return { A: context.IntroAudio, context, sources, gains, fetched, values, subscribers, clock: () => offset, setClock: v => { offset = v; } };
}

test('音樂與音效分軌，從畫面當下時間播放，靜音／兩個音量立即生效', async () => {
  const e = env(), audio = e.A.create(config, e.clock);
  e.values.musicVolume = 25; e.values.sfxVolume = 75;
  audio.start(); await settle();
  assert.deepEqual(e.fetched, ['music.wav', 'sfx.wav']);
  assert.deepEqual(e.sources.map(s => s.offset), [13.25, 13.25]);
  assert.deepEqual(e.gains.map(g => g.gain.value), [.5, 1.5]);
  e.values.mute = true; e.subscribers[0]();
  assert.deepEqual(e.gains.map(g => g.gain.value), [0, 0]);
  e.values.mute = false; e.values.musicVolume = 0; e.subscribers[0]();
  assert.deepEqual(e.gains.map(g => g.gain.value), [0, 1.5]);
  audio.dispose(); assert.ok(e.sources.every(s => s.stopped && s.disconnected));
  assert.ok(e.gains.every(g => g.disconnected));
});

test('暫停／恢復不補播過期聲音，不重新下載；多次重播只有一份設定監聽', async () => {
  const e = env(), first = e.A.create(config, e.clock);
  first.start(); await settle(); first.pause();
  assert.ok(e.sources.every(s => s.stopped));
  e.setClock(22500); first.start(); await settle();
  assert.deepEqual(e.sources.slice(-2).map(s => s.offset), [22.5, 22.5]);
  assert.equal(e.fetched.length, 2);
  const next = e.A.create(config, e.clock);
  assert.ok(e.sources.every(s => s.stopped), '新演出先清掉舊演出');
  first.start(); await settle(); assert.equal(e.sources.length, 4, '舊控制器不再起播');
  next.start(); await settle(); assert.equal(e.sources.length, 6);
  assert.equal(e.subscribers.length, 1); next.dispose();
});

test('下載中略過／暫停取消非同步起播，恢復從新位置開始', async () => {
  let resolveFetch;
  const response = new Promise(resolve => { resolveFetch = resolve; });
  const e = env({ fetch: () => response }), audio = e.A.create(config, e.clock);
  audio.start(); await settle(); audio.pause();
  resolveFetch({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) });
  await settle(); assert.equal(e.sources.length, 0);
  e.setClock(28000); audio.start(); await settle();
  assert.deepEqual(e.sources.map(s => s.offset), [28, 28]); audio.dispose();
});

test('未授權手勢／背景／音訊裝置或網路失敗安靜退化，不阻塞動畫', async () => {
  for (const options of [{ activated: false }, { suspended: true, resumeFails: true }, { networkFails: true }]) {
    const e = env(options), audio = e.A.create(config, e.clock);
    assert.doesNotThrow(() => audio.start()); await settle();
    assert.equal(e.sources.length, 0); audio.dispose();
  }
  const e = env(), audio = e.A.create(config, e.clock);
  e.context.document.hidden = true; audio.start(); await settle(); assert.equal(e.fetched.length, 0);
  e.context.document.hidden = false; e.setClock(30000); audio.start(); await settle();
  assert.equal(e.sources.length, 0, '最後一幀不從頭補播'); audio.dispose();
});

test('正式兩軌各30秒、無削波／非靜音／首尾歸零，可逐樣本重產', () => {
  const rendered = require('../tools/intro/build-score.cjs').render();
  for (const [name, expected] of Object.entries(rendered)) {
    const wav = fs.readFileSync(path.join(root, 'audio/intro', name));
    assert.ok(wav.equals(expected));
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
    assert.equal(wav.readUInt16LE(22), 1); assert.equal(wav.readUInt32LE(24), 24000);
    assert.equal(wav.readUInt16LE(34), 16); assert.equal(wav.readUInt32LE(40) / 2 / 24000, 30);
    let peak = 0, power = 0;
    for (let p = 44; p < wav.length; p += 2) { const v = wav.readInt16LE(p); peak = Math.max(peak, Math.abs(v)); power += v * v; }
    assert.ok(peak < 31130 && peak > 1000); assert.ok(power > 1e9);
    assert.equal(wav.readInt16LE(44), 0); assert.equal(wav.readInt16LE(wav.length - 2), 0);
  }
});
