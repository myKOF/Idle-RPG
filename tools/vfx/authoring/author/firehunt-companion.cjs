'use strict';
// 伴生火狩：與火狩母體同一套造型（firehunt-renew.cjs），核心帶暗邊光圈、拖尾壓到一半。三個配色見該檔檔頭。
const kit = require('../preset-kit.cjs');

const COMPANIONS = [['orb-firehunt-companion', 'blue'], ['orb-firehunt-solar-companion', 'red'], ['orb-firehunt-firegod-companion', 'cyan']];
function make(id) {
  const pair = COMPANIONS.find((c) => c[0] === (id || 'orb-firehunt-companion'));
  return require('./firehunt-renew.cjs').make(pair[0], pair[1]);
}

if (require.main === module) COMPANIONS.forEach((c) => kit.write(make(c[0])));
module.exports = { make };
