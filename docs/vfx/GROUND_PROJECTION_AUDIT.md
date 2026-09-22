# 地面特效投影交接：VFX-GROUND-20260922

完成 83 份 Preset、185 個地面圖層。地面圓形採 1:0.5，方形先轉 45° 再壓縮，沿用場景透視。泥沼與暴風雪依使用者同意同步旋轉實際矩形判定；其他傷害數值與時序不變。直立本體及未列入範圍的飛行、斬擊與受擊球體未做投影。

## 實作與檢查

修改 Core、Runtime、skills2、Editor、對應快取、測試與本文列出的素材。只讀檢查 battle-renderer.js 的地面比例、battlefield.js 體型判定、229 份素材與來源、既有圖層 layout。補償舊圖層和六芒星圖集預先壓扁比例；編輯器選取框與拖曳同步投影。

## 驗證

- `node --test tests/vfx-ground-plane.test.cjs`：5/5，涵蓋旋轉矩陣、直立粒子、場景比例、菱形命中與全部素材 schema／roundtrip。
- 最終 10 檔回歸：404 項，399 通過、4 既有失敗、1 跳過。檔案為 vfx-ground-plane、vfx-core、vfx-core-hierarchy、vfx-runtime、vfx-runtime-screen-space、vfx-editor-gizmo、vfx-editor-save、vfx-size、vfx-tower、waterball-vfx-integration（均 tests/*.test.cjs）。
- 既有失敗為 CAP-2 粒子 scale 舊斷言、未修改 hit-thunderstrike-bluewhite 非 canonical、bolt-sky-purple 舊 layout 根群組、STARFALL-TAIL 已被使用者修改的素材斷言；使用 HEAD 基準重跑確認原已存在。較早較廣 464 項另含 5 個既有水系技能失敗，亦已基準確認，未修改測試接受錯誤。
- `node tools/build_check.cjs`；`node tools/vfx/export-assets.cjs --check`；`git diff --check`。
- 83 份素材離線預覽逐一查看；瀏覽器 GPU 編輯器查看龍噬漩渦與熔岩泥沼，選取框貼合菱形，Console error/warn 0。

## 限制與交接

素材庫提交 `987e2c4`；遊戲提交為本文所在提交。ground-plane 與 preset-usage 最終合計 28/28；Build 395 檔通過，素材 export --check 已最新，diff check 通過。

未完成整套技能的長時間實戰手動驗收；已知舊測試失敗另案處理。index.html／AI_TASKS 與 Claude 不同區段的變更以三方合併乾跑檢查，僅代表目前版本可合併。未自行合併或推送 develop。素材庫既有未追蹤 thrust 目錄保留。

## 素材與圖層清單

| Preset | 地面圖層 | 素材庫來源 |
|---|---|---|
| aura-bloodrage | ring | codex-authored/ground-projection/presets/aura-bloodrage.json |
| aura-earth-reversal | earth-shadow, amber-underlight | codex-authored/ground-projection/presets/aura-earth-reversal.json |
| aura-earthguard-hexagram | white-hexagram-ground | codex-authored/ground-projection/presets/aura-earthguard-hexagram.json |
| aura-earthguard-life | life-hexagram-ground | codex-authored/ground-projection/presets/aura-earthguard-life.json |
| aura-earthguard-mana | mana-hexagram-ground | codex-authored/ground-projection/presets/aura-earthguard-mana.json |
| aura-earthguard-symbiosis | symbiosis-hexagram-ground | codex-authored/ground-projection/presets/aura-earthguard-symbiosis.json |
| aura-rock-armor | ring, rocks, rocks-hi | codex-authored/ground-projection/presets/aura-rock-armor.json |
| aura-rockarmor-stone | earth-shadow, amber-underlight | codex-authored/ground-projection/presets/aura-rockarmor-stone.json |
| bolt-curtain-lightning | ground, ground-glow | codex-authored/ground-projection/presets/bolt-curtain-lightning.json |
| bolt-sky-lightning | ground | codex-authored/ground-projection/presets/bolt-sky-lightning.json |
| burst-blood | rim | codex-authored/ground-projection/presets/burst-blood.json |
| burst-detonate-dark-09 | swirl, rim, swirl-copy, rim-copy, rim-copy-2 | codex-authored/bloodrage/presets/burst-detonate-dark-09.json |
| burst-detonate-dark | swirl, rim, swirl-copy | codex-authored/bloodrage/presets/burst-detonate-dark.json |
| burst-detonate-phys-08 | rim-glow, rim | codex-authored/bloodrage/presets/burst-detonate-phys-08.json |
| burst-detonate-phys | rim-glow, rim | codex-authored/bloodrage/presets/burst-detonate-phys.json |
| burst-detonate | rim-glow, rim | codex-authored/bloodrage/presets/burst-detonate.json |
| burst-earth | rim | codex-authored/ground-projection/presets/burst-earth.json |
| burst-fire-shockwave-small | wave-a, wave-b, wave-c | codex-authored/ground-projection/presets/burst-fire-shockwave-small.json |
| burst-fire-shockwave | wave-a, wave-b, wave-c | codex-authored/ground-projection/presets/burst-fire-shockwave.json |
| burst-fire | wave-a, wave-b, wave-c | codex-authored/ground-projection/presets/burst-fire.json |
| burst-frost-freeze | expanding-frost-shockwave, trailing-frost-wave, frost-pressure | codex-authored/ground-projection/presets/burst-frost-freeze.json |
| burst-frost-nova | expanding-frost-shockwave, trailing-frost-wave, frost-pressure | codex-authored/ground-projection/presets/burst-frost-nova.json |
| burst-gravity | swirl-a, swirl-b, rim | codex-authored/ground-projection/presets/burst-gravity.json |
| burst-holy | rim | codex-authored/ground-projection/presets/burst-holy.json |
| burst-ice-blast | rim | codex-authored/ground-projection/presets/burst-ice-blast.json |
| burst-meteor-inferno | ground-heat-wave | codex-authored/ground-projection/presets/burst-meteor-inferno.json |
| burst-rock-petrify | ground, wave, rim | codex-authored/ground-projection/presets/burst-rock-petrify.json |
| burst-venom | rim | codex-authored/ground-projection/presets/burst-venom.json |
| burst-zero-infection | rim, rim-core | codex-authored/ground-projection/presets/burst-zero-infection.json |
| cast-buff-dark | ring, ring-inner | codex-authored/ground-projection/presets/cast-buff-dark.json |
| cast-buff-def | ring, ring-inner | codex-authored/ground-projection/presets/cast-buff-def.json |
| cast-buff-light | ring, ring-inner | codex-authored/ground-projection/presets/cast-buff-light.json |
| cast-buff-phys | ring, ring-inner | codex-authored/ground-projection/presets/cast-buff-phys.json |
| cast-buff-poison | ring, ring-inner | codex-authored/ground-projection/presets/cast-buff-poison.json |
| cast-buff-special | ring, ring-inner | codex-authored/ground-projection/presets/cast-buff-special.json |
| cast-magic | circle | codex-authored/ground-projection/presets/cast-magic.json |
| demo-basic | ground-ring | codex-authored/ground-projection/presets/demo-basic.json |
| field-dragon-devour | outer-fire-stream, rim-embers, sprite-3, sprite-3-copy, sprite-3-copy-2, sprite-6, sprite-3-copy-3, sprite-6-copy | codex-authored/dragon-devour/presets/field-dragon-devour.json |
| field-water-tornado | sprite-5 | codex-authored/ground-projection/presets/field-water-tornado.json |
| fire-tornado-inferno | wave-a, wave-b, wave-c | codex-authored/ground-projection/presets/fire-tornado-inferno.json |
| fire-tornado-infinite | wave-a, wave-b, wave-c | codex-authored/ground-projection/presets/fire-tornado-infinite.json |
| fire-tornado | scorch, ground-ring, base-glow | codex-authored/ground-projection/presets/fire-tornado.json |
| ground-blizzard | irregular-frost-0, irregular-frost-1, irregular-frost-2, irregular-frost-3, irregular-frost-4, irregular-frost-7, irregular-frost-8, ground-ice-mist-0, ground-ice-mist-1, ground-ice-mist-2 | codex-authored/ground-projection/presets/ground-blizzard.json |
| ground-cyclone-avatar | blade-a, blade-b, blade-c | codex-authored/ground-projection/presets/ground-cyclone-avatar.json |
| ground-domain-earth | fill, edge, inner | codex-authored/ground-projection/presets/ground-domain-earth.json |
| ground-domain-fire | fill, edge, inner | codex-authored/ground-projection/presets/ground-domain-fire.json |
| ground-domain-ice | fill, edge, inner | codex-authored/ground-projection/presets/ground-domain-ice.json |
| ground-field-fire | fill, edge | codex-authored/ground-projection/presets/ground-field-fire.json |
| ground-mire-earth | flowing-earth-mud | codex-authored/ground-projection/presets/ground-mire-earth.json |
| ground-mire-lava | fill, edge, ripple-a, ripple-b, ripple-c, bubbles | codex-authored/ground-projection/presets/ground-mire-lava.json |
| ground-mire-magma | flowing-earth-mud, magma-flames, magma-sparks | codex-authored/ground-projection/presets/ground-mire-magma.json |
| ground-mire-poison | fill, edge, ripple-a, ripple-b, ripple-c, bubbles | codex-authored/ground-projection/presets/ground-mire-poison.json |
| ground-mire-venom | flowing-earth-mud | codex-authored/ground-projection/presets/ground-mire-venom.json |
| ground-mire | fill, edge, ripple-a, ripple-b, ripple-c, bubbles | codex-authored/ground-projection/presets/ground-mire.json |
| ground-orbit-ring-fire | halo, ring, motes | codex-authored/ground-projection/presets/ground-orbit-ring-fire.json |
| ground-orbit-ring-lightning | halo, ring, motes | codex-authored/ground-projection/presets/ground-orbit-ring-lightning.json |
| ground-orbit-ring-wind | halo, ring, motes | codex-authored/ground-projection/presets/ground-orbit-ring-wind.json |
| ground-starfall-shadow | shadow | codex-authored/ground-projection/presets/ground-starfall-shadow.json |
| ground-storm-barrier | floor-spiral-0, floor-spiral-1 | codex-authored/ground-projection/presets/ground-storm-barrier.json |
| ground-storm-dance | floor-green-rim-back, floor-white-core-back, floor-green-rim-front, floor-white-core-front | codex-authored/storm-dance/presets/ground-storm-dance.json |
| ground-storm-rip | ring | codex-authored/ground-projection/presets/ground-storm-rip.json |
| ground-swordfield | fill, dashes, edge | codex-authored/ground-projection/presets/ground-swordfield.json |
| ground-tornado-fire | ground | codex-authored/ground-projection/presets/ground-tornado-fire.json |
| ground-tornado-water | ground | codex-authored/ground-projection/presets/ground-tornado-water.json |
| ground-tornado-wind | ground | codex-authored/ground-projection/presets/ground-tornado-wind.json |
| hit-thunderfall-impact | ground-plasma, shockwave-outer, pressure-wave | codex-authored/ground-projection/presets/hit-thunderfall-impact.json |
| hit-thunderstrike-purplewhite | shock-ring | codex-authored/ground-projection/presets/hit-thunderstrike-purplewhite.json |
| hit-waterball-splash | spreading-water-ring, outer-pressure-ring | codex-authored/ground-projection/presets/hit-waterball-splash.json |
| mark-blue | fill, edge | codex-authored/ground-projection/presets/mark-blue.json |
| mark-red | fill, edge | codex-authored/ground-projection/presets/mark-red.json |
| pillar-earth | ring | codex-authored/ground-projection/presets/pillar-earth.json |
| pillar-indomitable | ring | codex-authored/ground-projection/presets/pillar-indomitable.json |
| pillar-light | ring | codex-authored/ground-projection/presets/pillar-light.json |
| st-aspd-up | ring | codex-authored/ground-projection/presets/st-aspd-up.json |
| st-atk-up | ring | codex-authored/ground-projection/presets/st-atk-up.json |
| st-buff | ring | codex-authored/ground-projection/presets/st-buff.json |
| st-crit-up | ring, ring-outer | codex-authored/ground-projection/presets/st-crit-up.json |
| st-debuff | ring | codex-authored/ground-projection/presets/st-debuff.json |
| st-def-up | ring | codex-authored/ground-projection/presets/st-def-up.json |
| st-invuln | ring | codex-authored/ground-projection/presets/st-invuln.json |
| st-slow | ring | codex-authored/ground-projection/presets/st-slow.json |
| st-thorns | ring | codex-authored/ground-projection/presets/st-thorns.json |
| burst-wind | outer, inner | codex-authored/ground-projection/presets/burst-wind.json |
