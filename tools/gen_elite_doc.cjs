#!/usr/bin/env node
'use strict';
/* 由資料（Skills2 敵人技能 → ENEMY_SKILLS2、NPC 表 → js/data.js）產生 docs/ELITE_AFFIXES.md 的「總表」自動段落。
   用法：
     node tools/gen_elite_doc.cjs            # 寫入 docs/ELITE_AFFIXES.md 的自動段落
     node tools/gen_elite_doc.cjs --check    # 只檢查文件是否最新（過期就以非零結束碼離開）
   文件其餘部分（規則、怎麼調）是手寫的；自動段落以 GENERATED 註解標記圍起來。 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const docPath = path.join(root, 'docs', 'ELITE_AFFIXES.md');
const ctx = { console, module: { exports: {} } };
vm.createContext(ctx);
['js/data.js', 'js/skills2.js', 'js/status.js', 'js/elite_data.js'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f }));

const ARCH_NAME = {
  spots: '多點落下', spot: '單點爆發', zone: '地面場域', volley: '彈體齊射', bolt: '電弧', dash: '衝鋒', spin: '原地連斬',
  invuln: '群體無敵', heal: '群體治療', bloodsac: '獻祭', curse: '詛咒', drain: '吸取',
  chain: '火鏈', rotbeam: '旋轉光束', puddle: '毒窪', cross: '旋轉十字', crystals: '冰晶爆裂', icepulse: '追蹤冰球',
  mortar: '迫擊', walls: '築牆', pull: '拉扯', immune: '免疫護盾', summon: '召喚', missiles: '追蹤飛彈',
  regen: '再生', haste: '加速', enrage: '狂暴', vampiric: '吸血', knockback: '擊飛', lifelink: '鏈結', phoenix: '重生',
  bomber: '自爆', splitter: '分裂', molten: '熔火', sparks: '電火花', vital: '強命', avenger: '復仇'
};
const ELEM_NAME = { fire: '火', ice: '冰', lightning: '雷', poison: '毒', light: '聖', dark: '暗', earth: '地', wind: '風' };
const ROLE_NAME = { cast: '施放', attack: '攻擊', proj: '彈體', hit: '受擊', ground: '地板', field: '場域', attack2: '攻擊²', proj2: '彈體²', hit2: '受擊²', ground2: '地板²', field2: '場域²' };

function table(rows, header) {
  const out = ['| ' + header.join(' | ') + ' |', '| ' + header.map(() => '---').join(' | ') + ' |'];
  rows.forEach((r) => out.push('| ' + r.join(' | ') + ' |'));
  return out.join('\n');
}
function cd(d) { return d.kind === 'active' ? (d.cd[0] === d.cd[1] ? d.cd[0] : d.cd[0] + '～' + d.cd[1]) : '常駐'; }
const m = (v) => (v / 10);       // 座標單位 → 米
/* 關鍵數字：只挑調整時最常動的幾個（距離換回米），完整欄位看 Skills2 表的「效果參數(JSON)」。 */
function knobs(d) {
  const k = [];
  const rng = (v) => (Array.isArray(v) ? (v[0] === v[1] ? v[0] : v[0] + '~' + v[1]) : v);
  if (d.dmg !== undefined) k.push('傷害×' + d.dmg);
  if (d.coreDmg !== undefined) k.push('核心×' + d.coreDmg);
  if (d.r !== undefined) k.push('半徑 ' + m(d.r) + 'm');
  if (d.coreR !== undefined) k.push('核心半徑 ' + m(d.coreR) + 'm');
  if (d.w2 !== undefined) k.push('長 ' + m(d.w2) + 'm');
  if (d.len !== undefined) k.push('長 ' + m(d.len) + 'm');
  if (d.warn) k.push('預警 ' + d.warn + 's');
  if (d.n !== undefined) k.push(rng(d.n) + (d.arch === 'splitter' || d.arch === 'summon' ? ' 隻' : ' 發'));
  if (d.arms !== undefined) k.push(rng(d.arms) + ' 根');
  if (d.maxStacks !== undefined) k.push('最多 ' + d.maxStacks + ' 層');
  if (d.life !== undefined) k.push('持續 ' + d.life + 's');
  if (d.dur !== undefined && d.arch !== 'curse') k.push(d.dur + 's');
  if (d.throwRange !== undefined) k.push('丟 ≤' + m(d.throwRange) + 'm');
  if (d.minRange !== undefined) k.push('最小射程 ' + m(d.minRange) + 'm');
  if (d.speed !== undefined && d.arch === 'pull') k.push('拉速 ' + m(d.speed) + 'm/s');
  if (d.hp !== undefined && d.arch === 'vital') k.push('生命×' + d.hp);
  if (d.stun) k.push('暈眩 ' + d.stun + 's');
  if (d.freeze) k.push('冰凍 ' + d.freeze + 's');
  if (d.slow) k.push('減速 ' + d.slow + 's');
  if (d.dot) k.push(d.dot.name + ' ' + d.dot.dur + 's');
  if (d.pct !== undefined) k.push(d.pct + '%');
  if (d.share !== undefined) k.push('分攤 ' + d.share + '%');
  if (d.hpPct !== undefined) k.push('血量≤' + d.hpPct + '%');
  if (d.hpCut !== undefined) k.push('死後小怪 −' + Math.round(d.hpCut * 100) + '%');
  if (d.minStage) k.push('≥' + d.minStage + ' 關');
  return k.join('、') || '—';
}
function flags(d) {
  const f = [];
  if (d.repo) f.push('先跑位');
  if (d.needs === 'group') f.push('需同伴');
  if (d.noTower) f.push('塔戰不抽');
  return f.join('、') || '—';
}
function vfxOf(d) {
  const parts = Object.keys(d.v).map((k) => (ROLE_NAME[k] || k) + '＝`' + d.v[k] + '`');
  (d.presets || []).forEach((p) => parts.push('`' + p + '`'));
  return parts.join('、') || '（無畫面）';
}
/* 狀態欄：我方＝施放者自己身上、敵方＝玩家身上；名稱取 Status 表 */
function statusOf(d) {
  const part = (label, list) => (list || []).map((e) => label + '：' + ((ctx.STATUS[e.id] && ctx.STATUS[e.id].name) || e.id) + '（`' + e.id + '`）');
  const st = d.status || {};
  return part('自己', st.self).concat(part('玩家', st.enemy)).join('、') || '—';
}
function row(id) {
  const d = ctx.ELITE_AFFIXES[id];
  return [d.emoji + ' ' + d.name, '`' + id + '`', ARCH_NAME[d.arch] || d.arch, d.elem ? (ELEM_NAME[d.elem] || d.elem) : '—', cd(d), knobs(d), flags(d), d.desc, statusOf(d), vfxOf(d)];
}
const HEADER = ['技能', 'id', '型態', '屬性', '冷卻（秒）', '關鍵數字', '限制', '效果', '掛的狀態', '特效 Preset（技能本身）'];
/* 敵人專用狀態（Status 表，id 以 e 開頭且 Skills2 敵人技能有引用）：畫面全在這裡 */
function statusTable() {
  const used = {};
  ctx.ELITE_AFFIX_ORDER.forEach((id) => {
    const st = ctx.ELITE_AFFIXES[id].status || {};
    ['self', 'enemy'].forEach((side) => (st[side] || []).forEach((e) => { (used[e.id] = used[e.id] || []).push(ctx.ELITE_AFFIXES[id].name); }));
  });
  return Object.keys(used).map((sid) => {
    const s = ctx.STATUS[sid] || {};
    const v = s.vfx || {};
    const cell = (k) => (v[k] ? '`' + v[k] + '`' : '—');
    return [s.icon + ' ' + s.name, '`' + sid + '`', used[sid].join('、'), cell('apply'), cell('aura'), cell('tick')];
  });
}

