'use strict';
/* VFX 特效目錄（設計定案）——驅動兩件事：
   1. 要製作哪些 Preset（PRESETS：id → 家族／製作簡述／名目尺寸）
   2. 技能表／狀態表每一列的特效欄位填什麼（SKILLS_VFX／SKILLS2_VFX／STATUS_VFX／COMBAT_DEFAULTS）

   欄位（角色）語意：
     cast        施放特效：施放當下在施法者身上（自身增益的光環、施法閃光）
     attack      攻擊特效：攻擊本體——斬擊弧、範圍爆發、光束、天降雷柱、敵身詛咒符文、自身護罩
     projectile  飛行子彈：會移動的東西——投射物、連鎖跳段、天降的落體、環繞體
     hit         受擊特效：傷害落到目標身上那一刻的爆點
     ground      地板特效：持續存在的場域——泥沼、火牆、暴風雪、龍捲、軌道環、落點預警
   狀態表：apply 施加特效（第一次出現）／aura 持續特效（掛在身上循環）／tick 作用特效（每跳）

   名目尺寸慣例（Preset 以此尺寸繪製，Runtime 再依實際幾何縮放）：
     hit／cast／curse：以目標身高 60px 為基準，主體約 40px
     burst／ground（圓形）：名目半徑 100px → Runtime scale = area.r / 100
     ground（矩形）：名目 200×100px → scaleX = w/200、scaleY = h/100
     beam／chain 段：沿 +X 軸長 200px → scaleX = 距離/200
     projectile：朝 +X 飛，主體約 40px 長（火球、隕石另註）
     bolt（天降）：從 y=-500 落到原點 (0,0)，原點＝著地點
     orb（環繞體）：名目半徑 20px → scale = area.orbR / 20
     status aura：目標身高 60px、原點在腳底
*/

const ELEM_THEME = {
  light: { c1: '#ffe47a', c2: '#fffef4', glow: '#fff3a3' },
  dark: { c1: '#6f2da8', c2: '#1a0c2e', glow: '#913dcc' },
  fire: { c1: '#e63924', c2: '#ffd447', glow: '#ff6a2a' },
  ice: { c1: '#4da6ff', c2: '#f2fbff', glow: '#79d8ff' },
  lightning: { c1: '#f2b705', c2: '#fff8b0', glow: '#ffd23f' },
  earth: { c1: '#ad7444', c2: '#5b3a27', glow: '#c48a55' },
  poison: { c1: '#4caf2b', c2: '#d8ff8a', glow: '#76d83b' },
  wind: { c1: '#86efac', c2: '#ffffff', glow: '#b9f6cf' },
  phys: { c1: '#e6ddc8', c2: '#ffffff', glow: '#f5ecd6' },
  magic: { c1: '#8ea2ff', c2: '#e6ecff', glow: '#a9b8ff' },
  bleed: { c1: '#d92846', c2: '#ffd0d8', glow: '#ff4962' },
  purple: { c1: '#c084fc', c2: '#fdf4ff', glow: '#9333ea' },
  water: { c1: '#38bdf8', c2: '#f0f9ff', glow: '#0284c7' },
  enemy: { c1: '#ff6b6b', c2: '#ffd0d0', glow: '#ff3b3b' }
};

/* ---------- Preset 清單 ---------- */
const P = {};
function def(id, family, brief, opts) { P[id] = Object.assign({ family: family, brief: brief }, opts || {}); }

/* 受擊 hit（一次性 0.3～0.45s；Runtime 強力版以 scale 1.6 播放） */
['phys', 'fire', 'ice', 'lightning', 'poison', 'light', 'dark', 'earth', 'wind'].forEach(function (e) {
  def('hit-' + e, 'hit', '受擊爆點（' + e + '）：中心閃光 + 擴散細環（半徑 6→18px）+ 6 顆加法混合火花向外飛並受重力下墜；'
    + '主色 ' + ELEM_THEME[e].c1 + '、亮部 ' + ELEM_THEME[e].c2 + '。元素形狀差異：fire 火花偏向上飄、ice 用菱形碎片、lightning 用細電弧絲、poison 用空心泡泡緩慢上浮、light 白金塵點、dark 內縮漩渦後爆開、earth 方形碎石、wind 細長風刃碎片、phys 方形碎片。',
    { nominal: 'target 60px', dur: 0.4, elem: e });
});
def('hit-bleed', 'hit', '流血受擊：暗紅 #d92846 中心閃光 + 亮粉紅 #ffd0d8 血滴向下濺落（6 顆、受重力），無畫面震動。', { nominal: 'target 60px', dur: 0.45 });
def('hit-fire-explosion', 'hit', '大型火球爆炸：橘紅核心 #c51e0d 閃光 + 環（半徑 6→60px，0.62s）+ 14～22 顆黃橘火花 #ffd447 高速四散並下墜；用於火球爆裂／小火球落地。', { nominal: 'r 60px', dur: 0.7 });
def('hit-thunder-purple', 'hit', '紫雷受擊：#c084fc 環 + #fdf4ff 電花 10 顆、#9333ea 外暈；比一般受擊大（半徑 6→24px）。', { nominal: 'target 60px', dur: 0.45 });
def('hit-enemy', 'hit', '敵方攻擊命中我方：紅 #ff6b6b 小環 + 4 顆淡紅塵點；輕量。', { nominal: 'target 60px', dur: 0.3 });

/* 斬擊本體 slash（attack 角色，phys 系） */
def('slash-phys', 'slash', '單道斬擊弧：半徑 36px 的弧線從左上掃到右下（0.24s），主色暖白 #e6ddc8 寬 7→3px、內側白色細弧；用素材 slash_* 或 trace 條紋配 rotationOverLife 掃動。', { nominal: 'R 36px', dur: 0.3 });
def('slash-phys-big', 'slash', '大型斬擊弧：同 slash-phys 但半徑 54px、更亮；普攻劍氣、疾風連斬亂舞使用。', { nominal: 'R 54px', dur: 0.3 });
def('slash-bloodblade', 'slash', '血刃斬：半徑 40px 的紅色 #d92846 斬弧 + 幾滴血珠飛濺。', { nominal: 'R 40px', dur: 0.32 });
def('slash-dual', 'slash', '雙刀亂舞：兩道交叉的暖白斬弧（X 形，各半徑 40px）錯開 0.06s 出現，加少量白色火花。', { nominal: 'R 40px', dur: 0.35 });
def('slash-cleave-arc', 'slash', '迴旋斬弧：藍色 #60a5fa 弧線（名目半徑 30px，寬 4.8px）由 -53° 掃到 +59°（0.5s），內側淺藍 #bfdbfe 細弧；原點＝玩家、+X＝面向。Runtime 以 rangeScale 縮放，震碎斬時整體沿 +X 前進。', { nominal: 'R 30px', dur: 0.5 });
def('slash-cleave-sector', 'slash', '迴身四方斬扇形：60° 楔形（名目半徑 100px、頂點在原點、朝 +X），藍色 #60a5fa 填色 α0.2 + 邊緣亮線 + 兩條淺藍徑向邊；由 8% 長到 95% 半徑並整體旋轉 45°/s，尾段淡出。', { nominal: 'R 100px', dur: 0.5 });
def('slash-gale-sector', 'slash', '疾風斬半圓：180° 半碟（名目半徑 100px、朝 +X），風系淺綠 #86efac 填色 α0.2 + 白色 #ffffff 外緣，8%→95% 放大並旋轉 45°/s。', { nominal: 'R 100px', dur: 0.5 });
def('slash-thrust-lance', 'slash', '突刺光槍：沿 +X 從原點刺出的金色光槍（名目長 100px、寬 36px），加法混合、亮金 #ffd166 中心線 + 古銅 #a86d2d 邊；前 40% 從根部往尖端顯露、80% 後淡出。Runtime 以 scaleX = lineLength/100、scaleY = lineWidth/36。', { nominal: 'L 100px', dur: 0.3 });
def('slash-wind-crescent', 'slash', '真空斬：從原點朝 +X 展開的風系新月（名目寬 75px、深 33px），淺綠 #86efac 填色 + 白色 #ffffff 內芯與描邊，0.32s 內由 55% 長到 100% 並淡至 15%。', { nominal: 'W 75px', dur: 0.32 });
def('slash-wind-spin', 'slash', '真空迴旋：以原點為中心的扁橢圓風環（名目半徑 60px、縱向壓 0.62），淺綠 #86efac 粗環 + 白色細環 + 4 片白色刀影繞一圈（0.42s），整體淡出。', { nominal: 'R 60px', dur: 0.42 });
def('slash-enemy-melee', 'slash', '敵方近戰爪痕：紅 #ff6b6b 半徑 36px 斬弧 + 白色內弧，方向由 Runtime 依敵→我方角度旋轉。', { nominal: 'R 36px', dur: 0.26 });

