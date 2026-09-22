# -*- coding: utf-8 -*-
"""佔位序列幀產生器：BOSS 的 sprite sheet + 幀定義 JSON。

正式圖到位後只需替換 images/sprites/*.png 並同步調整同名 .json 的
frameWidth/frameHeight/anims 幀數即可，程式端（js/battle-renderer.js）不用改。

玩家原本也由這裡產生佔位圖，2026-09-22 換成 8 方向騎士後改由
tools/build_character_sprites.cjs 產生（images/sprites/knight/），這裡只剩 BOSS。

用法：python tools/gen_placeholder_sprites.py
輸出：images/sprites/boss_generic.png / boss_generic.json
"""
import json
import math
import os

from PIL import Image, ImageDraw

OUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'images', 'sprites')

# ---- 調色盤（像素風） ----
OUTLINE = (24, 26, 34, 255)

BOSS_BODY = (122, 44, 138, 255)
BOSS_BODY_D = (84, 28, 96, 255)
BOSS_HORN = (238, 222, 180, 255)
BOSS_EYE = (255, 216, 64, 255)
BOSS_CLAW = (240, 240, 248, 255)
BOSS_WING = (60, 22, 70, 255)


def new_frame(size):
    return Image.new('RGBA', (size, size), (0, 0, 0, 0))


def px(d, x, y, c):
    d.point((x, y), fill=c)


def rect(d, x0, y0, x1, y1, c):
    d.rectangle([x0, y0, x1, y1], fill=c)


def outline_sprite(img):
    """把不透明像素的外緣描一圈深色邊，像素風輪廓。"""
    w, h = img.size
    src = img.load()
    edge = []
    for y in range(h):
        for x in range(w):
            if src[x, y][3] != 0:
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < w and 0 <= ny < h and src[nx, ny][3] != 0 and src[nx, ny] != OUTLINE:
                    edge.append((x, y))
                    break
    for x, y in edge:
        src[x, y] = OUTLINE
    return img


# ================= BOSS（48x48，面向左） =================
B = 48


def draw_boss(bob=0, wing=0, arm='rest', mouth=0, lean=0):
    """惡魔型 BOSS。wing: 翅膀張合 0~2；arm: rest/raise/smash。面向左（朝玩家）。"""
    img = new_frame(B)
    d = ImageDraw.Draw(img)
    cx = 24 - lean
    oy = 10 + bob

    # 翅膀（後層）
    spread = 4 + wing * 3
    d.polygon([(cx - 2, oy + 10), (cx - 2 - 2, oy + 2 - wing), (cx - 2 - spread, oy + 6 - wing)], fill=BOSS_WING)
    d.polygon([(cx + 8, oy + 10), (cx + 10 + 2, oy + 2 - wing), (cx + 10 + spread, oy + 6 - wing)], fill=BOSS_WING)

    # 身體
    rect(d, cx - 4, oy + 8, cx + 10, oy + 24, BOSS_BODY)
    rect(d, cx + 6, oy + 8, cx + 10, oy + 24, BOSS_BODY_D)
    # 腹紋
    for i in range(3):
        rect(d, cx - 1, oy + 14 + i * 3, cx + 6, oy + 14 + i * 3, BOSS_BODY_D)

    # 腳
    rect(d, cx - 3, oy + 24, cx + 0, oy + 28, BOSS_BODY_D)
    rect(d, cx + 5, oy + 24, cx + 8, oy + 28, BOSS_BODY_D)
    rect(d, cx - 4, oy + 28, cx + 0, oy + 29, BOSS_HORN)
    rect(d, cx + 4, oy + 28, cx + 8, oy + 29, BOSS_HORN)

    # 頭 + 角 + 眼 + 嘴
    rect(d, cx - 3, oy + 0, cx + 9, oy + 8, BOSS_BODY)
    rect(d, cx + 6, oy + 0, cx + 9, oy + 8, BOSS_BODY_D)
    d.polygon([(cx - 3, oy + 0), (cx - 6, oy - 5), (cx - 1, oy - 1)], fill=BOSS_HORN)
    d.polygon([(cx + 9, oy + 0), (cx + 12, oy - 5), (cx + 7, oy - 1)], fill=BOSS_HORN)
    rect(d, cx - 2, oy + 3, cx - 1, oy + 4, BOSS_EYE)
    rect(d, cx + 4, oy + 3, cx + 5, oy + 4, BOSS_EYE)
    if mouth:
        rect(d, cx + 0, oy + 6, cx + 4, oy + 6 + mouth, OUTLINE)

    # 手臂（面向左 → 攻擊手在左側）
    if arm == 'rest':
        rect(d, cx - 7, oy + 10, cx - 4, oy + 18, BOSS_BODY_D)
        rect(d, cx - 8, oy + 18, cx - 5, oy + 20, BOSS_CLAW)
        rect(d, cx + 10, oy + 10, cx + 13, oy + 18, BOSS_BODY_D)
    elif arm == 'raise':
        rect(d, cx - 8, oy + 2, cx - 5, oy + 12, BOSS_BODY_D)
        rect(d, cx - 10, oy - 1, cx - 5, oy + 2, BOSS_CLAW)
        rect(d, cx + 10, oy + 10, cx + 13, oy + 18, BOSS_BODY_D)
    elif arm == 'smash':
        rect(d, cx - 12, oy + 14, cx - 4, oy + 17, BOSS_BODY_D)
        rect(d, cx - 16, oy + 13, cx - 12, oy + 18, BOSS_CLAW)
        rect(d, cx + 10, oy + 10, cx + 13, oy + 18, BOSS_BODY_D)

    return outline_sprite(img)


