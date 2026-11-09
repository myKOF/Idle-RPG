'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const { SCHEMAS, csvParse, readXlsxRows, extractLiteral } = require('../tools/config_tables.cjs');
const track = 'audio/zones/desert-ascendant.mp3';
const track2 = 'audio/zones/desert-ascendant_2.mp3';

function mount(blocked = false, ready = true) {
  const events = {}, music = [], settings = { mute: false, musicVolume: 50, sfxVolume: 50 };
  let changed, allowed = !blocked, clock = 1000, timerId = 0;
  const timers = new Map();
  class Audio {
    constructor() { this.paused = true; this.currentTime = 0; this.starts = 0; this.ended = false; music.push(this); }
    get src() { return this._src; }
    set src(value) { this._src = value; this.paused = true; this.ended = false; this.currentTime = 0; }
    play() {
      this.starts++;
      if (!allowed) return Promise.reject(new Error('Autoplay denied'));
      this.paused = false;
      return Promise.resolve();
    }
    pause() { this.paused = true; }
  }
  const c = {
    Date: { now: () => clock },
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, at: clock + ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    ZONES: { desert: { bgm: track, bgm2: track2 }, Icefield: {}, test: { bgm: 'audio/test.mp3' }, secondOnly: { bgm2: track2 } },
    document: { hidden: false, addEventListener: (name, fn) => { events[name] = fn; } },
    window: { Audio, addEventListener: (name, fn) => { events[name] = fn; } },
    GameSettings: { get: key => settings[key], sfxGain: () => 1, subscribe: fn => { changed = fn; } }
  };
  vm.createContext(c); vm.runInContext(read('js/ui-sound.js'), c);
  if (ready) c.UISound.setSceneReady(true);
  return { c, music, events,
    scene: (zone, towerActive = false) => c.UISound.setScene({ zone, towerActive }),
    setting: (key, value) => { settings[key] = value; changed(key); },
    finish: audio => { audio.ended = true; audio.paused = true; audio.onended(); },
    pending: () => [...timers.values()],
    advance(ms) {
      const target = clock + ms;
      for (;;) {
        const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > target) break;
        clock = next[1].at; timers.delete(next[0]); next[1].fn();
      }
      clock = target;
    },
    allow: () => { allowed = true; }
  };
}

test('Zones Excel, CSV, runtime BGM and reverse extraction stay in sync without changing other maps', () => {
  const rows = csvParse(read('config/CSV/Zones.csv'));
  const xlsx = readXlsxRows(path.join(root, 'config/Excel/Zones.xlsx'), '地圖');
  assert.deepEqual(xlsx, rows);
  assert.equal(rows[0][3], 'BGM');
  assert.equal(rows[0][4], 'BGM2');
  const id = rows[0].indexOf('地圖識別碼'), bgm = rows[0].indexOf('BGM'), bgm2 = rows[0].indexOf('BGM2');
  for (const row of rows.slice(1)) {
    assert.equal(row[bgm], row[id] === 'desert' ? track : '');
    assert.equal(row[bgm2], row[id] === 'desert' ? track2 : '');
  }
  const src = read('js/data.js');
  const rebuilt = SCHEMAS.Zones.rebuild(rows.slice(1), rows[0], src);
  const actual = SCHEMAS.Zones.evaluate(extractLiteral(src, 'ZONES').literal);
  const expected = SCHEMAS.Zones.evaluate(extractLiteral(rebuilt.ZONES, 'ZONES').literal);
  assert.equal(JSON.stringify(actual), JSON.stringify(expected));
  const extracted = SCHEMAS.Zones.extract(src);
  assert.deepEqual(extracted.map(row => row.slice(0, 15)), rows.slice(1).map(row => row.slice(0, 15)));
  assert.equal(actual.desert.bgm, track);
  assert.equal(actual.desert.bgm2, track2);
  assert.equal(actual.Icefield.bgm, undefined);
  const manifest = JSON.parse(read('audio/zones/manifest.json'));
  const bytes = fs.readFileSync(path.join(root, track));
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), manifest.sha256);
  const manifest2 = JSON.parse(read('audio/zones/manifest-2.json'));
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, track2))).digest('hex'), manifest2.sha256);
});

test('entering a configured map loops music; ticks and stage changes preserve playback', () => {
  const m = mount();
  m.scene('desert');
  const audio = m.music[0];
  assert.equal(audio.src, track);
  assert.equal(audio.loop, false);
  assert.equal(audio.paused, false);
  audio.currentTime = 25;
  for (let i = 0; i < 100; i++) m.c.UISound.setScene({ zone: 'desert', stage: i, towerActive: false });
  assert.equal(m.music.length, 1);
  assert.equal(audio.starts, 1);
  assert.equal(audio.currentTime, 25);
  m.scene('Icefield');
  assert.equal(audio.paused, true);
  m.scene('desert');
  assert.equal(m.music[1].currentTime, 0);
  assert.equal(m.music[1].paused, false);
});

