'use strict';
/* 寶石種類表：GEM_TYPES 的每個 key 對應一份外觀。
   規則：48 種各有自己的顏色，不允許兩種長得一樣。顏色撞了就加第二色（acc）：
     acc＋accMode：grad 斜向漸層／center 中心換色／rim 外緣換色／facet 部分刻面換色。
   家族：plain 一般刻面；core 內部有發光核心（元素傷害提升「核」）；ward 元素抗性（「抗」，沒有專屬造型）。
   光暈（寶石後方的圓形柔光）只看階數：1～5 階沒有、6 階起淡淡出現、10 階最濃＝原抗性寶石的大光暈（強度表 gem-core.cjs TIERS.glow）；
   glow 欄位只決定光暈「顏色」，抗性寶石的光暈色與本體色相不同，所以 6 階起仍認得出。
   同一元素的三個家族色系相近（玩家記得住元素），但主色、第二色、核心光／光暈色都不同。
   改完請跑 node tools/gems/gem-audit.cjs 檢查兩兩顏色距離。 */
const { hsl } = require('./gem-core.cjs');

function pal(h, s, o) {
  o = o || {};
  const p = {
    dark: hsl(h + (o.dh1 || 0), s * (o.sd === undefined ? 1 : o.sd), o.ld === undefined ? 0.15 : o.ld),
    base: hsl(h, s, o.lb === undefined ? 0.43 : o.lb),
    light: hsl(h + (o.dh2 || 0), s * 0.92, o.ll === undefined ? 0.67 : o.ll),
    hi: hsl(h + (o.dh2 || 0), s * 0.35, o.lh === undefined ? 0.94 : o.lh),
    glow: hsl(h + (o.dhg || 0), s, o.lg === undefined ? 0.52 : o.lg)
  };
  if (o.dark) p.dark = o.dark;
  if (o.hi) p.hi = o.hi;
  if (o.glow) p.glow = o.glow;
  if (o.core) p.core = o.core;
  return p;
}

const D = {};
function def(key, o) { D[key] = Object.assign({ family: 'plain', trans: 1 }, o); }

// ---- 基礎寶石 ----
def('ruby', { pal: pal(355, 0.9, { dh1: 4, dh2: 8 }) });
def('sapphire', { pal: pal(224, 0.9, { dh1: -4, dh2: -6 }) });
def('topaz', { pal: pal(42, 0.96, { dh1: -12, dh2: 8, lb: 0.5 }), acc: pal(20, 0.95, { dh1: -8, lb: 0.46 }), accMode: 'grad', accAngle: 1.1 });
def('emerald', { pal: pal(146, 0.88, { dh1: 14, dh2: 14 }) });
def('iolite', { pal: pal(270, 0.74, { dh1: -8, dh2: -10 }), acc: pal(212, 0.5, { lb: 0.5, ll: 0.72 }), accMode: 'grad', accAngle: -0.6 });
def('kyanite', { pal: pal(214, 0.92, { dh1: 18, lb: 0.44 }), acc: pal(172, 0.85, { lb: 0.46, ll: 0.7 }), accMode: 'grad', accAngle: 0.5, tex: { kind: 'bands', freq: 1.6, ax: 0.35, ay: 0.9, alt: hsl(205, 0.95, 0.84), amt: 0.3 } });
def('diamond', { pal: pal(205, 0.2, { dark: hsl(218, 0.5, 0.28), lb: 0.68, ll: 0.88, lh: 1, glow: hsl(200, 0.5, 0.82) }), tex: { kind: 'fire' }, envW: 0.7 });
def('lapis', { pal: pal(228, 0.82, { lb: 0.3, ld: 0.09, ll: 0.48, lh: 0.8 }), trans: 0.25, tex: { kind: 'flecks', alt: hsl(45, 0.92, 0.64), vein: hsl(215, 0.5, 0.86) } });
def('amethyst', { pal: pal(278, 0.7, { lb: 0.52, ll: 0.76, dh2: -8 }), acc: pal(324, 0.7, { lb: 0.58, ll: 0.8 }), accMode: 'grad', accAngle: 0.7 });
def('garnet', { pal: pal(350, 0.72, { lb: 0.3, ld: 0.07, ll: 0.47, dh1: -14, dh2: -6 }), acc: pal(22, 0.85, { lb: 0.34, ld: 0.1, ll: 0.52 }), accMode: 'center' });
def('opal', { pal: pal(44, 0.4, { dh1: -14, lb: 0.8, ld: 0.5, ll: 0.92, lh: 1, glow: hsl(40, 0.6, 0.75) }), trans: 0.55, tex: { kind: 'patches' } });
def('onyx', { pal: pal(250, 0.14, { lb: 0.13, ld: 0.03, ll: 0.36, lh: 0.82, glow: hsl(255, 0.3, 0.3) }), trans: 0.2, shin: 70, glowW: 0.7 });
def('moonstone', { pal: pal(228, 0.5, { lb: 0.62, ld: 0.34, ll: 0.82, lh: 0.98 }), trans: 0.45, tex: { kind: 'sheen', alt: hsl(210, 0.9, 0.86), w: 0.34, add: 0.3 } });
def('catseye', { pal: pal(72, 0.74, { lb: 0.4, ld: 0.12, ll: 0.58, dh2: -12 }), acc: pal(108, 0.7, { lb: 0.36, ll: 0.56 }), accMode: 'grad', accAngle: 0.4, trans: 0.45, tex: { kind: 'slit', alt: hsl(62, 0.95, 0.9) } });
def('sunstone', { pal: pal(10, 0.66, { lb: 0.6, ld: 0.28, ll: 0.78, dh1: -8, dh2: 18, glow: hsl(14, 0.85, 0.6) }), trans: 0.6, tex: { kind: 'glitter', amt: 0.9 } });
def('piercePhys', { pal: pal(216, 0.4, { lb: 0.26, ld: 0.05, ll: 0.5, lh: 0.88 }), acc: pal(200, 0.12, { lb: 0.62, ll: 0.86, lh: 1 }), accMode: 'rim', envW: 0.95, jitter: 0.26, trans: 0.8 });
def('pierceMagic', { pal: pal(318, 0.86, { dh1: -18, dh2: 6 }), acc: pal(190, 0.85, { lb: 0.5, ll: 0.74, hi: hsl(185, 0.7, 0.93) }), accMode: 'grad', accAngle: 0.5 });
// ---- 防禦 ----
def('jade', { pal: pal(150, 0.45, { lb: 0.46, ld: 0.18, ll: 0.66 }), trans: 0.35, tex: { kind: 'mottle', alt: hsl(150, 0.4, 0.76) } });
def('turquoise', { pal: pal(178, 0.72, { lb: 0.5, ll: 0.68 }), trans: 0.3, tex: { kind: 'veins', alt: hsl(28, 0.55, 0.22) } });
def('agate', { pal: pal(24, 0.62, { lb: 0.42 }), trans: 0.35, tex: { kind: 'bands', concentric: true, freq: 3.2, alt: hsl(36, 0.5, 0.84) } });
def('pearl', { pal: pal(345, 0.2, { lb: 0.82, ld: 0.52, ll: 0.93, lh: 1 }), trans: 0.3, tex: { kind: 'sheen', alt: hsl(185, 0.55, 0.86), w: 0.4, add: 0.18, angle: -0.9 } });
def('malachite', { pal: pal(154, 0.78, { lb: 0.3, ld: 0.07, ll: 0.5, lh: 0.85 }), trans: 0.25, tex: { kind: 'bands', concentric: true, freq: 3.6, alt: hsl(150, 0.75, 0.12) } });
def('fluorite', { pal: pal(182, 0.72, { lb: 0.5 }), acc: pal(278, 0.72, { lb: 0.5 }), accMode: 'grad', accAngle: 1.0, trans: 0.85 });

