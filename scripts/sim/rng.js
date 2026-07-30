'use strict';
/* 種子化 PRNG（mulberry32）。

   用途只有一個：讓同 seed 的兩次模擬產生完全相同的結果，否則沒有任何比對做得下去
   （決定論、before/after 回歸、headless 與瀏覽器交叉驗證，全都靠它）。

   ⚠️ 這是整個 harness 唯一被允許替換遊戲行為的地方，替換點只有 Math.random 一個，
   而且是在 vm context 的全域 Math 上覆蓋，公式檔案一行都不改。
   機率分佈與 Math.random 一致（[0,1) 均勻），所以不改變任何期望值。 */

function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  return function random() {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

module.exports = { makeRng };
