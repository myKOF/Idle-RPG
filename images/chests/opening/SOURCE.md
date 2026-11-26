# Slanted chest opening

Self-authored in Blender 4.5.10. The existing five project illustrations from
`images/chests/` are projected onto separate fixed body walls and a curved lid.
The lid underside, lining bands, rivets, body cavity and hinge are newly authored
geometry. Both rear hinge vertices stay connected throughout the 110-degree turn.
The textured lining includes inset borders, corner leaves, paired scrolls,
quality-specific central crests and studs. The floor has a stitched border and
quilted diamond embossing. These patterns are procedural, self-authored geometry.

The user's GIF is a motion reference only. No pixels, assets, colours, text or
code from that reference are included. Existing project art provenance is recorded
in the `forge-chests-20261112` package.

The source package is resolved through `tools/vfx/vfx-library-root.cjs`:
`codex-authored/chest-opening-20261126-v3`. It contains the five source PNGs,
editable packed Blender scenes, 25 transparent renders per quality, lossless WebP
sheets, authoring/packing/export tools and a SHA-256 manifest.

Each game sheet is 1600 × 1600, arranged in five rows and five columns of 320 × 320
frames. Frame 0 is closed; frame 24 is fully open. The game holds the first frame
while charging, then plays the opening during the final portion of its existing
2.5-second presentation. CSS holds the last frame until dismissal. Reduced motion
holds frame 0 during the wait and switches to frame 24 when rewards appear.

Rebuild (paths below are placeholders):

    blender -b --python-exit-code 1 -P tools/chest-opening/build.py -- SOURCE_PNG_DIR PACKAGE/bake
    node tools/chest-opening/export.cjs --prepare
    node tools/chest-opening/export.cjs --check

The packer verifies every decoded WebP tile byte-for-byte against its PNG render.
The exporter verifies every source hash and each game/library sheet pair.
