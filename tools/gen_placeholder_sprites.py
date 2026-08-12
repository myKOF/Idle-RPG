# -*- coding: utf-8 -*-
"""佔位序列幀產生器：玩家角色與 BOSS 的 sprite sheet + 幀定義 JSON。

正式圖到位後只需替換 images/sprites/*.png 並同步調整同名 .json 的
frameWidth/frameHeight/anims 幀數即可，程式端（js/battle-renderer.js）不用改。

用法：python tools/gen_placeholder_sprites.py
輸出：images/sprites/player.png / player.json / boss_generic.png / boss_generic.json
"""
import json
import math
import os

from PIL import Image, ImageDraw

OUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'images', 'sprites')

# ---- 調色盤（像素風） ----
STEEL = (168, 178, 194, 255)
STEEL_D = (110, 120, 138, 255)
TUNIC = (52, 98, 168, 255)
TUNIC_D = (36, 68, 120, 255)
SKIN = (232, 190, 152, 255)
LEATHER = (104, 72, 44, 255)
BLADE = (222, 230, 240, 255)
BLADE_HL = (255, 255, 255, 255)
HILT = (196, 156, 58, 255)
PLUME = (196, 60, 60, 255)
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


# ================= 玩家（32x32，面向右） =================
S = 32


def draw_knight(bob=0, lead_leg=0, back_leg=0, arm='rest', sword='side',
                lunge=0, torso_lean=0):
    """參數化騎士。座標以 (16,16) 為身體中心附近。
    bob: 全身上下位移； lead/back_leg: 前後腳的水平擺幅
    arm: rest/raise/swing/thrust  sword: side/up/overhead/down/slash/thrust/wind
    lunge: 全身向前(右)位移  torso_lean: 上身前傾像素
    """
    img = new_frame(S)
    d = ImageDraw.Draw(img)
    ox = 10 + lunge          # 身體左緣基準
    oy = 6 + bob             # 頭頂基準
    tl = torso_lean

    # 後腳 / 前腳（褲+靴）
    rect(d, ox + 2 + back_leg, oy + 16, ox + 4 + back_leg, oy + 21, TUNIC_D)
    rect(d, ox + 1 + back_leg, oy + 21, ox + 4 + back_leg, oy + 22, LEATHER)
    rect(d, ox + 6 + lead_leg, oy + 16, ox + 8 + lead_leg, oy + 21, TUNIC)
    rect(d, ox + 6 + lead_leg, oy + 21, ox + 9 + lead_leg, oy + 22, LEATHER)

    # 軀幹（鎧甲）
    rect(d, ox + 1 + tl, oy + 9, ox + 8 + tl, oy + 15, TUNIC)
    rect(d, ox + 1 + tl, oy + 9, ox + 3 + tl, oy + 15, TUNIC_D)
    rect(d, ox + 1 + tl, oy + 12, ox + 8 + tl, oy + 12, LEATHER)  # 腰帶

    # 頭（頭盔+臉+羽飾）
    hx = ox + 2 + tl
    rect(d, hx, oy + 2, hx + 6, oy + 8, STEEL)
    rect(d, hx, oy + 2, hx + 1, oy + 8, STEEL_D)
    rect(d, hx + 4, oy + 5, hx + 6, oy + 7, SKIN)   # 臉
    px(d, hx + 5, oy + 5, OUTLINE)                   # 眼
    rect(d, hx + 1, oy + 0, hx + 3, oy + 2, PLUME)   # 羽飾

    # 手臂與劍
    ax = ox + 6 + tl
    ay = oy + 10
    if arm == 'rest':
        rect(d, ax, ay, ax + 2, ay + 4, STEEL_D)
        rect(d, ax + 1, ay + 4, ax + 2, ay + 5, SKIN)
    elif arm == 'raise':
        rect(d, ax, ay - 4, ax + 2, ay, STEEL_D)
        rect(d, ax + 1, ay - 5, ax + 2, ay - 4, SKIN)
    elif arm == 'swing':
        rect(d, ax + 1, ay + 1, ax + 4, ay + 3, STEEL_D)
        rect(d, ax + 4, ay + 1, ax + 5, ay + 2, SKIN)
    elif arm == 'thrust':
        rect(d, ax + 1, ay + 1, ax + 5, ay + 2, STEEL_D)
        rect(d, ax + 5, ay + 1, ax + 6, ay + 2, SKIN)

    def blade_v(x, y0, y1):
        rect(d, x, y0, x, y1, BLADE)
        px(d, x, y0, BLADE_HL)

    if sword == 'side':          # 垂在身側
        rect(d, ax + 1, ay + 5, ax + 3, ay + 5, HILT)
        blade_v(ax + 2, ay + 6, ay + 12)
    elif sword == 'up':          # 舉到頭上（過肩劈前置）
        rect(d, ax, ay - 6, ax + 2, ay - 6, HILT)
        blade_v(ax + 1, ay - 13, ay - 7)
    elif sword == 'overhead':    # 過肩、劍尖朝前上
        rect(d, ax + 2, ay - 5, ax + 2, ay - 3, HILT)
        for i in range(7):
            px(d, ax + 3 + i, ay - 6 - i // 2, BLADE)
        px(d, ax + 9, ay - 9, BLADE_HL)
    elif sword == 'down':        # 劈到底，劍尖朝前下
        rect(d, ax + 3, ay + 2, ax + 3, ay + 4, HILT)
        for i in range(8):
            px(d, ax + 4 + i, ay + 4 + i // 2, BLADE)
        px(d, ax + 11, ay + 7, BLADE_HL)
    elif sword == 'slash':       # 水平橫掃（劍在前方水平）
        rect(d, ax + 4, ay + 1, ax + 4, ay + 3, HILT)
        rect(d, ax + 5, ay + 2, ax + 13, ay + 2, BLADE)
        px(d, ax + 13, ay + 2, BLADE_HL)
    elif sword == 'thrust':      # 突刺（更長、帶速度感高光）
        rect(d, ax + 5, ay + 0, ax + 5, ay + 3, HILT)
        rect(d, ax + 6, ay + 1, ax + 15, ay + 1, BLADE)
        rect(d, ax + 12, ay + 1, ax + 15, ay + 1, BLADE_HL)
    elif sword == 'wind':        # 收劍到身後蓄力
        rect(d, ax - 2, ay + 1, ax - 2, ay + 3, HILT)
        for i in range(6):
            px(d, ax - 3 - i, ay + 2 - i // 2, BLADE)

    return outline_sprite(img)


def knight_frames():
    anims = {}
    # 待機：輕微起伏 + 劍身微沉
    anims['idle'] = [
        draw_knight(bob=0, arm='rest', sword='side'),
        draw_knight(bob=0, arm='rest', sword='side'),
        draw_knight(bob=1, arm='rest', sword='side'),
        draw_knight(bob=1, arm='rest', sword='side'),
    ]
    # 移動：六幀跑步循環
    anims['walk'] = [
        draw_knight(bob=0, lead_leg=2, back_leg=-2, arm='rest', sword='side', torso_lean=1),
        draw_knight(bob=1, lead_leg=1, back_leg=-1, arm='rest', sword='side', torso_lean=1),
        draw_knight(bob=0, lead_leg=0, back_leg=0, arm='rest', sword='side', torso_lean=1),
        draw_knight(bob=0, lead_leg=-2, back_leg=2, arm='rest', sword='side', torso_lean=1),
        draw_knight(bob=1, lead_leg=-1, back_leg=1, arm='rest', sword='side', torso_lean=1),
        draw_knight(bob=0, lead_leg=0, back_leg=0, arm='rest', sword='side', torso_lean=1),
    ]
    # 攻擊1：橫掃
    anims['attack1'] = [
        draw_knight(arm='raise', sword='wind', torso_lean=-1),
        draw_knight(arm='raise', sword='up', torso_lean=0),
        draw_knight(arm='swing', sword='slash', lunge=2, torso_lean=1, lead_leg=2, back_leg=-2),
        draw_knight(arm='swing', sword='slash', lunge=3, torso_lean=1, lead_leg=2, back_leg=-2),
        draw_knight(arm='rest', sword='side', lunge=1),
    ]
    # 攻擊2：過肩劈
    anims['attack2'] = [
        draw_knight(arm='raise', sword='up', torso_lean=-1),
        draw_knight(arm='raise', sword='up', bob=-1, torso_lean=-1),
        draw_knight(arm='swing', sword='overhead', lunge=2, torso_lean=1),
        draw_knight(arm='swing', sword='down', lunge=3, torso_lean=2, lead_leg=2, back_leg=-2),
        draw_knight(arm='rest', sword='side', lunge=1),
    ]
    # 攻擊3：突刺
    anims['attack3'] = [
        draw_knight(arm='rest', sword='wind', torso_lean=-1, lunge=-1),
        draw_knight(arm='thrust', sword='thrust', lunge=1, torso_lean=1),
        draw_knight(arm='thrust', sword='thrust', lunge=4, torso_lean=2, lead_leg=3, back_leg=-2),
        draw_knight(arm='thrust', sword='thrust', lunge=4, torso_lean=2, lead_leg=3, back_leg=-2),
        draw_knight(arm='rest', sword='side', lunge=1),
    ]
    return anims


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
        knight_frames(), S, 3,
        os.path.join(out, 'player.png'), os.path.join(out, 'player.json'),
        meta={
            'idle': {'fps': 5, 'loop': True},
            'walk': {'fps': 10, 'loop': True},
            'attack1': {'fps': 14, 'loop': False},
            'attack2': {'fps': 14, 'loop': False},
            'attack3': {'fps': 14, 'loop': False},
        })
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
