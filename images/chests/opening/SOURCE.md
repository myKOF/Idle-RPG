# Slanted chest opening

Self-authored in Blender 4.5.10. The existing five project illustrations from
`images/chests/` are projected onto separate fixed body walls and a curved lid.
The lid is a double-walled barrel shell with two complete textured end caps.
Transparent silhouette pixels in the original illustration are extended from
their own edge colours for the solid shell, while the original transparent image
remains unchanged for the body. Each end cap samples a fully painted region of
the project's own right-side artwork and has metal ribs and studs.

A forward solid mouth frame surrounds four sloped walls. They descend into a
visibly narrower, deeper 475-vertex curved lining. Different wall tones, depth
shading and four highlighted corner edges distinguish the frame, slopes and
recess. The lining's bands, motifs and rivets follow its curved surface. The
60-degree presentation exposes both the outer barrel roof and the inside, with
the two rear hinge vertices fixed. The body and floor remain unchanged.
The textured lining includes inset borders, corner leaves, paired scrolls,
quality-specific central crests and studs. The floor has a stitched border and
quilted diamond embossing. These patterns are procedural, self-authored geometry.

The user's GIF is a motion reference only. No pixels, assets, colours, text or
code from that reference are included. Existing project art provenance is recorded
in the `forge-chests-20261112` package.

The source package is resolved through `tools/vfx/vfx-library-root.cjs`:
`codex-authored/chest-opening-20261126-v5`. It contains the five source PNGs,
editable packed Blender scenes, 25 transparent renders per quality, lossless WebP
sheets, authoring/packing/export tools and a SHA-256 manifest.

Each game sheet is 1600 × 1600, arranged in five rows and five columns of 320 × 320
frames. Frame 0 is closed; frame 24 is fully open. The game plays these authored
poses with CSS; shake/open durations and light,
reward and confirmation timing are controlled by `js/ui-chest.js` and
`css/chest.css`. See `docs/CHEST_SYSTEM.md` for the current sequence. CSS holds the
last frame until dismissal. Shaking returns to the starting position before the
lid opens. Reduced motion holds frame 0 during the wait and switches to frame 24
when rewards appear.

Rebuild (paths below are placeholders):

    blender -b --python-exit-code 1 -P tools/chest-opening/build.py -- SOURCE_PNG_DIR PACKAGE/bake
    node tools/chest-opening/export.cjs --prepare
    node tools/chest-opening/export.cjs --check

The packer verifies every decoded WebP tile byte-for-byte against its PNG render.
The exporter verifies every source hash and each game/library sheet pair.
The manifest also records measured shell thickness, recessed lining depth, sealed
wall count and curved lining vertex count, complete end caps, highlighted corners,
mouth/recess widths, painted cap-source coverage and exposed roof height. The
Blender build asserts positive thickness/recess, fixed hinge vertices across all
25 poses, visible roof pixels and opaque source coverage for the side panels.