/* 飛行物 projectile（朝 +X） */
def('proj-swordwave', 'projectile', '普攻劍氣：暖白 #e6ddc8 新月形劍氣（約 30px）+ 淡金拖尾條紋（trace 素材、alignToVelocity），微光暈。', { nominal: 'L 30px', dur: 1.2 });
def('proj-knife', 'projectile', '飛刀：銀白細長飛鏢（約 28×10px、streak 素材）繞自身快速旋轉，極淡紅 #ff3850 光暈 + 短白色拖尾。', { nominal: 'L 28px', dur: 1.2 });
def('proj-knife-gold', 'projectile', '追魂刃：金色 #f2b705 飛鏢 + 明亮金光暈 #ffd23f α0.9 + 淡黃 #fff8b0 拖尾火花。', { nominal: 'L 28px', dur: 1.2 });
def('proj-fireball', 'projectile', '火球（大）：直徑約 40px 的火焰核心（#ffd447 內芯、#e63924 外焰、加法混合）+ 朝 -X 拖出約 45px 的火舌尾（flame 素材、scaleXOverLife 抖動）+ 少量餘燼火花；用於火球術本體與小火球（Runtime 以 scale 0.6 播小火球）。', { nominal: 'L 85px', dur: 1.5 });
def('proj-fire', 'projectile', '火屬性投射物（通用）：火紅 #e63924 圓球 + 黃 #ffd447 內芯 + 橘光暈 #ff6a2a + 火花拖尾。', { nominal: 'D 14px', dur: 1.2 });
def('proj-ice-shard', 'projectile', '冰箭：菱形冰晶（18×22px，#4da6ff 填色、#f2fbff 邊）+ 淡藍光暈 #79d8ff + 白色冰塵拖尾。', { nominal: 'L 22px', dur: 1.2 });
def('proj-lightning', 'projectile', '雷屬性投射物：金黃 #f2b705 鋸齒電弧（26×10px，spark_05/06 素材）閃爍 + #ffd23f 光暈 + 電花拖尾。', { nominal: 'L 26px', dur: 1.2 });
def('proj-poison-drop', 'projectile', '毒屬性投射物：綠色 #4caf2b 水滴（15×17px）+ 亮綠 #d8ff8a 高光 + 綠光暈、左右微擺的毒泡拖尾。', { nominal: 'L 17px', dur: 1.2 });
def('proj-light-orb', 'projectile', '聖光／奧術投射物：白金 #fffef4 核心 + 金黃 #ffe47a 光暈 + 旋轉十字星芒（star_08）+ 金塵拖尾。', { nominal: 'D 16px', dur: 1.2 });
def('proj-dark-orb', 'projectile', '暗影投射物：深紫 #1a0c2e 核心 + 紫 #6f2da8 漩渦（twirl 素材旋轉）+ 紫光暈 #913dcc + 暗紫煙拖尾。', { nominal: 'D 18px', dur: 1.2 });
def('proj-earth-rock', 'projectile', '土屬性投射物：棕 #ad7444 方形岩塊（16px、緩慢旋轉）+ 深棕 #5b3a27 陰影 + 土黃塵土拖尾。', { nominal: 'L 16px', dur: 1.2 });
def('proj-wind-crescent', 'projectile', '風刃：淺綠 #86efac 新月刀刃（名目寬 40px、深 16px，尖端朝 +X）+ 白色 #ffffff 內芯與描邊 + 白色細拖尾；Runtime 以 scaleY = lineWidth/40、scaleX = bodyLength/16。', { nominal: 'W 40px', dur: 1.5 });
def('proj-arcane-missile', 'projectile', '奧術飛彈：小型淡藍紫 #8ea2ff 光球（直徑 12px）+ 光暈 + 亮白拖尾條；奧術彈幕六發齊射、特殊／潛力技能的通用投射物。', { nominal: 'D 12px', dur: 1.2 });
def('proj-waterball', 'projectile', '水流彈：藍色 #38bdf8 水球（直徑 18px）+ 白 #f0f9ff 高光 + 飛濺水珠拖尾。', { nominal: 'D 18px', dur: 1.2 });
def('proj-firehunt-ring', 'projectile', '火神星環：半徑 11px 的火焰圓環（#ffd447 環 + #ff6a2a 外暈 + 白色高光弧），以 rotationYOverLife 做翻滾（每秒 2.6 翻）。', { nominal: 'R 11px', dur: 1.5 });
def('proj-enemy-bolt', 'projectile', '敵方魔法彈：紅 #ff6b6b 光球（直徑 13px）+ 光暈 + 淡紅拖尾；無屬性敵人的遠程攻擊。', { nominal: 'D 13px', dur: 1.2 });
def('proj-meteor', 'projectile', '隕石：直徑約 110px 的火焰團（flare／flame 素材、加法混合、顏色由 #facc22→#f89800→#f83600→#9f0404 漸暗）持續朝 -X 噴出拖尾火焰（拖尾長約 240px、每秒 13 顆、壽命 2.4s、飛行中不斷發射）。', { nominal: 'D 110px', dur: 2.5 });
def('proj-meteor-small', 'projectile', '小隕石：同 proj-meteor 縮小（直徑約 35px、拖尾約 125px、每秒 7 顆）。', { nominal: 'D 35px', dur: 2.0 });
def('proj-starfall', 'projectile', '地爆天星：直徑約 350px 的暗紅巨隕石（#e0451a→#a11208→#5c0a06→#260302），底部有橘色 #ffb257 弓形震波橢圓脈動（半徑約 138px）；朝 -X 拖尾。', { nominal: 'D 350px', dur: 3.0 });
def('proj-thunder-orb-fall', 'projectile', '雷殞天落的落體：藍色雷球（半徑約 29px；#1d4ed8 外層 α0.34、#60a5fa 中層、白色核心）+ 3 條白色弦線以 7 rad/s 旋轉。', { nominal: 'R 29px', dur: 1.5 });

/* 天降／光束／柱（attack 角色） */
def('bolt-sky-lightning', 'bolt', '天雷：從 (0,-500) 劈到原點 (0,0) 的金黃 #f2b705 鋸齒雷柱（spark 素材直立疊三段，寬 13→3px 向下收窄），白色 #ffffff 核心、#ffd23f 外暈，0.32s 內以 alphaOverLife 快速閃爍兩次後消失；著地點小型金色地面環。', { nominal: 'H 500px', dur: 0.4 });
def('bolt-sky-purple', 'bolt', '紫雷（雷紋刻印／落雷術）：同 bolt-sky-lightning 但更粗（22→9px）、色為 #c084fc 主體、#fdf4ff 核心、#9333ea 外暈，並在著地點畫一個旋轉的紫色符紋環（半徑 28px、6 rad/s、0.65s）。', { nominal: 'H 500px', dur: 0.65 });
def('bolt-chain-lightning', 'bolt', '連鎖雷鏈段：沿 +X 長 200px 的水平金黃電弧（spark 素材橫放 2～3 段疊接、寬 7→2.5px）+ #ffd23f 外暈 + 白核心，0.32s 閃爍後消失；Runtime 以 scaleX = 兩點距離/200 拉長並旋轉對準。', { nominal: 'L 200px', dur: 0.32 });
def('bolt-curtain-lightning', 'bolt', '雷幕電柱：從 (0,-450) 劈到原點的藍白電柱（#7dd3fc 主體、白核心、#2563eb 外暈），loop 且每 0.07s 重抖一次（用多層短壽命 spark 粒子 rate 發射模擬閃爍）；著地點白色小圓 + 藍色暈。', { nominal: 'H 450px', dur: 0.4, loop: true });
def('pillar-light', 'bolt', '聖光柱：寬 40px 的光柱從 (0,-400) 落到原點（0.8s：前 22% 由上往下伸展、70% 後淡出），亮白 #fffef4 核心 + 金黃 #ffe47a 邊緣 + 著地閃光 + 5 顆金塵上浮。', { nominal: 'H 400px', dur: 0.9 });
def('pillar-earth', 'bolt', '大地再造光柱：同 pillar-light 但為土黃 #c48a55 / 棕 #ad7444，塵土向外散開。', { nominal: 'H 400px', dur: 0.9 });
def('beam-light', 'bolt', '聖光光束：沿 +X 長 200px 的白色 #fffef4 細光束（寬 10→5px）+ 金黃 #ffe47a 外暈，0.45s 內 α 0→1→0；Runtime 以 scaleX 拉到目標。', { nominal: 'L 200px', dur: 0.45 });
def('beam-ice', 'bolt', '寒冰槍光束：沿 +X 長 200px 的冰藍 #4da6ff 光束（寬 8px）帶白色 #f2fbff 斜紋（uvScroll 或 streak 條紋）+ 淡藍 #79d8ff 外暈，0.45s。', { nominal: 'L 200px', dur: 0.45 });

