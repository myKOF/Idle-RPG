'use strict';
// 伴生火狩：與火狩本體同一套造型（firehunt-renew.cjs），改用藍色配色、拖尾壓暗三成。
const kit = require('../preset-kit.cjs');

function make() {
  return require('./firehunt-renew.cjs').make('orb-firehunt-companion', 'blue');
}

if (require.main === module) kit.write(make());
module.exports = { make };
