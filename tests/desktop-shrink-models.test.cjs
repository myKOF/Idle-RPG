'use strict';
/* 打包時縮模型貼圖（tools/desktop/shrink_models.cjs）。實際縮圖要在 Electron 裡跑（nativeImage），
   這裡守的是不靠 Electron 也能驗的部分：
   1. GLB 重寫：換掉圖片的 bufferView 後，其他資料（網格、動畫）一個位元組都不能動，偏移要 4 位元組對齊
   2. 用途判斷：需要透明的底色貼圖維持 PNG、法線貼圖用較高品質
   3. 暫存區是原始碼的硬連結：取代檔案一定要先 unlink 再 rename，否則會改到專案裡的原檔
   4. 打包預設會縮，--full-textures 才出原尺寸 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../tools/desktop/shrink_models.cjs');

const root = path.resolve(__dirname, '..');
const SAMPLE = path.join(root, 'images', 'models', 'hero3d', 'sunbrand-knight.glb');

function viewBytes(g, i) {
  const v = g.json.bufferViews[i];
  return g.bin.slice(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength);
}

test('GLB 原樣重寫：JSON 與每個 bufferView 的內容不變', () => {
  const src = fs.readFileSync(SAMPLE);
  const a = S.parseGlb(src);
  const out = S.writeGlb(JSON.parse(JSON.stringify(a.json)), a.bin, null);
  const b = S.parseGlb(out);
  assert.equal(out.readUInt32LE(8), out.length, '檔頭的總長度要等於實際長度');
  assert.equal(b.json.bufferViews.length, a.json.bufferViews.length);
  a.json.bufferViews.forEach((v, i) => assert.ok(viewBytes(a, i).equals(viewBytes(b, i)), 'bufferView ' + i));
  assert.deepEqual(b.json.accessors, a.json.accessors);
});

test('GLB 換掉一張圖：其他 bufferView 原樣保留、偏移 4 位元組對齊、buffer 長度一致', () => {
  const src = fs.readFileSync(SAMPLE);
  const a = S.parseGlb(src);
  const json = JSON.parse(JSON.stringify(a.json));
  // 造一個圖片 bufferView：沒有圖就拿第一個 bufferView 當替換對象（只測重排）
  const target = (json.images || []).find((im) => im.bufferView != null);
  const idx = target ? target.bufferView : 0;
  const fake = Buffer.from('not-really-a-jpeg-but-odd-length!');   // 奇數長度，逼出對齊補零
  const out = S.writeGlb(json, a.bin, { [idx]: fake });
  const b = S.parseGlb(out);
  assert.equal(out.readUInt32LE(8), out.length);
  assert.ok(viewBytes(b, idx).equals(fake));
  a.json.bufferViews.forEach((v, i) => {
    if (i === idx) return;
    assert.ok(viewBytes(a, i).equals(viewBytes(b, i)), 'bufferView ' + i + ' 內容被改到');
    assert.equal(b.json.bufferViews[i].byteOffset % 4, 0, 'bufferView ' + i + ' 沒有對齊');
  });
  assert.equal(b.json.buffers[0].byteLength <= b.bin.length, true);
  assert.equal(b.bin.length % 4, 0);
});

test('用途判斷：BLEND／MASK 的底色貼圖要保留透明；法線貼圖另外標記', () => {
  const json = {
    textures: [{ source: 0 }, { source: 1 }, { source: 2 }, { source: 3 }],
    materials: [
      { pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicRoughnessTexture: { index: 2 } }, normalTexture: { index: 1 } },
      { alphaMode: 'BLEND', pbrMetallicRoughness: { baseColorTexture: { index: 3 } } }
    ]
  };
  const r = S.imageRoles(json);
  assert.equal(r[0].needsAlpha, false, 'OPAQUE 的底色貼圖可以轉 JPEG');
  assert.equal(r[1].normal, true);
  assert.equal(r[1].other, false);
  assert.equal(r[2].needsAlpha, false);
  assert.equal(r[3].needsAlpha, true, '半透明材質的底色貼圖不能轉 JPEG');
});

test('縮圖尺寸：最長邊到 1024、等比；本來就小的不放大', () => {
  assert.deepEqual(S.targetSize(2048, 2048, 1024), { width: 1024, height: 1024, resized: true });
  assert.deepEqual(S.targetSize(4096, 1024, 1024), { width: 1024, height: 256, resized: true });
  assert.deepEqual(S.targetSize(512, 512, 1024), { width: 512, height: 512, resized: false });
});

test('硬連結安全：取代暫存區檔案時先 unlink 再 rename；打包預設會縮、可用 --full-textures 關掉', () => {
  const tool = fs.readFileSync(path.join(root, 'tools', 'desktop', 'shrink_models.cjs'), 'utf8');
  const body = /function replaceFile\(dst, data\) \{([\s\S]*?)\n\}/.exec(tool)[1];
  assert.ok(body.indexOf('fs.unlinkSync(dst)') >= 0 && body.indexOf('fs.unlinkSync(dst)') < body.indexOf('fs.renameSync(tmp, dst)'));
  assert.doesNotMatch(body, /fs\.writeFileSync\(dst/, '不能直接寫 dst（硬連結會連原檔一起改）');
  assert.match(tool, /process\.type === 'browser'/, '主流程要在 Electron 主行程才跑（require.main 判斷在 Electron 不成立，會掛住）');
  const build = fs.readFileSync(path.join(root, 'tools', 'desktop', 'build_desktop.cjs'), 'utf8');
  assert.match(build, /if \(!stageOnly && process\.argv\.indexOf\('--full-textures'\) < 0\) \{\s*var shrunk = shrinkModels\(\);/);
  assert.equal(require('../tools/desktop/ship-rules.cjs').classify('tools/desktop/shrink_models.cjs').ship, false);
});
