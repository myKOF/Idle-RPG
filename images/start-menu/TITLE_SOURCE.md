# 開始選單標誌

使用者提供的截圖用於參考金屬字面、冷藍邊光、古銅副標和中央紅寶石飾件。以內建 ImageGen 重繪獨立標誌，中央改為帶直槽的雙刃鋼劍。新版再以 ImageGen 減弱外光。輸出時以原稿及低光稿各半，按透明度加權合成為 1440 × 737 WebP。取原稿半透明藍光區域比較，藍色亮度約減少 44%，藍色相對紅色的色差約減少 47%。標誌的替代文字沿用 String 表的遊戲全名。

- 原稿 1752 × 897 RGBA PNG，SHA-256 `13e939b9eaab9ddcb685e3ba34d29751b4a1ec68862ae35bdbcc76f9fd1d0a77`
- 低光稿 1754 × 897 RGBA PNG，SHA-256 `c56035f587508c61c2ae7315ee8d915b595e945de4c6a431e73cefc3ad64cbcc`
- 遊戲用 WebP SHA-256 `de292c40f8a5edf56aaf06b6426a432fdb39436d812bbfad2d6b7e49bd5d6980`
- Effects-Materials 的 `codex-authored/start-menu-title-20261106` 保存 `originals/original.png`、`originals/low-glow.png` 與同位元組的 `web/title-lockup.webp`。

## 原稿生成提示詞

```text
Use case: logo-brand. Create the isolated title lockup for a dark-fantasy RPG start screen, using Image 1 as a visual reference for the Chinese glyph treatment, layout, and metallic color palette. Redraw the mark as original artwork; the landscape and menu labels in the reference are placement context only.

Text must be exact, with each character clearly legible, no substitution, no duplicates. Large top row: 「神力之巔」 (神 力 | 之 巔). Small centered bottom row: 「無限征途」 (無 限 | 征 途). Arrange the four large Chinese characters as two balanced pairs separated by one narrow vertical sword; center the smaller four subtitle characters below the large title, two on either side of the sword. Match the reference's weighty, sharpened classical Chinese serif letterforms, chipped charcoal-steel faces, bright silver beveled edges, muted bronze reflections, and dark shadows. Subtitle in warm antique champagne-bronze with subtle bevels. Use a restrained cold steel-blue halo and a few small pale glints just outside the title edges, with a thin understated bronze divider between rows.

Redesign the center sword as a physically plausible straight double-edged forged steel blade that points down and ends below the subtitle. Narrow, perfectly straight silhouette with one simple longitudinal fuller and a sharp tapered tip. Zero spiral or rope effect: no helix, winding ornament, twisted segments, or diagonal wrap anywhere along the blade. Upper ornament at the top center is a compact aged-bronze gothic crossguard with a ruby-red gemstone and four pointed arms, in the spirit of the reference. Keep the center blade slender so it never obscures a character.

A tightly framed, centered landscape logo with full sword tip and four characters intact, modest transparent margin. Actual transparent RGBA background, including the gaps between the glyphs and the soft blue halo. Export just the mark and its local lighting. No scenery, background panel, floor, menu buttons, English text, watermark, or frame.
```

## 低光稿編修提示詞

```text
Use case: precise-object-edit. Edit Image 1, the existing finished Chinese dark-fantasy title lockup. Make just one local lighting adjustment. Reduce the visible pale steel-blue outer halo around the logo to approximately 55% of its present intensity (a 45% reduction), primarily by fading the semi-transparent pale blue light surrounding and between the letters and around the hilt. Make it quieter and more translucent so the underlying game environment will show through. Leave a subtle blue rim so it still separates from a warm brown background.

Treat the existing artwork as the locked edit target. Preserve exactly the positions, silhouettes, spacing and relative scale of all glyphs and ornaments, the original dark steel faces, bright silver metallic bevel reflections, deep brown and black shading, warm bronze subtitle and divider, ruby-red crossguard, and the perfectly straight double-edged blade with a single straight fuller. Keep the exact Chinese text 神力之巔 and 無限征途, four characters each, without any addition or substitution. Keep the same wide canvas framing and fully intact point of the sword. Do not shrink or relocate the lockup within this file. Screen layout and 85% scale are applied separately in the game. Actual transparent RGBA, with no background, backing shape, matte, new effects, or scenery. The existing opaque metal and gemstones must remain crisp and fully visible.
```