/* 範圍爆發 burst（attack 角色；名目半徑 100px） */
def('burst-fire', 'burst', '火焰爆發：中心黃白閃光 + 橘紅 #e63924 火球膨脹（半徑 30→100px）+ 3 道扁橢圓震波環 #ffb21c/#7d1708 依序擴散 + 18 顆火舌向外飛並下墜；0.86s。', { nominal: 'R 100px', dur: 0.9 });
def('burst-frost-nova', 'burst', '冰霜新星：從中心擴散到半徑 100px 的冰藍 #4da6ff 圓（填色 α0.24）+ 白色 #f2fbff 粗外環 + 淡藍 #79d8ff 內環（0.72 倍）+ 冰晶碎片四散；0.5s smoothstep。', { nominal: 'R 100px', dur: 0.55 });
def('burst-ice-blast', 'burst', '寒冰爆裂：冰藍閃光 + 大量菱形冰晶碎片向外炸開（半徑到 100px）+ 白色冰霧擴散。', { nominal: 'R 100px', dur: 0.6 });
def('burst-frost-freeze', 'burst', '凍結：目標身上瞬間長出淡藍冰塊（#f2fbff 高光、#4da6ff 底、多片 mask-shape 冰晶疊成 60px 高）並定格 0.4s 後碎裂成冰晶粒子。', { nominal: 'target 60px', dur: 0.8 });
def('burst-wind', 'burst', '狂風碎裂：兩道扁橢圓（縱向 0.6）風環由 45%→105% 與 20%→70% 半徑擴散，淺綠 #86efac 外環寬 3px、白色 #ffffff 內環寬 1.5px；0.34s。', { nominal: 'R 100px', dur: 0.34 });
def('burst-blood', 'burst', '死亡屍爆／崩解：暗紅 #d92846 血爆閃光 + 血環擴散（到 100px）+ 12 顆血珠四散下墜；0.45s。', { nominal: 'R 100px', dur: 0.5 });
def('burst-zero-infection', 'burst', '零日感染：綠色 #4caf2b 毒爆閃光 + 帶 8px 亮綠 #d8ff8a 光暈的環 + 空心毒泡向上飄散；0.5s。', { nominal: 'R 100px', dur: 0.6 });
def('burst-rock-petrify', 'burst', '石化：棕 #ad7444 岩石碎片由地面裂開向外噴（splat 素材當裂痕 + 方塊碎石）+ 灰塵雲；0.8s。', { nominal: 'R 100px', dur: 0.8 });
def('burst-gravity', 'burst', '超重力場：深棕 #5b3a27 與暗紫 #6f2da8 的內縮漩渦（twirl 素材反向旋轉、scaleOverLife 由 1.3 縮到 0.4）+ 中心暗光；0.8s。', { nominal: 'R 100px', dur: 0.8 });
def('burst-holy', 'burst', '神聖爆發：白金 #fffef4 閃光 + 金黃 #ffe47a 光環擴散到 100px + 放射狀光芒（flare／star 素材）；0.6s。', { nominal: 'R 100px', dur: 0.6 });
def('burst-earth', 'burst', '大地爆發：土黃 #c48a55 地面環 + 棕色岩塊向上噴起後落下 + 塵土；0.8s。', { nominal: 'R 100px', dur: 0.8 });
def('burst-detonate-phys', 'burst', '斷罪引爆：暖白 #e6ddc8 大型爆閃（半徑到 100px）+ 粗環帶 8px 光暈 + 7 顆大碎片；0.6s；附畫面震動。', { nominal: 'R 100px', dur: 0.7 });
def('burst-detonate-dark', 'burst', '碎印湮滅／虛空裂隙：紫色 #6f2da8 conic 漩渦先內縮再爆開（rotationOverLife 600°）+ 深紫 #1a0c2e 核心 + 紫光 #913dcc 環；0.6s。', { nominal: 'R 100px', dur: 0.7 });
def('burst-venom', 'burst', '劇毒雲霧／疫爆：綠 #4caf2b 爆閃 + 綠環 + 殘留 2.5s 的毒霧雲（smoke 素材、tint #4caf2b、α0.6 漸散）與 5 顆空心毒泡上浮。', { nominal: 'R 100px', dur: 2.6 });
def('burst-fire-shockwave', 'burst', '烈焰衝擊／炎爆：hit-fire-explosion 的大爆炸 + 3 道扁橢圓震波環（#ffb21c 亮環先、#7d1708 暗環後，到 110% 半徑）+ 18 顆火舌 + 6 團塵霧；0.86s。', { nominal: 'R 100px', dur: 0.9 });
def('burst-cyclone-phys', 'burst', '旋風斬：三道暖白 #e6ddc8 弧刃（各 69°、120° 等分、半徑 64px）整體以 9 rad/s 旋轉，末 0.3s 淡出；名目半徑 100px 對應 area.r。', { nominal: 'R 100px', dur: 1.6, loop: true });

