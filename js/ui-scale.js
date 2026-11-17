/* Scale the design width uniformly and let the layout fill the available height. */
(function () {
  'use strict';

  var DESIGN_WIDTH = 1920;
  var stage = document.getElementById('ui-stage');
  if (!stage) return;

  var scale = 1;
  var canvasHeight = 0;
  stage.style.setProperty('--ui-canvas-width', DESIGN_WIDTH + 'px');
  stage.style.setProperty('--ui-vw', DESIGN_WIDTH / 100 + 'px');

  function syncUiScale() {
    var width = Math.max(1, document.documentElement.clientWidth || window.innerWidth);
    var height = Math.max(1, document.documentElement.clientHeight || window.innerHeight);
    scale = width / DESIGN_WIDTH;
    canvasHeight = height / scale;
    stage.style.setProperty('--ui-canvas-height', canvasHeight + 'px');
    stage.style.setProperty('--ui-vh', canvasHeight / 100 + 'px');
    stage.style.setProperty('--ui-scale', String(scale));
  }

  // Fixed UI layers are positioned in design pixels. Pointer events and DOMRects use viewport pixels.
  window.UiCanvas = {
    width: DESIGN_WIDTH,
    get height() { return canvasHeight; },
    get scale() { return scale; },
    point: function (x, y) { return { x: x / scale, y: y / scale }; },
    rect: function (element) {
      var bounds = element.getBoundingClientRect();
      return {
        left: bounds.left / scale,
        top: bounds.top / scale,
        right: bounds.right / scale,
        bottom: bounds.bottom / scale,
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
