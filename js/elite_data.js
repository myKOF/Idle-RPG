'use strict';
/* ============================================================
   elite_data.js — 菁英詞條（技能）定義表
   ------------------------------------------------------------
   菁英敵人身上會帶 1~3 個詞條。這份表只放「長什麼樣、數字多少」，
   行為邏輯在 js/elite.js（只在 Worker 載入）；主執行緒載入這份是為了
   顯示（名稱、圖示、說明、顏色）與 VFX Runtime 預載 preset。

   欄位共通：
     name／emoji／color   顯示用；color 同時是菁英身上光環與地面預警的主色
     kind                 active＝定時施放｜passive＝常駐或被動觸發
     arch                 行為原型（spots／spot／zone／volley／beam／bolt／dash／blink／
                          spin／vortex／shield／reflect／heal／invuln／bloodsac／summon／
                          curse／drain／被動各自的原型），數字欄位依原型而異，見 js/elite.js
     cd                   [最短, 最長] 冷卻秒數（實際再乘參數表的冷卻倍率）
     grp                  同一組互斥：一隻菁英不會同時抽到同組的兩個詞條
     w                    抽中權重（預設 10）
     minStage             最低出現關卡（強力詞條不在前期出現）
     dmg                  傷害倍率（乘菁英攻擊力，再乘參數表的技能傷害倍率）
   特效一律用 vfx/presets/ 既有的 preset：
     地面預警  mark-red／mark-blue 與各色領域魔法陣
     爆發      burst-*  落雷 bolt-*  彈體 proj-*  命中 hit-*  場域 ground-*
   全部登記在 docs/vfx/VFX_PRESET_USAGE_OUTSIDE_TABLES.md（AI_RULES 8.4）。
   ⚠️ preset id 只寫在這份表裡，不得在別處另寫字串（USAGE-3 會掃 js/）。
   ============================================================ */

