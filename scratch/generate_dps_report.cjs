'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const jsonPath = path.join(ROOT, 'scratch/all_69_ults_dps_results.json');
const results = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
const REPORT_PATH = path.join(ROOT, 'docs/ULT_EVOLUTION_ALL_69_SKILLS_DPS_REPORT.md');

// 取得測試產出時間
const stat = fs.statSync(jsonPath);
const testDate = stat.mtime;
const pad = n => String(n).padStart(2, '0');
const timeStr = `${testDate.getFullYear()}-${pad(testDate.getMonth() + 1)}-${pad(testDate.getDate())} ${pad(testDate.getHours())}:${pad(testDate.getMinutes())}:${pad(testDate.getSeconds())}`;

function fmtDps(dps) {
  if (dps >= 1e9) return (dps / 1e9).toFixed(2) + ' B';
  if (dps >= 1e6) return (dps / 1e6).toFixed(2) + ' M';
  if (dps >= 1e3) return (dps / 1e3).toFixed(2) + ' K';
  return dps.toString();
}

function fmtDmg(dmg) {
  if (dmg >= 1e12) return (dmg / 1e12).toFixed(2) + ' 兆';
  if (dmg >= 1e8) return (dmg / 1e8).toFixed(2) + ' 億';
  if (dmg >= 1e4) return (dmg / 1e4).toFixed(2) + ' 萬';
  return dmg.toString();
}

// 依技能群組 (23組) 分組
const groups = {};
results.forEach(r => {
  const gid = r.target.gid;
  if (!groups[gid]) groups[gid] = [];
  groups[gid].push(r);
});

const lines = [];

lines.push(`# ⚔️ 全 23 大技能群組（69 招超神進化技能）DPS 實測總結報表【${timeStr}】`);
lines.push('');
lines.push(`> **實測完成時間**：\`${timeStr}\`  `);
lines.push('> **測試基準版本**：v6.0（技能平衡調整版：總時長 2分30秒 / 前 30秒預熱排除 / 採集後 2分鐘穩定態數據）  ');
lines.push('> **負責測試**：Antigravity (QA & Combat Simulation Engine)  ');
lines.push('> **核心規則**：全 23 系技能群組、共 69 招超神進化技能全部實測，且**每系技能必帶該系專屬 5 個傳奇效果**（例如風刃必帶：裂風、增壓、風之痕、風蝕、斷空刃）。');
lines.push('');
lines.push('---');
lines.push('');
lines.push('## 1. 測試環境與標準化規範');
lines.push('1. **核心傷害詞條絕對一致**：');
lines.push('   * 全身 13 格 100 級傳奇裝備（強化 +40，滿詞條數值），物攻與魔攻（~50,000）、物理穿透與魔法穿透（100% 滿穿透）絕對對齊。');
lines.push('   * 暴擊率 100% 滿暴擊，全屬性增傷 +1000%，連擊數 3，格擋率 50%，格擋減傷 80%。');
lines.push('2. **傳奇特效配置（Mandatory Legendary Affixes）**：');
lines.push('   * 每個技能群組在測試時，**嚴格裝載該技能專屬的 5 個傳奇特效**。');
lines.push('   * 雙手武器（雙手巨劍、雙手魔劍、雙手法杖、雙手斧）依專案核心規則享有 **2.0x 傳奇效果倍率補償**（`TWO_HAND_EFFECT_VALUE_MULT`）。');
lines.push('3. **測試地圖與三種情境（300 級沼澤 Swamp，DEF=0 / MDEF=0）**：');
lines.push('   * **小怪**：普通小怪群戰（20 隻/波，總血量 ~3.55 兆）');
lines.push('   * **菁英**：菁英怪攻堅（5 隻/波，總血量 ~3.55 兆）');
lines.push('   * **BOSS**：單體 BOSS 戰（1 隻/波，總血量 ~2.66 兆）');
lines.push('4. **測試時長與數據統計口徑（2分30秒穩定態採樣）**：');
lines.push('   * **總測試時長**：每招技能每種情境持續戰鬥 **2 分 30 秒（150 秒）**。');
lines.push('   * **前 30 秒預熱排除**：排除前期 DOT 疊層、Buff 啟動、怪物進場走位等啟動偏差，前 30 秒數據**不計入**。');
lines.push('   * **後 2 分鐘精確統計**：嚴格採樣 **30 秒～150 秒（共 120 秒）** 的純淨穩定態輸出。');
lines.push('   * $\\text{平均 DPS} = \\frac{\\text{後 2 分鐘（120 秒）內累計輸出總傷害}}{120\\text{ 秒}}$。格式統一為：`總傷 | DPS`。');
lines.push('');
lines.push('---');
lines.push('');
lines.push('## 2. 全 23 大技能群組總結清單（依指定換行規則整理）');
lines.push('');

