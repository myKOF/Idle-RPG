'use strict';
if (typeof STR !== 'function') { var STR = function (id) { return '[#' + id + ']'; }; } // STR 安全網：單檔載入時的備援，真正的實作在 js/strings.js

var DisplaySettingsUI = (function () {
  var host, state, busy = false, failed = false;
  function el(id) { return document.getElementById(id); }
  function currentMode() { return state ? state.mode : (document.fullscreenElement ? 'fullscreen' : 'windowed'); }

  function paint() {
    var pane = el('settings-pane-display');
    if (!pane) return;
    var mode = currentMode();
    pane.querySelectorAll('[name="display-mode"]').forEach(function (radio) {
      radio.checked = radio.value === mode;
      radio.disabled = busy || (host ? !state : radio.value === 'borderless' ||
        (radio.value === 'fullscreen' && !document.fullscreenEnabled));
    });
    paintRendering();
    el('set-display-resolution').disabled = busy;
    var vsync = el('set-vsync');
    vsync.checked = !state || state.vsync;
    vsync.disabled = busy || !host || !state;
    el('reset-display-settings').disabled = busy;
    var status = el('display-settings-status');
    var message = failed ? 2560 : (!host ? 2558 : (state && state.vsync !== state.activeVsync ? 2559 : 0));
    status.hidden = !message;
    status.textContent = message ? STR(message) : '';
  }

  function paintRendering() {
    el('set-display-resolution').value = GameSettings.get('displayResolution');
    el('set-render-scale').value = GameSettings.get('renderScale');
    el('set-render-scale-value').textContent = GameSettings.get('renderScale') + '%';
    el('settings-pane-display').querySelectorAll('[name="display-fps"]').forEach(function (radio) {
      radio.checked = Number(radio.value) === GameSettings.get('fpsLimit');
    });
  }

  function readNativeState(next) { state = next; paint(); }

  async function run(action) {
    if (busy) return;
    busy = true;
    failed = false;
    paint();
    try { await action(); }
    catch (err) { failed = true; console.warn('[display-settings]', err); }
    finally { busy = false; paint(); }
  }

  function applyResolution() {
    if (!host) return Promise.resolve();
    var size = GameSettings.get('displayResolution').split('x');
    return host.setResolution(Number(size[0]), Number(size[1]));
  }

  async function setMode(mode) {
    if (host) readNativeState(await host.setMode(mode));
    else if (mode === 'fullscreen' && !document.fullscreenElement) await document.documentElement.requestFullscreen();
    else if (mode === 'windowed' && document.fullscreenElement) await document.exitFullscreen();
  }

  function init() {
    var pane = el('settings-pane-display');
    if (!pane) return;
    host = window.ApexHost && window.ApexHost.display;
    if (host) {
      host.onChange(readNativeState);
      run(async function () { readNativeState(await host.get()); await applyResolution(); });
    } else {
      document.addEventListener('fullscreenchange', paint);
      paint();
    }
    var topbar = el('topbar'), resources = el('res-bar');
    var brand = topbar && topbar.querySelector('.brand');
    if (brand && resources) {
      topbar.addEventListener('dblclick', function (event) {
        if (event.button !== 0 || event.target !== topbar || currentMode() === 'windowed') return;
        if (event.clientX < brand.getBoundingClientRect().right || event.clientX >= resources.getBoundingClientRect().left) return;
        run(function () { return setMode('windowed'); });
      });
    }
    pane.addEventListener('change', function (event) {
      var input = event.target;
      if (input.name === 'display-mode') run(function () { return setMode(input.value); });
      if (input.name === 'display-fps') GameSettings.set('fpsLimit', input.value);
      if (input.id === 'set-display-resolution') {
        GameSettings.set('displayResolution', input.value);
        run(applyResolution);
      }
      if (host && input.id === 'set-vsync') {
        var value = input.checked;
        run(async function () { readNativeState(await host.setVsync(value)); });
      }
    });
    el('set-render-scale').addEventListener('input', function (event) {
      GameSettings.set('renderScale', event.target.value);
      paintRendering();
    });
    el('reset-display-settings').addEventListener('click', function () {
      run(async function () {
        var defaults = GameSettings.defaults();
        ['displayResolution', 'renderScale', 'fpsLimit'].forEach(function (name) { GameSettings.set(name, defaults[name]); });
        if (typeof setPerfModeEnabled === 'function') setPerfModeEnabled(false, true);
        el('set-reduce-fx').checked = false;
        await applyResolution();
        if (host) readNativeState(await host.setVsync(true));
        await setMode(host ? 'borderless' : 'windowed');
      });
    });
  }

  return { init: init, refresh: paint };
})();
