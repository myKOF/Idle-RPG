# -*- coding: utf-8 -*-
"""gif-strip.py — 把 GIF 的每一格攤成一張橫條圖。

為什麼需要：讀圖工具讀得到 GIF，但只會給**第一格**。
對「這個動畫做了什麼」這種問題，第一格等於沒有資訊——
角色的待機、攻擊、受擊，差別全在後面那幾格。

放大用最近鄰（NEAREST）：這些是像素美術，雙線性會把它糊掉，
而「線條有沒有斷」「哪一格開始出手」正好要看清楚每個像素。

用法：
    python tools/vfx/gif-strip.py <in.gif> <out.png> [--scale 3] [--cols 8] [--bg checker]
"""
import sys
import os
from PIL import Image, ImageDraw

BG = {
    'checker': None,          # 特別處理
    'dark': (26, 28, 36),
    'grey': (118, 118, 120),
    'white': (255, 255, 255),
}


def load_frames(path):
    """逐格取出並轉成 RGBA。GIF 的 frame 之間有 disposal 規則，
    直接 seek 再 convert 會拿到殘影；用 copy() 讓 PIL 自己合成完再取。"""
    im = Image.open(path)
    frames = []
    try:
        while True:
            frames.append(im.convert('RGBA').copy())
            im.seek(im.tell() + 1)
    except EOFError:
        pass
    # 每格的顯示時間（毫秒），用來標註實際節奏
    durations = []
    im.seek(0)
    try:
        while True:
            durations.append(im.info.get('duration', 0))
            im.seek(im.tell() + 1)
    except EOFError:
        pass
    return frames, durations


def make_bg(w, h, kind):
    if kind == 'checker':
        bg = Image.new('RGB', (w, h), (100, 100, 100))
        d = ImageDraw.Draw(bg)
        for y in range(0, h, 8):
            for x in range(0, w, 8):
                if ((x // 8) + (y // 8)) % 2:
                    d.rectangle([x, y, x + 7, y + 7], fill=(128, 128, 128))
        return bg
    return Image.new('RGB', (w, h), BG.get(kind, BG['dark']))


def main():
    args = sys.argv[1:]
    if len(args) < 2:
        print(__doc__)
        return 2
    src, out = args[0], args[1]
    scale, cols, bgkind = 3, 8, 'checker'
    i = 2
    while i < len(args):
        if args[i] == '--scale':
            scale = int(args[i + 1]); i += 2
        elif args[i] == '--cols':
            cols = int(args[i + 1]); i += 2
        elif args[i] == '--bg':
            bgkind = args[i + 1]; i += 2
        else:
            raise SystemExit('不認得的參數：' + args[i])

    frames, durations = load_frames(src)
    n = len(frames)
    fw, fh = frames[0].size
    cw, ch = fw * scale, fh * scale
    pad, label_h = 4, 12
    cols = min(cols, n)
    rows = (n + cols - 1) // cols
    W = cols * (cw + pad) + pad
    H = rows * (ch + pad + label_h) + pad
    sheet = make_bg(W, H, bgkind)
    d = ImageDraw.Draw(sheet)
    for k, fr in enumerate(frames):
        big = fr.resize((cw, ch), Image.NEAREST)
        cx = pad + (k % cols) * (cw + pad)
        cy = pad + (k // cols) * (ch + pad + label_h)
        sheet.paste(big, (cx, cy), big)
        d.rectangle([cx - 1, cy - 1, cx + cw, cy + ch], outline=(70, 70, 76))
        ms = durations[k] if k < len(durations) else 0
        d.text((cx + 2, cy + ch + 1), '%d  %dms' % (k, ms), fill=(235, 235, 235))
    sheet.save(out)
    total = sum(durations)
    print('%s  %d 格  每格 %dx%d  總長 %dms（%.1f fps）  -> %s  %dx%d'
          % (os.path.basename(src), n, fw, fh, total,
             (n * 1000.0 / total) if total else 0, out, W, H))
    return 0


if __name__ == '__main__':
    sys.exit(main())
