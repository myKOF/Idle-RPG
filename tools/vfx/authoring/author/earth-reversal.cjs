'use strict';
// 天地逆返只改甲片符文藍色，沿用岩甲所有幾何、尺寸、速度與粒子。
const fs=require('fs'),path=require('path');
const rock=require('./rockarmor-renew.cjs');
function make(){
 const p=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../../../vfx/presets/aura-rockarmor-stone.json'),'utf8'));
 p.id='aura-earth-reversal';
 for(const l of p.layers)if(l.id.startsWith('orbiting-stone-plates-'))l.assetId=l.assetId.replace('stone-guard-','stone-guard-blue-runes-');
 return p;
}
if(require.main===module){
 for(const half of ['back','front'])rock.bake(half,{variant:'blue-runes',runeColor:'#57bdff',runeGlow:'#3297ff'});
 require('../preset-kit.cjs').write(make());
}
module.exports={make};