test('two tracks play first then second then first; same-map snapshots retain the second track', () => {
  const m = mount(); m.scene('desert');
  const audio = m.music[0];
  m.finish(audio);
  assert.equal(audio.src, track2);
  assert.equal(audio.paused, true);
  m.advance(9999);
  assert.equal(audio.paused, true);
  m.advance(1);
  assert.equal(audio.paused, false);
  assert.equal(audio.loop, false);
  audio.currentTime = 42;
  for (let i = 0; i < 20; i++) m.c.UISound.setScene({ zone: 'desert', stage: i });
  assert.equal(audio.src, track2);
  assert.equal(audio.currentTime, 42);
  assert.equal(audio.starts, 2);
  audio.onended();
  assert.equal(audio.src, track2, 'a queued duplicate end event must not skip the new track');
  m.finish(audio);
  assert.equal(audio.src, track);
  assert.equal(audio.currentTime, 0);
  assert.equal(audio.paused, true);
  m.advance(10000);
  assert.equal(audio.starts, 3);
  assert.equal(m.music.length, 1);
});

test('single-track and second-column-only maps wait before repeating; stale scene ends stay silent', () => {
  const m = mount(); m.scene('test');
  assert.equal(m.music[0].loop, false);
  m.finish(m.music[0]);
  assert.equal(m.music[0].paused, true);
  m.advance(10000);
  assert.equal(m.music[0].paused, false);
  m.scene('secondOnly');
  assert.equal(m.music[1].src, track2);
  assert.equal(m.music[1].loop, false);
  m.scene('desert');
  const old = m.music[2];
  m.scene('Icefield'); m.finish(old);
  assert.equal(old.paused, true);
  assert.equal(m.music.length, 3);
  m.scene('desert'); m.finish(old);
  assert.equal(m.music[3].src, track);
  assert.equal(m.music[3].paused, false);
});

test('track ends respect mute, start-screen and page-exit pause; resume preserves the selected track', () => {
  const m = mount(); m.scene('desert');
  const audio = m.music[0];
  m.finish(audio); m.advance(10000); audio.currentTime = 12;
  m.setting('mute', true); m.setting('mute', false);
  assert.equal(audio.src, track2);
  assert.equal(audio.currentTime, 12);
  m.setting('mute', true); m.finish(audio);
  assert.equal(audio.src, track);
  assert.equal(audio.paused, true);
  m.advance(10000);
  m.setting('mute', false);
  assert.equal(audio.paused, false);
  m.c.UISound.setStartScreenActive(true); m.finish(audio);
  assert.equal(audio.src, track2);
  assert.equal(audio.paused, true);
  m.advance(10000);
  m.c.UISound.setStartScreenActive(false);
  assert.equal(audio.paused, false);
  m.events.pagehide(); m.finish(audio);
  assert.equal(audio.src, track);
  assert.equal(audio.paused, true);
  m.setting('musicVolume', 30);
  assert.equal(audio.paused, true);
  m.advance(10000);
  m.events.pageshow();
  assert.equal(audio.src, track);
  assert.equal(audio.paused, false);
});

test('tower, blank and unknown maps stop field music; another configured map replaces it', () => {
  const m = mount();
  m.scene('desert'); m.scene('desert', true);
  assert.equal(m.music[0].paused, true);
  m.scene('desert'); m.scene('test');
  assert.equal(m.music[1].paused, true);
  assert.equal(m.music[2].src, 'audio/test.mp3');
  assert.equal(m.music[2].paused, false);
  m.scene('missing');
  assert.equal(m.music[2].paused, true);
});

test('menu and scene music are mutually exclusive through start-screen transitions', () => {
  const m = mount();
  m.c.UISound.setStartScreenActive(true);
  const menu = m.music[0];
  m.scene('desert');
  assert.equal(m.music.length, 1);
  m.c.UISound.setStartScreenActive(false);
  const field = m.music[1];
  assert.equal(menu.paused, true);
  assert.equal(field.paused, false);
  field.currentTime = 30;
  m.c.UISound.setStartScreenActive(true);
  assert.equal(menu.paused, false);
  assert.equal(field.paused, true);
  m.c.UISound.setStartScreenActive(false);
  assert.equal(field.currentTime, 30);
  assert.equal(field.paused, false);
});

test('music volume and mute resume at the same position; hidden tabs loop; page exit pauses', () => {
  const m = mount(); m.scene('desert');
  const audio = m.music[0]; audio.currentTime = 17;
  m.setting('musicVolume', 25);
  assert.equal(audio.volume, .25);
  m.setting('sfxVolume', 0);
  assert.equal(audio.paused, false);
  m.setting('mute', true);
  assert.equal(audio.paused, true);
  m.setting('mute', false);
  assert.equal(audio.paused, false);
  assert.equal(audio.currentTime, 17);
  m.setting('musicVolume', 0);
  assert.equal(audio.paused, true);
  m.setting('musicVolume', 60);
  assert.equal(audio.volume, .6);
  m.c.document.hidden = true; m.events.visibilitychange();
  assert.equal(audio.paused, false);
  m.events.pagehide();
  assert.equal(audio.paused, true);
  m.events.pageshow();
  assert.equal(audio.paused, false);
});