def boss_frames():
    anims = {}
    anims['idle'] = [
        draw_boss(bob=0, wing=0),
        draw_boss(bob=1, wing=1),
        draw_boss(bob=2, wing=2),
        draw_boss(bob=1, wing=1),
    ]
    anims['attack'] = [
        draw_boss(bob=0, wing=1, arm='raise', lean=-1),
        draw_boss(bob=-1, wing=2, arm='raise', mouth=2, lean=-1),
        draw_boss(bob=1, wing=0, arm='smash', mouth=2, lean=2),
        draw_boss(bob=2, wing=0, arm='smash', mouth=1, lean=2),
        draw_boss(bob=1, wing=1, arm='rest'),
    ]
    anims['hurt'] = [
        draw_boss(bob=0, wing=2, mouth=2, lean=-2),
        draw_boss(bob=1, wing=1, mouth=1, lean=-1),
    ]
    return anims


def pack(anims, cell, scale, out_png, out_json, meta):
    """逐列打包動畫 → sprite sheet PNG + 幀定義 JSON。"""
    rows = list(anims.keys())
    max_frames = max(len(v) for v in anims.values())
    size = cell * scale
    sheet = Image.new('RGBA', (size * max_frames, size * len(rows)), (0, 0, 0, 0))
    anim_meta = {}
    for r, name in enumerate(rows):
        frames = anims[name]
        for c, frame in enumerate(frames):
            big = frame.resize((size, size), Image.NEAREST)
            sheet.paste(big, (c * size, r * size))
        anim_meta[name] = dict(meta[name], row=r, frames=len(frames))
    os.makedirs(os.path.dirname(out_png), exist_ok=True)
    sheet.save(out_png)
    manifest = {
        'image': os.path.basename(out_png),
        'frameWidth': size,
        'frameHeight': size,
        'anims': anim_meta,
    }
    with open(out_json, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    print('wrote', out_png, sheet.size, 'and', os.path.basename(out_json))


def main():
    out = os.path.abspath(OUT_DIR)
    pack(
        boss_frames(), B, 3,
        os.path.join(out, 'boss_generic.png'), os.path.join(out, 'boss_generic.json'),
        meta={
            'idle': {'fps': 6, 'loop': True},
            'attack': {'fps': 12, 'loop': False},
            'hurt': {'fps': 10, 'loop': False},
        })


if __name__ == '__main__':
    main()
