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
      assert.ok(Number.isFinite(s.totalDamage) && s.totalDamage >= 0);
      assert.equal(s.avgDps, s.totalDamage / 120);
      assert.ok(Math.abs(Object.values(s.sources).reduce((n, v) => n + v.damage, 0) - s.totalDamage) <= Math.max(1, s.totalDamage) * 1e-12);
      for (const [stat, expected] of Object.entries({ atk: 50000, matk: 50000, pPen: 100, mPen: 100, critRate: 100, critDmg: 5996, totalDmgPct: 1000, blockRate: 50, blockDmgRed: 80, comboHits: 3 })) assert.equal(s.baseline[stat], expected);
      assert.equal(s.legendaryMultiplier, r.target.isTwoHand ? 2 : 1);
    }
  }
}
function render(data) {
  validate(data);
  const { metadata: m, results } = data;
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
    '> **測試基準版本**：v8.0（鎖血＋鎖法力重測：150秒／預熱30秒／採樣120秒，取代前版未鎖資源結果）  ',
    '> **負責測試**：Codex（Node VM Combat Simulation）  ',
    `> **遊戲基準提交**：\`${m.commit}\`  `,
    '> **資源驗證**：207場均開啟原生HP_lock與MP_lock，零死亡、零復活，法力不足不會阻擋施放。  ',
    `> **判讀提醒**：207場中${basicOnly}場後120秒僅普攻入帳；鎖血會阻止失血／瀕死／死亡效果，純Buff也可能只以普攻傷害呈現，不能由此判斷這些超神無效。  `,
    '> **核心規則**：全23系、69招、207場，每系必帶該系專屬5個傳奇效果。', '', '---', '',
    '## 1. 測試環境與標準化規範', '',
    '1. **核心傷害詞條絕對一致**：',
    '   * 全身13格100級傳奇裝備、強化+40（3.0x）、相同9種滿roll詞條：atkPct、critDmg、atkFlat、critRate、pPen、matkPct、matkFlat、mPen、aoeDmg；不依技能替換詞條。',
    '   * 戰鬥實際getStats固定：物攻=魔攻50,000、物穿=魔穿100%、暴擊100%、暴傷5996%、總增傷+1000%、各元素增傷+1000%、連擊3、格擋50%、格擋減傷80%。元素附傷elemDmgPct維持0，不捏造附傷。',
    '   * 各階及超神進化均Lv.10；僅測試VM開啟GM skillUnlock、hpLock及mpLock，保持角色100級／1轉；每場確認所選超神已生效。普攻、全系七階與傳奇衍生傷害均納入，因此數值是「裝載該超神的整套輸出」。',
    '2. **傳奇特效配置（Mandatory Legendary Affixes）**：',
    '   * 每系嚴格裝載來源表定義的5個傳奇效果；雙手巨劍、雙手魔劍、雙手法杖、雙手斧使用TWO_HAND_EFFECT_VALUE_MULT=2.0；修羅亂舞裝雙持雙手巨劍。',
    '3. **測試地圖與三種情境（300級沼澤Swamp，DEF=0／MDEF=0）**：',
    '   * 小怪20隻／波、菁英5隻／波、BOSS 1隻／波；整波死亡後立即補下一波。NPC從目前沼澤權重表抽取，由原生bfPlaceEnemies放置並自然移動。',
    '   * 現行NPC血量倍率使每波血量隨組成不同；不沿用舊報告的固定估計。每場各波實際HP及NPC ID均留原始JSON。',
    ...[['小怪', 'normalMob'], ['菁英', 'elite'], ['BOSS', 'boss']].map(([label, key]) => `   * 本次${label}首波實際總血量範圍：${fmtDmg(Math.min(...results.map(r => r[key].waves[0].totalHp)))}～${fmtDmg(Math.max(...results.map(r => r[key].waves[0].totalHp)))}。`),
    '4. **測試時長與數據統計口徑（2分30秒穩定態採樣）**：',
    '   * 每場3000步，每步0.05秒，共150秒；整數步換算GT，嚴格採樣30≤GT<150，分母固定120秒。',
    '   * 平均DPS = 後120秒累計輸出總傷害 ÷ 120秒，格式為`總傷 | DPS`；包含溢出傷害。',
    '   * 僅以正式recordRunDamage出口統計：普攻、直接、衍生、傳奇、DOT各記一次；不以血量差額補計，避免DOT到期爆炸重複入帳或漏掉溢出。',
    '5. **受擊模型與重現限制**：',
    '   * 沿用參考腳本的受控受擊：停用原生fieldMonsterAttack，每步最多前6隻存活怪依攻速resolveHit，不另檢查敵方射程；傷害由原生hpLock阻止，再以實際hpDamage呼叫skills2OnPlayerDamaged。沒有手動最低1HP補救，也不把0傷害改成50,000。此模型不代表完整正式野外實戰，不能用來驗收敵方攻擊距離或投射物。',
    '   * 初始HP／MP採角色計算上限；GM_TEST.hpLock=true、mpLock=true，原生邏輯阻擋敵傷／自傷扣血及主動／自動／被動觸發耗魔，不以灌入1e15資源代替鎖定。每步驗證兩個鎖定仍有效、HP>0，若進入死亡／復活流程即失敗；原始JSON留最低HP／MP、零死亡／復活與採樣期間施放次數。',
    '   * HP_lock使實際生命傷害為0，因此依失血、低血量、致死或死亡觸發的能力無法在此條件下完整發揮，例如不屈鬥魂的致死效果、戰神體的失血機制及生命反射。保留這個使用者指定條件，不造假補出失血或死亡傷害。',
    `   * 固定種子${m.seed}＋情境編號，同情境各技能同一起始亂數；技能消耗亂數不同，後續波次不保證相同。每技能每情境單次採樣，無多種子信賴區間。`,
    '   * 本次載入工作區JS與CSV。原有未提交Skills2.xlsx保留未套用；其SHA只用於來源追溯，不表示已測試該工作簿尚未匯出的修改。',
    '   * 本版取代CODEX v7.0未鎖資源結果。舊版可能因自傷死亡／復活後缺魔而只施放一次；本次以原生鎖血與鎖法力消除此干擾，重新實測全部207場，結果不可視為純平衡版本差異。', '', '---', '',
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
        lines.push(`${label}：${fmtDmg(s.totalDamage)} | ${fmtDps(s.avgDps)}${note}  `);
      }
      lines.push('');
    }
    lines.push('---', '');
  }
  lines.push('## 3. 全場景超神技能輸出天梯榜 (Top 10)', '');
  for (const [heading, key, label] of [['3.1 🌾 普通小怪群戰 DPS 天梯榜 (AOE / 清怪割草王者)', 'normalMob', '小怪'], ['3.2 🛡️ 菁英怪攻堅 DPS 天梯榜 (多目標攻堅王者)', 'elite', '菁英'], ['3.3 👑 單體 BOSS 戰 DPS 天梯榜 (單體極限爆發王者)', 'boss', 'BOSS']]) {
    lines.push(`### ${heading}`, '', `| 排名 | 技能群組 | 超神技能 | 專屬傳奇效果 | ${label} DPS | ${label}採樣總傷害 | 機制分析 |`, '| :---: | :--- | :--- | :--- | :---: | :---: | :--- |');
    [...results].sort((a, b) => b[key].avgDps - a[key].avgDps).slice(0, 10).forEach((r, idx) => {
      const topSource = Object.values(r[key].sources).sort((a, b) => b.damage - a.damage)[0];
      const note = topSource ? `主要記帳來源：${topSource.name}（${(100 * topSource.damage / r[key].totalDamage).toFixed(1)}%）` : '採樣無傷害';
      lines.push(`| **#${idx + 1}** | **${r.target.groupName}** | **${r.target.ultName}** | ${r.target.affixes.map(a => a.name).join('、')} | **${fmtDps(r[key].avgDps)}** | ${fmtDmg(r[key].totalDamage)} | ${note} |`);
    });
    lines.push('');
  }
  lines.push('---', '', '## 4. 傳奇效果協同與關鍵機制點評', '',
    '* 本節僅描述本次實測，未做移除單一傳奇的對照，不能把總輸出直接歸因於某一傳奇。',
    '* 主動技能、普攻觸發與防禦型超神皆保留原生技能行為；被動或防禦效果可沒有主動施放次數，已以sgUlt及七階Lv.10確認選擇生效。',
    '* 明細標註「採樣僅普攻入帳」時，代表後120秒的傷害來源只有普攻。純Buff仍可能強化普攻；本次已鎖血鎖法力，不能再將該註記解讀成死亡或缺魔造成停放。',
    '* 前30秒被排除不保證所有技能已達穩態；鎖血使失血／瀕死／死亡門檻不成立，遠程敵人未進入技能範圍也會影響輸出。', '');
  for (const gid of ['windblade', 'thunderstrike', 'dualdance', 'bloodblade', 'counter', 'earthguard']) {
    const list = groups.get(gid);
    lines.push(`* **${list[0].target.groupName} 5大傳奇（${list[0].target.affixes.map(a => a.name).join('、')}）**：`);
    for (const r of list) lines.push(`  * 【${r.target.ultName}】：小怪${fmtDps(r.normalMob.avgDps)}／菁英${fmtDps(r.elite.avgDps)}／BOSS ${fmtDps(r.boss.avgDps)}。`);
  }
  const zero = results.flatMap(r => ['normalMob', 'elite', 'boss'].filter(k => r[k].totalDamage === 0).map(k => r.target.ultId + '/' + k));
  lines.push('', `零傷害採樣：${zero.length ? zero.join('、') : '無'}。`, '', '## 5. 原始資料與重跑方式', '',
    '* 原始數據：[20261026-ult-dps-results.json](skill-tests/20261026-ult-dps-results.json)，含207場總傷、未四捨五入DPS、來源拆分、全場與採樣期間施放次數、HP／MP鎖定、最低資源、死亡／復活次數、基準屬性、傳奇倍率、seed、每波HP及來源SHA256。',
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
