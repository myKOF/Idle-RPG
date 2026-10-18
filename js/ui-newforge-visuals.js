'use strict';
/* 熔爐純顯示層：按裝備ID保留DOM、插補輸送帶位置；Canvas程序火焰不使用素材或Preset。 */
var NewForgeVisuals = (function () {
  var states = [], frame = null;
  var clock = typeof GameClock !== 'undefined' ? GameClock : globalThis;
  var pitch = 44;

  function now() { return typeof clock.now === 'function' ? clock.now() : performance.now(); }
  function active() { return (typeof UI === 'undefined' || UI.tab === 'newforge') && !document.hidden; }
  function reduced() { return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; }
  function position(entry, time) {
    var p = Math.max(0, Math.min(1, (time - entry.at) / entry.duration));
    return entry.from + (entry.to - entry.from) * p;
  }
  function advance(state, time) {
    if (state.enabled && active()) state.time += Math.max(0, time - state.lastAt);
    state.lastAt = time;
  }
  function move(entry, target, duration, time) {
    entry.from = position(entry, time);
    entry.to = target;
    entry.at = time;
    entry.duration = duration;
  }
  function keysFor(items) {
    var counts = Object.create(null);
    return items.map(function (it) {
      if (it.id !== undefined && it.id !== null) return 'id:' + it.id;
      // 舊快照沒有ID時，僅以相同外觀＋出現次序退化；新快照一律用真正的實例ID。
      var key = [it.slot, it.weaponType, it.rarity, it.name].join('|');
      counts[key] = (counts[key] || 0) + 1;
      return 'legacy:' + key + ':' + counts[key];
    });
  }
  function makeChip(item) {
    var holder = document.createElement('div');
    holder.innerHTML = nfBeltChipsHTML({ belt: [item] });
    return holder.firstElementChild;
  }
  function paintFire(state, seconds) {
    var c = state.context;
    if (!c) return;
    c.clearRect(0, 0, 96, 104);
    c.save();
    c.scale(2, 2);
    var glow = c.createRadialGradient(24, 43, 2, 24, 37, 25);
    glow.addColorStop(0, '#f7701655'); glow.addColorStop(1, '#a7240000');
    c.fillStyle = glow; c.fillRect(0, 0, 48, 52);
    // 固定基座與赤熱炭塊；火舌由連續粒子軌跡生成，沒有逐幀亂數閃爍。
    c.fillStyle = '#1e100b'; c.beginPath(); c.ellipse(24, 49, 20, 3, 0, 0, Math.PI * 2); c.fill();
    for (var coal = 0; coal < 7; coal++) {
      c.fillStyle = coal % 2 ? '#c74a16' : '#733019';
      c.fillRect(8 + coal * 5, 47 + coal % 2, 4, 2);
    }
    c.globalCompositeOperation = 'screen';
    // 外層橘紅火舌與較細的金白焰心，向上收束、左右翻捲。
    for (var layer = 0; layer < 2; layer++) {
      var count = layer ? 14 : 20;
      for (var i = 0; i < count; i++) {
        var seed = i * 2.399 + layer * 1.73;
        var age = (seconds * (layer ? 1.12 : .78) + i / count) % 1;
        var spread = (layer ? 9 : 15) * (1 - age * .55);
        var x = 24 + Math.sin(seed) * spread + Math.sin(seconds * 4 + seed + age * 3) * age * 4;
        var y = 49 - age * (layer ? 24 : 34);
        var width = (layer ? 3.2 : 5) * Math.sin(Math.PI * age) + 1;
        var height = (layer ? 13 : 19) * Math.sin(Math.PI * age) + 3;
        var curl = Math.sin(seconds * 3 + seed) * width;
        var gradient = c.createLinearGradient(x, y, x + curl, y - height);
        gradient.addColorStop(0, layer ? '#fff3ac' : '#ffad28');
        gradient.addColorStop(.5, layer ? '#ffd252' : '#f66513');
        gradient.addColorStop(1, layer ? '#ffa01800' : '#df350800');
        c.globalAlpha = Math.sin(Math.PI * age) * (layer ? .7 : .82);
        c.fillStyle = gradient;
        c.beginPath(); c.moveTo(x - width, y);
        c.bezierCurveTo(x - width * 1.1, y - height * .42, x + curl - width * .3, y - height * .7, x + curl, y - height);
        c.bezierCurveTo(x + curl + width * .2, y - height * .6, x + width * 1.2, y - height * .3, x + width, y);
        c.quadraticCurveTo(x, y + 3, x - width, y); c.fill();
      }
    }
    c.globalAlpha = 1;
    for (var spark = 0; spark < 7; spark++) {
      var t = (seconds * .64 + spark * .143) % 1;
      c.globalAlpha = Math.sin(Math.PI * t) * .85;
      c.fillStyle = spark % 2 ? '#ffbc4c' : '#ffeab6';
      c.fillRect(24 + Math.sin(spark * 4.1 + t * 3) * (7 + t * 10), 47 - t * 44, .7, 1.8);
    }
    c.restore();
  }
  function render(state, reduce) {
    var moving = false;
    state.entries.forEach(function (entry, key) {
      if (reduce) { entry.from = entry.to; entry.at = state.time; entry.duration = 1; }
      var x = reduce ? entry.to : position(entry, state.time);
      entry.node.style.transform = 'translate3d(' + x.toFixed(2) + 'px,-50%,0)';
      if (entry.exiting && (reduce || state.time >= entry.at + entry.duration)) {
        entry.node.remove(); state.entries.delete(key);
      } else if (Math.abs(x - entry.to) > .01) moving = true;
    });
    state.empty.hidden = state.entries.size > 0;
    if (state.visible && state.context && (state.fireAt === null || (!reduce && state.enabled && state.time - state.fireAt >= 1000 / 30))) {
      paintFire(state, state.time / 1000 + .35);
      state.fireAt = state.time;
    }
    return state.enabled && (!reduce || moving);
  }
  function tick(time) {
    frame = null;
    states = states.filter(function (state) {
      if (state.node.isConnected) return true;
      if (state.resize) state.resize.disconnect();
      if (state.visibility) state.visibility.disconnect();
      return false;
    });
    if (!active()) return;
    var work = false, reduce = reduced();
    states.forEach(function (state) {
      advance(state, time);
      if (state.visible) work = render(state, reduce) || work;
    });
    if (work) frame = clock.requestAnimationFrame(tick);
  }
  function update(node, fu) {
    var stamp = now();
    var state = states.find(function (s) { return s.id === fu.id; });
    if (!state) {
      state = { id: fu.id, node: node, entries: new Map(), time: 0, lastAt: stamp, enabled: !!fu.enabled, fireAt: null };
      states.push(state);
    }
    if (!frame || !active()) state.lastAt = stamp;
    advance(state, stamp);
    if (state.node !== node || !state.empty) {
      if (state.resize) state.resize.disconnect();
      if (state.visibility) state.visibility.disconnect();
      state.node = node;
      node.innerHTML = '';
      state.empty = document.createElement('span');
      state.empty.className = 'nf-belt-empty dim-text';
      state.empty.textContent = '（傳送帶空）'; node.appendChild(state.empty);
      state.entries.forEach(function (entry) { node.appendChild(entry.node); });
      var canvas = node.parentNode.querySelector('.nf-mouth-canvas');
      state.context = canvas ? canvas.getContext('2d') : null;
      state.fireAt = null;
      if (typeof ResizeObserver === 'function') {
        state.resize = new ResizeObserver(function () {
          if (node.isConnected && state.view) update(node, state.view);
        });
        state.resize.observe(node);
      }
      if (typeof IntersectionObserver === 'function') {
        state.visibility = new IntersectionObserver(function (entries) {
          state.inView = entries[0].isIntersecting;
          if (node.isConnected && state.view) update(node, state.view);
        });
        state.visibility.observe(node);
      }
    }
    state.view = fu;
    state.enabled = !!fu.enabled;
    state.visible = node.clientWidth > 0 && state.inView !== false;
    var width = node.clientWidth;
    if (!width) return;
    var items = (fu.belt || []).slice(0, NEW_FORGE_BELT_SHOW);
    var keys = keysFor(items), live = new Set(keys);
    var max = Math.max(1, Math.floor((width + 4) / pitch));
    var cycle = Math.max(.01, Number(fu.cycleDurationSec) || NEW_FORGE_INTERVAL);
    var remaining = Number(fu.cycleRemainingSec);
    var duration = Math.max(180, (Number.isFinite(remaining) && remaining > 0 ? remaining : cycle) * 1000);
    var shown = new Set(), incoming = 0;
    items.slice(0, max).forEach(function (item, i) {
      var key = keys[i], entry = state.entries.get(key);
      shown.add(key);
      if (!entry) {
        var chip = makeChip(item);
        chip.setAttribute('data-nf-item-id', item.id === undefined ? key : String(item.id));
        node.appendChild(chip);
        entry = { node: chip, from: width + incoming++ * pitch, to: i * pitch, at: state.time, duration: duration };
        state.entries.set(key, entry);
      } else if (entry.exiting || entry.to !== i * pitch || state.cycle !== cycle) {
        move(entry, i * pitch, duration, state.time);
      }
      entry.exiting = false;
    });
    state.entries.forEach(function (entry, key) {
      if (shown.has(key)) return;
      if (live.has(key)) { entry.node.remove(); state.entries.delete(key); }
      else if (!entry.exiting) {
        move(entry, -pitch, Math.max(80, Math.min(200, cycle * 250)), state.time);
        entry.exiting = true;
      }
    });
    state.cycle = cycle;
    render(state, reduced() || !state.visible);
    if (frame === null && active() && state.visible && state.enabled && !reduced()) frame = clock.requestAnimationFrame(tick);
  }
  if (typeof matchMedia === 'function') {
    var motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
    if (typeof motionPreference.addEventListener === 'function') motionPreference.addEventListener('change', function () {
      states.forEach(function (state) { if (state.node.isConnected) update(state.node, state.view); });
    });
  }
  return { update: update };
})();
