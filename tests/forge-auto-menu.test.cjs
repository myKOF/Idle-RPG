'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const ui=fs.readFileSync(require.resolve('../js/ui.js'),'utf8'),html=fs.readFileSync(require.resolve('../index.html'),'utf8');
test('新介面四功能切換取代自動配方選單，所有操作走Worker',()=>{
 for(const key of ['equip','ancient','gem','imprint'])assert.ok(html.includes('id="forge-mode-'+key+'"'));
 assert.doesNotMatch(html,/id="forge-auto-menu"/);
 for(const cmd of ['setOperation','setStones','start','unloadAll'])assert.ok(ui.includes("'forge."+cmd+"'"));
 for(const cmd of ['setAuto','setAutoFill','toggleDust','autoFillDust','cancel'])assert.ok(!ui.includes("'forge."+cmd+"'"));
});
test('法陣與寶石素材採增量格子更新，外圈六格與中央格共七格',()=>{
 const start=ui.indexOf('function renderForge()'),end=ui.indexOf('/* ---- 高塔分頁 ----',start),body=ui.slice(start,end);
 assert.match(body,/syncItemGridCells\(hex, keys, htmls\)/);
 assert.match(body,/syncItemGridCells\(\$id\('forge-gem-grid'\), gemKeys, gemHtml\)/);
 assert.match(body,/keys.push\('stones'\)/);assert.match(body,/i < FORGE_SLOTS/);
 assert.doesNotMatch(body,/hex.innerHTML|grid.innerHTML/);
});
