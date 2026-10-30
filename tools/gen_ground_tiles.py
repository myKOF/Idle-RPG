# -*- coding: utf-8 -*-
"""可無縫拼接的地板貼圖產生器。

輸出 images/ground/*.png，由 js/battle-renderer.js 以 TilingSprite 平鋪。
人界沿用256×256原創材質；神界手繪地表由scene-renewal匯出器管理，本工具不覆寫。

刻意做得「淡」：地板只是襯底，對比太高會蓋過敵人與傷害數字。
所有花紋以模數運算繞回，保證上下左右接縫連續。

用法：python tools/gen_ground_tiles.py
"""
import math
import os
import random

from PIL import Image, ImageFilter

OUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'images', 'ground')
SIZE = 256


def blend(base, over, a):
    return tuple(int(base[i] * (1 - a) + over[i] * a) for i in range(3))


def make_tile(name, base_rgb, speckle_rgb, seed, crack=True):
    img = Image.new('RGB', (SIZE, SIZE), base_rgb)
    px = img.load()
    rnd = random.Random(seed)

    # 底色不疊週期性正弦明暗，也不畫磚縫，避免旋轉平鋪後形成菱形格子。
    # 大面積自然起伏由 battle-decor 的世界座標不規則色塊提供。

    # 細裂紋：用模數包裝，跨邊界時自動接回另一側
    if crack:
        crack_col = blend(base_rgb, (0, 0, 0), 0.08)
        for _ in range(4):
            cx, cy = rnd.randrange(SIZE), rnd.randrange(SIZE)
            ang = rnd.random() * math.tau
            for _ in range(rnd.randint(12, 26)):
                ang += rnd.uniform(-0.5, 0.5)
                cx = (cx + math.cos(ang) * 3) % SIZE
                cy = (cy + math.sin(ang) * 3) % SIZE
                px[int(cx), int(cy)] = crack_col

    # 砂點：兩種亮度，讓平鋪時不會一眼看出重複
    for _ in range(SIZE * 6):
        x, y = rnd.randrange(SIZE), rnd.randrange(SIZE)
        a = rnd.uniform(0.05, 0.20)
        px[x, y] = blend(px[x, y], speckle_rgb, a)
    for _ in range(SIZE * 2):
        x, y = rnd.randrange(SIZE), rnd.randrange(SIZE)
        px[x, y] = blend(px[x, y], (0, 0, 0), rnd.uniform(0.05, 0.18))

    # 先鋪九份再平滑並裁中央，濾波同樣環繞，避免貼圖邊緣出現一像素接縫。
    wrapped = Image.new('RGB', (SIZE * 3, SIZE * 3))
    for ty in range(3):
        for tx in range(3):
            wrapped.paste(img, (tx * SIZE, ty * SIZE))
    img = wrapped.filter(ImageFilter.SMOOTH).crop((SIZE, SIZE, SIZE * 2, SIZE * 2))
    os.makedirs(os.path.abspath(OUT_DIR), exist_ok=True)
    path = os.path.join(os.path.abspath(OUT_DIR), name + '.png')
    img.save(path)
    print('wrote', path, img.size)


def main():
    # 一張通用底圖 + 各地圖色調。渲染器找不到地圖專屬圖時退回 ground_default。
    make_tile('ground_default', (58, 58, 63), (146, 147, 154), 20260812, crack=False)
    make_tile('ground_desert', (104, 82, 53), (185, 153, 102), 1001, crack=False)
    make_tile('ground_Icefield', (71, 90, 103), (188, 213, 226), 1002)
    make_tile('ground_swamp', (46, 63, 46), (138, 166, 115), 1003, crack=False)
    make_tile('ground_undead_mountains', (53, 49, 59), (129, 124, 139), 1004)
    # 神界是手繪來源，不再以舊程序色塊蓋回；由export-source.cjs核對／匯出。
    print('preserved painted god-realm ground textures')


if __name__ == '__main__':
    main()