var ELITE_AFFIXES = {
  /* ───────── 範圍落點類：先在地上畫預警，倒數結束才爆 ───────── */
  meteor: {
    name: '隕石雨', emoji: '☄️', color: '#ff8a3d', kind: 'active', arch: 'spots', grp: 'sky', w: 10,
    cd: [11, 15], busy: 1.6, n: 4, spread: 170, warn: 1.25, step: 0.28, r: 54, dmg: 1.5, elem: 'fire',
    warnPreset: 'mark-red', fall: 'proj-meteor-small', bodyD: 52, burst: 'burst-fire-shockwave-small', burstScale: 1.3,
    dot: { id: 'burn', name: '燃燒', pct: 35, dur: 4 },
    desc: '在你身邊降下數顆隕石，落點先出現紅圈預警，倒數結束後爆炸並使你燃燒。'
  },
  lightningstorm: {
    name: '雷霆風暴', emoji: '⛈️', color: '#7fd2ff', kind: 'active', arch: 'spots', grp: 'sky', w: 10,
    cd: [10, 14], busy: 1.4, n: 5, spread: 150, warn: 0.95, step: 0.32, r: 42, dmg: 1.25, elem: 'lightning',
    warnPreset: 'mark-blue', bolt: 'bolt-sky-lightning', burst: 'burst-detonate', burstScale: 1.2, stun: 0.3,
    desc: '連續降下數道落雷，每道落點先出現藍圈預警；被雷劈中會短暫麻痺。'
  },
  moltenblast: {
    name: '熔岩爆裂', emoji: '🌋', color: '#ff5a2a', kind: 'active', arch: 'spot', grp: 'blast', w: 10,
    cd: [9, 13], busy: 1.8, at: 'player', r: 105, warn: 1.55, warnPreset: 'ground-domain-fire',
    burst: 'burst-fire-shockwave', burstScale: 1.15, dmg: 2.4, elem: 'fire',
    dot: { id: 'burn', name: '燃燒', pct: 40, dur: 4 },
    desc: '鎖定你腳下的位置，火紅魔法陣亮起後爆發烈焰；離開圈外即可躲開。'
  },
  frostnova: {
    name: '冰霜新星', emoji: '❄️', color: '#8fdcff', kind: 'active', arch: 'spot', grp: 'blast', w: 10,
    cd: [10, 14], busy: 1.5, at: 'self', r: 145, warn: 1.25, warnPreset: 'ground-domain-ice',
    burst: 'burst-frost-nova', burstScale: 1.1, dmg: 1.8, elem: 'ice', slow: 3,
    desc: '以自身為中心展開冰藍魔法陣，倒數結束後釋放寒冰新星，傷害並使你減速。'
  },
  quake: {
    name: '地裂震擊', emoji: '🌍', color: '#c9a36a', kind: 'active', arch: 'spot', grp: 'blast', w: 9,
    cd: [12, 16], busy: 1.7, at: 'self', r: 165, warn: 1.45, warnPreset: 'ground-domain-earth',
    burst: 'burst-earth', burst2: 'burst-rock-petrify', burstScale: 1.1, dmg: 2.0, elem: 'earth', stun: 0.9,
    desc: '重擊大地，以自身為中心震裂出大範圍衝擊，被波及者會被震暈。'
  },
  petrify: {
    name: '石化凝視', emoji: '🗿', color: '#b9b2a0', kind: 'active', arch: 'spot', grp: 'blast', w: 8, minStage: 20,
    cd: [13, 18], busy: 1.6, at: 'player', r: 80, warn: 1.45, warnPreset: 'mark-blue',
    burst: 'burst-rock-petrify', burstScale: 1.2, dmg: 1.0, elem: 'earth', stun: 1.5,
    desc: '凝視你所在的位置，倒數結束後將範圍內的目標石化，無法行動片刻。'
  },
  shockwave: {
    name: '震地衝擊', emoji: '💥', color: '#ffd08a', kind: 'active', arch: 'spot', grp: 'blast', w: 8,
    cd: [10, 14], busy: 1.2, at: 'self', r: 180, warn: 0.95, warnPreset: 'mark-red',
    burst: 'burst-detonate-phys', burstScale: 1.35, dmg: 1.3, push: 150,
    desc: '以自身為中心炸出環形衝擊波，被波及者會被推開一大段距離。'
  },

  /* ───────── 持續場域類：地面上留下一塊會持續傷害的區域 ───────── */
  plaguecloud: {
    name: '瘟疫毒雲', emoji: '☠️', color: '#8ee05a', kind: 'active', arch: 'zone', grp: 'field', w: 10,
    cd: [12, 16], busy: 1.2, at: 'player', r: 95, life: 7, tick: 0.5, warn: 0.95, warnPreset: 'mark-red',
    preset: 'ground-mire-venom', dmg: 0.4, elem: 'poison',
    dot: { id: 'poison', name: '中毒', pct: 30, dur: 3 },
    desc: '在你腳下釋放長時間的毒霧，站在裡面會持續受傷並中毒。'
  },
  blizzard: {
    name: '暴風雪', emoji: '🌨️', color: '#bfe9ff', kind: 'active', arch: 'zone', grp: 'field', w: 9,
    cd: [13, 17], busy: 1.2, at: 'player', r: 130, life: 6, tick: 0.5, warn: 1.0, warnPreset: 'mark-blue',
    preset: 'ground-blizzard', dmg: 0.32, elem: 'ice', slow: 1.6,
    desc: '召來一片暴風雪籠罩你的位置，區域內持續受到寒冰傷害並被減速。'
  },
  darkzone: {
    name: '褻瀆領域', emoji: '🌑', color: '#b06cff', kind: 'active', arch: 'zone', grp: 'field', w: 9,
    cd: [12, 16], busy: 1.2, at: 'player', r: 85, life: 8, tick: 0.5, warn: 1.2, warnPreset: 'mark-red',
    preset: 'ground-mire-magma-10', dmg: 0.42, elem: 'dark',
    desc: '在你腳下鋪開暗影領域，持續吞噬站在其中的生命。'
  },
  moltenpool: {
    name: '熔岩足跡', emoji: '🔥', color: '#ff7a1c', kind: 'passive', arch: 'zone', grp: 'trail', w: 10, trail: true,
    cd: [2.6, 3.2], at: 'self', r: 50, life: 7, tick: 0.5, warn: 0, preset: 'ground-mire-lava', dmg: 0.4, elem: 'fire',
    dot: { id: 'burn', name: '燃燒', pct: 25, dur: 3 },
    desc: '走過的地方會留下熔岩池，持續灼燒踩在上面的人。'
  },
  tornado: {
    name: '追獵龍捲', emoji: '🌪️', color: '#9fe8c9', kind: 'active', arch: 'zone', grp: 'field', w: 9,
    cd: [14, 18], busy: 1.0, at: 'self', r: 58, life: 7, tick: 0.4, warn: 0, preset: 'ground-tornado-wind',
    drift: 72, dmg: 0.55, elem: 'wind', slow: 1.2,
    desc: '放出一道緩緩追向你的龍捲風，碰到會持續受傷並被拖慢。'
  },
  thunderorb: {
    name: '雷光球', emoji: '🔵', color: '#6aa8ff', kind: 'active', arch: 'zone', grp: 'field', w: 9,
    cd: [13, 17], busy: 1.0, at: 'self', r: 46, life: 6.5, tick: 0.6, warn: 0, preset: 'ground-thunder-orb',
    drift: 100, dmg: 0.95, elem: 'lightning', stun: 0.2,
    desc: '釋放一顆追著你跑的雷光球，靠近就會被電擊並麻痺。'
  },
  firewall: {
    name: '火焰鎖鏈', emoji: '🔗', color: '#ff6a3a', kind: 'active', arch: 'zone', grp: 'field', w: 9,
    cd: [13, 18], busy: 1.4, at: 'player', w2: 270, h2: 42, life: 4.2, tick: 0.4, warn: 1.1, warnPreset: 'mark-red',
    rect: true, preset: 'ground-firewall', dmg: 0.62, elem: 'fire',
    dot: { id: 'burn', name: '燃燒', pct: 25, dur: 3 },
    desc: '兩端先亮起紅圈，隨後燃起一道橫跨你身側的火牆，接觸會被灼傷。'
  },
  thunderwall: {
    name: '電磁牆', emoji: '🚧', color: '#8ad4ff', kind: 'active', arch: 'zone', grp: 'field', w: 8,
    cd: [13, 18], busy: 1.2, at: 'ahead', w2: 250, h2: 36, life: 4.6, tick: 0.5, warn: 1.0, warnPreset: 'mark-blue',
    rect: true, curtain: true, preset: 'bolt-curtain-lightning', dmg: 0.7, elem: 'lightning', stun: 0.25,
    desc: '在你與它之間豎起一道電牆，穿過去會被電擊麻痺。'
  },
  waterprison: {
    name: '水牢', emoji: '🫧', color: '#58c8e8', kind: 'active', arch: 'zone', grp: 'field', w: 8, minStage: 30,
    cd: [15, 20], busy: 1.2, at: 'player', r: 85, life: 3.4, tick: 0.5, warn: 1.1, warnPreset: 'mark-blue',
    preset: 'field-water-prison-dome', dmg: 0.45, elem: 'ice', slow: 2.2,
    desc: '以水幕罩住你所在的位置，困在水牢中會持續受傷並被嚴重拖慢。'
  },

  /* ───────── 彈體類 ───────── */
  darkorbs: {
    name: '暗影彈幕', emoji: '🔮', color: '#a06cff', kind: 'active', arch: 'volley', grp: 'shot', w: 10,
    cd: [8, 11], busy: 1.4, n: 5, gap: 0.2, travel: 0.9, proj: 'proj-dark-orb', bodyD: 30, hit: 'hit-dark',
    dmg: 0.9, elem: 'dark', hitR: 90,
    desc: '連續射出數顆暗影彈，逐發追向你。'
  },
  poisonspit: {
    name: '劇毒吐息', emoji: '🧪', color: '#7be04a', kind: 'active', arch: 'volley', grp: 'shot', w: 9,
    cd: [8, 11], busy: 1.1, n: 3, gap: 0.28, travel: 0.8, proj: 'proj-poison-drop', hit: 'hit-poison',
    dmg: 0.8, elem: 'poison', hitR: 90, dot: { id: 'poison', name: '中毒', pct: 40, dur: 4 },
    desc: '吐出數團毒液，命中的目標會中毒。'
  },
  iceshards: {
    name: '冰錐齊射', emoji: '🧊', color: '#9fe3ff', kind: 'active', arch: 'volley', grp: 'shot', w: 9,
    cd: [8, 11], busy: 1.2, n: 6, gap: 0.12, travel: 0.7, proj: 'proj-ice-shard', hit: 'hit-ice',
    dmg: 0.62, elem: 'ice', hitR: 95, slow: 1.8,
    desc: '一口氣射出大量冰錐，命中使你減速。'
  },
  fireball: {
    name: '烈焰火球', emoji: '🔥', color: '#ff8c3a', kind: 'active', arch: 'volley', grp: 'shot', w: 10,
    cd: [9, 12], busy: 1.3, n: 1, gap: 0, travel: 1.0, proj: 'proj-fireball', bodyD: 70, hit: 'hit-fire',
    dmg: 2.2, elem: 'fire', hitR: 110, burst: 'burst-fire', burstR: 80,
    dot: { id: 'burn', name: '燃燒', pct: 40, dur: 4 },
    desc: '丟出一顆巨大的火球，落地炸開並點燃目標。'
  },
  windblades: {
    name: '旋風刃', emoji: '🌀', color: '#8fe8c0', kind: 'active', arch: 'volley', grp: 'shot', w: 8,
    cd: [8, 11], busy: 1.2, n: 4, gap: 0.16, travel: 0.6, proj: 'proj-wind-crescent', hit: 'hit-wind',
    dmg: 0.85, elem: 'wind', hitR: 90,
    desc: '連續擲出數道風刃，速度很快。'
  },
  lightningspear: {
    name: '閃電矛', emoji: '🗡️', color: '#9ad8ff', kind: 'active', arch: 'volley', grp: 'shot', w: 8,
    cd: [8, 11], busy: 1.1, n: 3, gap: 0.22, travel: 0.45, proj: 'proj-lightning', hit: 'hit-lightning',
    dmg: 0.95, elem: 'lightning', hitR: 90, stun: 0.25,
    desc: '射出疾速的閃電矛，命中有機會麻痺。'
  },

  /* ───────── 直線與連線類 ───────── */
  arcanebeam: {
    name: '秘法光束', emoji: '🔆', color: '#fff2a8', kind: 'active', arch: 'beam', grp: 'beam', w: 9, minStage: 15,
    cd: [12, 16], busy: 1.8, len: 560, width: 74, warn: 1.15, warnPreset: 'mark-red',
    beamPreset: 'beam-light', dmg: 2.4, elem: 'light',
    desc: '先在地面劃出一條光線預警，隨後沿該直線射出貫穿光束。'
  },
  chainlightning: {
    name: '連鎖閃電', emoji: '⚡', color: '#6fd0ff', kind: 'active', arch: 'bolt', grp: 'beam', w: 9,
    cd: [7, 10], busy: 0.9, bolt: 'bolt-chain-lightning', hit: 'hit-lightning', dmg: 1.5, elem: 'lightning', stun: 0.3,
    desc: '一道電弧瞬間連到你身上，傷害並使你麻痺片刻。'
  },

  /* ───────── 位移類 ───────── */
  charge: {
    name: '野蠻衝鋒', emoji: '🐗', color: '#ff7a5a', kind: 'active', arch: 'dash', grp: 'move', w: 9,
    cd: [11, 15], busy: 2.0, warn: 0.9, warnPreset: 'mark-red', speed: 1150, hitR: 95,
    impact: 'slash-phys-big', burst: 'burst-detonate-phys', dmg: 2.0, stun: 0.5, push: 110,
    desc: '先在你身上標出紅圈，隨後高速衝撞過來，撞上會被擊退並短暫暈眩。'
  },
  blink: {
    name: '瞬影突襲', emoji: '🌀', color: '#b58cff', kind: 'active', arch: 'blink', grp: 'move', w: 9,
    cd: [9, 13], busy: 1.4, dist: 110, warn: 0.5, warnPreset: 'mark-red',
    burst: 'burst-detonate-dark', r: 70, dmg: 1.3, elem: 'dark',
    desc: '消失後瞬間出現在你身旁，並在落點炸出暗影衝擊。'
  },
  whirlwind: {
    name: '旋風斬', emoji: '⚔️', color: '#d8e8ff', kind: 'active', arch: 'spin', grp: 'move', w: 9,
    cd: [10, 14], busy: 1.9, r: 100, ticks: 3, gap: 0.5, warn: 0.55, warnPreset: 'mark-red',
    burst: 'slash-wind-spin', dmg: 0.95,
    desc: '原地高速旋轉連斬數次，身邊一圈都在攻擊範圍內。'
  },
  vortex: {
    name: '虛空漩渦', emoji: '🕳️', color: '#7a5cff', kind: 'active', arch: 'vortex', grp: 'blast', w: 7, minStage: 40,
    cd: [15, 20], busy: 3.2, r: 125, life: 2.6, pull: 105, warn: 0.9, warnPreset: 'mark-blue',
    preset: 'black-hole', burst: 'burst-gravity', dmg: 2.0, elem: 'dark', slow: 2,
    desc: '在附近撕開黑洞，把你往中心拖拽，結束時整個坍縮爆發。'
  },

  /* ───────── 支援與干擾類 ───────── */
  shield: {
    name: '魔法護盾', emoji: '🛡️', color: '#9ad4ff', kind: 'active', arch: 'shield', grp: 'ward', w: 10,
    cd: [13, 17], busy: 0.8, pct: 30, dur: 6, vfx: 'burst-holy', vfxScale: 0.9,
    desc: '為自己展開一層護盾（最大生命的一部分），先打破護盾才能傷到本體。'
  },
  reflectshield: {
    name: '反射護罩', emoji: '🪞', color: '#ffe08a', kind: 'active', arch: 'reflect', grp: 'ward', w: 8, minStage: 20,
    cd: [15, 20], busy: 0.8, dur: 4, pct: 45, vfx: 'burst-detonate-phys',
    desc: '短時間內將受到傷害的一部分反彈給你，罩子亮起時別硬打。'
  },
  invulnaura: {
    name: '庇護光環', emoji: '🔰', color: '#fff6c8', kind: 'active', arch: 'invuln', grp: 'ward', w: 7, minStage: 30,
    cd: [16, 21], busy: 0.8, dur: 2, vfx: 'burst-holy', vfxScale: 0.7,
    desc: '讓整個群體短暫進入無敵，這幾秒打不傷任何成員。'
  },
  heal: {
    name: '神聖治癒', emoji: '✨', color: '#ffe9a0', kind: 'active', arch: 'heal', grp: 'ward2', w: 9,
    cd: [11, 15], busy: 1.2, pct: 18, vfx: 'pillar-light',
    desc: '呼喚光柱治療整個群體（包含自己）一部分生命。'
  },
  summoner: {
    name: '召喚師', emoji: '👥', color: '#d89cff', kind: 'active', arch: 'summon', grp: 'summon', w: 8,
    cd: [13, 18], busy: 1.2, n: 2, vfx: 'burst-detonate-dark',
    desc: '召喚小兵協助戰鬥，數量有上限。'
  },
  bloodsac: {
    name: '血祭', emoji: '🩸', color: '#ff3a52', kind: 'active', arch: 'bloodsac', grp: 'summon2', w: 7,
    cd: [12, 16], busy: 1.0, heal: 22, atk: 12, dur: 8, vfx: 'burst-blood',
    desc: '獻祭身邊一名同伴，自己回復生命並提高攻擊力。'
  },
  curse: {
    name: '衰弱詛咒', emoji: '🧿', color: '#c58cff', kind: 'active', arch: 'curse', grp: 'hex', w: 9,
    cd: [11, 15], busy: 1.0, atkDown: 25, defDown: 20, dur: 7, vfx: 'curse-dark', dmg: 0.5, elem: 'dark',
    desc: '詛咒你，使你的攻擊力與防禦力降低一段時間。'
  },
  manadrain: {
    name: '魔力吸取', emoji: '💧', color: '#5aa8ff', kind: 'active', arch: 'drain', grp: 'hex', w: 8,
    cd: [10, 14], busy: 1.0, mp: 14, heal: 8, proj: 'proj-light-orb', bodyD: 24, dmg: 0.6, elem: 'light',
    desc: '抽走你一部分法力，並用來治療自己。'
  },

  /* ───────── 常駐與被動類 ───────── */
  regen: {
    name: '再生', emoji: '💚', color: '#6dfb8f', kind: 'passive', arch: 'regen', grp: 'regen', w: 9,
    cd: [2, 2], pct: 1.6, vfx: 'burst-holy',
    desc: '持續回復自身生命，不盡快擊殺就會越打越久。'
  },
  haste: {
    name: '迅捷', emoji: '💨', color: '#a8f0ff', kind: 'passive', arch: 'haste', grp: 'speed', w: 9,
    aspd: 1.5, run: 1.6,
    desc: '攻擊速度與移動速度大幅提高。'
  },
  giant: {
    name: '巨像', emoji: '🗿', color: '#d8b48a', kind: 'passive', arch: 'giant', grp: 'body', w: 9,
    hp: 1.6, red: 25, scale: 1.3,
    desc: '體型與生命大幅提升，並額外減少受到的傷害。'
  },
  enrage: {
    name: '狂暴', emoji: '😡', color: '#ff4a3a', kind: 'passive', arch: 'enrage', grp: 'rage', w: 9,
    hpPct: 45, atk: 1.6, aspd: 1.4, vfx: 'burst-blood',
    desc: '生命降到一定比例時進入狂暴，攻擊力與攻擊速度大幅提升。'
  },
  vampiric: {
    name: '嗜血', emoji: '🧛', color: '#ff5a7a', kind: 'passive', arch: 'vampiric', grp: 'leech', w: 9,
    pct: 55, proj: 'proj-bloodrage-drain',
    desc: '每次擊中你都會把造成傷害的一部分吸成自己的生命。'
  },
  thorns: {
    name: '荊棘', emoji: '🌵', color: '#8ad46a', kind: 'passive', arch: 'thorns', grp: 'reflect', w: 9,
    pct: 14, cap: 20, hit: 'hit-phys',
    desc: '你打到它時會受到一部分反震傷害。'
  },
  knockback: {
    name: '擊飛', emoji: '🥊', color: '#ffd27a', kind: 'passive', arch: 'knockback', grp: 'push', w: 8,
    chance: 28, dist: 95, stun: 0.35, vfx: 'burst-wind',
    desc: '普通攻擊有機會把你擊退一段距離並使你踉蹌。'
  },
  lifelink: {
    name: '生命鏈結', emoji: '⛓️', color: '#ff7ad0', kind: 'passive', arch: 'lifelink', grp: 'link', w: 9,
    share: 50,
    desc: '與群體中其他有鏈結的成員分攤傷害，只打一隻很難打死，要集火或打斷鏈結。'
  },
  phoenix: {
    name: '不死鳥', emoji: '🕊️', color: '#ffb35a', kind: 'passive', arch: 'phoenix', grp: 'death', w: 7, minStage: 25,
    hp: 35, vfx: 'burst-fire', vfx2: 'pillar-light',
    desc: '第一次死亡時會浴火重生，帶著一部分生命站起來。'
  },
  bomber: {
    name: '自爆', emoji: '💣', color: '#ff9a3a', kind: 'passive', arch: 'bomber', grp: 'death', w: 8,
    delay: 1.6, r: 105, dmg: 2.6, warnPreset: 'mark-red', burst: 'burst-explosion-sheet', elem: 'fire',
    desc: '死亡後原地留下紅圈，倒數結束就爆炸，擊殺後要馬上走開。'
  },
  splitter: {
    name: '分裂', emoji: '🧬', color: '#9cff8a', kind: 'passive', arch: 'splitter', grp: 'death', w: 8,
    n: 2, hp: 30, atk: 65, vfx: 'burst-zero-infection',
    desc: '死亡時分裂成數隻較弱的分身。'
  }
};