/* 地板／持續場域 ground（loop） */
def('ground-mire', 'ground', '泥沼：扁矩形（名目 200×100，實際只畫 52% 高度）泥棕 #4a3a20 填色 α0.5 + #7d6533 邊 + 3 圈向外擴散的矩形漣漪 #a37a48 + 6 顆泥泡 #c49b68 緩慢上浮；loop 2.1s。', { nominal: 'rect 200x100', dur: 2.1, loop: true });
def('ground-mire-lava', 'ground', '熔岩沼：同 ground-mire 但暗紅 #8a2b0b 底、橘 #ff7a2a 邊、#ffb347 漣漪、#ffd282 岩漿泡，加零星火花。', { nominal: 'rect 200x100', dur: 2.1, loop: true });
def('ground-mire-poison', 'ground', '毒沼：同 ground-mire 但暗褐 #4a3020 底、暗紫 #5b2b72 邊、#7e3f9a 漣漪、#6b2d7c 毒泡，加 3 條起伏的紫色毒氣流（streak 素材 uvScroll 或擺動）。', { nominal: 'rect 200x100', dur: 2.1, loop: true });
def('ground-firewall', 'ground', '火牆：沿 +X 長 200px、厚 40px 的火牆——地面焦痕條 #30231d + 3 座火焰渦柱（高約 120px，橘紅 #e43b12 輪廓、#ffd84a/#ffa51d 內焰、白黃火芯）左右擺動 + 頂端煙霧 + 火花；loop 1.2s。', { nominal: 'rect 200x40', dur: 1.2, loop: true });
def('ground-thunder-curtain', 'ground', '雷幕地帶：沿 +X 長 200px、厚 20px 的藍色 #7dd3fc 帶狀光 α0.22 + 兩端白色電花；電柱由 Runtime 另放 bolt-curtain-lightning。', { nominal: 'rect 200x20', dur: 1.0, loop: true });
def('ground-thunder-orb', 'ground', '雷球（場域體）：半徑 30px 的藍色雷球（#1d4ed8 α0.24 外層、#60a5fa 中層、白核心）以 9 rad/s 微脈動 + 4 條白／淡藍電弧沿表面爬行（spark 粒子繞圈）；loop。', { nominal: 'R 30px', dur: 1.0, loop: true });
def('ground-blizzard', 'ground', '暴風雪：扁矩形（200×100，畫 52% 高）淡藍 #7dd3fc 填色 α0.2 + 青 #22d3ee 邊 + 3 條起伏雲線 + 10 片雪花持續落下（白色小圓 rate 發射）；loop 2.6s。', { nominal: 'rect 200x100', dur: 2.6, loop: true });
def('ground-tornado-fire', 'ground', '火龍捲：以原點為底的火焰龍捲——地面橘紅 #7d1708 橢圓 + 火柱剪影（底寬 62px、高 118px，#d93413）+ 4 條擺動火焰帶（#ffdf4d/#ff761c/#ffa51d）+ 白黃火芯 + 頂部火舌 + 上升火花；loop 1.2s。名目 area.r = 28px。', { nominal: 'R 28px', dur: 1.2, loop: true });
def('ground-tornado-water', 'ground', '水龍捲：同 ground-tornado-fire 幾何，配色深藍 #0284c7 柱、#38bdf8 邊、#f0f9ff 水芯與飛濺水珠。', { nominal: 'R 28px', dur: 1.2, loop: true });
def('ground-tornado-wind', 'ground', '風龍捲：同幾何，綠色 #22c55e 柱、#86efac 邊、白色風芯與葉片狀碎片。', { nominal: 'R 28px', dur: 1.2, loop: true });
def('ground-homing-ice-shard', 'ground', '追蹤冰箭本體：半徑 30px 的冰晶菱形（#4da6ff/#f2fbff）+ 淡藍光暈 + 尾端冰塵；朝 +X；loop 脈動 0.55s。', { nominal: 'R 30px', dur: 0.55, loop: true });
def('ground-homing-wind-crescent', 'ground', '追跡風刃本體：半徑 30px 的風系新月（尖端朝 +X，#86efac/#ffffff）+ 微風尾；loop 脈動 0.55s。', { nominal: 'R 30px', dur: 0.55, loop: true });
def('orb-firehunt', 'orb', '火狩火球（環繞體）：半徑 20px 的火球（#ffd447 內芯、#e63924 外焰、加法）+ 朝 -X 的短火焰尾 + 上升餘燼；loop 0.5s。Runtime 以 scale = orbR/20 並逐幀繞玩家轉。', { nominal: 'R 20px', dur: 0.5, loop: true });
def('orb-thunder', 'orb', '環體電球：半徑 20px 的雷球（#fff8b0 核、#f2b705 體、#ffd23f 暈）+ 表面電弧絲閃爍；loop。', { nominal: 'R 20px', dur: 0.5, loop: true });
def('orb-void-disc', 'orb', '虛空斬鋸刃：半徑 24px 的 12 齒鋸盤（mask-shape 星形或 gear 素材，#86efac 填、#ffffff 邊、白色軸心），自轉 3 圈/s，帶 5 層漸淡殘影；loop。', { nominal: 'R 24px', dur: 1.0, loop: true });
def('ground-orbit-ring-fire', 'ground', '火狩軌道環：扁橢圓（縱向 0.62）淡火紅 #e63924 細環 α0.18（名目半徑 100px）+ 環上零星上升火星；loop。', { nominal: 'R 100px', dur: 2.0, loop: true });
def('ground-orbit-ring-lightning', 'ground', '電球軌道環：同幾何，金黃 #f2b705 細環 + 電花。', { nominal: 'R 100px', dur: 2.0, loop: true });
def('ground-orbit-ring-wind', 'ground', '虛空斬軌道環：同幾何，淺綠 #86efac 細環 α0.16。', { nominal: 'R 100px', dur: 2.0, loop: true });
def('ground-storm-barrier', 'ground', '暴風屏障（護罩）：三層扁橢圓風環（rx 30px、ry 9px，y = -6/+10/+26）淺綠 #86efac、中層白 #ffffff，寬 2.5px α0.6，隨 4.2 rad/s 呼吸 + 3 顆白點繞行；loop。原點＝玩家腳底上方 24px。', { nominal: 'body 60px', dur: 1.5, loop: true });
def('ground-storm-god', 'ground', '暴風神體：同 ground-storm-barrier 但更亮（α0.9）、金色 #ffe9a3 中環與繞點、外加一圈 40×46px 的金色全身光環，速度 7 rad/s。', { nominal: 'body 60px', dur: 0.9, loop: true });
def('ground-storm-rip', 'ground', '暴風撕裂（脈衝）：6 片白色 #ffffff 小風刃（9×3.4px）在扁橢圓上旋轉並由半徑 26px 擴到 60px，α 0.7→0；0.5s 一次性。', { nominal: 'R 60px', dur: 0.5 });
def('ground-domain-fire', 'ground', '火神降臨領域：扁橢圓（縱向 0.62、名目半徑 100px）——黃 #ffd447 淡填色 α0.1 + 火紅 #e63924 邊 2px + 內圈橘 #ff6a2a 細環，每秒約 10 顆火星從邊緣上升；loop 呼吸 ±4%。', { nominal: 'R 100px', dur: 1.85, loop: true });
def('ground-domain-earth', 'ground', '超重岩／重力場領域：同幾何，深棕 #5b3a27 填、棕 #ad7444 邊、土黃 #c48a55 內環，塵土上浮。', { nominal: 'R 100px', dur: 1.85, loop: true });
def('ground-domain-ice', 'ground', '水牢天瀑／海淵葬界領域：同幾何，白 #f2fbff 填、冰藍 #4da6ff 邊、淡藍 #79d8ff 內環，水霧與雪點上浮。', { nominal: 'R 100px', dur: 1.85, loop: true });
def('ground-field-fire', 'ground', '焚世領域（舊技能地板）：圓形（名目半徑 100px）火紅 #e63924 淡填色 + 黃 #ffd447 邊 + 持續上升的火焰粒子（flame 素材）與火星；loop。', { nominal: 'R 100px', dur: 1.6, loop: true });
def('ground-swordfield', 'ground', '劍域千鋒：圓形（名目半徑 100px）暖白 #e6ddc8 淡填色 + 一圈虛線劍氣環以 5s 一圈旋轉（rotationOverLife）+ 直立劍光條紋（trace 素材）從地面升起；loop。', { nominal: 'R 100px', dur: 5.0, loop: true });
def('ground-cyclone-avatar', 'ground', '暴風亂舞化身／不屈之誓：圍繞原點的三道暖白弧刃以 9 rad/s 旋轉（半徑 64px）+ 上升白色火花；loop。', { nominal: 'R 100px', dur: 1.6, loop: true });
def('aura-rock-armor', 'ground', '岩甲術（自身）：玩家周圍 3～4 塊棕色 #ad7444 岩石（方塊素材）緩慢環繞（rotationOverLife 一圈 3s）+ 土黃 #c48a55 地面環 + 塵土；loop。原點＝玩家腳底。', { nominal: 'body 60px', dur: 3.0, loop: true });
def('aura-bloodrage', 'ground', '嗜血狂怒（自身）：暗紅 #d92846 呼吸光暈（circle 素材 α0.3 脈動）+ 紅色火花向上噴 + 地面血紅環；loop 0.8s。', { nominal: 'body 60px', dur: 0.8, loop: true });
def('aura-lightning-relay', 'ground', '雷幻身（自身閃現）：玩家身上一次性金黃電弧爆閃（spark 粒子 8 顆、0.35s）+ 白色閃光。', { nominal: 'body 60px', dur: 0.35 });
def('mark-red', 'ground', '落點預警（火）：扁橢圓（縱向 0.52、名目半徑 100px）紅 #dc2626 填色 α0.16 + 淺紅 #f87171 邊 2.5px，±2.5% 脈動；loop 1.14s（Runtime 在落地時停止）。', { nominal: 'R 100px', dur: 1.14, loop: true });
def('mark-blue', 'ground', '落點預警（雷）：同 mark-red，藍 #2563eb 填、淺藍 #60a5fa 邊。', { nominal: 'R 100px', dur: 1.14, loop: true });
def('ground-starfall-shadow', 'ground', '地爆天星陰影：黑色 #000000 扁橢圓（名目半徑 100px，Runtime 縮放到整個畫面）由 4% 長到 100%、α 0.10→0.55（5s，ease-in）。', { nominal: 'R 100px', dur: 5.0 });

/* 施放／自身增益 cast、敵身詛咒 curse */
def('cast-buff-def', 'cast', '防禦／治療系施放：綠 #4ade80 光環由 1.45 收縮到 0.7 倍（0.7s）+ 4 顆淡綠光點上升 + 白色閃光；原點＝玩家腳底。', { nominal: 'body 60px', dur: 0.9 });
def('cast-buff-phys', 'cast', '物理系施放：暖白 #e6ddc8 光環收縮 + 金白光點上升。', { nominal: 'body 60px', dur: 0.9 });
def('cast-buff-special', 'cast', '特殊系施放：奧術藍紫 #8ea2ff 光環收縮 + 星芒光點（star_08）上升。', { nominal: 'body 60px', dur: 0.9 });
def('cast-buff-light', 'cast', '聖光系施放：金黃 #ffe47a 光環 + 白金塵點上升 + 十字星芒閃。', { nominal: 'body 60px', dur: 0.9 });
def('cast-buff-dark', 'cast', '暗影系施放：紫 #6f2da8 光環 + 暗紫煙絲上升。', { nominal: 'body 60px', dur: 0.9 });
def('cast-buff-poison', 'cast', '毒系被動施放：綠 #4caf2b 光環 + 毒泡上浮。', { nominal: 'body 60px', dur: 0.9 });
def('cast-magic', 'cast', '魔法施放閃光：玩家手部位置（原點）一個 0.3s 的淡藍紫 #8ea2ff 魔法圈（arcane-ring 素材快速旋轉放大淡出）+ 幾顆星芒。', { nominal: 'R 24px', dur: 0.35 });
def('cast-drain', 'cast', '汲取回流：暗綠 #6f2da8→#4ade80 的光絲從外側被吸進玩家（inflow 粒子：gravity 朝中心）+ 中心綠光閃 0.5s；用於暗影箭／生命汲取命中時。', { nominal: 'body 60px', dur: 0.6 });
def('curse-dark', 'curse', '敵身詛咒：目標身上一個紫色 #c084fc 符文環（arcane-ring 素材，半徑 24px）旋轉 + 中心暗紫 #1a0c2e 符號閃爍，緩慢上升 16px/s、左右擺動，0.9s 淡出。', { nominal: 'target 60px', dur: 1.0 });
def('curse-bleed', 'curse', '流血詛咒：目標身上暗紅 #d92846 血滴符號（水滴形 mask 素材）上升擺動 + 幾滴血珠落下，0.9s。', { nominal: 'target 60px', dur: 1.0 });
def('curse-poison', 'curse', '劇毒詛咒：目標身上綠色 #4caf2b 骷髏／毒泡符號上升擺動 + 毒泡上浮，0.9s。', { nominal: 'target 60px', dur: 1.0 });

