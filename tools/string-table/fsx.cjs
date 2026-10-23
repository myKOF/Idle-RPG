'use strict';
/* 寫檔重試：Windows 上編輯器／索引服務偶爾短暫鎖住檔案，writeFileSync 會丟 UNKNOWN／EBUSY／EPERM；等一下再寫通常就過了。 */
const fs = require('fs');

function sleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

function write(file, data) {
  let last;
  for (let i = 0; i < 8; i++) {
    try { fs.writeFileSync(file, data); return; } catch (e) {
      last = e;
      if (!/^(UNKNOWN|EBUSY|EPERM|EACCES)$/.test(e.code || '')) throw e;
      sleep(300 * (i + 1));
    }
  }
  throw last;
}

module.exports = { write };
