'use strict';
const objects=require('./rockarmor-objects.cjs');
if(require.main===module)require('../preset-kit.cjs').write(objects.make());
module.exports={make:objects.make};