/* 狀態 aura（loop，掛在身上；原點＝腳底、身高 60px）與 tick */
def('st-burn', 'status', '燃燒持續：腳底到身高 60px 範圍內持續上升的橘紅火焰（flame 素材 rate 12/s、壽命 0.8s、tint #ff7a24）+ 黃色餘燼；loop。', { nominal: 'body 60px', dur: 1.0, loop: true });
def('st-bleed', 'status', '流血持續：暗紅 #d92846 血滴（水滴 mask 素材）從身上滴落（rate 4/s、gravity 向下）+ 淡紅呼吸光；loop。', { nominal: 'body 60px', dur: 1.0, loop: true });
def('st-poison', 'status', '中毒持續：綠色 #4caf2b 空心毒泡上浮（rate 5/s、左右微擺）+ 淡綠霧；loop。', { nominal: 'body 60px', dur: 1.2, loop: true });
def('st-corrode', 'status', '侵蝕／詛咒持續：暗紫 #6f2da8 煙絲（smoke 素材 tint）繞身上升 + 深紫 #1a0c2e 陰影脈動；loop。', { nominal: 'body 60px', dur: 1.5, loop: true });
def('st-frostbite', 'status', '寒霜凍傷持續：淡藍 #79d8ff 冰霧 + 小冰晶碎片緩慢下落 + 身體處白色 #f2fbff 微光；loop。', { nominal: 'body 60px', dur: 1.2, loop: true });
def('st-frost-stacks', 'status', '寒霜層數：身上環繞的雪花（star／mask-shape 雪花素材 tint #f2fbff）緩慢旋轉 + 冰藍 #4da6ff 呼吸光；loop。', { nominal: 'body 60px', dur: 2.0, loop: true });
def('st-frozen', 'status', '凍結：整個身體被淡藍冰塊包住（多片冰晶 mask 疊出 60px 高的塊體，#f2fbff 高光、#4da6ff 底、α0.75）+ 表面反光緩慢掃過；loop。', { nominal: 'body 60px', dur: 1.5, loop: true });
def('st-windcut', 'status', '風切持續：淺綠 #86efac 細長風刃碎片繞身快速旋轉（rotationOverLife 一圈 0.8s）+ 白色風痕；loop。', { nominal: 'body 60px', dur: 0.8, loop: true });
def('st-stun', 'status', '暈眩：頭頂（y=-64）3 顆金黃 #ffe47a 星星（star_08）繞橢圓軌道旋轉一圈 1.2s + 微弱閃爍；loop。', { nominal: 'body 60px', dur: 1.2, loop: true });
def('st-slow', 'status', '減速：腳底一圈藍 #4da6ff 扁橢圓緩慢脈動 + 幾滴淡藍水珠緩慢下落；loop。', { nominal: 'body 60px', dur: 1.6, loop: true });
def('st-invuln', 'status', '無敵結界：包住全身的金色 #ffe47a 半透明圓頂（circle 素材 α0.25）+ 表面白色星芒閃爍 + 底部金環；loop 呼吸。', { nominal: 'body 60px', dur: 1.5, loop: true });
def('st-shield', 'status', '護盾：包住身體的藍色 #4da6ff 泡泡（ring + circle 素材 α0.3）+ 高光反射緩慢旋轉；loop。', { nominal: 'body 60px', dur: 2.0, loop: true });
def('st-regen', 'status', '再生：綠色 #4ade80 十字／光點從腳底上升（rate 4/s）+ 淡綠呼吸光；loop。', { nominal: 'body 60px', dur: 1.2, loop: true });
def('st-buff', 'status', '一般增益：白金 #fffef4 光點緩慢上升（rate 3/s）+ 腳底金黃 #ffe47a 淡環；loop。', { nominal: 'body 60px', dur: 1.5, loop: true });
def('st-debuff', 'status', '一般減益：暗紫 #913dcc 霧絲向下沉（rate 3/s、gravity 向下）+ 腳底暗紫淡環；loop。', { nominal: 'body 60px', dur: 1.5, loop: true });
def('st-atk-up', 'status', '攻擊提升：紅橙 #ff6a2a 火花向上噴 + 紅色腳底環；loop。', { nominal: 'body 60px', dur: 1.0, loop: true });
def('st-def-up', 'status', '防禦提升：灰藍 #93c5fd 六角盾形光（mask-shape 六角）在身前緩慢脈動 + 淡藍腳底環；loop。', { nominal: 'body 60px', dur: 1.5, loop: true });
def('st-aspd-up', 'status', '攻速／極速：黃色 #f2b705 速度線（streak 素材）沿身側向後飛掠 + 黃色腳底環；loop 0.6s。', { nominal: 'body 60px', dur: 0.6, loop: true });
def('st-crit-up', 'status', '爆擊／狂暴：橘紅 #ff4a08 火星繞身噴發 + 紅色雙環；loop 0.8s。', { nominal: 'body 60px', dur: 0.8, loop: true });
def('st-armor-break', 'status', '破甲／防禦下降：灰棕 #ad7444 碎甲片從身上剝落下墜（rate 3/s）+ 裂痕閃光；loop。', { nominal: 'body 60px', dur: 1.2, loop: true });
def('st-wind-rend', 'status', '風切減益：淺綠 #86efac 風痕切線在身上交錯閃現 + 綠色向下細碎片；loop 1.0s。', { nominal: 'body 60px', dur: 1.0, loop: true });
def('st-petrify', 'status', '石化／僵直：身體蒙上灰棕 #8a7a6a 石紋（circle 素材 α0.5）+ 灰塵緩慢下落；loop。', { nominal: 'body 60px', dur: 2.0, loop: true });
def('st-mark-dark', 'status', '暗印記（靈魂撕裂／殺神印記）：頭頂紫色 #c084fc 符文環緩慢旋轉 + 暗紫火苗；loop。', { nominal: 'body 60px', dur: 2.0, loop: true });
def('st-fire-amp', 'status', '火焰增幅／烙印：身體外圍橘紅 #ff6a2a 火光環（ring 素材）呼吸 + 少量火星；loop。', { nominal: 'body 60px', dur: 1.0, loop: true });
def('st-thorns', 'status', '反震／反擊：綠棕 #76d83b 尖刺光（streak 素材向外指）繞身一圈緩慢旋轉；loop。', { nominal: 'body 60px', dur: 2.0, loop: true });
def('st-lightning', 'status', '雷電增益（過載／超導／雷痕）：金黃 #f2b705 電弧絲在身上隨機閃現（spark 粒子 rate 10/s、壽命 0.1～0.3s）+ 淡黃光；loop。', { nominal: 'body 60px', dur: 0.5, loop: true });
def('st-water-prison', 'status', '水牢／寒冰逆轉：藍 #38bdf8 水環繞身旋轉 + 上浮水珠；loop。', { nominal: 'body 60px', dur: 1.5, loop: true });
def('st-storm', 'status', '暴風系增益（狂風／暴風化身／虛空斬計時）：淺綠 #86efac 風環繞身旋轉 + 白色風痕；loop 1.0s。', { nominal: 'body 60px', dur: 1.0, loop: true });
def('st-tick-fire', 'status', '燃燒每跳：身體處一次小火焰竄起（3 片 flame、0.4s）+ 2 顆餘燼。', { nominal: 'body 60px', dur: 0.45 });
def('st-tick-poison', 'status', '中毒每跳：2～3 顆綠色毒泡從身上冒出上浮並破裂（0.6s）。', { nominal: 'body 60px', dur: 0.6 });
def('st-tick-bleed', 'status', '流血每跳：3 滴暗紅血珠濺落（0.45s）+ 淡紅閃。', { nominal: 'body 60px', dur: 0.45 });
def('st-tick-ice', 'status', '凍傷每跳：冰藍小閃光 + 3 片冰晶碎片彈出下落（0.45s）。', { nominal: 'body 60px', dur: 0.45 });
def('st-tick-dark', 'status', '侵蝕每跳：暗紫閃光 + 紫煙絲一縷上升（0.5s）。', { nominal: 'body 60px', dur: 0.5 });
def('st-tick-wind', 'status', '風切每跳：兩道淺綠風痕交叉閃過（0.35s）。', { nominal: 'body 60px', dur: 0.35 });

