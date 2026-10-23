'use strict';
/* 字串表的掃描範圍：哪些檔案、函式、呼叫情境的字串不屬於玩家可見文字（build_string_csv.cjs 與 migrate.cjs 共用）。 */
const EXCLUDE_FILE = /^js\/(strings|strings_data|gm_exec|gm|lagprobe|recorder|vfx-core|vfx-runtime|vfx-pixi-backend|vfx-tower|battle-perf|ai-key-setting|worker\/shim)\.js$/;
const EXCLUDE_FN = /Diag|diag|Perf|perf|Lag|lag|^skills2CleaveRangeScale$|^gm[A-Z]|GM|^validate/;
const dropCallee = /^(console\.\w+|Error|errors\.push|String|\w*\.?(includes|indexOf|startsWith|endsWith|test|match|replace|split))$/;
/* config_tables.cjs --apply 會由 CSV 重建整段字面值；這些頂層變數裡的字串不能直接改。 */
const GENERATED_TOP = /^(GEM_TYPES|TALENT_TREES|AFFIX_POOL|PASSIVE_POOL|GODFORGE_POOL|TASKS|SKILLS2|ENEMY_SKILLS2|STATUS|RUNES|RUNEWORDS|RUNE_SETTINGS|GEM_RESONANCE_\w+|\w+_POOL)$/;

/* 回傳不收的原因（'file'|'fn'|'callee'|'cmp'|'regex'），要收則回傳空字串 */
function scopeReason(r) {
  if (EXCLUDE_FILE.test(r.file)) return 'file';
  if (EXCLUDE_FN.test(r.fn)) return 'fn';
  if (dropCallee.test(r.callee) || /(^|\.)(includes|indexOf|startsWith|endsWith|test|match)$/.test(r.callee)) return 'callee';
  if (['===', '==', '!==', '!='].includes(r.prev)) return 'cmp';
  if (/^\^|\(\?:/.test(r.text)) return 'regex';
  return '';
}
module.exports = { EXCLUDE_FILE, EXCLUDE_FN, dropCallee, GENERATED_TOP, scopeReason };