var ELITE_AFFIX_ORDER = Object.keys(ELITE_AFFIXES);

/* VFX Runtime 預載清單：collectPresetIds 會掃這個物件裡每一個字串值。
   只收「真的存在於 vfx/presets/ 的 id」；非 preset 的字串（名稱、顏色）不放進來。 */
var ELITE_VFX_PRESETS = (function () {
  var skip = { name: 1, emoji: 1, color: 1, kind: 1, arch: 1, grp: 1, desc: 1, elem: 1, at: 1, id: 1 };
  var out = Object.create(null);
  ELITE_AFFIX_ORDER.forEach(function (key) {
    var def = ELITE_AFFIXES[key];
    (function walk(v, k) {
      if (typeof v === 'string') {
        if (!skip[k] && /^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(v)) out[v] = true;
        return;
      }
      if (v && typeof v === 'object') for (var kk in v) walk(v[kk], kk);
    })(def, '');
  });
  /* 不屬於任何詞條、由 js/elite.js 共用的施法光（eliteSelfPulse 的預設） */
  ['cast-buff-dark'].forEach(function (id) { out[id] = true; });
  return Object.keys(out).sort();
})();

function eliteAffixDef(id) { return (id && ELITE_AFFIXES[id]) || null; }
/* 顯示用：「🔥熔岩足跡」。 */
function eliteAffixLabel(id) {
  var d = eliteAffixDef(id);
  return d ? (d.emoji + d.name) : String(id || '');
}
