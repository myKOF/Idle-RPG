# -*- coding: utf-8 -*-
"""把 Aseprite 匯出的角色動畫打包成 battle-renderer 吃的序列幀資源。

Aseprite 匯出的形式是「一個動作一個檔」：
    SpriteSheets/<角色>-Idle.png   單列 N 格
    json/<角色>-Idle.json          每格的 duration（毫秒）

battle-renderer 要的是「一張圖、一個動作一列」：
    images/sprites/player.png + player.json

兩件事要在這裡對齊：

1. 幀率。Aseprite 給的是**逐格**時間（出手那兩格 75ms、其餘 100ms），
   而舊的 manifest 只有一個 fps。硬套單一 fps 會把出手的那兩格拖慢，
   打擊感就鈍了。所以 durations 照抄進 manifest——PIXI 的 AnimatedSprite
   本來就支援逐格時間（吃 {texture, time} 陣列），只是先前沒有用到。
   fps 仍然照算並寫進去，當作不支援 durations 時的退路。

2. 多個動作共用同一段素材。遊戲的普攻會在 attack1~3 之間隨機挑一個，
   但素材只有一段攻擊。manifest 的 row 是每個動作各自指定的，
   所以三個動作可以指到同一列——不必把同一段畫三份。

用法：
    python tools/pack_character_sheet.py <來源資料夾> <輸出基底> \\
        --map idle=Idle --map walk=Run \\
        --map attack1,attack2,attack3="normal attack" --map hurt=Hurt \\
        --loop idle,walk --scale 3.15 --anchor-y 0.725

    來源資料夾要有 SpriteSheets/ 與 json/ 兩個子目錄。
    輸出基底例如 images/sprites/player（會寫出 .png 與 .json）。
"""
import io
import json
import os
import sys

from PIL import Image


def load_clip(src, clip):
    """讀一個動作：回傳 (幀影像列表, 每格毫秒)。"""
    sheets = os.path.join(src, 'SpriteSheets')
    jsons = os.path.join(src, 'json')
    png = None
    meta = None
    for f in os.listdir(sheets):
        if f.lower().endswith(clip.lower() + '.png'):
            png = os.path.join(sheets, f)
            break
    for f in os.listdir(jsons):
        if f.lower().endswith(clip.lower() + '.json'):
            meta = os.path.join(jsons, f)
            break
    if not png:
        raise SystemExit('找不到動作的圖：%s（在 %s）' % (clip, sheets))
    im = Image.open(png).convert('RGBA')
    if meta:
        j = json.load(io.open(meta, encoding='utf-8'))
        frames = j['frames']
        if isinstance(frames, dict):                    # Aseprite 的 hash 版
            frames = [frames[k] for k in sorted(frames)]
        fw = frames[0]['sourceSize']['w']
        fh = frames[0]['sourceSize']['h']
        durs = [f.get('duration', 100) for f in frames]
    else:
        # 沒有 json 就假設是正方格
        fh = im.height
        fw = fh
        durs = [100] * (im.width // fw)
    n = len(durs)
    if im.width < n * fw:
        raise SystemExit('%s：圖寬 %d 放不下 %d 格 x %d' % (clip, im.width, n, fw))
    imgs = [im.crop((i * fw, 0, (i + 1) * fw, fh)) for i in range(n)]
    return imgs, durs, fw, fh


def main():
    args = sys.argv[1:]
    if len(args) < 2:
        print(__doc__)
        return 2
    src, outbase = args[0], args[1]
    mapping = []            # [(names[], clip)]
    loops = set()
    scale = None
    anchor_y = None
    i = 2
    while i < len(args):
        a = args[i]
        if a == '--map':
            spec = args[i + 1]
            names, clip = spec.split('=', 1)
            mapping.append(([n.strip() for n in names.split(',')], clip.strip()))
            i += 2
        elif a == '--loop':
            loops = set(n.strip() for n in args[i + 1].split(','))
            i += 2
        elif a == '--scale':
            scale = float(args[i + 1]); i += 2
        elif a == '--anchor-y':
            anchor_y = float(args[i + 1]); i += 2
        else:
            raise SystemExit('不認得的參數：' + a)
    if not mapping:
        raise SystemExit('至少要一個 --map')

    rows = []               # 每個 row 一段素材
    fw = fh = None
    for names, clip in mapping:
        imgs, durs, w, h = load_clip(src, clip)
        if fw is None:
            fw, fh = w, h
        elif (w, h) != (fw, fh):
            raise SystemExit('%s 的格是 %dx%d，與第一個動作的 %dx%d 不同；'
                             '同一張 manifest 的所有動作必須同尺寸' % (clip, w, h, fw, fh))
        rows.append({'names': names, 'clip': clip, 'imgs': imgs, 'durs': durs})

    cols = max(len(r['imgs']) for r in rows)
    sheet = Image.new('RGBA', (cols * fw, len(rows) * fh), (0, 0, 0, 0))
    anims = {}
    for ri, r in enumerate(rows):
        for ci, im in enumerate(r['imgs']):
            sheet.paste(im, (ci * fw, ri * fh))
        total = sum(r['durs'])
        fps = round(len(r['durs']) * 1000.0 / total, 2) if total else 10
        for name in r['names']:
            anims[name] = {
                'row': ri,
                'frames': len(r['imgs']),
                'fps': fps,
                'loop': name in loops,
                'durations': r['durs'],
            }

    manifest = {
        'image': os.path.basename(outbase) + '.png',
        'frameWidth': fw,
        'frameHeight': fh,
        'anims': anims,
    }
    if scale is not None:
        manifest['scale'] = scale
    if anchor_y is not None:
        manifest['anchorY'] = anchor_y

    sheet.save(outbase + '.png')
    io.open(outbase + '.json', 'w', encoding='utf-8', newline='\n').write(
        json.dumps(manifest, ensure_ascii=False, indent=1) + '\n')

    print('%s.png  %dx%d（%d 欄 x %d 列，格 %dx%d）'
          % (outbase, sheet.width, sheet.height, cols, len(rows), fw, fh))
    for ri, r in enumerate(rows):
        print('  row %d  %-28s %2d 格  %4dms  %s'
              % (ri, '/'.join(r['names']), len(r['imgs']), sum(r['durs']),
                 '循環' if r['names'][0] in loops else '單次'))
    return 0


if __name__ == '__main__':
    sys.exit(main())