/* ---------- 舊技能表（SKILLS）欄位對應 ---------- */
const CAST_BY_CAT = { def: 'cast-buff-def', phys: 'cast-buff-phys', special: 'cast-buff-special', passive: 'cast-buff-phys', magic: 'cast-buff-special' };
const CAST_BY_ELEM = { light: 'cast-buff-light', dark: 'cast-buff-dark', poison: 'cast-buff-poison' };
const PROJ_BY_ELEM = { fire: 'proj-fire', ice: 'proj-ice-shard', lightning: 'proj-lightning', poison: 'proj-poison-drop', light: 'proj-light-orb', dark: 'proj-dark-orb', earth: 'proj-earth-rock', wind: 'proj-wind-crescent' };
function hitFor(elem, cat) { return 'hit-' + (elem || (cat === 'phys' ? 'phys' : (cat === 'magic' ? 'light' : 'phys'))); }

/* facts 來自 skills-vfx-facts.json（id/cat/elem/shape/fxKind/variant/hasField） */
function skillRoles(f) {
  const r = {};
  const elem = f.elem || null;
  switch (f.fxKind) {
    case 'slash':
      r.attack = f.variant === 'swordfield' ? 'slash-phys-big' : 'slash-phys';
      if (f.variant === 'detonate') { r.attack = 'burst-detonate-phys'; }
      r.hit = hitFor(elem, f.cat);
      if (f.hasField && f.variant === 'swordfield') r.ground = 'ground-swordfield';
      break;
    case 'burst':
      if (f.variant === 'cyclone') r.attack = 'burst-cyclone-phys';
      else if (f.variant === 'bladestorm') r.attack = 'slash-phys-big';
      else r.attack = 'burst-' + (elem || 'detonate-phys');
      r.hit = hitFor(elem, f.cat);
      break;
    case 'beam':
      r.attack = elem === 'ice' ? 'beam-ice' : 'beam-light';
      r.hit = hitFor(elem, f.cat);
      break;
    case 'projectile':
      if (f.variant === 'fireball') r.projectile = 'proj-fireball';
      else if (f.variant === 'arcane-barrage') r.projectile = 'proj-arcane-missile';
      else if (f.variant === 'chain') { r.attack = 'bolt-sky-lightning'; r.projectile = 'bolt-chain-lightning'; }
      else if (elem) r.projectile = PROJ_BY_ELEM[elem];
      else r.projectile = 'proj-arcane-missile';
      r.hit = hitFor(elem, f.cat);
      if (f.variant === 'nova') { r.attack = 'burst-frost-nova'; }
      if (f.variant === 'vortex') { r.attack = 'burst-detonate-dark'; }
      if (f.variant === 'detonate') { r.attack = elem === 'dark' ? 'burst-detonate-dark' : 'burst-detonate-phys'; }
      if (f.variant === 'venom') { r.attack = 'burst-venom'; }
      if (f.variant === 'venomburst') { r.attack = 'burst-venom'; }
      if (f.variant === 'drain') { r.cast = 'cast-drain'; }
      if (f.variant === 'flamewave') { r.projectile = 'proj-fireball'; }
      if (f.hasField && f.variant === 'flamewave') r.ground = 'ground-field-fire';
      if (f.cat === 'magic' && !r.cast) r.cast = 'cast-magic';
      break;
    case 'rain':
      if (f.variant === 'meteor') { r.projectile = 'proj-meteor'; r.hit = 'hit-fire-explosion'; r.ground = 'mark-red'; r.attack = 'burst-fire-shockwave'; }
      else if (f.variant === 'pillar') { r.attack = 'pillar-light'; r.hit = 'hit-light'; }
      else if (f.variant === 'purple-thunder') { r.attack = 'bolt-sky-purple'; r.hit = 'hit-thunder-purple'; }
      else { r.projectile = PROJ_BY_ELEM[elem] || 'proj-arcane-missile'; r.hit = hitFor(elem, f.cat); }
      break;
    case 'selfBuff':
      r.cast = CAST_BY_ELEM[elem] || CAST_BY_CAT[f.cat] || 'cast-buff-phys';
      break;
    case 'curse':
      r.attack = elem === 'dark' ? 'curse-dark' : 'curse-bleed';
      r.hit = hitFor(elem, f.cat);
      break;
  }
  return r;
}

/* ---------- 新技能表（SKILLS2）欄位對應：tiers[0..6]、ult 依選項 id ---------- */
const S2 = {};
function g(gid, tiers, ult) { S2[gid] = { tiers: tiers, ult: ult || {} }; }
const _ = null; // 該階沒有自己的特效

