/* 戰場裝飾圖集的背景建造（2026-10）
   ============================================================
   程序化浮雕擺件要逐像素打光，一張圖集在主執行緒上要一兩百毫秒，單一大型擺件（石板地、拱門）
   就可能吃掉一整幀以上——換地圖或換階段帶時畫面會頓一下。這支 Worker 用 OffscreenCanvas 把整張圖集
   畫好，轉成 ImageBitmap 傳回主執行緒，主執行緒只剩上傳貼圖。

   畫法完全沿用 js/battle-decor.js 與 js/decor-sculpt.js（同一份程式碼，不是另一套）：
   那兩支只透過 document.createElement('canvas') 取得畫布，這裡把它換成 OffscreenCanvas 即可。

   訊息：主 → { id, kitKey, deep }；回 → { id, key, bitmap } 或 { id, key, error }。
   ⚠️ 改了 decor-sculpt.js 或 battle-decor.js 要一起更新下面 importScripts 的版本字串。 */
'use strict';

self.document = {
  createElement: function () { return new OffscreenCanvas(1, 1); }
};

importScripts('../decor-sculpt.js?v=1.0.0', '../battle-decor.js?v=1.0.7');

self.onmessage = function (e) {
  var m = e.data || {};
  var key = (m.kitKey || '') + (m.deep ? '#deep' : '');
  try {
    var plan = BattleDecor.buildAtlas(m.kitKey, !!m.deep);
    var bitmap = plan.canvas.transferToImageBitmap();
    self.postMessage({ id: m.id, key: plan.key, bitmap: bitmap }, [bitmap]);
  } catch (err) {
    self.postMessage({ id: m.id, key: key, error: String((err && err.message) || err) });
  }
};
