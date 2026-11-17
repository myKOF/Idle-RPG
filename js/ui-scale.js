/* Fit the fixed design canvas inside the viewport with the same scale on both axes. */
(function () {
  'use strict';

  var DESIGN_WIDTH = 1920;
  var DESIGN_HEIGHT = 900;
  var stage = document.getElementById('ui-stage');
  if (!stage) return;

  var scale = 1;
  var left = 0;
  var top = 0;
  stage.style.setProperty('--ui-canvas-width', DESIGN_WIDTH + 'px');
  stage.style.setProperty('--ui-canvas-height', DESIGN_HEIGHT + 'px');
  stage.style.setProperty('--ui-vw', DESIGN_WIDTH / 100 + 'px');
  stage.style.setProperty('--ui-vh', DESIGN_HEIGHT / 100 + 'px');

  function syncUiScale() {
    var width = Math.max(1, document.documentElement.clientWidth || window.innerWidth);
    var height = Math.max(1, document.documentElement.clientHeight || window.innerHeight);
    scale = Math.min(width / DESIGN_WIDTH, height / DESIGN_HEIGHT);
    left = (width - DESIGN_WIDTH * scale) / 2;
    top = (height - DESIGN_HEIGHT * scale) / 2;
    stage.style.setProperty('--ui-scale', String(scale));
  }

  // Fixed UI layers are positioned in design pixels. Pointer events and DOMRects use viewport pixels.
  window.UiCanvas = {
    width: DESIGN_WIDTH,
    height: DESIGN_HEIGHT,
    get scale() { return scale; },
    point: function (x, y) { return { x: (x - left) / scale, y: (y - top) / scale }; },
    rect: function (element) {
      var bounds = element.getBoundingClientRect();
      return {
        left: (bounds.left - left) / scale,
        top: (bounds.top - top) / scale,
        right: (bounds.right - left) / scale,
        bottom: (bounds.bottom - top) / scale,
        width: bounds.width / scale,
        height: bounds.height / scale
      };
    }
  };

  window.syncUiScale = syncUiScale;
  window.addEventListener('resize', syncUiScale, { passive: true });
  document.addEventListener('fullscreenchange', syncUiScale);
  syncUiScale();
})();
