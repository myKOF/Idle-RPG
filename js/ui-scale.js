/* Fixed-size game canvas scaler. */
(function () {
  'use strict';

  var DESIGN_WIDTH = 1920;
  var DESIGN_HEIGHT = 900;

  function buildUiCanvas() {
    var topbar = document.getElementById('topbar');
    var gameLayout = document.getElementById('game-layout');
    if (!topbar || !gameLayout || document.getElementById('ui-stage')) return;

    var stage = document.createElement('div');
    stage.id = 'ui-stage';
    var shell = document.createElement('div');
    shell.id = 'ui-shell';
    stage.appendChild(shell);
    document.body.insertBefore(stage, topbar);
    shell.appendChild(topbar);
    shell.appendChild(gameLayout);
  }

  function syncUiScale() {
    var stage = document.getElementById('ui-stage');
    var shell = document.getElementById('ui-shell');
    if (!stage || !shell) return;

    var width = Math.max(1, document.documentElement.clientWidth || window.innerWidth);
    var height = Math.max(1, document.documentElement.clientHeight || window.innerHeight);
    var scale = Math.min(width / DESIGN_WIDTH, height / DESIGN_HEIGHT);
    shell.style.transform = 'translate(-50%, -50%) scale(' + scale + ')';
    stage.style.setProperty('--ui-scale', String(scale));
  }

  function init() {
    buildUiCanvas();
    window.syncUiScale = syncUiScale;
    window.addEventListener('resize', syncUiScale, { passive: true });
    document.addEventListener('fullscreenchange', syncUiScale);
    syncUiScale();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
