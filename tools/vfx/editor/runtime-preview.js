'use strict';
/* 僅編輯器的測試場景。使用正式 Adapter，不複製飛行、裁切或淡出公式。 */
var VFXRuntimePreview = (function () {
  async function open(preset, resolver) {
    var dialog=document.createElement('dialog');
    dialog.style.cssText='background:#202b35;color:#eee;max-width:95vw;border:1px solid #748ba0;padding:16px';
    var title=document.createElement('div');title.textContent='遊戲播放測試：'+preset.id;dialog.appendChild(title);
    var hint=document.createElement('p');hint.textContent='使用目前尚未存檔的設定。這是測試事件，移速與範圍不會寫回遊戲技能。';dialog.appendChild(hint);
    var mode=document.createElement('select');mode.setAttribute('data-runtime-preview','mode');
    [['attack','目標本體'],['hit','範圍受擊'],['rain','天降'],['chain','連鎖飛行'],['projectile','投射物'],['field','持續場域'],['orbit','環繞'],['flash','雷光閃']].forEach(function(pair){
      var option=document.createElement('option');option.value=pair[0];option.textContent=pair[1];mode.appendChild(option);
    });
    mode.value=/chain-travel/.test(preset.id)?'chain':/^proj-/.test(preset.id)?'projectile':/^ground-|tornado|rockarmor/.test(preset.id)?'field':'attack';
    dialog.appendChild(mode);
    var motion=document.createElement('input');motion.type='checkbox';motion.setAttribute('data-runtime-preview','motion');
    var label=document.createElement('label');label.appendChild(motion);label.appendChild(document.createTextNode(' 移動目標 '));dialog.appendChild(label);
    var replay=document.createElement('button');replay.textContent='重播';dialog.appendChild(replay);
    var paused=false,pause=document.createElement('button');pause.textContent='暫停';dialog.appendChild(pause);
    pause.onclick=function(){paused=!paused;pause.textContent=paused?'繼續':'暫停';};
    var close=document.createElement('button');close.textContent='關閉測試';dialog.appendChild(close);
    var status=document.createElement('div');status.className='hint';dialog.appendChild(status);
    var holder=document.createElement('div');dialog.appendChild(holder);document.body.appendChild(dialog);dialog.showModal();
    var app=new PIXI.Application(),adapter=null,root=null,closed=false,time=0,lastField=0;
    function cleanup(){if(closed)return;closed=true;if(adapter)adapter.destroy();if(app.renderer)app.destroy(true,{children:true});dialog.remove();}
    close.onclick=cleanup;dialog.addEventListener('cancel',function(e){e.preventDefault();cleanup();});
    try {
      await app.init({width:800,height:500,background:0x263746,antialias:true});
      if(closed){app.destroy(true,{children:true});return;}holder.appendChild(app.canvas);app.canvas.style.maxWidth='85vw';
      var sources=[];
      var parent=preset.id==='aura-earth-reversal'?'aura-rockarmor-stone':preset.id==='burst-vacuum-shockwave'?'slash-wind-crescent':null;
      if(parent){var response=await fetch('/vfx/presets/'+parent+'.json');if(!response.ok)throw Error('無法讀取繼承來源 '+parent);sources.push(await response.json());}
      var assets=new Set();sources.concat([preset]).forEach(function(p){p.layers.forEach(function(l){if(l.assetId)assets.add(resolver.resolve(l.assetId));});});
      await Promise.all(Array.from(assets).map(function(url){return PIXI.Assets.load(url);}));
      if(closed)return;
      var markers=new PIXI.Graphics();app.stage.addChild(markers);
      function point(id){return id==='pv-float'?{x:-180,y:60}:{x:180,y:motion.checked?Math.sin(time*1.5)*70:60};}
      function spec(){
        var common={targets:['enemy'],hit:false,vfx:{},area:{x:180,y:60,r:60},travelMs:[2000],dur:3};
        if(mode.value==='hit'){common.fxKind='burst';common.hit=true;common.vfx.hit=preset.id;}
        else if(mode.value==='rain'){common.fxKind='rain';common.vfx.projectile=preset.id;}
        else if(mode.value==='chain'){common.fxKind='chain';common.variant='lightning-chain';common.targets=['pv-float','enemy'];common.travelMs=[0,2000];common.lineLength=180;common.area={chainId:'preview',homingSpeed:180};common.vfx.attack=preset.id;}
        else if(mode.value==='field'){common.fxKind='aura';common.variant=preset.id.indexOf('devour')>=0?'dragon-devour':'preview';common.area.id='preview-field';common.vfx.field=preset.id;}
        else if(mode.value==='orbit'){common.fxKind='aura';common.area={r:100,orbitR:100,orbR:20,orbs:3,spinRate:1};common.vfx.projectile=preset.id;}
        else if(mode.value==='flash'){common.fxKind='slash';common.variant='gale-thunder-flash';common.area={x:-180,y:60,w:360,h:60,a:0};common.vfx.attack=preset.id;}
        else if(mode.value==='projectile'){common.fxKind='projectile';delete common.area;common.vfx.projectile=preset.id;}
        else {common.fxKind='slash';delete common.area;common.travelMs=[0];common.vfx.attack=preset.id;}
        return common;
      }
      function restart(){
        if(adapter)adapter.destroy();if(root)root.destroy({children:true});
        root=new PIXI.Container();root.position.set(400,240);app.stage.addChild(root);
        adapter=VFXRuntime.create({core:VFXCore,resolver:resolver,fxBackend:VFXPixiBackend.createBackend({PIXI:PIXI,container:root}),
          ctx:{posOf:point,footOf:point,playerPos:function(){return point('pv-float');},chainPoint:point}});
        adapter.registerPresets(sources.concat([preset]));time=0;lastField=0;
        adapter.tryPlay(spec());status.textContent='播放中；位置標記：左側為我方，右側為目標。';
      }
      replay.onclick=restart;mode.onchange=restart;motion.onchange=restart;restart();
      app.ticker.add(function(ticker){
        if(closed||paused)return;var dt=Math.min(.1,ticker.deltaMS/1000);time+=dt;
        if(mode.value==='field'&&time<2&&time-lastField>.15){adapter.tryPlay(spec());lastField=time;}
        adapter.update(dt);
        var a=point('pv-float'),b=point('enemy');markers.clear().circle(a.x+400,a.y+240,6).stroke({color:0x63f59b,width:2}).circle(b.x+400,b.y+240,6).stroke({color:0xff7272,width:2});
        if(time>7)status.textContent='可切換播放方式或按重播。場域續命事件已停止；既有命中／結束規則由 Runtime 處理。';
      });
    } catch(e){status.textContent='測試無法啟動：'+e.message;}
  }
  return {open:open};
})();
