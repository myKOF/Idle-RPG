/* ============================================================
   spine-ref.js — VFX Editor 的「Spine 參考」面板

   用途只有一個：**把買來的 Spine 特效播出來看**，作為自己用 preset
   重做時的參照。所以這裡沒有任何編輯功能，也刻意不做——
   它不是第二套特效系統，是一張會動的參考圖。

   ⚠️ Spine 的 runtime 不進遊戲。它放在 tools/spine/vendor/，只有這個面板
      會載，而且是**按下按鈕才載**（194～227 KB，不該在每次開編輯器時付這個成本）。
      index.html 從頭到尾沒有它的 script 標籤，所以絕不可能隨遊戲出貨。
      這個分界是刻意的：Spine runtime 的授權綁編輯器授權，
      「本機看一下」與「放進產品」是兩件不同的事。

   為什麼不用官方的資源載入流程（PIXI.Assets ＋ 別名）：
   素材會散在硬碟各處（下載資料夾、素材庫…），不在伺服器根目錄底下。
   所以走「選整個資料夾 → 用 File 物件自己組裝」：
     TextureAtlas(文字) → 逐頁 setTexture → AtlasAttachmentLoader
     → SkeletonJson/Binary.readSkeletonData → new spine.Spine(data)
   這些類別 iife 版全部有匯出，不需要打包工具（本專案是零建置）。
   ============================================================ */
