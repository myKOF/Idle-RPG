'use strict';
/* 打包時 PNG 換成 WebP 內容、檔名不變（tools/desktop/webp_images.py＋electron/app-protocol.cjs）。
   1. 協議看檔頭回報 image/webp：只有 .png 需要看，真的 PNG 照副檔名
   2. 轉換工具的規則：不碰 exe 圖示與模型、序列幀與小圖無損、硬連結先 unlink 再 rename
   3. 打包預設會換，--keep-png 才出原本的 PNG
   有 Python＋Pillow 時另外實際轉一張，確認無損模式逐像素相同、真的是 WebP。 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const P = require('../electron/app-protocol.cjs');

const root = path.resolve(__dirname, '..');
const tool = fs.readFileSync(path.join(root, 'tools', 'desktop', 'webp_images.py'), 'utf8');

test('協議：.png 看檔頭，WebP 內容回 image/webp；真的 PNG、太短的檔照副檔名', () => {
  assert.equal(P.needsSniff('images/a.png'), true);
  assert.equal(P.needsSniff('images/a.PNG'), true);
  assert.equal(P.needsSniff('images/a.webp'), false);
  assert.equal(P.needsSniff('js/a.js'), false);
  const webp = Buffer.from('RIFF\x10\x00\x00\x00WEBPVP8 ', 'latin1');
  const png = Buffer.from('\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR', 'latin1');
  assert.equal(P.sniffImageMime(webp), 'image/webp');
  assert.equal(P.sniffImageMime(png), null);
  assert.equal(P.sniffImageMime(Buffer.from('RIFF')), null);
  assert.equal(P.sniffImageMime(null), null);
  const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
  assert.match(main, /AppProtocol\.needsSniff\(file\)/);
  assert.match(main, /AppProtocol\.sniffImageMime\(head\) \|\| AppProtocol\.mimeFor\(file\)/);
});

test('轉換規則：不碰 electron／images/models、序列幀與 256 以下小圖無損、硬連結安全', () => {
  assert.match(tool, /SKIP_PREFIXES = \('electron\/', 'images\/models\/'\)/);
  assert.match(tool, /LOSSLESS_PREFIXES = \('images\/sprites\/',\)/, '序列幀以最近鄰放大，必須逐像素相同');
  assert.match(tool, /LOSSLESS_MAX_SIDE = 256/);
  assert.match(tool, /alpha_quality=100/, '透明度一律無損（遮罩、覆蓋率判斷靠 alpha）');
  const body = /def process\(args\):([\s\S]*?)\n\n\ndef /.exec(tool)[1];
  const unlink = body.indexOf('os.unlink(path)'), rename = body.indexOf('os.rename(tmp, path)');
  assert.ok(unlink > 0 && unlink < rename, '要先 unlink（斷開硬連結）再 rename');
  assert.doesNotMatch(body, /open\(path, 'wb'\)/, '不能直接寫回原路徑（硬連結會改到專案原檔）');
  const build = fs.readFileSync(path.join(root, 'tools', 'desktop', 'build_desktop.cjs'), 'utf8');
  assert.match(build, /if \(!stageOnly && process\.argv\.indexOf\('--keep-png'\) < 0\) \{\s*var webp = webpImages\(\);/);
  assert.equal(require('../tools/desktop/ship-rules.cjs').classify('tools/desktop/webp_images.py').ship, false);
});

const hasPillow = spawnSync('python', ['-I', '-c', 'import PIL; from PIL import features; assert features.check("webp")'], { windowsHide: true }).status === 0;

test('實際轉換（需要 Python＋Pillow）：序列幀逐像素相同、大圖變成有損 WebP、electron/ 不動', { skip: !hasPillow && '沒有 Python／Pillow' }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'webp-test-'));
  try {
    const stage = path.join(tmp, 'stage');
    const write = (rel, script) => {
      const p = path.join(stage, rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      const r = spawnSync('python', ['-I', '-c', script, p], { windowsHide: true });
      assert.equal(r.status, 0, String(r.stderr));
    };
    // 序列幀：雜訊像素圖（無損要逐像素相同）；大圖：平滑漸層＋雜訊（有損）；electron 下的圖：不能動
    // 像素風：4×4 色塊、每塊隨機色與半透明（太單純的圖 PNG 本身就很小，省不到門檻會被保留成 PNG）
    const noise = 'import sys,random\nfrom PIL import Image\nrandom.seed(1)\nW,H=640,400\ncells={(cx,cy):(random.randrange(256),random.randrange(256),random.randrange(256),random.choice((0,128,255))) for cx in range(W//4) for cy in range(H//4)}\nim=Image.new("RGBA",(W,H))\nim.putdata([cells[(x//4,y//4)] for y in range(H) for x in range(W)])\nim.save(sys.argv[1])';
    // 大圖：漸層加細微雜訊（像手繪場景），PNG 很大、有損 WebP 能省很多
    const big = 'import sys,random\nfrom PIL import Image\nrandom.seed(2)\nim=Image.new("RGB",(600,400))\nim.putdata([(min(255,(x*255)//600+random.randrange(12)),min(255,(y*255)//400+random.randrange(12)),128) for y in range(400) for x in range(600)])\nim.save(sys.argv[1])';
    write('images/sprites/hero/walk.png', noise);
    write('images/scene/bg.png', big);
    write('electron/icons/app.png', big);
    const origSprite = fs.readFileSync(path.join(stage, 'images/sprites/hero/walk.png'));
    const origIcon = fs.readFileSync(path.join(stage, 'electron/icons/app.png'));
    const r = spawnSync('python', ['-I', path.join(root, 'tools/desktop/webp_images.py'), stage, path.join(tmp, 'cache'), path.join(tmp, 'report.json')],
      { windowsHide: true, env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' }) });
    assert.equal(r.status, 0, String(r.stderr));
    const sprite = fs.readFileSync(path.join(stage, 'images/sprites/hero/walk.png'));
    const scene = fs.readFileSync(path.join(stage, 'images/scene/bg.png'));
    assert.equal(sprite.toString('latin1', 8, 12), 'WEBP');
    assert.equal(scene.toString('latin1', 8, 12), 'WEBP');
    assert.ok(scene.includes(Buffer.from('VP8 ')), '大圖用有損');
    assert.ok(fs.readFileSync(path.join(stage, 'electron/icons/app.png')).equals(origIcon), 'electron/ 不能動');
    // 無損：解回來逐像素相同
    fs.writeFileSync(path.join(tmp, 'orig.png'), origSprite);
    const cmp = spawnSync('python', ['-I', '-c', 'import sys\nfrom PIL import Image, ImageChops\na=Image.open(sys.argv[1]).convert("RGBA");b=Image.open(sys.argv[2]).convert("RGBA")\nsys.exit(0 if ImageChops.difference(a,b).getbbox() is None else 3)',
      path.join(tmp, 'orig.png'), path.join(stage, 'images/sprites/hero/walk.png')], { windowsHide: true });
    assert.equal(cmp.status, 0, '序列幀轉完要逐像素相同');
    const report = JSON.parse(fs.readFileSync(path.join(tmp, 'report.json'), 'utf8'));
    assert.equal(report.errors.length, 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
