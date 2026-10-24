# MakeHuman silver knight — static restart R6

User instruction: restart from the original knight sprite sheets using
MakeHuman + Blender, retaining a helmet, without a shield or sword trails.
This is a first static shape candidate. Similarity has not been approved.

## Sources and rights

- MakeHuman official Git: https://github.com/makehumancommunity/makehuman
  upstream commit `a8bc2d54ff0ac92e78ff71431b1023eda42bf482`.
- Official MakeHuman Blender tool MPFB:
  https://github.com/makehumancommunity/mpfb2
  upstream commit `b1a2dc98776da9d1eea751b159d42cf61778fe2e`.
- Core human meshes, macro targets and standard rig/weights are MakeHuman
  Community **CC0-1.0** art data. The exact basemesh hashes are in
  `manifest.json`; the complete CC0 text is in `LICENSE.ASSETS.md`.
  Official license explanation:
  https://static.makehumancommunity.org/about/license.html
- MakeHuman application code is AGPL and MPFB code is GPL. Full application
  checkouts remain outside the game package; no third-party application source
  is copied into these art files. The local authoring scripts call their APIs.
- Existing project knight sprite sheets are visual reference and are shown
  unchanged beside renders only in the chat preview. No sprite pixels were
  traced, copied into textures, or incorporated into new geometry.
- Armor, helmet, sword, palette, static combat pose, studio and the two local
  authoring tools were authored for this project. No external armor, textures,
  poses or animation clips were imported.

## Reproducible source package

- `knight.mhm`: native MakeHuman anatomy parameters. Native MHM import through
  MPFB was compared with the original generated anatomy; maximum vertex error
  was below 1e-5 model units. The measured value is in the chat validation.
- `knight-human.json`: official MPFB character preset containing the same human
  parameters and game_engine rig choice.
- `knight_makehuman.blend`: editable original MakeHuman anatomy and shape keys
  (hidden from renders), standard 53-bone rig and weights, separately editable
  original armor and a static combat pose. No Actions.
- `knight_makehuman.glb`: the visible posed mesh baked for static viewing.
  One mesh/primitive/material, two embedded 28×4 palette maps, no skins or clips.
  This is **not** the final animated character or an installed game replacement.

Covered anatomy is omitted from the visible arming-suit copy, and hollow armor
uses folded rims without duplicate hidden inner surfaces. The editable full
human is retained in the Blend. Armor fit is sampled against the generated
MakeHuman body; the original body's skin weights drive the exposed joints and
gloved hands. The native MHM stores anatomy only; armor and pose live in Blender.

## Scope and remaining work

Static reference/front/side/back images are rendered after reopening the saved
Blend. The enlarged comparison uses one global scale for each character to
match head-to-foot height, without independent body-part scaling. The small
56px check is a size estimate derived from the existing game presentation,
not a screenshot of live 3D integration. Comparison shadows are presentation
only; no new effect is added to the game.

The original R4 animation package and earlier R5 static candidate are frozen.
Shape approval comes before reconstructing all six actions. Armor overlap,
animation deformation, final similarity and live game performance still need
their respective later reviews. A valid mesh does not imply artistic approval.
