'use strict';
/* ============================================================
   vfx-pixi-backend.js — VFX Core 的 PixiJS v8 繪圖後端（瀏覽器專用）

   Core 已經把所有數值算完，這一層只做三件事：建節點、套 transform、回收節點。
   刻意不含任何動態邏輯——動態全部留在 vfx-core.js，
   Editor 與 Runtime 才不會因為後端不同而長出不同的表現。

   貼圖非同步載入，但 Core 的 createNode 是同步的：
   先給空白貼圖，載入完成後回填，並以 URL 為鍵快取，避免重複載入。
   ============================================================ */

var VFXPixiBackend = (function () {

  /* Pixi 的 Assets 是全域資源管理器，多個 backend 可能載入同一個 URL。
     若各自在 destroy 時無條件 unload，先收攤的那一個會把另一個仍在用的貼圖拆掉。
     因此參照計數放在模組層級，只有最後一個使用者才真的卸載。 */
  var textureRefs = Object.create(null);

  function retainTexture(url) {
    textureRefs[url] = (textureRefs[url] || 0) + 1;
  }

  function releaseTexture(PixiLib, url) {
    if (!textureRefs[url]) return;
    textureRefs[url]--;
    if (textureRefs[url] > 0) return;
    delete textureRefs[url];
    /* 載入失敗的 URL 也持有一份 entry（ownership 才會成對），因此這裡一定會對
       「從未成功載入」的 URL 呼叫 unload。Pixi v8 的 unload 回傳 Promise，
       這種情況會非同步 reject——不接住就是一則 unhandled rejection。 */
    try {
      var pending = PixiLib.Assets.unload(url);
      if (pending && typeof pending.catch === 'function') pending.catch(function () {});
    } catch (e) { /* 已卸載或從未載入成功 */ }
  }

  /* Pixi v8 的 blendMode 是字串 */
  var BLEND_MAP = {
    normal: 'normal',
    add: 'add',
    multiply: 'multiply',
    screen: 'screen'
  };

  function createBackend(options) {
    var opts = options || {};
    var PixiLib = opts.PIXI || (typeof PIXI !== 'undefined' ? PIXI : null);
    if (!PixiLib) throw new Error('VFXPixiBackend 需要 PIXI（請先載入 js/vendor/pixi.min.js）');
    var container = opts.container;
    if (!container) throw new Error('VFXPixiBackend 需要一個 PIXI.Container 當作掛載點');
    container.sortableChildren = true;

    /* url -> { state: 'loading' | 'ready' | 'failed', texture, promise }

       每個 URL 在同一個 backend 內只有一個 entry：entry 建立時 retain 一次，
       destroy 時每個 entry release 一次。載入成功、失敗、或仍在進行中都一樣，
       所以 retain/release 必然成對。

       失敗時保留 entry 並標記 'failed'，而不是把 cache 寫回 null——null 與
       「從未請求過」無法區分，下一次 createNode 會判定成尚未 retain 而再 retain
       一次，計數便再也回不到 0，Assets.unload() 永遠不會被呼叫。
       代價是同一個 URL 失敗後不會在同一個 backend 內自動重試（錯誤也因此只記錄
       一次，不會每建一個節點就洗版）；素材路徑修好後重開 Editor 即可。 */
    var entries = Object.create(null);
    var pendingErrors = [];
    var destroyed = false;

    function getTexture(url, onReady) {
      if (destroyed) return;                     // 已經 release 完畢，不能再 retain
      var entry = entries[url];
      if (!entry) {
        entry = { state: 'loading', texture: null, promise: null };
        entries[url] = entry;
        retainTexture(url);                      // 與 entry 一對一
        entry.promise = PixiLib.Assets.load(url).then(function (tex) {
          entry.state = 'ready';
          entry.texture = tex;
          return tex;
        }, function (err) {
          // 載不到就記錄下來，不 silent fallback 成空白讓人以為特效壞了卻查不到原因
          entry.state = 'failed';
          pendingErrors.push({ url: url, message: String(err && err.message || err) });
          return null;
        });
      }
      if (entry.state === 'ready') {
        if (!destroyed) onReady(entry.texture);
        return;
      }
      if (entry.state === 'failed') return;      // 已知失敗：不重試、也不再 retain
      entry.promise.then(function (tex) { if (tex && !destroyed) onReady(tex); });
    }

    function createNode(spec) {
      var node;
      if (spec.kind === 'tiled') {
        node = new PixiLib.TilingSprite({
          texture: PixiLib.Texture.EMPTY,
          width: 256,
          height: 256
        });
      } else {
        node = new PixiLib.Sprite(PixiLib.Texture.EMPTY);
      }
      node.blendMode = BLEND_MAP[spec.blendMode] || 'normal';
      node.visible = false;
      container.addChild(node);
      getTexture(spec.assetUrl, function (tex) {
        if (node.destroyed) return;
        node.texture = tex;
      });
      return node;
    }

    function updateNode(node, t) {
      if (!t) return;
      if (t.visible === false) { node.visible = false; return; }
      node.visible = true;
      if (t.x !== undefined) node.x = t.x;
      if (t.y !== undefined) node.y = t.y;
      if (t.rotation !== undefined) node.rotation = t.rotation;
      if (t.scaleX !== undefined) node.scale.set(t.scaleX, t.scaleY);
      if (t.alpha !== undefined) node.alpha = t.alpha;
      if (t.tint !== undefined) node.tint = t.tint;
      if (t.zIndex !== undefined) node.zIndex = t.zIndex;
      if (node.anchor && t.anchorX !== undefined) node.anchor.set(t.anchorX, t.anchorY);
      if (t.width !== undefined) node.width = t.width;
      if (t.height !== undefined) node.height = t.height;
      if (t.tileX !== undefined && node.tilePosition) {
        node.tilePosition.set(t.tileX * (node.texture.width || 1), t.tileY * (node.texture.height || 1));
      }
    }

    function destroyNode(node) {
      if (node.parent) node.parent.removeChild(node);
      node.destroy();
    }

    /* 貼圖是 GPU 資源，只清本地 cache 不夠——Pixi 的全域 Assets 仍持有它們。
       Backend 收攤時把自己載入過的 URL 一併卸載，避免反覆重建 Editor 時累積。 */
    function unloadTextures() {
      var urls = Object.keys(entries);
      entries = Object.create(null);
      urls.forEach(function (url) { releaseTexture(PixiLib, url); });
    }

    return {
      createNode: createNode,
      updateNode: updateNode,
      destroyNode: destroyNode,
      /* 診斷用：載入失敗的貼圖。Editor 會顯示出來，不讓錯誤靜靜消失。 */
      takeErrors: function () { var e = pendingErrors; pendingErrors = []; return e; },
      destroy: function () {
        if (destroyed) return;
        destroyed = true;
        container.removeChildren();
        unloadTextures();
      }
    };
  }

  return {
    createBackend: createBackend,
    /* 測試用：目前被幾個 backend 持有 */
    _refCount: function (url) { return textureRefs[url] || 0; }
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = VFXPixiBackend;
}