let gIdx = 0;
for (const [gid, list] of Object.entries(groups)) {
  gIdx++;
  const first = list[0].target;
  const affStr = first.affixes.map(a => a.name).join('、');
  const wpType = first.primaryWp + (first.isTwoHand ? ' (2H雙手補償)' : '');

  lines.push(`### 【${gIdx}】${first.groupName} (${gid})`);
  lines.push('');
  lines.push('| 技能群組 | 屬性 / 武器類型 | 必帶 5 大傳奇效果 |');
  lines.push('| :--- | :--- | :--- |');
  lines.push(`| **${first.groupName}** | ${first.elem} / ${wpType} | ${affStr} |`);
  lines.push('');

  const ZERO_NOTES = {
    soulhunterBlade: { elite: '*(遠程菁英站位未達5m射程)*' },
    holyBody: { mob: '*(需累積10次反擊，小怪未達次數門檻)*' },
    indomitable: { boss: '*(需面臨致命死亡方觸發4000%自爆)*' },
    asuraFist: { mob: '*(純Buff無本體傷害，需依附普攻)*' },
    adamantBody: { boss: '*(純護盾防禦被動，無主動攻擊)*' },
    gravityField: { elite: '*(純控場減速Debuff，無直接傷害)*' },
    fateReversal: {
      mob: '*(遠程怪在20米反射範圍外+高頻壓制無血可扣)*',
      elite: '*(遠程怪在20米反射範圍外+高頻壓制無血可扣)*',
      boss: '*(傷害來自T6生命反射之盾：BOSS近戰貼身且攻擊間隔能回血再失血反彈)*'
    },
    venomDomain: { elite: '*(遠程菁英未踏入領域範圍)*' }
  };

  list.forEach((r, uIdx) => {
    const t = r.target;
    const mob = r.normalMob;
    const elite = r.elite;
    const boss = r.boss;
    const note = ZERO_NOTES[t.ultId] || {};

    const mobNote = (mob.avgDps === 0 && note.mob) ? ' ' + note.mob : '';
    const eliteNote = (elite.avgDps === 0 && note.elite) ? ' ' + note.elite : '';
    const bossNote = ((boss.avgDps === 0 || t.ultId === 'fateReversal') && note.boss) ? ' ' + note.boss : '';

    lines.push(`**${t.ultName}** (\`${t.ultId}\`)`);
    lines.push(`小怪：${fmtDmg(mob.totalDamage)} | ${fmtDps(mob.avgDps)}${mobNote}`);
    lines.push(`菁英：${fmtDmg(elite.totalDamage)} | ${fmtDps(elite.avgDps)}${eliteNote}`);
    lines.push(`BOSS：${fmtDmg(boss.totalDamage)} | ${fmtDps(boss.avgDps)}${bossNote}`);
    if (uIdx < list.length - 1) {
      lines.push('');
    }
  });

  if (gid === 'bloodblade') {
    lines.push('');
    lines.push('> 💡 **血刃斬超神進化傷害特性與機制分析**：');
    lines.push('> 1. **萬毒血霧**：具備 30 米全場光環，20 隻小怪進場無條件每 0.5 秒疊毒至滿層 20 層（每秒全場 800 次毒傷跳字），群體傷害表現極為強大。');
    lines.push('> 2. **殺神領域**：24 米領域內每死 1 怪疊層，小怪群中秒速滿層 100 層，帶來 +100%~+200% 全域傷害翻倍。');
    lines.push('> 3. **崩解（小怪戰傷害特性）**：');
    lines.push('>    - **到期爆炸機制**：崩解爆炸限定「流血/中毒持續時間自然結束」時觸發。若小怪在 1~3 秒內提前被擊殺，實體銷毀導致 DOT 隨之消失，無法觸發自然到期爆炸。');
    lines.push('>    - **缺乏全場自動 AOE**：本體為 8 秒 CD 單體斬擊，缺乏萬毒血霧的全場每 0.5 秒自動疊毒。');
    lines.push('>    - **爆炸半徑僅 6 米**：貼身 60 像素範圍極狹窄，群怪分散難以互炸。');
    lines.push('>    - **菁英與 BOSS 戰正常發揮**：菁英怪血厚能撐過 7~10 秒並完整引發 200% 到期大爆炸；單體 BOSS 戰中能穩定跳滿與結算。');
  }

  lines.push('');
  lines.push('---');
  lines.push('');
}

lines.push('## 3. 全場景超神技能輸出天梯榜 (Top 10)');
lines.push('');