g('thrust', [
  { attack: 'slash-thrust-lance', hit: 'hit-phys' },  // T1 突刺
  _,                                                 // T2 連刺
  _,                                                 // T3 傷害強化
  { attack: 'slash-thrust-lance', hit: 'hit-phys' },  // T4 超連刺（thrust-parallel）
  { hit: 'hit-phys' },                               // T5 擴散（擴散傷害的受擊）
  { attack: 'slash-thrust-lance', hit: 'hit-phys' },  // T6 貫穿突刺（thrust-pierce）
  { attack: 'slash-thrust-lance', hit: 'hit-phys' }   // T7 八方連刺（thrust-octagonal）
]);
g('cleave', [
  { attack: 'slash-cleave-arc', hit: 'hit-phys' },    // T1 迴旋斬（cleave）
  _, _, _, _,
  { attack: 'slash-cleave-arc', hit: 'hit-phys' },    // T6 震碎斬（cleave-shockwave）
  { attack: 'slash-cleave-sector', hit: 'hit-phys' }  // T7 迴身四方斬（cleave-cross-shockwave）
], { windChaser: { ground: 'ground-tornado-wind' } }); // 逐風者：風龍捲
g('knife', [
  { projectile: 'proj-knife', hit: 'hit-phys' },      // T1 飛刀
  _,
  { projectile: 'proj-knife', hit: 'hit-phys' },      // T3 彈射飛刀（knife-bounce）
  _, _, _, _
], { soulhunterBlade: { projectile: 'proj-knife-gold', hit: 'hit-lightning' } });
g('gale', [
  { attack: 'slash-gale-sector', hit: 'hit-phys' },   // T1 疾風斬（gale-slashes）
  _, _, _, _, _, _
], { thunderFlash: { hit: 'hit-lightning' }, thunderGodSlash: { attack: 'bolt-sky-purple', hit: 'hit-thunder-purple' } });
g('bloodblade', [
  { attack: 'slash-bloodblade', hit: 'hit-bleed', cast: 'curse-bleed' },      // T1 血刃斬 + 流血詛咒（curse/bleed 走 cast 欄？→ 不，curse 用 attack；T1 attack 已用，見下方註記）
  _, _,
  { attack: 'curse-poison', hit: 'hit-poison' },                             // T4 血毒刃（curse/poison）
  { projectile: 'proj-poison-drop', hit: 'hit-poison' },                     // T5 毒霧感染（poison-spread）
  { attack: 'burst-blood', hit: 'hit-bleed' },                               // T6 死亡屍爆（blood-explosion）
  { attack: 'burst-zero-infection', hit: 'hit-poison' }                      // T7 零日感染
], { disintegrate: { attack: 'burst-blood', hit: 'hit-bleed' }, venomDomain: { ground: 'ground-mire-poison', attack: 'curse-poison', hit: 'hit-poison' }, slayerDomain: { ground: 'ground-mire' } });
g('dualdance', [
  { attack: 'slash-dual', hit: 'hit-phys' },          // T1 雙刀亂舞（dual-slash）
  _, _, _, _, _,
  { attack: 'slash-dual', hit: 'hit-phys', ground: 'ground-cyclone-avatar' } // T7 暴風亂舞（dual-storm + cyclone）
]);
g('counter', [
  { attack: 'slash-phys', hit: 'hit-phys' },          // T1 反擊（counter-riposte）
  _, _, _,
  { hit: 'hit-earth' },                               // T5 破甲擊（armor-break impact）
  _, _
], { holyBody: { attack: 'burst-holy', hit: 'hit-light' }, indomitable: { attack: 'burst-earth', hit: 'hit-earth', ground: 'aura-rock-armor', cast: 'pillar-earth' } });
g('bloodrage', [
  { ground: 'aura-bloodrage' },                       // T1 嗜血狂怒（bloodrage-aura）
  _, _, _, _, _, _
], { asuraFist: { ground: 'aura-bloodrage' } });
g('fireball', [
  { projectile: 'proj-fireball', hit: 'hit-fire', attack: 'burst-fire', cast: 'cast-magic' }, // T1 火球術 + 爆炸範圍
  { hit: 'st-tick-fire' },                                                                     // T2 燃燒（burn-tick）
  { projectile: 'proj-fireball', hit: 'hit-fire-explosion' },                                  // T3 火球爆裂（fireball-small + fire-explosion）
  _,
  { attack: 'burst-fire', hit: 'hit-fire' },                                                   // T5 爆燃（fire-blast）
  _,
  { projectile: 'proj-meteor', hit: 'hit-fire-explosion', ground: 'mark-red', attack: 'burst-fire-shockwave' } // T7 殞石術
], { phoenixPrairie: { projectile: 'proj-fireball', hit: 'hit-fire-explosion' }, starfallCataclysm: { ground: 'ground-starfall-shadow', projectile: 'proj-starfall', attack: 'burst-fire-shockwave', hit: 'hit-fire' } });
g('firepillar', [
  { ground: 'ground-tornado-fire', hit: 'hit-fire' }, // T1 火龍捲（pillar 場域）
  _, _, _,
  { attack: 'burst-fire-shockwave', hit: 'hit-fire' }, // T5 烈焰衝擊（firepillar-impact）
  _,
  { ground: 'ground-firewall', hit: 'hit-fire' }       // T7 無限火牆
], { eternalInferno: { ground: 'ground-mire-lava' } });
g('firehunt', [
  { projectile: 'orb-firehunt', ground: 'ground-orbit-ring-fire', hit: 'hit-fire-explosion', attack: 'burst-fire' }, // T1 火狩（環繞 + 命中 + 炎爆）
  _, _, _, _, _, _
], { fireGodDescend: { ground: 'ground-domain-fire', projectile: 'proj-firehunt-ring', hit: 'hit-fire' } });
g('rockarmor', [
  { ground: 'aura-rock-armor' },                      // T1 岩甲術
  _,
  { hit: 'hit-earth' },                               // T3 岩甲尖刺（rock-spike impact）
  _, _, _, _
], { superRockArt: { ground: 'ground-domain-earth', attack: 'burst-rock-petrify', hit: 'hit-earth' }, gravityField: { ground: 'ground-domain-earth', attack: 'burst-gravity', hit: 'hit-earth' } });
g('mire', [
  { ground: 'ground-mire' },                          // T1 泥沼術
  _,
  { ground: 'ground-mire-poison' },                   // T3 毒沼術
  _, _, _,
  { ground: 'ground-mire-lava' }                      // T7 熔岩沼
], { abyssInferno: { ground: 'ground-tornado-fire', hit: 'hit-fire' } });
g('earthguard', [
  _, _, _, _, _,
  { attack: 'beam-light', hit: 'hit-light' },         // T6 生命反射之盾（earth-reflect）
  { cast: 'pillar-light' }                            // T7 天地共生（rebirth pillar on player）
], { worldRebirth: { attack: 'pillar-earth', hit: 'hit-earth' } });
g('chainlightning', [
  { projectile: 'bolt-chain-lightning', hit: 'hit-lightning', cast: 'cast-magic' }, // T1 連鎖閃電
  _, _, _,
  { hit: 'hit-lightning' },                           // T5 電殛擴散（thunder-burst）
  { ground: 'aura-lightning-relay' },                 // T6 雷幻身（lightning-relay）
  _
], { eternalSuperconductor: { ground: 'aura-lightning-relay', projectile: 'bolt-chain-lightning', hit: 'hit-lightning' }, flyingThunderGod: { projectile: 'bolt-chain-lightning', hit: 'hit-lightning' } });
g('thunderstrike', [
  { attack: 'bolt-sky-purple', hit: 'hit-thunder-purple', cast: 'cast-magic' }, // T1 落雷術（thunder-strike + thunder-impact）
  _, _, _, _, _, _
], { thunderMatrix: { ground: 'ground-thunder-curtain', attack: 'bolt-curtain-lightning' }, heavenTribulation: { attack: 'bolt-sky-purple', hit: 'hit-thunder-purple' } });
g('thunderorb', [
  { ground: 'ground-thunder-orb', hit: 'hit-lightning', cast: 'cast-magic' }, // T1 雷球（thunder-orb 場域）
  _, _,
  { projectile: 'orb-thunder', ground: 'ground-orbit-ring-lightning', hit: 'hit-lightning' }, // T4 環體電球（thunder-orbit）
  _,
  { ground: 'ground-thunder-orb', hit: 'hit-lightning' }, // T6 伴生雷球
  { projectile: 'proj-thunder-orb-fall', ground: 'mark-blue', hit: 'hit-lightning', attack: 'burst-fire-shockwave' } // T7 雷殞天落（thunder-fall）
], { thunderBurst: { hit: 'hit-lightning' } });
g('icearrow', [
  { projectile: 'proj-ice-shard', hit: 'hit-ice', cast: 'cast-magic' }, // T1 寒冰箭（ice-arrow）
  { hit: 'st-tick-ice' },                                               // T2 寒霜箭（frost-tick）
  _,
  { projectile: 'proj-ice-shard', hit: 'hit-ice' },                     // T4 貫穿冰箭（ice-arrow-pierce）
  { ground: 'ground-homing-ice-shard' },                                // T5 冰箭散射（追蹤場域 ice-arrow-homing）
  _,
  { attack: 'burst-ice-blast', hit: 'hit-ice' }                         // T7 寒冰爆裂箭（ice-blast）
], { tearsOfIce: { projectile: 'proj-ice-shard', hit: 'hit-ice' } });
g('waterball', [
  { projectile: 'proj-waterball', hit: 'hit-ice', cast: 'cast-magic' }, // T1 水流彈
  _, _,
  { attack: 'burst-frost-nova', hit: 'hit-ice', projectile: 'proj-waterball' }, // T4 寒流爆散（water-burst + water-bounce）
  { projectile: 'proj-ice-shard', hit: 'hit-ice' },                     // T5 寒霜擴散（frost-spread）
  _,
  { ground: 'ground-tornado-water' }                                    // T7 水龍捲
], { waterPrisonFall: { ground: 'ground-domain-ice' }, ragingTide: { ground: 'ground-tornado-water' }, abyssBurial: { ground: 'ground-domain-ice', hit: 'st-tick-ice' } });
g('frostnova', [
  { attack: 'burst-frost-nova', hit: 'hit-ice', cast: 'cast-magic' },   // T1 冰霜新星 + frost-freeze（見 vfxTier 註記：凍結走 T1 的 attack？→ 用 T4 極致寒霜）
  _,
  { hit: 'hit-ice' },                                                   // T3 寒冰體（frost-body impact）
  { attack: 'burst-frost-freeze', hit: 'hit-ice' },                     // T4 極致寒霜：凍結演出（frost-freeze）
  _, _,
  { ground: 'ground-blizzard' }                                         // T7 暴風雪
], { iceKingDomain: { ground: 'ground-tornado-water' }, crystalResonance: { projectile: 'proj-ice-shard', hit: 'hit-ice' } });
g('windblade', [
  { projectile: 'proj-wind-crescent', hit: 'hit-wind', cast: 'cast-magic' }, // T1 風刃
  _, _,
  { projectile: 'proj-wind-crescent', hit: 'hit-wind' },                // T4 亂披風（wind-blade-small）
  { ground: 'ground-homing-wind-crescent', hit: 'hit-wind' },           // T5 追跡風刃
  { attack: 'burst-wind', hit: 'hit-wind' },                            // T6 狂風碎裂（wind-burst 脈衝）
  _
], { stormMyriad: { ground: 'ground-homing-wind-crescent', hit: 'hit-wind' }, stormMountain: { projectile: 'proj-wind-crescent', hit: 'hit-wind' } });
g('vacuumslash', [
  { attack: 'slash-wind-crescent', hit: 'hit-wind', cast: 'cast-magic' }, // T1 真空斬（wind-slash）
  _, _,
  { attack: 'slash-wind-spin', hit: 'hit-wind' },                       // T4 真空迴旋（wind-spin）
  _, _,
  { projectile: 'orb-void-disc', ground: 'ground-orbit-ring-wind', hit: 'hit-wind', attack: 'burst-wind' } // T7 虛空斬
], { vacuumOmen: { ground: 'ground-homing-wind-crescent', hit: 'hit-wind' } });
g('stormbarrier', [
  { ground: 'ground-storm-barrier' },                 // T1 暴風屏障
  { ground: 'ground-storm-rip', hit: 'hit-wind' },    // T2 暴風撕裂（storm-rip 脈衝）
  { hit: 'hit-wind' },                                // T3 亂風切（wind-rend impact）
  { projectile: 'proj-wind-crescent', hit: 'hit-wind' }, // T4 暴風之刃
  { projectile: 'proj-wind-crescent', hit: 'hit-wind' }, // T5 風切擴散（wind-rend-spread 小風刃）
  _,
  { ground: 'ground-storm-god' }                      // T7 暴風神體
], { skyfallStars: { projectile: 'proj-meteor', hit: 'hit-fire-explosion', ground: 'mark-red', attack: 'burst-fire-shockwave' }, myriadPhenomena: { projectile: 'orb-void-disc', ground: 'ground-orbit-ring-wind', hit: 'hit-wind' } });

