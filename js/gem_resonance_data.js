'use strict';
/* ============ 寶石共鳴：資料表（配置表 Gem_resonance → 本檔） ============
   本檔三個 var 區塊由 tools/config_tables.cjs 從 config/CSV/Gem_resonance.csv 整段重建，
   區塊內的註解不會保留，說明一律寫在這裡。邏輯在 js/gem_resonance.js（兩端共載）。

   版面：7 個區域各 7 孔（孔 0＝中心，孔 1~6＝外圈，從正上方順時針）。
   區域順序＝版面順序：前 6 個是外圍區（從正上方順時針），最後 1 個是中央區。
   SETTINGS.perLevelPct  孔每升 1 級，讓「相鄰孔的寶石」多算幾 %。
   SETTINGS.maxPct       上述加成的上限 %。
   REGIONS[i].types      可鑲的寶石種類（GEM_TYPES 的鍵）；null＝不限種類。
   REGIONS[i].centerCap  中心孔可放的寶石數（外圈孔一律 1 顆）。
   REGIONS[i].minLv      各孔的最低寶石階：[中心, 外圈 1~6]；更高階可鑲，更低階不行。
   UPGRADES[n-1]         孔從 n-1 升到 n 級的花費：金幣、同種寶石的階級與顆數（同種＝該孔目前鑲的寶石種類）。
                         陣列長度＝孔的等級上限。 */
var GEM_RESONANCE_SETTINGS = { perLevelPct: 3, maxPct: 30 };
var GEM_RESONANCE_REGIONS = [
  { id: 'magic', name: '魔法傷害', types: ['sapphire', 'pierceMagic', 'iolite', 'amethyst'], centerCap: 2, minLv: [6, 4, 4, 5, 5, 5, 4] },
  { id: 'defense', name: '防禦', types: ['diamond', 'lapis', 'topaz', 'moonstone', 'jade', 'pearl', 'malachite', 'fluorite'], centerCap: 2, minLv: [6, 4, 4, 4, 5, 5, 5] },
  { id: 'elemRes', name: '元素抗性', types: ['wardFire', 'wardIce', 'wardLightning', 'wardPoison', 'wardDark', 'wardLight', 'wardEarth', 'wardWind', 'wardAll'], centerCap: 2, minLv: [6, 5, 4, 4, 4, 5, 5] },
  { id: 'elemDmg', name: '屬性傷害', types: ['spinel', 'aquamarine', 'amazonite', 'peridot', 'citrine', 'tourmaline', 'tigerEye', 'moldavite', 'coreFire', 'coreIce', 'coreLightning', 'corePoison', 'coreLight', 'coreDark', 'coreEarth', 'coreWind'], centerCap: 2, minLv: [6, 5, 5, 4, 4, 4, 5] },
  { id: 'recover', name: '回復', types: ['emerald', 'kyanite', 'onyx', 'manastone'], centerCap: 2, minLv: [6, 5, 5, 5, 4, 4, 4] },
  { id: 'phys', name: '物理傷害', types: ['ruby', 'piercePhys', 'opal', 'catseye', 'garnet'], centerCap: 2, minLv: [6, 4, 5, 5, 5, 4, 4] },
  { id: 'core', name: '任意', types: null, centerCap: 6, minLv: [10, 8, 8, 8, 8, 8, 8] }
];
var GEM_RESONANCE_UPGRADES = [
  { gold: 5000, gemLv: 1, gemCount: 3 },
  { gold: 15000, gemLv: 2, gemCount: 3 },
  { gold: 45000, gemLv: 3, gemCount: 3 },
  { gold: 135000, gemLv: 4, gemCount: 3 },
  { gold: 405000, gemLv: 5, gemCount: 3 },
  { gold: 1215000, gemLv: 6, gemCount: 1 },
  { gold: 3645000, gemLv: 7, gemCount: 1 },
  { gold: 10935000, gemLv: 8, gemCount: 1 },
  { gold: 32805000, gemLv: 9, gemCount: 1 },
  { gold: 98415000, gemLv: 10, gemCount: 1 }
];