// 排序小怪 DPS
const topMob = [...results].sort((a, b) => b.normalMob.avgDps - a.normalMob.avgDps).slice(0, 10);
lines.push('### 3.1 🌾 普通小怪群戰 DPS 天梯榜 (AOE / 清怪割草王者)');
lines.push('');
lines.push('| 排名 | 技能群組 | 超神技能 | 專屬傳奇效果 | 小怪 DPS | 小怪採樣總傷害 | 超神技能效果摘要 |');
lines.push('| :---: | :--- | :--- | :--- | :---: | :---: | :--- |');
topMob.forEach((r, idx) => {
  const t = r.target;
  const m = r.normalMob;
  const affs = t.affixes.map(a => a.name).join('、');
  const desc = t.ultDesc.replace(/[\r\n]+/g, ' ').slice(0, 35) + '...';
  lines.push(`| **#${idx + 1}** | **${t.groupName}** | **${t.ultName}** | ${affs} | **${fmtDps(m.avgDps)}** | ${fmtDmg(m.totalDamage)} | ${desc} |`);
});
lines.push('');

// 排序菁英怪 DPS
const topElite = [...results].sort((a, b) => b.elite.avgDps - a.elite.avgDps).slice(0, 10);
lines.push('### 3.2 🛡️ 菁英怪攻堅 DPS 天梯榜 (多目標攻堅王者)');
lines.push('');
lines.push('| 排名 | 技能群組 | 超神技能 | 專屬傳奇效果 | 菁英怪 DPS | 菁英採樣總傷害 | 超神技能效果摘要 |');
lines.push('| :---: | :--- | :--- | :--- | :---: | :---: | :--- |');
topElite.forEach((r, idx) => {
  const t = r.target;
  const e = r.elite;
  const affs = t.affixes.map(a => a.name).join('、');
  const desc = t.ultDesc.replace(/[\r\n]+/g, ' ').slice(0, 35) + '...';
  lines.push(`| **#${idx + 1}** | **${t.groupName}** | **${t.ultName}** | ${affs} | **${fmtDps(e.avgDps)}** | ${fmtDmg(e.totalDamage)} | ${desc} |`);
});
lines.push('');

// 排序 BOSS DPS
const topBoss = [...results].sort((a, b) => b.boss.avgDps - a.boss.avgDps).slice(0, 10);
lines.push('### 3.3 👑 單體 BOSS 戰 DPS 天梯榜 (單體極限爆發王者)');
lines.push('');
lines.push('| 排名 | 技能群組 | 超神技能 | 專屬傳奇效果 | BOSS DPS | BOSS 採樣總傷害 | 超神技能效果摘要 |');
lines.push('| :---: | :--- | :--- | :--- | :---: | :---: | :--- |');
topBoss.forEach((r, idx) => {
  const t = r.target;
  const b = r.boss;
  const affs = t.affixes.map(a => a.name).join('、');
  const desc = t.ultDesc.replace(/[\r\n]+/g, ' ').slice(0, 35) + '...';
  lines.push(`| **#${idx + 1}** | **${t.groupName}** | **${t.ultName}** | ${affs} | **${fmtDps(b.avgDps)}** | ${fmtDmg(b.totalDamage)} | ${desc} |`);
});
lines.push('');

lines.push('---');
lines.push('');
lines.push('## 4. 傳奇效果協同與關鍵機制點評');
lines.push('');
lines.push('* **風刃 5 大傳奇（裂風、增壓、風之痕、風蝕、斷空刃）**：');
lines.push('  * 【斷空刃】將暴風真空刃連射數強制改寫至 3 道且技能傷害 +30%；【風之痕】兩側小型風刃再帶 1.3 倍獨立乘區；【裂風】隨命中持續疊層增傷。');
lines.push('  * 實測中**嵐之山**具備風土雙系滿加成，小怪 DPS 達 **5.03 B**（總傷 2015 億），位列全遊戲第四；**天穹崩裂**受擊被動連環發射風刃達 **4.12 B**；**暴風萬刃**追擊 7 秒達 **4.02 B**。');
lines.push('* **落雷術 5 大傳奇（三重雷、雷鎖、震雷、雷之再生、引雷針）**：');
lines.push('  * 【雷電矩陣】小怪 DPS 達 **10.18 B**（總傷 4076 億），橫掃全場；【雷霆天劫】達 **8.84 B**；【永恒雷獄】達 **8.81 B**。');
lines.push('* **雙刀亂舞 5 大傳奇（狂舞、狂戰士、不屈之誓、殺千刀、雙生刃）**：');
lines.push('  * 享有雙手補償與狂舞縮短間隔，【修羅亂舞】與【火之神樂】對單體 BOSS DPS 達 **4.68 B**（總傷 1873 億），為單體天花板。');
lines.push('');

fs.writeFileSync(REPORT_PATH, lines.join('\n'), 'utf8');
console.log('✅ 報表重新排版完成！路徑: ' + REPORT_PATH);
