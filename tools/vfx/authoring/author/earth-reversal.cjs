'use strict';
const objects=require('./rockarmor-objects.cjs');
function make(){return objects.make(true);}
if(require.main===module)require('../preset-kit.cjs').write(make());
module.exports={make};
