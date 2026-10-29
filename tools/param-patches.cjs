'use strict';
// Kept as an explicit migration error for callers using the retired commands.
if (require.main === module) {
  console.error('[param-patches] 已於2026-10-29停用暫存與集中合併。請先儲存並關閉相關Excel，再直接修改來源工作簿；規範見AI_RULES.md第8.5節。');
  process.exitCode = 1;
}
