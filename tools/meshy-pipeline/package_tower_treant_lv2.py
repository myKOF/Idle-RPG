"""Package the five actual treant clips; python package_tower_treant_lv2.py OUTPUT."""
import json
import math
from pathlib import Path
import sys
from PIL import Image, ImageDraw
from package_tower_boss1 import font, write_gif, LABELS


def package(root):
    manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
    overview_fps = manifest['renderFps']
    width, height = manifest['width'], manifest['height']
    small, report = {}, {}
    for name, clip in manifest['clips'].items():
        fps = clip.get('fps', overview_fps)
        frames, small[name] = [], []
        for i in range(clip['frames']):
            with Image.open(root / name / f'{i:04d}.png') as image:
                source = image.convert('RGB')
            frame = Image.new('RGB', (width, height + 64), (14, 19, 27))
            frame.paste(source, (0, 64))
            ImageDraw.Draw(frame).text((28, 18), f'樹人Ⅱ · {LABELS[name]} · 原速 · {fps} FPS', font=font(24), fill=(235, 223, 197))
            frames.append(frame)
            small[name].append(source.resize((460, 460), Image.Resampling.LANCZOS))
        duration = [1000 // fps] * len(frames)
        duration[-1] += 850 if name == 'Die' else (0 if name == 'Walk' else 300)
        destination = root / f'Treant_LV2_{name}_HD.gif'
        write_gif(frames, destination, duration)
        report[name] = {'file': destination.name, 'frames': len(frames), 'size': [width, height + 64], 'durationMs': sum(duration)}
        print('GIF_WRITTEN', name, flush=True)
    fps = overview_fps
    count = math.ceil(max(c['duration'] for c in manifest['clips'].values()) * fps)
    frames = []
    for index in range(count):
        board = Image.new('RGB', (1920, 1200), (14, 19, 27))
        draw = ImageDraw.Draw(board)
        draw.text((34, 25), '封魔塔 第12關 · 樹人Ⅱ · 第2階五動作預覽', font=font(36), fill=(235, 223, 197))
        draw.text((36, 80), '原速播放  /  無武器  /  3D 成品實際渲染', font=font(23), fill=(154, 173, 193))
        for n, (name, clip) in enumerate(manifest['clips'].items()):
            hold = 0 if name == 'Walk' else (.85 if name == 'Die' else .3)
            time = min(index / fps % (clip['duration'] + hold), clip['duration'])
            at = min(len(small[name]) - 1, int(time * clip.get('fps', overview_fps)))
            x, y = 38 + (n % 3) * 640, 143 + (n // 3) * 525
            draw.text((x, y), LABELS[name], font=font(25), fill=(235, 223, 197))
            board.paste(small[name][at], (x + 50, y + 43))
        draw.text((1350, 770), '樹人Ⅱ', font=font(58), fill=(209, 223, 176))
        draw.text((1350, 862), '走路 / 三種攻擊 / 死亡', font=font(27), fill=(154, 173, 193))
        frames.append(board)
    write_gif(frames, root / 'Treant_LV2_actions_HD.gif', [1000 // fps] * count)
    frames[0].save(root / 'Treant_LV2_cover.png')
    report['overview'] = {'file': 'Treant_LV2_actions_HD.gif', 'frames': count, 'size': [1920, 1200], 'durationMs': count * (1000 // fps)}
    (root / 'gif-report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')


if __name__ == '__main__':
    package(Path(sys.argv[1]).resolve())