// ---- 對屬性敵人傷害（plain）----
def('spinel', { pal: pal(8, 0.95, { dh1: -10, dh2: 14, ll: 0.64 }), acc: pal(38, 1, { lb: 0.52, ll: 0.74, dh1: -10 }), accMode: 'center' });
def('aquamarine', { pal: pal(190, 0.75, { dh1: 26, lb: 0.54, ll: 0.8 }), acc: pal(224, 0.88, { lb: 0.42, ll: 0.62 }), accMode: 'rim' });
def('amazonite', { pal: pal(54, 0.98, { dark: hsl(38, 0.95, 0.24), lb: 0.5, ll: 0.72, lh: 0.97 }), acc: pal(226, 0.92, { lb: 0.46, ll: 0.7 }), accMode: 'rim', glow: hsl(60, 1, 0.55) });
def('peridot', { pal: pal(92, 0.88, { dh1: 20, lb: 0.45 }), acc: pal(288, 0.7, { lb: 0.4, ll: 0.64 }), accMode: 'rim' });
def('citrine', { pal: pal(50, 0.8, { lb: 0.62, ld: 0.28, ll: 0.82, lh: 1 }), acc: pal(18, 0.35, { lb: 0.82, ll: 0.93 }), accMode: 'center' });
def('tourmaline', { pal: pal(196, 0.42, { lb: 0.2, ld: 0.04, ll: 0.4, lh: 0.8 }), acc: pal(324, 0.84, { lb: 0.42, ll: 0.66 }), accMode: 'rim', glow: hsl(318, 0.7, 0.5) });
def('tigerEye', { pal: pal(30, 0.64, { lb: 0.36, ld: 0.1, ll: 0.55, dh2: 8, lg: 0.42 }), trans: 0.4, tex: { kind: 'chatoyant', freq: 3.4, alt: hsl(42, 0.88, 0.6) } });
def('moldavite', { pal: pal(160, 0.62, { lb: 0.5, ll: 0.74 }), acc: pal(198, 0.72, { lb: 0.55, ll: 0.8 }), accMode: 'grad', accAngle: 0.9 });

