#!/usr/bin/env node
'use strict';
/* 由資料表（js/elite_data.js）產生 docs/ELITE_AFFIXES.md 的「菁英詞條總表」。
   說明文件與實際資料同源——改了資料表就重跑本檔，文件不會漂移：

     node tools/gen_elite_doc.cjs            # 寫入 docs/ELITE_AFFIXES.md 的自動段落
     node tools/gen_elite_doc.cjs --check    # 只檢查文件是否已是最新（不寫檔）

   文件裡「<!-- GENERATED:BEGIN -->」到「<!-- GENERATED:END -->」之間由本檔覆寫，其餘文字手寫。 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const docPath = path.join(root, 'docs', 'ELITE_AFFIXES.md');
const ctx = {};
vm.createContext(ctx);
['js/data.js', 'js/elite_data.js'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f }));

const ARCH_NAME = {
  spots: '多點落下', spot: '單點爆發', zone: '地面場域', volley: '彈體齊射', beam: '直線光束', bolt: '電弧', dash: '衝鋒', blink: '瞬移',
  spin: '原地連斬', vortex: '拖拽漩渦', shield: '護盾', reflect: '反射', invuln: '群體無敵', heal: '群體治療', summon: '召喚',
  bloodsac: '獻祭', curse: '詛咒', drain: '吸取', regen: '再生', haste: '加速', giant: '巨像', enrage: '狂暴', vampiric: '吸血',
  thorns: '反震', knockback: '擊飛', lifelink: '鏈結', phoenix: '重生', bomber: '自爆', splitter: '分裂'
};
const ELEM_NAME = { fire: '火', ice: '冰', lightning: '雷', poison: '毒', light: '聖', dark: '暗', earth: '地', wind: '風' };

function table(rows, header) {
  const out = ['| ' + header.join(' | ') + ' |', '| ' + header.map(() => '---').join(' | ') + ' |'];
  rows.forEach((r) => out.push('| ' + r.join(' | ') + ' |'));
  return out.join('\n');
}
function cd(d) { return d.kind === 'active' ? d.cd[0] + '～' + d.cd[1] : '常駐'; }
/* 關鍵數字：只挑調整時最常動的幾個，完整欄位看 js/elite_data.js。 */
function knobs(d) {
  const k = [];
  if (d.dmg !== undefined) k.push('傷害×' + d.dmg);
  if (d.r !== undefined) k.push('半徑 ' + d.r);
  if (d.w2 !== undefined) k.push('長 ' + d.w2);
  if (d.warn) k.push('預警 ' + d.warn + 's');
  if (d.n !== undefined && d.arch !== 'splitter' && d.arch !== 'summon') k.push(d.n + ' 發');
  if (d.n !== undefined && (d.arch === 'splitter' || d.arch === 'summon')) k.push(d.n + ' 隻');
  if (d.life !== undefined) k.push('持續 ' + d.life + 's');
  if (d.stun) k.push('暈眩 ' + d.stun + 's');
  if (d.slow) k.push('減速 ' + d.slow + 's');
  if (d.dot) k.push(d.dot.name + ' ' + d.dot.dur + 's');
  if (d.pct !== undefined) k.push(d.pct + '%');
  if (d.dur !== undefined && d.arch !== 'curse') k.push(d.dur + 's');
  if (d.share !== undefined) k.push('分攤 ' + d.share + '%');
  if (d.red !== undefined) k.push('減傷 ' + d.red + '%');
  if (d.hpPct !== undefined) k.push('血量≤' + d.hpPct + '%');
  if (d.minStage) k.push('≥' + d.minStage + ' 關');
  return k.join('、') || '—';
}

function generate() {
  const L = [];
  const ids = ctx.ELITE_AFFIX_ORDER;
  const active = ids.filter((id) => ctx.ELITE_AFFIXES[id].kind === 'active').length;
  L.push('共 ' + ids.length + ' 個詞條（主動 ' + active + '、常駐／被動 ' + (ids.length - active) + '）。數字以 `js/elite_data.js` 為準；表上的「互斥組」相同的詞條不會同時出現在同一隻菁英身上。');
  L.push('');
  L.push(table(ids.map((id) => {
    const d = ctx.ELITE_AFFIXES[id];
    return [d.emoji + ' ' + d.name, '`' + id + '`', ARCH_NAME[d.arch] || d.arch, d.elem ? (ELEM_NAME[d.elem] || d.elem) : '—',
      cd(d), knobs(d), d.grp || '—', d.desc];
  }), ['詞條', 'id', '型態', '屬性', '冷卻（秒）', '關鍵數字', '互斥組', '效果']));
  return L.join('\n');
}

const BEGIN = '<!-- GENERATED:BEGIN -->';
const END = '<!-- GENERATED:END -->';
function build(current) {
  const s = current.indexOf(BEGIN), e = current.indexOf(END);
  if (s < 0 || e < 0 || e < s) throw new Error('docs/ELITE_AFFIXES.md 缺少自動段落標記');
  return current.slice(0, s + BEGIN.length) + '\n\n' + generate() + '\n\n' + current.slice(e);
}

if (require.main === module) {
  const current = fs.readFileSync(docPath, 'utf8');
  const next = build(current);
  if (process.argv.includes('--check')) {
    if (next !== current) { console.error('docs/ELITE_AFFIXES.md 已過期：請執行 node tools/gen_elite_doc.cjs'); process.exit(1); }
    console.log('docs/ELITE_AFFIXES.md 是最新的');
  } else {
    fs.writeFileSync(docPath, next, 'utf8');
    console.log('已更新 docs/ELITE_AFFIXES.md（' + ctx.ELITE_AFFIX_ORDER.length + ' 個詞條）');
  }
}
module.exports = { generate, build };
