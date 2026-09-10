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
    var depthGroups = new Map();
    function detachDepth(node) {
      var group = node.__depthGroup;
      if (!group) return;
      group.removeChild(node); node.__depthGroup = null;
      if (!group.children.length) { depthGroups.delete(group.__effectId); container.removeChild(group); group.destroy(); }
    }
    function assignDepth(node, t) {
      if (!opts.depthSort || t.sortGroup === undefined) return;
      var group = depthGroups.get(t.sortGroup);
      if (node.__depthGroup !== group || !group) {
        detachDepth(node);
        group = depthGroups.get(t.sortGroup);
        if (!group) { group = new PixiLib.Container(); group.sortableChildren = true; group.__effectId = t.sortGroup; depthGroups.set(t.sortGroup, group); container.addChild(group); }
        if (node.parent) node.parent.removeChild(node);
        group.addChild(node); node.__depthGroup = group;
      }
      group.zIndex = t.sortY;
    }

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

    /* 序列幀：把一張圖切成 columns×rows 個 Texture，全部共用同一個 TextureSource。

       ⚠️ 絕對不能改共用貼圖自己的 frame。Pixi 的 Texture 是可以共用的物件，
       一個節點把 texture.frame 改掉，所有用同一張圖的節點會一起變——
       畫面上是「別的特效跟著一起換格」，而且完全查不出誰動的。
       正確作法是為每一格各建一個 Texture，節點只換 texture 的**指向**。

       每個 (url, columns, rows) 只切一次並快取：一個 8×8 的序列在畫面上
       同時有幾十顆粒子，重切就是幾十倍的物件配置。 */
    var sheetCache = Object.create(null);
    var profileCache = Object.create(null);
    function buildProfileFrames(spec, tex) {
      var key = spec.assetUrl + '|' + (spec.sheet ? spec.sheet.columns + 'x' + spec.sheet.rows : '1x1') + '|' + spec.profileScales.length;
      if (profileCache[key]) return profileCache[key];
      var frames = spec.sheet ? buildFrames(spec, tex) : [tex];
      profileCache[key] = frames.map(function (frame) {
        return spec.profileScales.map(function (_, i) {
          var r = frame.frame, h = r.height / spec.profileScales.length;
          return new PixiLib.Texture({ source: frame.source,
            frame: new PixiLib.Rectangle(r.x, r.y + i * h, r.width, h) });
        });
      });
      return profileCache[key];
    }
    function updateProfile(node) {
      var frames = node.__profileFrames;
      if (!frames) return;
      var index = Math.max(0, Math.min(frames.length - 1, node.__frameWanted || 0));
      var strips = frames[index], n = strips.length;
      var w = strips[0].frame.width, h = strips[0].frame.height * n;
      node.children.forEach(function (child, i) {
        child.texture = strips[i];
        child.scale.set(node.__profileScales[i], 1);
        child.x = -w * node.__anchorX * node.__profileScales[i];
        child.y = h * (i / n - node.__anchorY);
        child.tint = node.__profileTint;
      });
    }
    function sheetKey(spec) { return spec.assetUrl + '|' + spec.sheet.columns + 'x' + spec.sheet.rows; }
    function buildFrames(spec, baseTex) {
      var key = sheetKey(spec);
      if (sheetCache[key]) return sheetCache[key];
      var cols = spec.sheet.columns, rows = spec.sheet.rows;
      var src = baseTex.source;
      /* 用 frame 的寬高而不是 source 的：素材若本身就是某張圖的一部分
         （atlas），source 是整張大圖，切出來會整個歪掉。 */
      var fw = baseTex.frame.width / cols;
      var fh = baseTex.frame.height / rows;
      var ox = baseTex.frame.x, oy = baseTex.frame.y;
      var list = [];
      for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) {
          list.push(new PixiLib.Texture({
            source: src,
            frame: new PixiLib.Rectangle(ox + c * fw, oy + r * fh, fw, fh)
          }));
        }
      }
      sheetCache[key] = list;
      return list;
    }


    // Dynamic surfaces contain one current procedural sample, never a frame atlas.
    // Share equal samples across simultaneous fields; recycle unused surfaces.
    var generatedCache = new Map(), surfacePool = [];
    function canvas() { var c = opts.canvasFactory ? opts.canvasFactory() : document.createElement('canvas'); c.width = 320; c.height = 320; return c; }
    function paintCommands(ctx, commands) {
      commands.forEach(function (c) {
        var color = c.color; ctx.fillStyle = ctx.strokeStyle = 'rgba(' + color.slice(0, 3).map(function (v) { return Math.round(Math.max(0, Math.min(255, v))); }).join(',') + ',' + Math.max(0, Math.min(1, color[3] / 255)) + ')';
        ctx.beginPath();
        if (c.ellipse) ctx.ellipse(c.ellipse[0], c.ellipse[1], c.ellipse[2], c.ellipse[3], 0, 0, Math.PI * 2);
        else { c.points.forEach(function (pt, i) { if (i) ctx.lineTo(pt[0], pt[1]); else ctx.moveTo(pt[0], pt[1]); }); }
        if (c.line) { ctx.lineWidth = c.line; ctx.stroke(); } else { ctx.closePath(); ctx.fill(); }
      });
    }
    function raster(surface, sample) {
      var ctx = surface.canvas.getContext('2d'); ctx.resetTransform(); ctx.clearRect(0, 0, 320, 320);
      if (sample.pixels) { var img = ctx.createImageData(320, 320); img.data.set(sample.pixels); ctx.putImageData(img, 0, 0); }
      if (sample.commands.length) {
        ctx.save(); ctx.scale(.5, .5); paintCommands(ctx, sample.commands); ctx.restore();
      }
      var groups = sample.groups;
      if (sample.blur) groups = [{ source: surface.canvas, blur: sample.blur, alpha: 1 }];
      if (groups) {
        var temp = surface.temp, tc = temp.getContext('2d');
        groups.forEach(function (g, index) {
          tc.resetTransform(); tc.clearRect(0, 0, 320, 320);
          if (g.source) tc.drawImage(g.source, 0, 0);
          else { tc.save(); tc.scale(.5, .5); paintCommands(tc, g.commands); tc.restore(); }
          if (index === 0) ctx.clearRect(0, 0, 320, 320);
          ctx.save(); ctx.filter = 'blur(' + g.blur / 2 + 'px)'; ctx.globalAlpha = g.alpha;
          ctx.globalCompositeOperation = groups.length > 1 ? 'lighter' : 'source-over'; ctx.drawImage(temp, 0, 0); ctx.restore();
        });
      }
      surface.texture.source.update();
    }
    function releaseGenerated(node) {
      var entry = node.__generatedEntry;
      if (!entry) return;
      entry.refs--; node.__generatedEntry = null;
      if (!entry.refs) { generatedCache.delete(entry.key); surfacePool.push(entry); }
    }
    function bindGenerated(node, sample) {
      if (!sample || (node.__generatedEntry && node.__generatedEntry.key === sample.key)) return;
      releaseGenerated(node);
      var entry = generatedCache.get(sample.key);
      if (!entry) {
        entry = surfacePool.pop();
        if (!entry) {
          var c = canvas(), tex = PixiLib.Texture.from(c);
          entry = { canvas: c, temp: canvas(), texture: tex, refs: 0, strips: [] };
          for (var i = 0; i < 64; i++) entry.strips.push(new PixiLib.Texture({ source: tex.source, frame: new PixiLib.Rectangle(0, i * 5, 320, 5) }));
        }
        entry.key = sample.key; raster(entry, sample); generatedCache.set(sample.key, entry);
      }
      entry.refs++; node.__generatedEntry = entry; node.__profileFrames = node.__flatGenerated ? [[entry.texture]] : [entry.strips]; node.__frameWanted = 0;
    }

    function createNode(spec) {
      var node;
      if (spec.kind === 'profiled' || spec.kind === 'generated') {
        node = new PixiLib.Container();
        node.__profileScales = spec.profileScales ? spec.profileScales.slice() : Array(64).fill(1);
        node.__flatGenerated = spec.kind === 'generated' && node.__profileScales.every(function (s) { return s === node.__profileScales[0]; });
        if (node.__flatGenerated) node.__profileScales = [node.__profileScales[0]];
        node.__generated = spec.kind === 'generated';
        node.__anchorX = 0.5; node.__anchorY = 0.5;
        node.__profileTint = 0xffffff;
        node.__profileScales.forEach(function () {
          var child = new PixiLib.Sprite(PixiLib.Texture.EMPTY);
          child.blendMode = BLEND_MAP[spec.blendMode] || 'normal';
          node.addChild(child);
        });
      } else if (spec.kind === 'tiled') {
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
      if (spec.kind === 'generated') return node;
      getTexture(spec.assetUrl, function (tex) {
        if (node.destroyed) return;
        if (spec.kind === 'profiled') {
          node.__profileFrames = buildProfileFrames(spec, tex);
          updateProfile(node);
        } else if (spec.sheet) {
          node.__frames = buildFrames(spec, tex);
          /* 貼圖是非同步載入的，這期間 updateNode 已經跑過好幾幀了——
             把最後收到的幀號補上，否則會停在第 0 格直到下一次更新。 */
          node.texture = node.__frames[Math.min(node.__frameWanted || 0, node.__frames.length - 1)];
        } else {
          node.texture = tex;
        }
      });
      return node;
    }

    function updateNode(node, t) {
      if (!t) return;
      if (t.visible === false) { node.visible = false; detachDepth(node); return; }
      node.visible = true;
      assignDepth(node, t);
      if (node.__generated) bindGenerated(node, t.generated);
      if (t.frame !== undefined) {
        node.__frameWanted = t.frame;
        var fr = node.__frames;
        if (fr && fr.length) {
          var want = fr[t.frame < 0 ? 0 : (t.frame >= fr.length ? fr.length - 1 : t.frame)];
          if (node.texture !== want) node.texture = want;
        }
      }
      if (t.x !== undefined) node.x = t.x;
      if (t.y !== undefined) node.y = t.y;
      if (t.rotation !== undefined) node.rotation = t.rotation;
      if (node.skew) node.skew.set(t.skewX || 0, 0);
      if (t.scaleX !== undefined) node.scale.set(t.scaleX, t.scaleY);
      if (t.alpha !== undefined) node.alpha = t.alpha;
      if (t.tint !== undefined && !node.__profileScales) node.tint = t.tint;
      if (t.zIndex !== undefined) node.zIndex = t.zIndex;
      if (node.anchor && t.anchorX !== undefined) node.anchor.set(t.anchorX, t.anchorY);
      if (node.__profileScales) {
        if (t.anchorX !== undefined) { node.__anchorX = t.anchorX; node.__anchorY = t.anchorY; }
        if (t.tint !== undefined) node.__profileTint = t.tint;
        updateProfile(node);
      }
      if (t.width !== undefined) node.width = t.width;
      if (t.height !== undefined) node.height = t.height;
      if (t.tileX !== undefined && node.tilePosition) {
        node.tilePosition.set(t.tileX * (node.texture.width || 1), t.tileY * (node.texture.height || 1));
      }
    }

    function destroyNode(node) {
      detachDepth(node);
      releaseGenerated(node);
      if (node.parent) node.parent.removeChild(node);
      /* 切好的 Texture 是整個 backend 共用的（sheetCache），不能跟著單一節點
         被銷毀——只把節點對它的指向拿掉。實際釋放在 destroy() 一次做完。 */
      node.__frames = null;
      node.__profileFrames = null;
      node.destroy({ children: true });
    }

    /* 貼圖是 GPU 資源，只清本地 cache 不夠——Pixi 的全域 Assets 仍持有它們。
       Backend 收攤時把自己載入過的 URL 一併卸載，避免反覆重建 Editor 時累積。 */
    function unloadTextures() {
      var urls = Object.keys(entries);
      entries = Object.create(null);
      urls.forEach(function (url) { releaseTexture(PixiLib, url); });
      /* 切好的每一格 Texture 只是同一個 TextureSource 上的一個矩形，
         銷毀它們不會動到 source（那由上面的 releaseTexture 管），
         但這些 Texture 物件本身要收掉，否則重開 Editor 會一直累積。 */
      Object.keys(sheetCache).forEach(function (k) {
        sheetCache[k].forEach(function (tex) { tex.destroy(false); });
      });
      sheetCache = Object.create(null);
      var surfaces = Array.from(generatedCache.values()).concat(surfacePool);
      surfaces.forEach(function (entry) { entry.strips.forEach(function (tex) { tex.destroy(false); }); entry.texture.destroy(true); });
      generatedCache.clear(); surfacePool = [];
      Object.keys(profileCache).forEach(function (k) {
        profileCache[k].forEach(function (frame) { frame.forEach(function (tex) { tex.destroy(false); }); });
      });
      profileCache = Object.create(null);
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
        depthGroups.forEach(function (group) { group.removeChildren(); group.destroy(); }); depthGroups.clear();
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
