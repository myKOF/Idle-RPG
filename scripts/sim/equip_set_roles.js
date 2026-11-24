'use strict';
/* 三套裝備各自的用途：直接讀策略的切套規則（equipSetSwitch），不在別處另寫一份。

   equipSetSwitch.home       平常穿哪一套（＝練功，野外打一般怪）
   equipSetSwitch.encounter  碰到什麼才切到哪一套：{ boss: 套, elite: 套, tower: 套 }

   回傳 { 套索引(0 起): [用途鍵...] }，用途鍵依 ROLE_ORDER 排序；策略沒有切套規則（或是真人軌跡）回 null。
   儀表板的裝備快照頁籤據此標出「第 N 套（練功）」之類的字樣。 */

const ROLE_ORDER = ['field', 'boss', 'tower', 'elite'];

function equipSetRoles(policyJson) {
  const rules = policyJson && Array.isArray(policyJson.rules) ? policyJson.rules : [];
  const rule = rules.find((r) => r && r.equipSetSwitch);
  if (!rule) return null;
  const cfg = rule.equipSetSwitch;
  const roles = {};
  const add = (idx, role) => {
    const k = Math.floor(Number(idx));
    if (!Number.isFinite(k) || k < 0) return;
    (roles[k] = roles[k] || []).push(role);
  };
  add(cfg.home === undefined ? 0 : cfg.home, 'field');
  const enc = cfg.encounter || {};
  for (const role of ROLE_ORDER) if (role !== 'field' && enc[role] !== undefined) add(enc[role], role);
  for (const k of Object.keys(roles)) roles[k].sort((a, b) => ROLE_ORDER.indexOf(a) - ROLE_ORDER.indexOf(b));
  return roles;
}

module.exports = { equipSetRoles, ROLE_ORDER };