test('blocked autoplay retries only after real interaction and always uses the latest scene', async () => {
  const m = mount(true); m.scene('desert');
  await Promise.resolve();
  assert.equal(m.music[0].paused, true);
  m.allow(); m.events.pointerdown({ isTrusted: false });
  assert.equal(m.music[0].paused, true);
  m.events.keydown({ isTrusted: true });
  assert.equal(m.music[0].paused, false);
  m.scene('Icefield'); m.events.pointerdown({ isTrusted: true });
  assert.equal(m.music[0].paused, true);
  m.c.window.Audio = function () { throw new Error('No output device'); };
  assert.doesNotThrow(() => m.scene('desert'));
});

test('loading blocks scene snapshots, gestures and settings until the game is revealed', () => {
  const m = mount(false, false); m.scene('desert');
  m.events.keydown({ isTrusted: true });
  m.setting('musicVolume', 25);
  assert.equal(m.music.length, 0);
  m.c.UISound.setSceneReady(true);
  const audio = m.music[0];
  assert.equal(audio.paused, false);
  assert.equal(audio.volume, .25);
  audio.currentTime = 12;
  m.c.UISound.setSceneReady(false);
  assert.equal(audio.paused, true);
  m.c.UISound.setSceneReady(true);
  assert.equal(audio.currentTime, 12);
  assert.equal(audio.paused, false);
});

test('settings, gestures, same-map ticks and loading toggles cannot bypass the ten-second gap', () => {
  const m = mount(); m.scene('desert'); const audio = m.music[0];
  m.finish(audio); m.advance(5000);
  m.scene('desert'); m.setting('musicVolume', 75);
  m.setting('mute', true); m.setting('mute', false);
  m.events.keydown({ isTrusted: true }); m.events.pageshow();
  m.c.UISound.setSceneReady(false); m.c.UISound.setSceneReady(true);
  assert.equal(audio.paused, true);
  assert.equal(audio.starts, 1);
  m.advance(4999); assert.equal(audio.paused, true);
  m.advance(1); assert.equal(audio.paused, false);
  assert.equal(audio.src, track2);
  assert.equal(audio.starts, 2);
});

test('leaving during the gap cancels its timer and a stale callback cannot start the new scene', () => {
  const m = mount(); m.scene('desert'); const old = m.music[0];
  m.finish(old); const late = m.pending()[0].fn; m.advance(5000);
  m.scene('Icefield'); assert.equal(m.pending().length, 0);
  m.scene('desert'); const current = m.music[1];
  late(); m.advance(5000);
  assert.equal(old.paused, true);
  assert.equal(current.src, track);
  assert.equal(current.starts, 1);
});

test('startup audio readiness is enabled only after the actual loading veil is hidden', () => {
  const src = read('js/main.js'), log = [], elements = { topbar: { inert: true }, 'game-layout': { inert: true } };
  const c = {
    UISound: { setSceneReady: ready => log.push('audio:' + ready) },
    document: { getElementById: id => elements[id] },
    showLoadingScreen: () => log.push('show'), hideLoadingScreen: () => log.push('hide'),
    WorkerBridge: { on() {}, releaseStartupHold: () => log.push('release') },
    MSG_OUT: { BOOTED: 'booted' }, requestAnimationFrame() {}
  };
  vm.createContext(c);
  vm.runInContext(src.slice(src.indexOf('function revealGame()'), src.indexOf('function enterGame(')), c);
  c.waitForStartupUi(); assert.deepEqual(log, ['audio:false', 'show']);
  c.revealGame(); assert.deepEqual(log, ['audio:false', 'show', 'hide', 'release', 'audio:true']);
  assert.equal(elements.topbar.inert, false);
});

test('authoritative full and tick views update audio even when tower state does not change', () => {
  const src = read('js/ui.js');
  const fn = src.slice(src.indexOf('function applyUiBossFightView(view)'), src.indexOf('function skillLoadoutButtonAttributes'));
  const scenes = [];
  const c = { UISound: { setScene: view => scenes.push(view.zone) }, UI_WORKER_STATE: { view: { towerActive: false } } };
  vm.createContext(c); vm.runInContext(fn, c);
  c.applyUiBossFightView({ zone: 'desert', towerActive: false });
  c.applyUiBossFightView({ zone: 'Icefield', towerActive: false });
  assert.deepEqual(scenes, ['desert', 'Icefield']);
  assert.match(src, /if \(snapshot\.view\) applyUiBossFightView\(snapshot\.view\)/);
  assert.match(src, /if \(msg\.view\) applyUiBossFightView\(msg\.view\)/);
});