function npcSummary() {
  const pools = ['DESERT_POOL', 'ICEFIELD_POOL', 'SWAMP_POOL', 'UNDEAD_MOUNTAINS_POOL', 'GOD_BATTLEFIELD_POOL', 'GOD_CHAOS_POOL', 'GOD_SANCTUARY_POOL'];
  const rows = [];
  pools.forEach((p) => ctx[p].forEach((n) => {
    const b = n.skills && n.skills.boss;
    rows.push(['`' + n.id + '`', n.name, (b && b.ex || []).map((id) => ctx.ELITE_AFFIXES[id].emoji + ctx.ELITE_AFFIXES[id].name).join('、') || '—']);
  }));
  const towers = ctx.BOSS_LIST.map((b) => ['`' + b.id + '`', b.name, (b.skills.ex || []).map((id) => ctx.ELITE_AFFIXES[id].emoji + ctx.ELITE_AFFIXES[id].name).join('、'), (b.skills.rnd[0] === b.skills.rnd[1] ? b.skills.rnd[0] : b.skills.rnd[0] + '~' + b.skills.rnd[1]) + ' 個']);
  return { fieldBoss: rows, tower: towers };
}

function generate() {
  const L = [];
  const random = ctx.eliteSkillIds('random');
  const excl = ctx.eliteSkillIds('exclusive');
  L.push('共 ' + ctx.ELITE_AFFIX_ORDER.length + ' 個敵人技能：隨機技能池 ' + random.length + ' 個、專屬技能 ' + excl.length + ' 個。數字以 Skills2 表（類別＝enemy 的列）為準，距離在表上是米。');
  L.push('');
  L.push('### 隨機技能池（' + random.length + '）');
  L.push('');
  L.push(table(random.map(row), HEADER));
  L.push('');
  L.push('### 專屬技能（' + excl.length + '）');
  L.push('');
  L.push(table(excl.map(row), HEADER));
  const s = npcSummary();
  L.push('');
  L.push('### 敵人專用狀態（Status 表；狀態型特效的畫面都在這裡）');
  L.push('');
  L.push(table(statusTable(), ['狀態', 'id', '哪些技能掛', '施加特效（上身一次）', '持續特效（期間）', '作用特效（每次回復）']));
  L.push('');
  L.push('### 封魔塔 BOSS 的專屬技能（NPC 表 tower_boss 列）');
  L.push('');
  L.push(table(s.tower, ['id', 'BOSS', '專屬技能', '隨機技能數量']));
  L.push('');
  L.push('### 野外 BOSS 的專屬技能（NPC 表 boss 列，每種 NPC 一個）');
  L.push('');
  L.push(table(s.fieldBoss, ['NPC id', 'NPC', '專屬技能']));
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
    console.log('已更新 docs/ELITE_AFFIXES.md（' + ctx.ELITE_AFFIX_ORDER.length + ' 個技能）');
  }
}
module.exports = { generate, build };