(function () {
  'use strict';

  /* runtime 版本必須與匯出素材的編輯器版本相符，4.1／4.2／4.3 的檔案格式
     互不相容。版本就寫在檔案裡，所以不必問人——見 readVersion。
     官方的 spine-pixi-v8 只出 4.2 與 4.3。 */
  var SUPPORTED = ['4.2', '4.3'];
  var RUNTIME_URL = '/tools/spine/vendor/spine-pixi-v8-{v}.min.js';

  var loadedRuntime = null;     // 已載入哪一版（一頁只能載一版）
  var app = null;               // 這個面板自己的 Pixi Application
  var current = null;           // 目前顯示的 Spine 物件
  var bundles = [];
  var els = {};

  function $(id) { return document.getElementById(id); }

  function setStatus(text, cls) {
    if (!els.status) return;
    els.status.textContent = text || '';
    els.status.className = 'spine-status' + (cls ? ' ' + cls : '');
  }

  /* ---------------- 版本偵測 ---------------- */

  function versionOfJson(text) {
    try {
      var j = JSON.parse(text);
      return (j && j.skeleton && j.skeleton.spine) || null;
    } catch (e) { return null; }
  }

  /* 二進位標頭的佈局 4.1 與 4.2 不同（前者 hash 是字串，後者是 8 byte），
     與其為兩種各寫一套解析（讀錯一個 varint 就整個歪掉），這裡在開頭
     找「像版本號的 ASCII」。偵測器只要回答「幾版」，不必解出骨架。 */
  function versionOfSkel(buf) {
    var head = new Uint8Array(buf).subarray(0, 128);
    var s = '';
    for (var i = 0; i < head.length; i++) {
      s += (head[i] >= 32 && head[i] < 127) ? String.fromCharCode(head[i]) : ' ';
    }
    var m = s.match(/[34]\.\d+\.\d+[A-Za-z0-9.\-]*/);
    return m ? m[0] : null;
  }

  function loadRuntime(major) {
    if (loadedRuntime === major) return Promise.resolve();
    if (loadedRuntime) {
      return Promise.reject(new Error(
        '這一頁已經載入 Spine ' + loadedRuntime + ' 的 runtime，沒辦法同時載 ' + major +
        '。混版的素材要分批看：重新整理編輯器後再選另一批。'));
    }
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = RUNTIME_URL.replace('{v}', major);
      s.onload = function () { loadedRuntime = major; res(); };
      s.onerror = function () { rej(new Error('載不到 ' + s.src)); };
      document.head.appendChild(s);
    });
  }

  /* ---------------- 檔案分組 ----------------
     一份 Spine 特效是三個檔：骨架 ＋ atlas ＋ 圖集頁。使用者丟進來的是
     整個資料夾（可能幾十份），所以照「同一層目錄」分組。 */
  function groupFiles(files) {
    var byDir = {};
    files.forEach(function (f) {
      var p = f.webkitRelativePath || f.name;
      var dir = p.slice(0, p.lastIndexOf('/') + 1);
      (byDir[dir] = byDir[dir] || []).push({ f: f, name: p.slice(p.lastIndexOf('/') + 1) });
    });
    var out = [];
    Object.keys(byDir).forEach(function (dir) {
      var items = byDir[dir];
      var atlases = items.filter(function (i) { return /\.atlas(\.txt)?$/i.test(i.name); });
      var skels = items.filter(function (i) { return /\.(skel|json)$/i.test(i.name); });
      var imgs = {};
      items.forEach(function (i) {
        if (/\.(png|jpe?g|webp)$/i.test(i.name)) imgs[i.name.toLowerCase()] = i;
      });
      if (!atlases.length || !skels.length) return;
      skels.forEach(function (sk) {
        var stem = sk.name.replace(/\.(skel|json)$/i, '');
        var at = null;
        for (var k = 0; k < atlases.length; k++) {
          if (atlases[k].name.indexOf(stem) === 0) { at = atlases[k]; break; }
        }
        out.push({
          dir: dir, skel: sk, atlas: at || atlases[0], imgs: imgs,
          binary: /\.skel$/i.test(sk.name)
        });
      });
    });
    return out;
  }

  function readText(f) { return f.text ? f.text() : new Response(f).text(); }

  /* ---------------- Pixi ---------------- */

  /* ⚠️ Pixi 的 renderer 是**建構時**照當下註冊的 extension 組出來的，
     而 spine runtime 是在載入時才把自己的 render pipe 註冊進去。
     所以順序不能反：先載 runtime，再 new Application。
     反過來的話 renderer 裡沒有 spine 那條管線，畫的時候會炸在
     「Cannot read properties of undefined (reading 'addRenderable')」——
     那個錯誤訊息完全看不出是順序問題，所以這裡寫下來。 */
  function ensureApp() {
    if (app) return Promise.resolve();
    if (!window.spine) return Promise.reject(new Error('runtime 還沒載，不能建 renderer'));
    app = new PIXI.Application();
    return app.init({
      background: 0x14161c, antialias: true,
      width: els.host.clientWidth || 640, height: els.host.clientHeight || 420
    }).then(function () {
      els.host.appendChild(app.canvas);
    });
  }

  function layout() {
    if (!current || !app) return;
    current.x = app.renderer.width / 2;
    current.y = app.renderer.height * 0.62;
    current.scale.set(parseFloat(els.scale.value));
  }

  /* ---------------- 載入一份骨架 ---------------- */

  function loadBundle(b) {
    setStatus('讀取 ' + b.skel.name + ' …');
    var isBin = b.binary;
    var readSkel = isBin ? b.skel.f.arrayBuffer() : readText(b.skel.f);
    var skelData;
    return readSkel.then(function (d) {
      skelData = d;
      var ver = isBin ? versionOfSkel(d) : versionOfJson(d);
      if (!ver) throw new Error(b.skel.name + '：讀不出 Spine 版本，可能不是骨架檔');
      var major = ver.split('.').slice(0, 2).join('.');
      if (SUPPORTED.indexOf(major) < 0) {
        throw new Error('這份是 Spine ' + ver + '。官方的 spine-pixi-v8 只出 ' +
          SUPPORTED.join(' 與 ') + '，要看的話得先用 Spine 編輯器重新匯出。');
      }
      b.version = ver;
      return loadRuntime(major);
    }).then(function () {
      return ensureApp();               // 一定要在 runtime 之後，見 ensureApp 的說明
    }).then(function () {
      return readText(b.atlas.f);
    }).then(function (atlasText) {
      var atlas = new spine.TextureAtlas(atlasText);
      /* 逐頁把圖綁上去。atlas 只寫檔名，圖是使用者選進來的 File，
         所以用 object URL 讓瀏覽器解碼，再交給 Pixi。 */
      var chain = Promise.resolve();
      atlas.pages.forEach(function (page) {
        chain = chain.then(function () {
          var item = b.imgs[page.name.toLowerCase()];
          if (!item) throw new Error('atlas 指名的圖集頁不在資料夾裡：' + page.name);
          /* 用 createImageBitmap 而不是 <img> + decode()：
             decode() 的完成與「瀏覽器有沒有在畫這一頁」有關，分頁在背景時
             它可能永遠不 resolve，整條載入鏈就停在那裡不動也不報錯。
             createImageBitmap 直接從 Blob 解碼，與渲染無關。 */
          return createImageBitmap(item.f).then(function (bmp) {
            var tex = PIXI.Texture.from(bmp);
            page.setTexture(spine.SpineTexture.from(tex.source));
          });
        });
      });
      return chain.then(function () { return atlas; });
    }).then(function (atlas) {
      var loader = new spine.AtlasAttachmentLoader(atlas);
      var parser = b.binary ? new spine.SkeletonBinary(loader) : new spine.SkeletonJson(loader);
      var data = parser.readSkeletonData(
        b.binary ? new Uint8Array(skelData) : JSON.parse(skelData));

      if (current) { current.destroy(); current = null; }
      current = new spine.Spine(data);
      app.stage.addChild(current);
      layout();

      renderAnims(data.animations);
      var vram = atlas.pages.reduce(function (s, p) { return s + p.width * p.height * 4; }, 0);
      els.info.textContent =
        'Spine ' + b.version + (b.binary ? '（.skel）' : '（.json）') +
        '　骨 ' + data.bones.length + '　slot ' + data.slots.length +
        '　skin ' + data.skins.length + '\n' +
        'atlas ' + atlas.pages.length + ' page（' +
        atlas.pages.map(function (p) { return p.width + 'x' + p.height; }).join('、') + '）' +
        '　VRAM 約 ' + (vram / 1048576).toFixed(1) + ' MB\n' +
        '動畫 ' + data.animations.length + ' 段';
      if (data.animations.length) play(data.animations[0].name);
      setStatus('已載入 ' + b.skel.name);
    });
  }

  function play(name) {
    if (!current) return;
    current.state.setAnimation(0, name, els.loop.checked);
    current.state.timeScale = parseFloat(els.speed.value);
    current.__anim = name;
    Array.prototype.forEach.call(els.anims.children, function (btn) {
      btn.classList.toggle('on', btn.dataset.a === name);
    });
  }

  function renderAnims(animations) {
    els.anims.innerHTML = '';
    animations.forEach(function (a) {
      var b = document.createElement('button');
      b.textContent = a.name + '　' + a.duration.toFixed(2) + 's';
      b.dataset.a = a.name;
      b.onclick = function () { play(a.name); };
      els.anims.appendChild(b);
    });
  }

  function renderBundles() {
    els.list.innerHTML = '';
    bundles.forEach(function (b, i) {
      var btn = document.createElement('button');
      btn.textContent = (b.dir || '') + b.skel.name;
      btn.title = btn.textContent;
      btn.onclick = function () {
        Array.prototype.forEach.call(els.list.children, function (x) { x.classList.remove('on'); });
        btn.classList.add('on');
        loadBundle(b)['catch'](function (e) {
          setStatus(e.message, 'err');
          els.info.textContent = e.message;
        });
      };
      els.list.appendChild(btn);
    });
  }

  function take(files) {
    bundles = groupFiles(files);
    if (!bundles.length) {
      setStatus('這個資料夾裡找不到「骨架 ＋ atlas ＋ 圖集頁」的組合', 'err');
      els.list.innerHTML = '';
      return;
    }
    setStatus('找到 ' + bundles.length + ' 份骨架');
    renderBundles();
    els.list.children[0].classList.add('on');
    loadBundle(bundles[0])['catch'](function (e) {
      setStatus(e.message, 'err');
      els.info.textContent = e.message;
    });
  }

  /* ---------------- 逐格出圖 ----------------
     這是這個面板真正有用的地方。即時播放看一次就過去了；要照著重做，
     需要能停在每一格上比對形狀、顏色與時序——與 preset-render 的逐格出圖
     是同一個道理。

     ⚠️ 每一格**必須用同一個取景框**。第一版是逐格 extract 物件本身，
        Pixi 會裁到那一格自己的外接矩形，再縮放塞進格子裡——結果是每一格
        各自被縮到不同比例，看起來全部一樣大。那樣的圖沒辦法回答
        「這個爆炸長到多大」「什麼時候開始收」，而那正是要看它的原因。
        所以先掃一遍全部取樣點求出**聯集範圍**，再用那個固定框抽第二遍。 */
  function sampleTimes(anim, n) {
    var ts = [];
    for (var i = 0; i < n; i++) ts.push(anim.duration * (i + 0.5) / n);
    return ts;
  }

  /* 把姿勢設到指定時刻。

     ⚠️ 最後那一行必須是 current.update(0)——**Spine 物件自己的 update**，
        不是 skeleton 的。直接呼叫 state.apply + skeleton.updateWorldTransform
        會把骨頭擺對，但 render pipe 不知道有東西變了，於是不重建網格：
        實測十二格全部畫出同一個姿勢（都是最後一次擺的那個），
        而骨頭的頂點明明是 64 → 96 → 127。姿勢對、畫面錯，非常難查。
        Spine.update() 會順便把 _stateChanged 立起來，pipe 才會重建。

     delta 給 0：state.update(0) 不會推進 trackTime，所以上面設的時刻不會跑掉。 */
  function poseAt(name, t) {
    current.state.setAnimation(0, name, false);
    current.state.tracks[0].trackTime = t;
    current.update(0);
  }

  /* 回傳畫好的 canvas，存檔是另一段。分開的理由是「畫得對不對」與
     「有沒有下載成功」是兩件事，混在一起就只能靠下載資料夾驗證。 */
  function stripCanvas() {
    if (!current || !app) return null;
    var name = current.__anim;
    var anim = null;
    current.skeleton.data.animations.forEach(function (a) { if (a.name === name) anim = a; });
    if (!anim) return null;

    var n = parseInt(els.frames.value, 10);
    var cell = parseInt(els.cell.value, 10);
    var times = sampleTimes(anim, n);
    var wasAuto = current.autoUpdate;
    current.autoUpdate = false;

    /* 第一遍：求聯集取景框（螢幕座標）。

       ⚠️ 不能用 current.getBounds()。spine-pixi 的 Spine 物件是用
          boundsProvider 給邊界的，預設那個算的是**設定姿勢**，
          與當下播到哪一格無關——實測一段 1→2 倍的放大動畫，
          getBounds() 從頭到尾都回 78x78。拿它求聯集等於什麼都沒量。
          skeleton.getBounds() 才是照當下姿勢的頂點算的（同一段量到
          64 → 96 → 127）。

       骨架空間 y 軸向上、Pixi 向下，所以換算時 y 要翻。 */
    var off = new spine.Vector2(), size = new spine.Vector2();
    var sx = current.scale.x, sy = current.scale.y;
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    times.forEach(function (t) {
      poseAt(name, t);
      current.skeleton.getBounds(off, size);
      if (!isFinite(size.x) || !isFinite(size.y) || size.x <= 0) return;
      var l = current.x + sx * off.x;
      var r = current.x + sx * (off.x + size.x);
      var b2 = current.y - sy * off.y;                  // 骨架 y 小 → 螢幕 y 大
      var t2 = current.y - sy * (off.y + size.y);
      x0 = Math.min(x0, l, r); x1 = Math.max(x1, l, r);
      y0 = Math.min(y0, t2, b2); y1 = Math.max(y1, t2, b2);
    });
    if (!isFinite(x0) || x1 <= x0) { current.autoUpdate = wasAuto; return null; }
    var pad = 6;
    x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
    /* 取正方形取景框：格子是正方形，用非正方框會在縮放時被壓扁 */
    var side = Math.max(x1 - x0, y1 - y0);
    var cxm = (x0 + x1) / 2, cym = (y0 + y1) / 2;
    var frame = new PIXI.Rectangle(cxm - side / 2, cym - side / 2, side, side);

    var cols = Math.min(n, 6), rows = Math.ceil(n / cols);
    var gap = 4, labelH = 12;
    var W = cols * (cell + gap) + gap, H = rows * (cell + gap + labelH) + gap;
    var out = document.createElement('canvas');
    out.width = W; out.height = H;
    var g = out.getContext('2d');
    /* 棋盤底：透明與淺色的畫要分得出來（與 contact-sheet.cjs 同一個理由） */
    for (var yy = 0; yy < H; yy += 8) {
      for (var xx = 0; xx < W; xx += 8) {
        g.fillStyle = ((xx >> 3) + (yy >> 3)) & 1 ? '#808080' : '#646464';
        g.fillRect(xx, yy, 8, 8);
      }
    }

    /* 第二遍：固定取景框逐格抽圖 */
    times.forEach(function (t, i) {
      poseAt(name, t);
      var src = app.renderer.extract.canvas({ target: app.stage, frame: frame });
      var cv = src.canvas || src;
      var cx = gap + (i % cols) * (cell + gap);
      var cy = gap + Math.floor(i / cols) * (cell + gap + labelH);
      if (cv.width && cv.height) g.drawImage(cv, cx, cy, cell, cell);
      var label = i + '　' + t.toFixed(2) + 's';
      g.font = '10px ui-monospace, monospace';
      g.fillStyle = '#000'; g.fillText(label, cx + 2, cy + cell + 10);
      g.fillStyle = '#fff'; g.fillText(label, cx + 1, cy + cell + 9);
    });

    current.autoUpdate = wasAuto;
    play(name);
    out.__anim = name;
    /* 取景框的邊長寫進來：逐格圖上所有格子共用同一個比例尺，
       想知道「畫面上實際多大」時要靠它換算。 */
    out.__frameSide = Math.round(side);
    return out;
  }

  function strip() {
    var out = stripCanvas();
    if (!out) return;
    out.toBlob(function (blob) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'spine-' + out.__anim + '.png';
      a.click();
    }, 'image/png');
  }

  /* ---------------- 開關 ---------------- */

  function open() {
    els.panel.hidden = false;
    /* 這裡不建 renderer：要等知道是哪一版、runtime 載進來之後才能建。 */
    layout();
  }
  function close() {
    els.panel.hidden = true;
    /* 不銷毀 app 與已載入的骨架：關掉再開通常是同一批素材，
       重建的成本沒有必要付。 */
    if (current) current.state.timeScale = 0;
  }

  function init() {
    els.panel = $('spine-ref');
    if (!els.panel) return;                 // 舊版 index.html：靜靜不做事
    els.host = $('spine-host');
    els.list = $('spine-list');
    els.anims = $('spine-anims');
    els.info = $('spine-info');
    els.status = $('spine-status');
    els.scale = $('spine-scale');
    els.speed = $('spine-speed');
    els.loop = $('spine-loop');
    els.frames = $('spine-frames');
    els.cell = $('spine-cell');

    $('spine-open').onclick = open;
    $('spine-close').onclick = close;
    $('spine-pick').onchange = function (e) { take(Array.prototype.slice.call(e.target.files)); };
    $('spine-drop').onclick = function () { $('spine-pick').click(); };
    els.scale.oninput = function () {
      $('spine-scale-val').textContent = parseFloat(els.scale.value).toFixed(2);
      layout();
    };
    els.speed.onchange = function () { if (current) current.state.timeScale = parseFloat(els.speed.value); };
    els.loop.onchange = function () { if (current) play(current.__anim); };
    $('spine-strip').onclick = strip;

    els.panel.addEventListener('click', function (e) { if (e.target === els.panel) close(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !els.panel.hidden) close();
    });
  }

  /* 對外只露出開關與「吃一批 File」。編輯器其他模組也是這樣掛在 window 上
     （VFXLayoutSchema 等）。露出 take 是為了讓測試能直接餵檔案進來——
     webkitdirectory 的選檔對話框沒有辦法用程式驅動。 */
  window.SpineRef = {
    open: open, close: close, take: take, stripCanvas: stripCanvas,
    /* 目前顯示的那一份。露出來是為了排查——「動畫到底有沒有被套上去」
       這種問題不看骨頭的實際角度是講不清楚的。 */
    get current() { return current; }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
