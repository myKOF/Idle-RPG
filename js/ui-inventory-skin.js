/* 背包共用靜態底圖；不包含裝備圖示、星等或互動狀態。 */
'use strict';

var InventorySkin = (function () {
  var states = new WeakMap();
  var readyClass = 'inventory-mythic-skin-ready';
  var skinProperties = ['background', 'box-shadow', 'border-top', 'border-right',
    'border-bottom', 'border-left', 'border-radius', 'border-image-source', 'border-image-slice',
    'border-image-width', 'border-image-repeat', 'box-sizing'];

  function xml(value) {
    return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  function skinStyle(cell, pseudo) {
    var style = window.getComputedStyle(cell, pseudo);
    return skinProperties.map(function (name) {
      return name + ':' + style.getPropertyValue(name);
    }).join(';');
  }

  function prepare(box, width) {
    if (!box || !(width > 0)) return;
    var dpr = Math.min(3, Math.max(1, Number(window.devicePixelRatio) || 1));
    var key = width + ':' + dpr;
    var state = states.get(box);
    if (!state) {
      state = { revision: 0, frame: 0 };
      states.set(box, state);
    }
    if (state.requestedKey !== key) {
      state.requestedKey = key;
      state.pendingKey = null;
      state.failedKey = null;
      state.revision++;
    }
    if (state.readyKey === key || state.pendingKey === key || state.failedKey === key) return;
    state.pendingKey = key;
    state.dpr = dpr;
    if (state.frame) return;
    // 合併同一幀的請求；不在 renderInventory 的 DOM 寫入後強迫量測。
    state.frame = window.requestAnimationFrame(function () {
      state.frame = 0;
      var requestedKey = state.pendingKey;
      var revision = state.revision;
      if (!requestedKey) return;
      var sample = box.querySelector('.item-cell.eff-mythic:not(.dimmed):not(.item-cell-dimmed)');
      if (!sample || !box.isConnected) { state.pendingKey = null; return; }

      function failed() {
        if (state.revision !== revision) return;
        state.pendingKey = null;
        state.failedKey = requestedKey;
        state.readyKey = null;
        box.classList.remove(readyClass);
        box.style.removeProperty('--inventory-mythic-skin');
      }

      try {
        var style = window.getComputedStyle(sample);
        // 使用邏輯尺寸，避免 UI shell 的 transform 縮放被套用兩次。
        var w = parseFloat(style.width), h = parseFloat(style.height);
        if (!(w > 0 && h > 0)) { state.pendingKey = null; return; }
        var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '">' +
          '<foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="' +
          xml('position:relative;width:100%;height:100%;overflow:hidden;border-radius:' + style.borderRadius) + '">' +
          '<div style="' + xml('position:absolute;inset:0;' + skinStyle(sample, '::before')) + '"></div>' +
          '<div style="' + xml('position:absolute;inset:2px;' + skinStyle(sample, '::after')) + '"></div>' +
          '</div></foreignObject></svg>';
        var image = new Image();
        image.onerror = failed;
        image.onload = function () {
          if (state.revision !== revision) return;
          if (!box.isConnected) { state.pendingKey = null; return; }
          try {
            var canvas = document.createElement('canvas');
            canvas.width = Math.ceil(w * state.dpr);
            canvas.height = Math.ceil(h * state.dpr);
            var context = canvas.getContext('2d');
            if (!context) { failed(); return; }
            context.drawImage(image, 0, 0, canvas.width, canvas.height);
            var url = canvas.toDataURL('image/png');
            // 完整解碼及點陣化成功後才切換；不支援的瀏覽器維持原 CSS。
            box.style.setProperty('--inventory-mythic-skin', 'url("' + url + '")');
            box.classList.add(readyClass);
            state.readyKey = requestedKey;
            state.pendingKey = null;
          } catch (error) { failed(); }
        };
        image.src = 'data:image/svg+xml,' + encodeURIComponent(svg);
      } catch (error) { failed(); }
    });
  }

  return { prepare: prepare };
})();
