"""打包時把 PNG 換成 WebP 內容（檔名不變）。由 tools/desktop/build_desktop.cjs 呼叫，只改暫存區那一份。

  python -I tools/desktop/webp_images.py <暫存區根目錄> <快取資料夾> <報告 JSON>

---- 為什麼檔名不變 ----
程式、配置表（Excel／CSV）、VFX Preset、runtime-assets.json 裡的圖片路徑全部寫 .png，而且 images/vfx/assets
會被 VFX 編輯器整棵換新——改副檔名要動上千處、還會被下一次匯出蓋回去。桌面版的 app:// 協議改成看檔頭回報
MIME（electron/app-protocol.cjs sniffImageMime），檔名照舊、內容是 WebP，網頁版完全不受影響。

---- 規則 ----
- images/sprites/**：角色序列幀是像素風、以最近鄰放大（js/battle-renderer.js loadSheet），用「無損」WebP，像素完全一致。
- 其他：有損 WebP 品質 90；透明度一律無損（alpha_quality=100），透明區底下的顏色保留（exact）。
  實測取樣：348 MB 的 PNG → 約 61 MB，畫面看不出差別。
- 不處理：electron/（exe 圖示）、images/models/（由 shrink_models.cjs 處理）。
- 省不到 10% 或 2 KB 的保留原 PNG。

---- 暫存區是原始碼的硬連結 ----
寫暫存檔 → unlink 原路徑 → rename；直接寫會改到專案裡的原檔。

---- 快取 ----
以「原檔 SHA-1＋規則版本」為鍵存在快取資料夾，沒改過的圖第二次打包直接取用。 """
import hashlib
import io
import json
import os
import sys
from concurrent.futures import ProcessPoolExecutor

from PIL import Image

RULES_VERSION = 'v2-lossy90-alpha100-exact-sprites-small256-lossless'
QUALITY = 90
LOSSLESS_MAX_SIDE = 256   # 小圖（介面圖示、寶石、成就）用無損：有損 WebP 的色度減半會在高飽和邊緣出色邊（128 圖示實測 PSNR 25 dB），小圖也省不了多少
MIN_SAVING_RATIO = 0.10
MIN_SAVING_BYTES = 2048
SKIP_PREFIXES = ('electron/', 'images/models/')
LOSSLESS_PREFIXES = ('images/sprites/',)


def is_lossless(rel):
    return rel.startswith(LOSSLESS_PREFIXES)


def webp_is_lossless(b):
    """逐一看 RIFF 區塊：有 VP8L 就是無損；VP8（含 ALPH）是有損。不是 WebP 回 None。"""
    if len(b) < 16 or b[:4] != b'RIFF' or b[8:12] != b'WEBP':
        return None
    off = 12
    while off + 8 <= len(b):
        tag = b[off:off + 4]
        size = int.from_bytes(b[off + 4:off + 8], 'little')
        if tag == b'VP8L':
            return True
        if tag == b'VP8 ':
            return False
        off += 8 + size + (size & 1)
    return None


def encode(src_bytes, lossless):
    im = Image.open(io.BytesIO(src_bytes))
    im.load()
    lossless = lossless or max(im.size) <= LOSSLESS_MAX_SIDE
    has_alpha = im.mode in ('RGBA', 'LA', 'PA') or (im.mode == 'P' and 'transparency' in im.info)
    im = im.convert('RGBA' if has_alpha else 'RGB')
    out = io.BytesIO()
    if lossless:
        im.save(out, 'WEBP', lossless=True, quality=100, method=5, exact=True)
    else:
        im.save(out, 'WEBP', quality=QUALITY, alpha_quality=100, method=5, exact=True)
    return out.getvalue(), lossless


def process(args):
    path, rel, cache_dir = args
    with open(path, 'rb') as f:
        src = f.read()
    lossless = is_lossless(rel)
    # 快取鍵含路徑類別（序列幀一律無損），同一張圖放在不同資料夾不會拿錯
    key = hashlib.sha1(RULES_VERSION.encode() + (b'L' if lossless else b'-') + src).hexdigest()
    cached = os.path.join(cache_dir, key + '.bin')
    if os.path.exists(cached):
        with open(cached, 'rb') as f:
            out = f.read()
        hit = True
        lossless = webp_is_lossless(out)
    else:
        try:
            out, lossless = encode(src, lossless)
        except Exception as e:  # 解不開的檔（損毀、非 PNG）保留原檔
            return {'file': rel, 'before': len(src), 'after': len(src), 'kept': 'error: %s' % e}
        if len(src) - len(out) < max(MIN_SAVING_BYTES, len(src) * MIN_SAVING_RATIO):
            out = src
        tmp = cached + '.%d.tmp' % os.getpid()
        with open(tmp, 'wb') as f:
            f.write(out)
        os.replace(tmp, cached)
        hit = False
    entry = {'file': rel, 'before': len(src), 'after': len(out), 'lossless': lossless, 'cacheHit': hit}
    if out is src or out == src:
        entry['kept'] = 'saving too small'
        entry['after'] = len(src)
        return entry
    tmp = path + '.webp-tmp'
    with open(tmp, 'wb') as f:
        f.write(out)
    os.unlink(path)       # 斷開硬連結（不動原始檔）
    os.rename(tmp, path)
    return entry


def main():
    stage, cache_dir, report_file = (os.path.abspath(a) for a in sys.argv[1:4])
    os.makedirs(cache_dir, exist_ok=True)
    jobs = []
    for dp, dn, fn in os.walk(stage):
        for name in fn:
            if not name.lower().endswith('.png'):
                continue
            p = os.path.join(dp, name)
            rel = os.path.relpath(p, stage).replace('\\', '/')
            if rel.startswith(SKIP_PREFIXES):
                continue
            jobs.append((p, rel, cache_dir))
    with ProcessPoolExecutor(max_workers=max(1, (os.cpu_count() or 2) - 1)) as ex:
        results = list(ex.map(process, jobs, chunksize=8))
    report = {
        'rules': RULES_VERSION,
        'files': results,
        'beforeBytes': sum(r['before'] for r in results),
        'afterBytes': sum(r['after'] for r in results),
        'converted': sum(1 for r in results if 'kept' not in r),
        'kept': sum(1 for r in results if 'kept' in r),
        'errors': [r for r in results if str(r.get('kept', '')).startswith('error')],
        'cacheHits': sum(1 for r in results if r.get('cacheHit')),
    }
    with open(report_file, 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=1)
    print('PNG → WebP：%d 個轉換、%d 個保留，%.1f → %.1f MB（快取命中 %d）' % (
        report['converted'], report['kept'], report['beforeBytes'] / 1048576, report['afterBytes'] / 1048576, report['cacheHits']))
    if report['errors']:
        print('解不開而保留原檔：%d 個（例：%s）' % (len(report['errors']), report['errors'][0]['file']))


if __name__ == '__main__':
    main()
