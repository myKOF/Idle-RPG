/* 戰場裝飾圖集的背景建造（2026-10）
   ============================================================
   程序化浮雕擺件要逐像素打光，一張圖集在主執行緒上要一兩百毫秒，單一大型擺件（石板地、拱門）
   就可能吃掉一整幀以上——換地圖或換階段帶時畫面會頓一下。這支 Worker 用 OffscreenCanvas 把整張圖集
   畫好，轉成 ImageBitmap 傳回主執行緒，主執行緒只剩上傳貼圖。

   畫法沿用 battle-decor／decor-sculpt／decor-nature（同一份程式碼）：
   圖集只透過 document.createElement('canvas') 取得畫布，這裡換成 OffscreenCanvas 即可。

   訊息：主 → { id, kitKey, deep }；回 → { id, key, bitmap } 或 { id, key, error }。
   ⚠️ 改了三支繪圖模組要一起更新下面 importScripts 的版本字串。 */
'use strict';

self.document = {
  createElement: function () { return new OffscreenCanvas(1, 1); }
};

importScripts('../decor-sculpt.js?v=1.0.0', '../decor-nature.js?v=1.0.6', '../battle-decor.js?v=1.0.16');

self.onmessage = async function (e) {
  var m = e.data || {};
  var key = (m.kitKey || '') + (m.deep ? '#deep' : '');
  try {
    await DecorNature.loadImages(new URL('../../',self.location.href).href);
    var plan = BattleDecor.buildAtlas(m.kitKey, !!m.deep);
    var bitmap = plan.canvas.transferToImageBitmap();
    self.postMessage({ id: m.id, key: plan.key, bitmap: bitmap }, [bitmap]);
  } catch (err) {
    self.postMessage({ id: m.id, key: key, error: String((err && err.message) || err) });
  }
};