/* ---------- 狀態表（STATUS）欄位對應：apply／aura／tick ---------- */
const ST = {};
function s(id, apply, aura, tick) { ST[id] = { apply: apply || '', aura: aura || '', tick: tick || '' }; }
// 舊系統 dot
s('bleed', 'hit-bleed', 'st-bleed', 'st-tick-bleed');
s('burn', 'hit-fire', 'st-burn', 'st-tick-fire');
s('poison', 'hit-poison', 'st-poison', 'st-tick-poison');
s('corrode', 'hit-dark', 'st-corrode', 'st-tick-dark');
s('plague', 'hit-poison', 'st-poison', 'st-tick-poison');
s('deathCurse', 'curse-dark', 'st-corrode', 'st-tick-dark');
// 控場／護盾／回復
s('stun', 'hit-phys', 'st-stun', '');
s('slow', 'hit-ice', 'st-slow', '');
s('invuln', 'cast-buff-light', 'st-invuln', '');
s('regen', 'cast-buff-def', 'st-regen', '');
s('shield', 'cast-buff-def', 'st-shield', '');
// 舊系統 buff
s('atkUp', 'cast-buff-phys', 'st-atk-up', '');
s('defUp', 'cast-buff-def', 'st-def-up', '');
s('aspdUp', 'cast-buff-phys', 'st-aspd-up', '');
s('evasionUp', 'cast-buff-special', 'st-buff', '');
s('critDmgUp', 'cast-buff-phys', 'st-crit-up', '');
s('blockUp', 'cast-buff-def', 'st-def-up', '');
s('thornsUp', 'cast-buff-def', 'st-thorns', '');
s('lootUp', 'cast-buff-special', 'st-buff', '');
s('penUp', 'cast-buff-phys', 'st-buff', '');
s('allDmgUp', 'cast-buff-special', 'st-buff', '');
s('velocitySurge', 'cast-buff-special', 'st-aspd-up', '');
s('lightningOverload', 'hit-lightning', 'st-lightning', '');
s('chronoCdr', 'cast-buff-special', 'st-buff', '');
s('sacredInvert', 'cast-buff-light', 'st-buff', '');
s('legendaryDarkUp', 'cast-buff-dark', 'st-mark-dark', '');
s('legendaryGuardRed', 'cast-buff-def', 'st-def-up', '');
s('legendaryLightShieldRed', 'cast-buff-light', 'st-def-up', '');
// 舊系統 debuff
s('atkDown', 'curse-dark', 'st-debuff', '');
s('defDown', 'hit-earth', 'st-armor-break', '');
s('enemyAspdDown', 'hit-ice', 'st-slow', '');
// 新系統
s('sgBleed', 'hit-bleed', 'st-bleed', 'st-tick-bleed');
s('sgPoison', 'hit-poison', 'st-poison', 'st-tick-poison');
s('sgIronBleed', 'hit-bleed', 'st-bleed', 'st-tick-bleed');
s('sgGale', 'cast-buff-phys', 'st-aspd-up', '');
s('sgFrenzyCr', 'cast-buff-phys', 'st-crit-up', '');
s('sgFrenzyCd', 'cast-buff-phys', 'st-crit-up', '');
s('sgStorm', 'cast-buff-phys', 'st-storm', '');
s('sgBloodrage', 'cast-buff-phys', 'st-atk-up', '');
s('sgArmorBrk', 'hit-earth', 'st-armor-break', '');
s('sgBurn', 'hit-fire', 'st-burn', 'st-tick-fire');
s('sgFireAmp', 'cast-magic', 'st-fire-amp', '');
s('sgFirehunt', '', '', '');           // 火狩剩餘時間：由環繞場域本身表現
s('sgRockArmor', '', '', '');          // 岩甲：由 aura-rock-armor 表現
s('sgRockAmp', 'hit-earth', 'st-fire-amp', '');
s('sgMire', 'hit-earth', 'st-slow', '');
s('sgMirePoison', 'hit-poison', 'st-poison', 'st-tick-poison');
s('sgMireLava', 'hit-fire', 'st-burn', 'st-tick-fire');
s('sgThunderOrb', '', '', '');         // 環體電球：由環繞場域表現
s('sgFrost', 'hit-ice', 'st-frost-stacks', '');
s('sgFrostBite', 'hit-ice', 'st-frostbite', 'st-tick-ice');
s('sgFrozen', 'burst-frost-freeze', 'st-frozen', '');
s('sgIceRevert', 'hit-ice', 'st-water-prison', '');
s('sgFrostbody', 'cast-magic', 'st-frostbite', '');
s('sgWindRend', 'hit-wind', 'st-wind-rend', '');
s('sgWindCut', 'hit-wind', 'st-windcut', 'st-tick-wind');
s('sgWindSlow', 'hit-wind', 'st-slow', '');
s('sgStormBarrier', '', '', '');       // 暴風屏障：由 ground-storm-barrier 表現
s('sgVoidBlade', '', '', '');          // 虛空斬：由環繞場域表現
s('sgStormGod', '', '', '');           // 暴風神體：由 ground-storm-god 表現
s('sgThrustVuln', 'hit-phys', 'st-debuff', '');
s('sgSoulRend', 'curse-dark', 'st-mark-dark', '');
s('sgThrustBleed', 'hit-bleed', 'st-bleed', 'st-tick-bleed');
s('sgPhantomDodge', 'cast-buff-special', 'st-buff', '');
s('sgDeathReaper', 'cast-buff-dark', 'st-mark-dark', '');
s('sgKnifeWaltz', 'cast-buff-phys', 'st-storm', '');
s('sgSlayerMark', 'curse-dark', 'st-mark-dark', '');
s('sgVenomField', 'hit-poison', 'st-poison', 'st-tick-poison');
s('sgKagura', 'hit-fire', 'st-burn', 'st-tick-fire');
s('sgDeathDefer', 'cast-buff-light', 'st-invuln', '');
s('sgBloodMist', 'hit-dark', 'st-debuff', '');
s('sgCounterWrath', 'cast-buff-phys', 'st-atk-up', '');
s('sgBurnBlood', 'cast-buff-phys', 'st-crit-up', '');
s('sgThornsRage', 'cast-buff-def', 'st-thorns', '');
s('sgWarGodKill', 'cast-buff-phys', 'st-atk-up', '');
s('sgAsuraFist', 'cast-buff-phys', 'st-atk-up', '');
s('sgStarfall', '', '', '');           // 地爆天星計時：由陰影與隕石表現
s('sgBurnAmp', 'hit-fire', 'st-fire-amp', '');
s('sgPetrify', 'burst-rock-petrify', 'st-petrify', '');
s('sgStiffen', 'hit-earth', 'st-petrify', '');
s('sgMireBleed', 'hit-bleed', 'st-bleed', 'st-tick-bleed');
s('sgPlague', 'hit-poison', 'st-poison', 'st-tick-poison');
s('sgInferno', 'hit-fire', 'st-fire-amp', '');
s('sgSuperconduct', 'hit-lightning', 'st-lightning', '');
s('sgThunderQuake', 'hit-lightning', 'st-lightning', '');
s('sgWaterPrison', 'hit-ice', 'st-water-prison', '');
s('sgWindErode', 'hit-wind', 'st-wind-rend', '');

/* ---------- 普攻／敵方／潛力（不在表裡的固定對應，寫進 js/data.js VFX_COMBAT_DEFAULTS） ---------- */
const COMBAT_DEFAULTS = {
  basicAttack: { projectile: 'proj-swordwave', attack: 'slash-phys-big', hit: 'hit-phys' },
  basicAttackExtra: { projectile: 'proj-swordwave', attack: 'slash-phys', hit: 'hit-phys' },
  smite: { attack: 'bolt-sky-lightning', hit: 'hit-lightning' },
  enemyMelee: { attack: 'slash-enemy-melee', hit: 'hit-enemy' },
  enemyProjectile: { projectile: 'proj-enemy-bolt', hit: 'hit-enemy' },
  enemyProjectileByElem: { fire: 'proj-fire', ice: 'proj-ice-shard', lightning: 'proj-lightning', poison: 'proj-poison-drop', light: 'proj-light-orb', dark: 'proj-dark-orb', earth: 'proj-earth-rock', wind: 'proj-wind-crescent' },
  enemyHitByElem: { fire: 'hit-fire', ice: 'hit-ice', lightning: 'hit-lightning', poison: 'hit-poison', light: 'hit-light', dark: 'hit-dark', earth: 'hit-earth', wind: 'hit-wind' },
  chainLightning: { attack: 'bolt-sky-lightning', projectile: 'bolt-chain-lightning', hit: 'hit-lightning' },
  legendaryLightningChain: { projectile: 'bolt-chain-lightning', hit: 'hit-lightning' }
};

module.exports = { PRESETS: P, ELEM_THEME, skillRoles, SKILLS2_VFX: S2, STATUS_VFX: ST, COMBAT_DEFAULTS, CAST_BY_CAT, CAST_BY_ELEM, PROJ_BY_ELEM };
