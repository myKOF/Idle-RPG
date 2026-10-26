'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'docs/skill-tests/20261026-ult-dps-results.json');
const REPORT = path.join(ROOT, 'docs/ULT_EVOLUTION_ALL_69_SKILLS_DPS_REPORT_CODEX.md');
function fmtDps(n) {
  for (const [v, unit] of [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']]) if (n >= v) return (n / v).toFixed(2) + ' ' + unit;
  return n.toFixed(2);
}
function fmtDmg(n) {
  for (const [v, unit] of [[1e12, '兆'], [1e8, '億'], [1e4, '萬']]) if (n >= v) return (n / v).toFixed(2) + ' ' + unit;
  return n.toFixed(2);
}
function validate(data) {
  assert.equal(data.metadata.hpLock, true);
  assert.equal(data.metadata.mpLock, true);
  assert.equal(data.metadata.playerLevel, 100);
  assert.equal(data.metadata.enemyLevel, 100);
  assert.equal(data.metadata.effectiveHitChance, 100);
  assert.equal(data.results.length, 69);
  assert.equal(new Set(data.results.map(r => r.target.ultId)).size, 69);
  assert.equal(new Set(data.results.map(r => r.target.gid)).size, 23);
  for (const r of data.results) {
    assert.equal(r.target.affixes.length, 5);
    for (const key of ['normalMob', 'elite', 'boss']) {
      const s = r[key];
      assert.equal(s.sampleDuration, 120);
      assert.equal(s.totalDuration, 150);
      assert.equal(s.warmupDuration, 30);
      assert.equal(s.steps, 3000);
      assert.ok(s.ultimateActive);
      assert.equal(s.resources.hpLock, true);
      assert.equal(s.resources.mpLock, true);
      assert.equal(s.resources.deaths, 0);
      assert.equal(s.resources.revivalTicks, 0);
      assert.ok(s.resources.minHp > 0);
      assert.ok(s.resources.minMp >= 0);
      assert.ok(s.finalPlayerHp > 0);
      assert.ok(s.sampleCasts && typeof s.sampleCasts === 'object');
      assert.equal(s.playerLevel, 100);
      assert.equal(s.enemyLevel, 100);
      assert.ok(Number.isInteger(s.kills.total) && Number.isInteger(s.kills.sample));
      assert.ok(s.kills.total >= s.kills.sample && s.kills.sample >= 0);
      assert.ok(s.waves.every(w => w.level === 100 && w.count === [0, 20, 5, 1][s.scenarioType]));
      assert.equal(s.damageAudit.playerHitMisses, 0);
      assert.equal(s.damageAudit.minHitChance, 100);
      assert.ok(s.baseline.hit - s.baseline.maxEnemyDodge >= 100);
      assert.ok(Number.isFinite(s.totalDamage) && s.totalDamage >= 0);
      assert.equal(s.avgDps, s.totalDamage / 120);
      assert.ok(Math.abs(Object.values(s.sources).reduce((n, v) => n + v.damage, 0) - s.totalDamage) <= Math.max(1, s.totalDamage) * 1e-12);
      assert.ok(Math.abs(Object.values(s.subTypes).reduce((n, v) => n + v.damage, 0) - s.totalDamage) <= Math.max(1, s.totalDamage) * 1e-12);
      for (const [stat, expected] of Object.entries({ atk: 50000, matk: 50000, pPen: 100, mPen: 100, critRate: 100, critDmg: 5996, totalDmgPct: 1000, blockRate: 50, blockDmgRed: 80, comboHits: 3 })) assert.equal(s.baseline[stat], expected);
      assert.equal(s.legendaryMultiplier, r.target.isTwoHand ? 2 : 1);
    }
  }
}
function render(data) {
  validate(data);
  const { metadata: m, results } = data;
  const scenarios = results.flatMap(r => ['normalMob', 'elite', 'boss'].map(k => r[k]));
  const hitAttempts = scenarios.reduce((n, s) => n + s.damageAudit.playerHitAttempts, 0);
  const deadRejected = scenarios.reduce((n, s) => n + s.damageAudit.rejectedDeadHits + s.damageAudit.rejectedDeadDirect, 0);
  const basicOnly = results.flatMap(r => ['normalMob', 'elite', 'boss'].filter(key => {
    const sources = Object.values(r[key].sources);
    return sources.length && sources.every(s => s.name === '普攻');
  })).length;
  const time = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei', dateStyle: 'short', timeStyle: 'medium' }).format(new Date(m.completedAt));
  const groups = new Map();
  for (const r of results) { if (!groups.has(r.target.gid)) groups.set(r.target.gid, []); groups.get(r.target.gid).push(r); }
  const lines = [
    `# ⚔️ 全 23 大技能群組（69 招超神進化技能）DPS 實測總結報表【${time}】`, '',
    `> **實測完成時間**：\`${time}\`（Asia/Taipei）  `,
    '> **測試基準版本**：v10.0（同級100、鎖血鎖法力、實際必中；致死最後一下保留溢出，死後計傷歸零）  ',
    '> **負責測試**：Codex（Node VM Combat Simulation）  ',
    `> **遊戲基準提交**：\`${m.commit}\`  `,
    '> **資源驗證**：207場均開啟原生HP_lock與MP_lock，零死亡、零復活，法力不足不會阻擋施放。  ',
    '> **敵人與補怪**：角色固定100級、怪物實際level固定100；全滅當步立即補上同數量、同類型新一批，持續到150秒。  ',
    '> **命中與計傷**：扣除閃避後實際命中100%，逐次驗證零MISS；僅保留活目標所承受的致死那筆完整傷害，之後對同一死亡目標的DOT／延遲／追加傷害全部排除。  ',
    `> **本次稽核**：全場${hitAttempts.toLocaleString('en-US')}次玩家命中判定、0次MISS；已死目標結算入口拒絕${deadRejected}次（0代表原生上層已擋住，沒有此類後續結算嘗試）。  `,
    `> **判讀提醒**：207場中${basicOnly}場後120秒僅普攻入帳；鎖血會阻止失血／瀕死／死亡效果，純Buff也可能只以普攻傷害呈現，不能由此判斷這些超神無效。  `,
    '> **核心規則**：全23系、69招、207場，每系必帶該系專屬5個傳奇效果。', '', '---', '',
    '## 1. 測試環境與標準化規範', '',
    '1. **核心傷害詞條絕對一致**：',
    '   * 全身13格100級傳奇裝備、強化+40（3.0x）、相同9種滿roll詞條：atkPct、critDmg、atkFlat、critRate、pPen、matkPct、matkFlat、mPen、aoeDmg；不依技能替換詞條。',
    '   * 戰鬥實際getStats固定：物攻=魔攻50,000、物穿=魔穿100%、暴擊100%、暴傷5996%、總增傷+1000%、各元素增傷+1000%、連擊3、格擋50%、格擋減傷80%。元素附傷elemDmgPct維持0，不捏造附傷。',
    `   * 命中屬性固定${results[0].normalMob.baseline.hit}，三類敵人最高閃避${results[0].normalMob.baseline.maxEnemyDodge}，扣除閃避後實際命中率100%；每次活目標resolveHit皆驗證命中率與零MISS。暴擊率與命中率分開控制。普攻攻速仍為每秒${results[0].normalMob.baseline.aspd}次，沒有提高攻速。`,
    '   * 各階及超神進化均Lv.10；僅測試VM開啟GM skillUnlock、hpLock及mpLock，保持角色100級／1轉；每場確認所選超神已生效。普攻、全系七階與傳奇衍生傷害均納入，因此數值是「裝載該超神的整套輸出」。',
    '2. **傳奇特效配置（Mandatory Legendary Affixes）**：',
    '   * 每系嚴格裝載來源表定義的5個傳奇效果；雙手巨劍、雙手魔劍、雙手法杖、雙手斧使用TWO_HAND_EFFECT_VALUE_MULT=2.0；修羅亂舞裝雙持雙手巨劍。',
    '3. **測試地圖與三種情境（同級100級沼澤NPC，DEF=0／MDEF=0）**：',
    '   * 小怪20隻／波、菁英5隻／波、BOSS 1隻／波；整波死亡後立即補下一波。NPC從目前沼澤權重表抽取，由原生bfPlaceEnemies放置並自然移動。',
    '   * 角色等級與敵人實際level皆固定100，不因擊殺獲得經驗或熟練度而升級；怪物生成明確排除威能等級加成。保留原NPC種類／倍率，將前版300級敵人改為同級100級。',
    '   * 現行NPC血量倍率使每波血量隨組成不同；不沿用舊報告的固定估計。每場各波實際HP及NPC ID均留原始JSON。',
    ...[['小怪', 'normalMob'], ['菁英', 'elite'], ['BOSS', 'boss']].map(([label, key]) => `   * 本次${label}首波實際總血量範圍：${fmtDmg(Math.min(...results.map(r => r[key].waves[0].totalHp)))}～${fmtDmg(Math.max(...results.map(r => r[key].waves[0].totalHp)))}。`),
    '4. **測試時長與數據統計口徑（2分30秒穩定態採樣）**：',
    '   * 每場3000步，每步0.05秒，共150秒；整數步換算GT，嚴格採樣30≤GT<150，分母固定120秒。',
    '   * 平均DPS = 後120秒累計輸出總傷害 ÷ 120秒，格式為`總傷 | DPS | 殺敵：採樣數（全場數）`；致死那筆結算保留超出剩餘HP的傷害。',
    '   * 殺敵數由原生onFieldKill成功結算後的recordLootKill入口統計；同一次死亡重複掃描不重複計數，天地再造重生後再次擊殺依遊戲規則可再計1次。採樣數只計30≤GT<150，全場數計完整150秒，預熱擊殺不放進採樣數。',
    '   * 僅以正式recordRunDamage出口統計：普攻、直接、衍生、傳奇、DOT各記一次；不以血量差額補計。在測試VM的resolveHit／applyEnemyHpDamage入口先看目標是否活著：活著時保留完整結算，已死亡時直接返回0，後續DOT、延遲或追加命中不再入帳；原生同批DOT仍視為一次結算。',
    '   * 例：敵人剩100HP，本次造成1000傷害並死亡，計1000；之後再對屍體結算500DOT，計0。死亡爆炸若打到其他活敵仍可計傷；原生復活後再受傷也可正常計算。',
    '5. **受擊模型與重現限制**：',
    '   * 沿用參考腳本的受控受擊：停用原生fieldMonsterAttack，每步最多前6隻存活怪依攻速resolveHit，不另檢查敵方射程；傷害由原生hpLock阻止，再以實際hpDamage呼叫skills2OnPlayerDamaged。沒有手動最低1HP補救，也不把0傷害改成50,000。此模型不代表完整正式野外實戰，不能用來驗收敵方攻擊距離或投射物。',
    '   * 初始HP／MP採角色計算上限；GM_TEST.hpLock=true、mpLock=true，原生邏輯阻擋敵傷／自傷扣血及主動／自動／被動觸發耗魔，不以灌入1e15資源代替鎖定。每步驗證兩個鎖定仍有效、HP>0，若進入死亡／復活流程即失敗；原始JSON留最低HP／MP、零死亡／復活與採樣期間施放次數。',
    '   * HP_lock使實際生命傷害為0，因此依失血、低血量、致死或死亡觸發的能力無法在此條件下完整發揮，例如不屈鬥魂的致死效果、戰神體的失血機制及生命反射。保留這個使用者指定條件，不造假補出失血或死亡傷害。',
    `   * 固定種子${m.seed}＋情境編號，同情境各技能同一起始亂數；技能消耗亂數不同，後續波次不保證相同。每技能每情境單次採樣，無多種子信賴區間。`,
    '   * 本次載入工作區JS與CSV。原有未提交Skills2.xlsx保留未套用；其SHA只用於來源追溯，不表示已測試該工作簿尚未匯出的修改。',
    '   * 本版取代CODEX v9.0的低命中結果：前版命中106.1、普通怪閃避62.8，實際僅43.3%；這次統一實際必中，並明確排除死亡後計傷，重新實測全部207場。高等級最大HP比例及致死溢出仍會放大DPS，需與殺敵數並讀。', '', '---', '',
    '## 2. 全 23 大技能群組總結清單（依指定換行規則整理）', ''
  ];
  let i = 0;
  for (const [gid, list] of groups) {
    const t = list[0].target;
    lines.push(`### 【${++i}】${t.groupName} (${gid})`, '', '| 技能群組 | 屬性 / 武器類型 | 必帶 5 大傳奇效果 |', '| :--- | :--- | :--- |', `| **${t.groupName}** | ${t.elem} / ${t.primaryWp}${t.isTwoHand ? ' (2H雙手補償)' : ''} | ${t.affixes.map(a => a.name).join('、')} |`, '');
    for (const r of list) {
      lines.push(`**${r.target.ultName}** (\`${r.target.ultId}\`)  `);
      for (const [label, key] of [['小怪', 'normalMob'], ['菁英', 'elite'], ['BOSS', 'boss']]) {
        const s = r[key];
        const sources = Object.values(s.sources);
        const casts = s.casts['skill2:' + r.target.gid];
        const sample = s.sampleCasts['skill2:' + r.target.gid] || 0;
        const note = sources.length && sources.every(v => v.name === '普攻')
          ? `（採樣僅普攻入帳；${casts === undefined ? '被動效果' : '全場施放' + casts + '次／採樣期間' + sample + '次'}）` : '';
        lines.push(`${label}：${fmtDmg(s.totalDamage)} | ${fmtDps(s.avgDps)} | 殺敵：${s.kills.sample}（全場${s.kills.total}）${note}  `);
      }
      lines.push('');
    }
    lines.push('---', '');
  }
  lines.push('## 3. 全場景超神技能輸出天梯榜 (Top 10)', '');
  for (const [heading, key, label] of [['3.1 🌾 普通小怪群戰 DPS 天梯榜 (AOE / 清怪割草王者)', 'normalMob', '小怪'], ['3.2 🛡️ 菁英怪攻堅 DPS 天梯榜 (多目標攻堅王者)', 'elite', '菁英'], ['3.3 👑 單體 BOSS 戰 DPS 天梯榜 (單體極限爆發王者)', 'boss', 'BOSS']]) {
    lines.push(`### ${heading}`, '', `| 排名 | 技能群組 | 超神技能 | 專屬傳奇效果 | ${label} DPS | ${label}採樣總傷害 | 採樣殺敵數 | 全場殺敵數 | 機制分析 |`, '| :---: | :--- | :--- | :--- | :---: | :---: | :---: | :---: | :--- |');
    [...results].sort((a, b) => b[key].avgDps - a[key].avgDps).slice(0, 10).forEach((r, idx) => {
      const topSource = Object.values(r[key].sources).sort((a, b) => b.damage - a.damage)[0];
      const note = topSource ? `主要記帳來源：${topSource.name}（${(100 * topSource.damage / r[key].totalDamage).toFixed(1)}%）` : '採樣無傷害';
      lines.push(`| **#${idx + 1}** | **${r.target.groupName}** | **${r.target.ultName}** | ${r.target.affixes.map(a => a.name).join('、')} | **${fmtDps(r[key].avgDps)}** | ${fmtDmg(r[key].totalDamage)} | ${r[key].kills.sample} | ${r[key].kills.total} | ${note} |`);
    });
    lines.push('');
  }
  lines.push('---', '', '## 4. 傳奇效果協同與關鍵機制點評', '',
    '* 本節僅描述本次實測，未做移除單一傳奇的對照，不能把總輸出直接歸因於某一傳奇。',
    '* 主動技能、普攻觸發與防禦型超神皆保留原生技能行為；被動或防禦效果可沒有主動施放次數，已以sgUlt及七階Lv.10確認選擇生效。',
    '* 明細標註「採樣僅普攻入帳」時，代表後120秒的傷害來源只有普攻。純Buff仍可能強化普攻；本次已鎖血鎖法力，不能再將該註記解讀成死亡或缺魔造成停放。',
    '* 前30秒被排除不保證所有技能已達穩態；鎖血使失血／瀕死／死亡門檻不成立，遠程敵人未進入技能範圍也會影響輸出。', '');
  lines.push('### 雙刀前版極端傷害的查核', '',
    '* 前版300級敵人每隻普通怪約1.243兆HP。三招共用T5【鐵血之舞】，傷害按敵人最大HP計算；短測分項顯示幾乎全部傷害來自【鐵血裂傷】，而非超神三招各自的特殊效果。',
    '* 當時實際每跳比例：鐵血之舞2% × 狂戰士1.5倍（雙手補償後+50%）× 暴擊59.96倍 × 總增傷11倍 = 敵人最大HP的1978.68%。每隻300級小怪單跳約24.60兆傷害；此狀態無元素標籤，這個案例沒有再乘各元素增傷11倍。',
    '* 原生DOT管線會對最大HP百分比流血套暴擊與總增傷，而本報告依規範計入Overkill；即使單怪只剩約1.243兆HP，該跳仍可記約24.60兆。這個計算可重現，不能據此認定超神本體強幾十萬倍，也不能把同一系三個近似數值當作三個獨立機制都很強。',
    '* 本次改為同級100級、增加實際殺敵數與傷害子類JSON，直接觀察清怪效果。沒有為了讓測試結果接近其他技能而調低傷害、刪除溢出、停用T5或修改正式公式。', '');
  lines.push('### 反擊三招的殺敵數與DPS為何可能不同', '',
    '* DPS保留致死最後一下的完整傷害。對同一隻怪造成10倍或100倍生命的傷害，都只增加1殺，但後者的DPS仍會更高。因此相同殺敵數不代表相同總傷，殺敵更多也不保證DPS更高。',
    '* 戰神體累計生命及護盾的損失百分比來放大下一段反擊。HP_lock只擋扣血，盾仍會被打破；反擊盾每次補出的小盾，被完整打破時也可累計其當時盾上限的100%。反覆補盾／破盾會累積大幅反擊加成，再以致死溢出呈現在DPS，可能沒有增加殺敵數。',
    '* 神聖之體另有光彈範圍攻擊，能多殺其他活敵；這是覆蓋與出手機會增加，單次傷害未必高於戰神體。前版鎖血條件下，不屈鬥魂的瀕死效果也無法觸發，不能由這組條件評估其救命價值。', '');
  for (const gid of ['windblade', 'thunderstrike', 'dualdance', 'bloodblade', 'counter', 'earthguard']) {
    const list = groups.get(gid);
    lines.push(`* **${list[0].target.groupName} 5大傳奇（${list[0].target.affixes.map(a => a.name).join('、')}）**：`);
    for (const r of list) lines.push(`  * 【${r.target.ultName}】：小怪${fmtDps(r.normalMob.avgDps)}／菁英${fmtDps(r.elite.avgDps)}／BOSS ${fmtDps(r.boss.avgDps)}。`);
  }
  const zero = results.flatMap(r => ['normalMob', 'elite', 'boss'].filter(k => r[k].totalDamage === 0).map(k => r.target.ultId + '/' + k));
  lines.push('', `零傷害採樣：${zero.length ? zero.join('、') : '無'}。`, '', '## 5. 原始資料與重跑方式', '',
    '* 原始數據：[20261026-ult-dps-results.json](skill-tests/20261026-ult-dps-results.json)，含207場總傷、未四捨五入DPS、來源／傷害子類拆分、命中次數／MISS／最低實際命中率、致死結算與死亡後拒絕計傷次數、採樣與全場殺敵數、實際等級、全場與採樣期間施放次數、HP／MP鎖定、最低資源、死亡／復活次數、基準屬性、傳奇倍率、seed、每波HP及來源SHA256。',
    '* 重跑：`node tools/ult-dps-benchmark.cjs`，再執行`node tools/ult-dps-report.cjs`。工具不讀寫玩家存檔，不修改遊戲配置。',
    '* 結構及算術驗證：`node --test tests/ult-dps-benchmark.test.cjs`；`node tools/ult-dps-report.cjs --check`比對報告與JSON是否一致。', '');
  // CommonMark hard breaks without trailing whitespace, so git diff --check stays clean.
  return lines.map(line => line.endsWith('  ') ? line.slice(0, -2) + '\\' : line).join('\n');
}
if (require.main === module) {
  const report = render(JSON.parse(fs.readFileSync(DATA, 'utf8')));
  if (process.argv.includes('--check')) assert.equal(fs.readFileSync(REPORT, 'utf8'), report);
  else fs.writeFileSync(REPORT, report);
  console.log('69 skills / 207 scenarios validated; report ' + (process.argv.includes('--check') ? 'matches' : 'written'));
}
module.exports = { validate, render, fmtDps, fmtDmg };
