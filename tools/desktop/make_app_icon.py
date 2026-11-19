"""桌面版應用程式圖示：從遊戲 logo 摘出中間的劍，斜 45 度排成方形透明圖示（2026-11-19，使用者選定）。

  python -I tools/desktop/make_app_icon.py              產生 electron/icons/app.png（1024）與 app.ico（16～256）
  python -I tools/desktop/make_app_icon.py --preview    另外輸出 tmp/app-icon-preview.png（淺色／深色背景對照）

需要 Pillow。來源是 images/start-menu/title-lockup-forged.webp（已去背、1440×736）；logo 改版後要重跑，
並檢查下方三組實測座標（護手寶石、劍身左右緣、「之」貼著劍身的那一段）是否還對。

---- 摘劍的方法 ----
alpha 門檻 → 從護手中央的紅寶石往外找連通區 → 擴張 3 px 收回外框陰影的柔邊 → 乘回原 alpha。
劍和文字之間大多有細縫，但「之」在 y 405～475 貼著劍身右緣、裝飾橫線在 y≈495 橫過劍身，
所以握柄以下只收劍身寬度，而且只取到裝飾線上方，劍身末端用淡出收尾。

---- 小尺寸 ----
32 以下另外裁短劍身（取上方 72%），讓護手與寶石在小圖裡夠大；≤48 補一點銳利度。 """
import os
import sys
from collections import deque
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = os.path.join(REPO, 'images', 'start-menu', 'title-lockup-forged.webp')
OUT_DIR = os.path.join(REPO, 'electron', 'icons')

SEED = (720, 135)                      # 護手中央的紅寶石
TH = 150                               # 連通搜尋的 alpha 門檻
CUT_Y = 482                            # 裝飾橫線（y≈495）上方
GUARD_X0, GUARD_X1 = 560, 880          # 護手段的搜尋寬度
BLADE_Y, BLADE_X0, BLADE_X1 = 238, 690, 748   # 握柄以下：劍身實測 693～745，含 2～3 px 外框
TOUCH_Y0, TOUCH_Y1, TOUCH_X1 = 405, 475, 746  # 「之」貼著劍身右緣的那一段，右界再收一點
SIZES = [256, 128, 64, 48, 32, 24, 16]


def allowed(x, y):
    if y >= BLADE_Y:
        return BLADE_X0 <= x <= (TOUCH_X1 if TOUCH_Y0 <= y <= TOUCH_Y1 else BLADE_X1)
    return GUARD_X0 <= x < GUARD_X1


def extract_sword(im):
    W, H = im.size
    A = im.getchannel('A')
    ap = A.load()
    if ap[SEED] <= TH:
        sys.exit('護手寶石的位置 %r 不是實心像素：logo 改版了？請重新量測檔頭的座標' % (SEED,))
    seen = bytearray(W * H)
    seen[SEED[1] * W + SEED[0]] = 1
    q = deque([SEED])
    comp = Image.new('L', (W, H), 0)
    cp = comp.load()
    while q:
        x, y = q.popleft()
        cp[x, y] = 255
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= ny < CUT_Y and 0 <= nx < W and allowed(nx, ny) and not seen[ny * W + nx] and ap[nx, ny] > TH:
                seen[ny * W + nx] = 1
                q.append((nx, ny))
    grown = comp.filter(ImageFilter.MaxFilter(7))
    gp = grown.load()
    for y in range(H):                 # 擴張後再裁一次：柔邊不能長回文字上
        for x in range(W):
            if gp[x, y] and (y >= CUT_Y or not allowed(x, y)):
                gp[x, y] = 0
    alpha = ImageChops.multiply(grown, A)
    sword = im.copy()
    sword.putalpha(alpha)
    return sword.crop(alpha.getbbox())


def fade_bottom(img, start_frac):
    w, h = img.size
    g = Image.new('L', (1, h), 255)
    gp = g.load()
    y0 = int(h * start_frac)
    for y in range(y0, h):
        t = (y - y0) / max(1, h - 1 - y0)
        gp[0, y] = int(255 * (1 - t) ** 1.6)
    out = img.copy()
    out.putalpha(ImageChops.multiply(img.getchannel('A'), g.resize((w, h))))
    return out


def diagonal(img, size, margin):
    up = img.resize((img.width * 3, img.height * 3), Image.LANCZOS)   # 先放大再轉，邊緣比較細
    rot = up.rotate(-45, resample=Image.BICUBIC, expand=True)
    rot = rot.crop(rot.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox())
    s = size * (1 - 2 * margin) / max(rot.width, rot.height)
    r = rot.resize((max(1, round(rot.width * s)), max(1, round(rot.height * s))), Image.LANCZOS)
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(r, ((size - r.width) // 2, (size - r.height) // 2))
    return canvas


def sharpen(img):
    a = img.getchannel('A')
    f = img.filter(ImageFilter.UnsharpMask(radius=0.6, percent=70, threshold=2))
    f.putalpha(a)
    return f


def preview(frames, path):
    try:
        font = ImageFont.truetype(os.path.join(os.environ.get('WINDIR', 'C:/Windows'), 'Fonts', 'msjh.ttc'), 16)
    except OSError:
        font = ImageFont.load_default()
    show = [s for s in (256, 48, 32, 24, 16)]
    w = 24 + sum(s + 28 for s in show)
    canvas = Image.new('RGB', (w, 2 * 320), (255, 255, 255))
    d = ImageDraw.Draw(canvas)
    for row, (bg, fg) in enumerate((((243, 243, 243), (30, 30, 30)), ((24, 40, 64), (235, 235, 235)))):
        y0 = row * 320
        d.rectangle([0, y0, w, y0 + 320], fill=bg)
        x = 24
        for s in show:
            f = frames[s]
            canvas.paste(f, (x, y0 + 30 + 256 - s), f)
            d.text((x, y0 + 30 + 256 + 4), str(s), fill=fg, font=font)
            x += s + 28
    os.makedirs(os.path.dirname(path), exist_ok=True)
    canvas.save(path)


def main():
    im = Image.open(SRC).convert('RGBA')
    sword = extract_sword(im)
    big = fade_bottom(sword, 0.70)
    small = fade_bottom(sword.crop((0, 0, sword.width, int(sword.height * 0.72))), 0.75)
    master = diagonal(big, 1024, 0.02)
    os.makedirs(OUT_DIR, exist_ok=True)
    master.save(os.path.join(OUT_DIR, 'app.png'), optimize=True)
    frames = {}
    for s in SIZES:
        f = master.resize((s, s), Image.LANCZOS) if s >= 48 else diagonal(small, s * 4, 0.01).resize((s, s), Image.LANCZOS)
        frames[s] = sharpen(f) if s <= 48 else f
    ordered = [frames[s] for s in SIZES]
    ordered[0].save(os.path.join(OUT_DIR, 'app.ico'), format='ICO', sizes=[(s, s) for s in SIZES], append_images=ordered[1:])
    print('electron/icons/app.png（1024）、app.ico（%s）' % '／'.join(str(s) for s in SIZES))
    if '--preview' in sys.argv:
        p = os.path.join(REPO, 'tmp', 'app-icon-preview.png')
        preview(frames, p)
        print('預覽：' + os.path.relpath(p, REPO))


if __name__ == '__main__':
    main()