// ---- 元素傷害提升（core）：暗色本體＋明亮的核心，核心色與本體色相不同 ----
def('coreFire', { family: 'core', pal: pal(358, 0.86, { lb: 0.3, ld: 0.07, ll: 0.5, core: hsl(48, 1, 0.86) }), acc: pal(28, 1, { lb: 0.5 }), accMode: 'center', glow: hsl(28, 1, 0.5) });
def('coreIce', { family: 'core', pal: pal(240, 0.82, { lb: 0.24, ld: 0.05, ll: 0.5, core: hsl(190, 0.95, 0.95) }), acc: pal(196, 0.9, { lb: 0.5 }), accMode: 'center', glow: hsl(196, 0.95, 0.55) });
def('coreLightning', { family: 'core', pal: pal(268, 0.72, { lb: 0.32, ld: 0.08, ll: 0.55, core: hsl(56, 1, 0.92) }), acc: pal(54, 1, { lb: 0.52 }), accMode: 'center', glow: hsl(54, 1, 0.55) });
def('corePoison', { family: 'core', pal: pal(145, 0.82, { lb: 0.26, ld: 0.06, ll: 0.46, core: hsl(76, 1, 0.84) }), acc: pal(80, 1, { lb: 0.5 }), accMode: 'center', glow: hsl(86, 1, 0.5) });
def('coreLight', { family: 'core', pal: pal(30, 0.95, { lb: 0.48, ll: 0.68, core: hsl(48, 1, 0.98) }), acc: pal(52, 0.7, { lb: 0.78, ll: 0.93 }), accMode: 'center', glow: hsl(42, 1, 0.62) });
def('coreDark', { family: 'core', pal: pal(286, 0.56, { lb: 0.2, ld: 0.04, ll: 0.4, core: hsl(312, 0.92, 0.78) }), acc: pal(320, 0.9, { lb: 0.46 }), accMode: 'center', glow: hsl(310, 0.8, 0.5) });
def('coreEarth', { family: 'core', pal: pal(42, 0.6, { lb: 0.26, ld: 0.07, ll: 0.46, core: hsl(42, 0.96, 0.76) }), acc: pal(32, 0.95, { lb: 0.5 }), accMode: 'center', glow: hsl(36, 0.9, 0.48) });
def('coreWind', { family: 'core', pal: pal(156, 0.74, { lb: 0.3, ld: 0.06, ll: 0.54, core: hsl(150, 0.85, 0.95) }), acc: pal(132, 0.6, { lb: 0.68, ll: 0.9 }), accMode: 'center', glow: hsl(150, 0.8, 0.55) });

// ---- 元素抗性（ward）：光暈色（glow）與本體色相不同 ----
def('wardFire', { family: 'ward', pal: pal(26, 0.82, { dh1: -12, lb: 0.36, ld: 0.08, ll: 0.58 }), acc: pal(46, 1, { lb: 0.52, ll: 0.76 }), accMode: 'center', glow: hsl(46, 1, 0.64) });
def('wardIce', { family: 'ward', pal: pal(232, 0.62, { lb: 0.52, ld: 0.16, ll: 0.8 }), acc: pal(190, 0.7, { lb: 0.82, ll: 0.95 }), accMode: 'center', glow: hsl(194, 0.95, 0.86) });
def('wardLightning', { family: 'ward', pal: pal(57, 0.96, { lb: 0.5 }), acc: pal(285, 0.7, { lb: 0.4 }), accMode: 'rim', glow: hsl(272, 0.85, 0.78) });
def('wardPoison', { family: 'ward', pal: pal(96, 0.9, { lb: 0.46, ld: 0.12, ll: 0.74 }), acc: pal(52, 0.9, { lb: 0.7, ll: 0.9 }), accMode: 'center', glow: hsl(86, 0.95, 0.58) });
def('wardDark', { family: 'ward', pal: pal(268, 0.62, { lb: 0.4, ld: 0.09, ll: 0.62 }), acc: pal(236, 0.5, { lb: 0.3, ld: 0.06 }), accMode: 'rim', glow: hsl(296, 0.6, 0.78) });
def('wardLight', { family: 'ward', pal: pal(20, 0.42, { lb: 0.78, ld: 0.36, ll: 0.9, lh: 1 }), acc: pal(40, 0.95, { lb: 0.55 }), accMode: 'rim', glow: hsl(50, 1, 0.84) });
def('wardEarth', { family: 'ward', pal: pal(32, 0.7, { lb: 0.38, ld: 0.1, ll: 0.58 }), acc: pal(100, 0.5, { lb: 0.34, ll: 0.56 }), accMode: 'rim', glow: hsl(96, 0.6, 0.56) });
def('wardWind', { family: 'ward', pal: pal(202, 0.5, { lb: 0.6, ld: 0.22, ll: 0.82 }), acc: pal(178, 0.55, { lb: 0.78, ll: 0.94 }), accMode: 'grad', accAngle: 0.9, glow: hsl(176, 0.7, 0.9) });
def('wardAll', { family: 'ward', pal: pal(200, 0.2, { lb: 0.74, ld: 0.34, ll: 0.9, lh: 1 }), tex: { kind: 'rainbow' }, glow: hsl(280, 0.5, 0.78) });

module.exports = D;
