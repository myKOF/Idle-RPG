/* 原創環境繪圖。只在建圖時繪製，所有物件共用圖集。
 * 腳點為 (0, 0)；直立本體與地面接觸區分開，讓地板透視與人物遮擋各自成立。
 * 不讀外部素材，地表／地下配色由 BattleDecor 的地圖組合傳入。 */
var DecorNature = (function () {
  'use strict';
  var SPRITE_FILES={willow:'willow',deadTree:'burnt-tree',pine:'snow-pine',giantBones:'beast-bones',cactus:'cactus',ice:'ice-cluster',void:'void-crystal',log:'fallen-log',stump:'swamp-stump',runeStone:'rune-stele',pillar:'stone-column',arch:'ruined-arch',ruinWall:'ruined-wall',rubble:'fallen-masonry',urn:'weathered-urn',grave:'old-gravestone'};
  var sprites={},loading=null;
  var scriptRoot=typeof document!=='undefined'&&document.currentScript?new URL('../',document.currentScript.src).href:null;
  function registerImages(images){Object.keys(images).forEach(function(key){sprites[key]=images[key];});}
  function loadImages(base,loader){
    if(Object.keys(SPRITE_FILES).every(function(key){return !!sprites[key];}))return Promise.resolve();
    if(loading)return loading;
    base=base||scriptRoot||(typeof location!=='undefined'?new URL('./',location.href).href:'');
    loader=loader||function(url){
      if(typeof createImageBitmap==='function')return fetch(url).then(function(response){if(!response.ok)throw new Error('Scene sprite HTTP '+response.status+': '+url);return response.blob();}).then(function(blob){return createImageBitmap(blob);});
      return new Promise(function(resolve,reject){var image=new Image();image.onload=function(){resolve(image);};image.onerror=function(){reject(new Error('Scene sprite load: '+url));};image.src=url;});
    };
    loading=Promise.all(Object.keys(SPRITE_FILES).map(function(key){
      if(sprites[key])return;
      return loader(new URL('images/scene/'+SPRITE_FILES[key]+'.png?v=20261007-simple-art',base).href).then(function(image){sprites[key]=image;});
    })).then(function(){loading=null;},function(error){loading=null;throw error;});
    return loading;
  }
  function wholeSprite(g,key,w,h){
    var image=sprites[key];if(!image)throw new Error('完整場景素材尚未載入：'+key);
    var k=Math.min(w/image.width,h/image.height),dw=image.width*k,dh=image.height*k;
    g.drawImage(image,-dw/2,-dh,dw,dh);
  }
  function rng(seed) {
    return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  function poly(g, p) { g.beginPath(); g.moveTo(p[0][0], p[0][1]); p.slice(1).forEach(function (v) { g.lineTo(v[0], v[1]); }); g.closePath(); }
  function mix(a,b,t) {
    var x=parseInt(a.slice(1),16),y=parseInt(b.slice(1),16);
    return '#' + [16,8,0].map(function(s){return ('0'+Math.round(((x>>s)&255)*(1-t)+((y>>s)&255)*t).toString(16)).slice(-2);}).join('');
  }
  var DEFAULT_STYLE = { stone:'#718171', light:'#b3b69b', dark:'#2e443b', soil:'#55563a', moss:true, snow:false };
  function ellipse(g, x, y, rx, ry, color) { g.fillStyle = color; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fill(); }
  function wash(g, x, y, rx, ry, color) {
    g.save(); g.translate(x, y); g.scale(rx, ry);
    var a = g.createRadialGradient(0, 0, 0, 0, 0, 1);
    a.addColorStop(0, color); a.addColorStop(1, 'transparent');
    g.fillStyle = a; g.beginPath(); g.arc(0, 0, 1, 0, Math.PI * 2); g.fill(); g.restore();
  }
  function contour(r, x, y, rx, ry, n) {
    var p = []; for (var i = 0; i < n; i++) { var a = i / n * Math.PI * 2, k = .75 + r() * .45; p.push([x + Math.cos(a) * rx * k, y + Math.sin(a) * ry * k]); } return p;
  }
  function smooth(g,p) {
    var last=p[p.length-1];g.beginPath();g.moveTo((last[0]+p[0][0])/2,(last[1]+p[0][1])/2);
    p.forEach(function(v,i){var next=p[(i+1)%p.length];g.quadraticCurveTo(v[0],v[1],(v[0]+next[0])/2,(v[1]+next[1])/2);});g.closePath();
  }
  function stroke(g, p, color, w) { g.strokeStyle = color; g.lineWidth = w; g.lineCap = 'round'; g.beginPath(); g.moveTo(p[0][0], p[0][1]); p.slice(1).forEach(function (v) { g.lineTo(v[0], v[1]); }); g.stroke(); }
  function grass(g, r, x, y, size, count) {
    var greens = ['#304b33', '#486442', '#607647', '#7b8851', '#3f644b'];
    for (var i = 0; i < count; i++) {
      var px = x + (r() - .5) * size, py = y + (r() - .5) * size * .24;
      var h = size * (.17 + r() * .42), dx = (r() - .5) * size * .7;
      g.fillStyle = greens[Math.floor(r() * greens.length)];
      g.beginPath(); g.moveTo(px - .8, py); g.quadraticCurveTo(px + dx * .18, py - h * .75, px + dx, py - h);
      g.quadraticCurveTo(px + dx * .45, py - h * .35, px + 1.2, py); g.fill();
    }
  }
  function moss(g, r, x, y, rx, ry, n, light, colors) {
    for (var i = 0; i < n; i++) {
      var a = r() * Math.PI * 2, d = Math.sqrt(r()), s = 1 + r() * 2.5;
      ellipse(g, x + Math.cos(a) * rx * d, y + Math.sin(a) * ry * d, s, s * .55,
        (colors || ['#283d30', '#415a37', '#526943', '#697c4d', light || '#859563'])[Math.floor(r() * 5)]);
    }
  }
  function groundContact(g, r, width, green, style) {
    style=style||DEFAULT_STYLE;
    wash(g, 3, 3, width * .7, width * .24, 'rgba(8,17,14,.62)');
    wash(g, -5, 4, width * .66, width * .19, 'rgba(76,66,43,.28)');
    for (var i = 0; i < 60; i++) {
      var a = r() * Math.PI * 2, d = .4 + r() * .6;
      var x = Math.cos(a) * width * .58 * d, y = Math.sin(a) * width * .16 * d;
      ellipse(g, x, y, .6 + r() * 2.4, .3 + r() * .85, [mix(style.soil,'#000000',.35),mix(style.soil,style.stone,.25),style.soil][Math.floor(r() * 3)]);
    }
    if (green) { moss(g, r, -width * .26, 2, width * .26, width * .1, 50); moss(g, r, width * .25, 3, width * .26, width * .11, 45); }
    if(style.snow){moss(g,r,-width*.22,2,width*.31,width*.1,45,null,['#8599ad','#a7bdce','#c8d9e5','#e5eef3','#f3f8fb']);}
  }
  function pebble(g, r, x, y, s, style) {
    style=style||DEFAULT_STYLE;
    var p = [[x-s, y], [x-s*.8, y-s*.65], [x-s*.2, y-s*.95], [x+s*.7, y-s*.5], [x+s, y+.4], [x+.1, y+s*.3]];
    poly(g, p); g.fillStyle = mix(style.stone,style.dark,.4); g.fill();
    poly(g, [p[0],p[1],p[2],[x+.2,y-s*.35]]); g.fillStyle=style.light;g.fill();
    stroke(g, [p[1],p[2],p[3]], 'rgba(166,174,133,.4)', .6);
  }
  function boulder(g, r, cx, cy, w, h, style) {
    style=style||DEFAULT_STYLE;
    var p = [[cx-w*.5,cy-2],[cx-w*.53,cy-h*.3],[cx-w*.4,cy-h*.68],
      [cx-w*.22,cy-h*.87],[cx+w*.08,cy-h*(.91+r()*.09)],[cx+w*.36,cy-h*.76],
      [cx+w*.48,cy-h*.39],[cx+w*.44,cy-3],[cx+w*.25,cy+1], [cx+w*.06,cy-1], [cx-w*.2,cy+2]];
    var q=[cx-w*.02,cy-h*.49], t=[cx-w*.08,cy-h*.77];
    var faces=[[p[2],p[3],p[4],t],[t,p[4],p[5],q],[p[1],p[2],t,q],
      [q,p[5],p[6],p[7]],[p[0],p[1],q,p[10]],[p[10],q,p[7],p[8],p[9]]];
    var colors=[[style.light,mix(style.light,style.stone,.7)],[mix(style.light,style.stone,.32),mix(style.stone,style.dark,.27)],
      [mix(style.light,style.stone,.55),mix(style.stone,style.dark,.4)],[style.stone,mix(style.stone,style.dark,.6)],
      [mix(style.light,style.stone,.7),mix(style.stone,style.dark,.65)],[mix(style.stone,style.dark,.3),style.dark]];
    faces.forEach(function(f,i) {
      var grad=g.createLinearGradient(cx-w*.3,cy-h, cx+w*.3,cy+2); grad.addColorStop(0,colors[i][0]);grad.addColorStop(1,colors[i][1]);
      poly(g,f);g.fillStyle=grad;g.fill();
    });
    g.save();poly(g,p);g.clip();
    for(var i=0;i<w*h*.2;i++) {
      var x=cx+(r()-.5)*w*1.1,y=cy-r()*h, s=.2+r()*1.2;
      ellipse(g,x,y,s,s*.5,r()<.48?'rgba(200,210,175,.14)':'rgba(16,31,27,.18)');
    }
    for(var k=0;k<6;k++) {
      var x=cx+(r()-.5)*w*.75, y=cy-h*(.25+r()*.6);
      stroke(g,[[x,y],[x+w*.04,y+h*.11],[x-w*.04,y+h*.18]],'rgba(23,44,37,.48)',.7);
      stroke(g,[[x+.8,y],[x+w*.04+.8,y+h*.11]],'rgba(180,194,157,.25)',.6);
    }
    if(style.moss){
      moss(g,r,cx-w*.1,cy-h*.83,w*.27,h*.06,Math.round(w*.7),'#9aaa6b');
      moss(g,r,cx-w*.28,cy-h*.2,w*.18,h*.16,Math.round(w*.65));
      moss(g,r,cx+w*.15,cy-h*.05,w*.3,h*.07,Math.round(w*.8));
    }
    if(style.snow){
      poly(g,[[cx-w*.4,cy-h*.68],[cx-w*.22,cy-h*.87],[cx+w*.08,cy-h*.98],[cx+w*.36,cy-h*.76],
        [cx+w*.22,cy-h*.64],[cx+w*.04,cy-h*.7],[cx-w*.06,cy-h*.62],[cx-w*.24,cy-h*.7]]);
      g.fillStyle='#cfdeeb';g.fill();
      for(var snow=0;snow<24;snow++){ellipse(g,cx+(r()-.5)*w*.55,cy-h*(.72+r()*.14),.6+r()*2,.4+r(),r()<.5?'#e8f2f8':'#aec4d8');}
    }
    g.restore();
    stroke(g,[p[2],p[3],p[4]],'rgba(221,225,188,.4)',.85);
    stroke(g,[p[0],p[10],p[9],p[8],p[7]],'rgba(12,27,23,.65)',1.4);
  }
  function rock(g, r, w, h, style) {
    boulder(g,r,-w*.03,-3,w*.77,h*.83,style);
    boulder(g,r,w*.29,1,w*.32,h*.34,style);
    boulder(g,r,-w*.31,3,w*.28,h*.28,style);
    for(var i=0;i<9;i++){var x=(r()-.5)*w*.9, y=2+r()*5;pebble(g,r,x,y,1+r()*Math.min(3.5,w*.03),style);}
    if(style.moss){moss(g,r,-w*.08,4,w*.43,4,50);grass(g,r,-w*.36,4,w*.23,12);grass(g,r,w*.36,5,w*.23,11);}
  }
  function fern(g,r,w,h) {
    for(var f=0;f<9;f++) {
      var ang=-Math.PI*.92+f*Math.PI*.105, len=h*(.65+r()*.35);
      var ex=Math.cos(ang)*len,ey=Math.sin(ang)*len*.7;
      stroke(g,[[0,2],[ex*.36,ey*.8],[ex,ey]],'#4e7550',.85);
      for(var j=1;j<12;j++) {
        var t=j/12, x=ex*t, y=ey*(1.45*t-.45*t*t),l=len*.17*Math.sin(t*Math.PI)*(.7+r()*.3);
        for(var side=-1;side<=1;side+=2){
          var nx=-ey/len*side,ny=ex/len*side;
          g.fillStyle=side===-1?'#7f965b':'#456e49';
          poly(g,[[x,y],[x+nx*l*.52-ex*.04,y+ny*l*.52-ey*.04],[x+nx*l+ex*.06,y+ny*l+ey*.06],[x+ex*.05,y+ey*.05]]);g.fill();
        }
      }
    }
  }
  function reeds(g,r,w,h) {
    for(var i=0;i<16;i++) {
      var x=(r()-.5)*w*.65,y=(r()-.5)*8, dx=(r()-.5)*w*.4, hh=h*(.4+r()*.6);
      stroke(g,[[x,y],[x+dx*.35,y-hh*.55],[x+dx,y-hh]],['#617451','#425d43','#87915c'][i%3],1.15);
      if(i%3===0){stroke(g,[[x+dx,y-hh+8],[x+dx+1,y-hh-2]],'#443a27',4);stroke(g,[[x+dx-1,y-hh+6],[x+dx,y-hh-1]],'#887449',1);}
    }
    grass(g,r,0,2,w,28);
  }
  function mushrooms(g,r,w,h,style) {
    style=style||DEFAULT_STYLE;
    var n=5;
    for(var i=0;i<n;i++) {
      var x=(i/n-.4)*w*.85,y=r()*6,s=h*(.23+r()*.26);
      stroke(g,[[x,y],[x+1,y-s*.85]],'#3a392e',s*.23);
      stroke(g,[[x-1,y],[x,y-s*.85]],'#b4b097',s*.1);
      var grad=g.createLinearGradient(x,y-s*1.25,x,y-s*.55);grad.addColorStop(0,style.cap?mix(style.cap,'#ffffff',.25):'#b29b73');grad.addColorStop(.5,style.cap||'#7b7860');grad.addColorStop(1,'#384d40');
      g.fillStyle=grad;g.beginPath();g.ellipse(x,y-s*.85,s*.61,s*.28,-.1,Math.PI,Math.PI*2);g.quadraticCurveTo(x+s*.1,y-s*.54,x-s*.61,y-s*.85);g.fill();
      stroke(g,[[x-s*.52,y-s*.84],[x,y-s*.72],[x+s*.53,y-s*.87]],'#aea78b',.7);
      for(var j=0;j<5;j++)ellipse(g,x+(r()-.5)*s*.7,y-s*(.9+r()*.1),.5+r(),.5,'#c2b893');
    }
    moss(g,r,0,3,w*.4,4,35);
  }
  function wood(g,r,w,h,fallen,style) {
    style=style||DEFAULT_STYLE;
    var top=fallen?-h*.4:-h*.78;
    var left=fallen?-w*.46:-w*.25,right=fallen?w*.36:w*.27;
    if(!fallen) {
      [[-.5,.17],[-.3,.27],[.3,.24],[.47,.08]].forEach(function(p){
        stroke(g,[[0,-h*.14],[w*p[0]*.65,0],[w*p[0],h*p[1]*.35]],'#3a3929',h*.17);
        stroke(g,[[0,-h*.14],[w*p[0]*.65,-1],[w*p[0],h*p[1]*.35-1]],'#6e6845',h*.07);
      });
    }
    var grad=g.createLinearGradient(left,top,right,4);grad.addColorStop(0,'#9a8961');grad.addColorStop(.27,'#6f6448');grad.addColorStop(.7,'#484836');grad.addColorStop(1,'#282f26');
    poly(g,[[left,top],[right,top+6],[right+w*.08,1],[w*.13,5],[-w*.18,2],[left-w*.04,-3]]);g.fillStyle=grad;g.fill();
    for(var k=0;k<22;k++) {
      var t=r(),x=left+(right-left)*t;
      stroke(g,[[x,top+5],[x+(r()-.5)*6,top*.35],[x+(r()-.5)*8,2]],r()<.5?'rgba(23,31,23,.7)':'rgba(155,138,92,.45)',.5+r()*1.5);
    }
    var rx=fallen?h*.36:w*.27,ry=fallen?h*.26:h*.12,cx=fallen?right:0,cy=fallen?top*.5:top+2;
    ellipse(g,cx,cy,rx,ry,'#3a392b');ellipse(g,cx-1,cy-1,rx*.88,ry*.84,'#a49b72');
    for(var ring=1;ring<5;ring++){g.strokeStyle='#6b674a';g.lineWidth=.7;g.beginPath();g.ellipse(cx-2,cy-1,rx*ring/5,ry*ring/5,0,0,Math.PI*2);g.stroke();}
    stroke(g,[[cx-rx*.7,cy-ry*.55],[cx-rx*.12,cy+ry*.1],[cx+rx*.6,cy+ry*.3]],'#4b4b36',.8);
    if(style.moss){
      moss(g,r,fallen?-w*.13:-w*.17,top*.48,w*.28,h*.13,80);
      moss(g,r,0,3,w*.41,5,60);grass(g,r,-w*.43,3,w*.3,12);
      mushrooms(g,rng(Math.floor(r()*100000)),w*.26,h*.45);
    }
    if(style.snow){ellipse(g,cx,cy-2,rx*.95,ry*.75,'#cedbd6');wash(g,0,3,w*.38,5,'rgba(197,217,218,.65)');}
  }
  function puddle(g,r,w,h) {
    var p=contour(r,0,0,w*.5,h*.5,28);
    wash(g,0,0,w*.62,h*.7,'rgba(9,26,21,.45)');
    // Broad muddy shore dissolves into scattered moss before the water edge.
    p.forEach(function(v){wash(g,v[0],v[1],12+r()*9,4+r()*3,'rgba(88,79,49,.23)');});
    g.save();smooth(g,p);g.clip();
    var a=g.createLinearGradient(0,-h*.5,0,h*.5);a.addColorStop(0,'#162d29');a.addColorStop(.6,'#284b41');a.addColorStop(1,'#4a6450');g.fillStyle=a;g.fillRect(-w,-h,w*2,h*2);
    for(var j=0;j<16;j++){var x=(r()-.5)*w,y=(r()-.5)*h;stroke(g,[[x,y],[x+7+r()*22,y]],'rgba(145,166,132,.13)',.7);}
    g.restore();
    smooth(g,p);g.strokeStyle='rgba(7,25,18,.62)';g.lineWidth=1.4;g.stroke();
    for(var i=0;i<40;i++){var t=Math.floor(r()*p.length),v=p[t];ellipse(g,v[0],v[1],1+r()*3.2,.6+r(),'#3e5037');}
    for(var k=0;k<5;k++) {
      var x=(r()-.5)*w*.65,y=(r()-.5)*h*.5;
      ellipse(g,x,y,6+r()*4,2.7,'#526f48');stroke(g,[[x,y],[x+5,y-1]],'#879767',.65);
    }
  }
  function roots(g,r,w,h,style) {
    style=style||DEFAULT_STYLE;
    for(var i=0;i<6;i++){var x=(r()-.5)*w,y=(r()-.5)*h;stroke(g,[[-w*.4,0],[x*.5,y*.4],[x,y]],'#252f23',5);stroke(g,[[-w*.4,-1],[x*.5,y*.4-1],[x,y-1]],'#626848',1.8);}
    if(style.moss){moss(g,r,-w*.25,-1,w*.25,h*.3,70);grass(g,r,-w*.32,2,w*.34,18);}
  }
  /* 地貌造型：曲線樹皮、植被群落、風化雕刻與裂晶。全部原創路徑。 */
  function shrub(g,r,w,h,style,dry) {
    var chaos=style.theme==='god_chaos';
    var colors=dry?(chaos?['#514341','#71605b','#917565']:['#746650','#948366','#b39a70']):chaos?['#403547','#665063','#8a635a']:style.snow?['#52746b','#77948a','#b8cec5']:style.theme==='god_sanctuary'?['#456652','#688565','#9caf86']:['#3d5e40','#5f754a','#8b965f'];
    if(dry){for(var blade=0;blade<64;blade++){var bx=(r()-.5)*w*.6,by=-h*(.22+r()*.62),lean=(r()-.4)*w*.24;stroke(g,[[bx*.6,1],[bx+lean*.4,by*.5],[bx+lean,by]],colors[blade%3],.5+r()*.65);}return;}
    for(var i=0;i<18;i++){
      var x=(r()-.5)*w*.9,y=-h*(.2+r()*.65);
      stroke(g,[[0,1],[x*.55,y*.55],[x,y]],chaos?'#493b43':dry?'#6f6048':'#3a4935',1+r());
      for(var k=0;k<4;k++){
        var t=.4+k*.15;g.save();g.translate(x*t,y*t);g.rotate((i%2?1:-1)*.6);
        ellipse(g,0,0,1.5+r()*3,dry?2.5+r()*2:3.5+r()*3,colors[(i+k)%3]);g.restore();
      }
      if(style.theme==='god_sanctuary'||style.theme==='Icefield'||chaos&&i%3===0){
        ellipse(g,x,y,2.2,1.7,chaos?'#9e4350':style.snow?'#c9e4ee':'#d9d0e1');ellipse(g,x-1,y-.6,.9,.7,chaos?'#c0886a':'#f2ecd0');
      }
    }
  }
  function block(g,r,x,y,w,h,style) {
    var edge=w*.16;
    var p=[[x-w*.5,y],[x-w*.5,y-h*.85],[x-w*.4,y-h],[x+w*.43,y-h*.94],[x+w*.5,y-h*.75],[x+w*.5,y-edge*.1],[x+w*.28,y+1]];
    var gr=g.createLinearGradient(x-w*.5,y-h,x+w*.5,y);gr.addColorStop(0,style.light);gr.addColorStop(.48,style.stone);gr.addColorStop(1,style.dark);
    poly(g,p);g.fillStyle=gr;g.fill();poly(g,[p[3],p[4],p[5],[x+w*.24,y],[x+w*.24,y-h*.9]]);g.fillStyle=mix(style.stone,style.dark,.5);g.fill();
    stroke(g,[p[1],p[2],p[3]],mix(style.light,'#ffffff',.1),.9);
    g.save();poly(g,p);g.clip();
    for(var k=0;k<w*h*.08;k++)ellipse(g,x+(r()-.5)*w,y-r()*h,.3+r(),.3+r()*.6,r()<.5?'rgba(255,255,235,.11)':'rgba(0,0,0,.15)');
    for(var j=0;j<4;j++){var cx=x+(r()-.5)*w*.75,cy=y-r()*h*.85;stroke(g,[[cx,cy],[cx-2,cy+4],[cx+3,cy+7]],mix(style.dark,'#000000',.15),.7);}
    g.restore();
  }
  function relic(g,r,w,h,style,type) {
    if(type==='banner'){
      stroke(g,[[0,1],[w*.02,-h*.93]],'#2a2d2a',3);stroke(g,[[-1,0],[w*.02-1,-h*.93]],'#8a8b77',.9);
      var p=[[0,-h*.9],[w*.44,-h*.87],[w*.41,-h*.65],[w*.28,-h*.57],[w*.33,-h*.72],[w*.15,-h*.61],[w*.12,-h*.72],[0,-h*.66]];
      var gr=g.createLinearGradient(0,-h,w*.4,0);gr.addColorStop(0,'#936655');gr.addColorStop(.6,'#5f4540');gr.addColorStop(1,'#302e2d');poly(g,p);g.fillStyle=gr;g.fill();
      stroke(g,[[w*.14,-h*.84],[w*.26,-h*.72],[w*.14,-h*.7],[w*.2,-h*.81]],'#b69b6c',.9);
    }else{
      g.save();g.rotate(-.17);block(g,r,0,0,w*.6,h*.2,style);poly(g,[[-w*.06,-h*.08],[-w*.055,-h*.74],[0,-h*.92],[w*.055,-h*.75],[w*.045,-h*.06]]);g.fillStyle='#7c8b89';g.fill();
      stroke(g,[[0,-h*.14],[0,-h*.86]],'#bdc8bf',1.2);stroke(g,[[-w*.24,-h*.24],[w*.24,-h*.24]],'#8e7850',h*.045);g.restore();
    }
  }
  function spire(g,r,w,h,style) {
    for(var i=0;i<3;i++)boulder(g,r,(i-1)*w*.17,0,w*(.36+r()*.12),h*(i===1?.95:.65),style);
    for(var j=0;j<6;j++)stroke(g,[[-w*.27,-h*(.15+j*.1)],[w*.16,-h*(.14+j*.1)]],mix(style.stone,style.light,.28),.7);
  }

  function drawArenaFloor(g,pal,seed,size) {
    var r=rng(seed),S=size;
    g.fillStyle=pal.floor;g.fillRect(0,0,S,S);
    function wrap(fn){for(var dx=-S;dx<=S;dx+=S)for(var dy=-S;dy<=S;dy+=S){g.save();g.translate(dx,dy);fn();g.restore();}}
    // 不規則火山岩雲紋與灰屑，可四向接續，不生成行列石板。
    for(var i=0;i<38;i++){
      var x=r()*S,y=r()*S,rx=20+r()*56,ry=12+r()*37,col=i%3?'rgba(0,0,0,.13)':'rgba(139,127,116,.04)';
      wrap(function(){wash(g,x,y,rx,ry,col);});
    }
    for(var j=0;j<430;j++){
      var px=r()*S,py=r()*S,sz=.2+r()*1.1,c=j%3?'rgba(0,0,0,.23)':'rgba(183,160,140,.08)';
      wrap(function(){ellipse(g,px,py,sz,sz*.6,c);});
    }
    for(var k=0;k<4;k++){
      var pts=[[r()*S,r()*S]];
      for(var t=0;t<6;t++)pts.push([pts[t][0]+(r()-.3)*22,pts[t][1]+(r()-.5)*26]);
      wrap(function(){stroke(g,pts,'rgba(0,0,0,.4)',1.5);});
    }
  }
  function drawBody(g,type,x,y,w,h,seed,style) {
    style=style||DEFAULT_STYLE;
    var r=rng(seed);g.save();g.translate(x,y);
    if(type==='skullPile')wholeSprite(g,'giantBones',w,h);
    else if(SPRITE_FILES[type]&&(type!=='stump'||!style.snow))wholeSprite(g,type,w,h);
    else if(type==='crystals'||type==='spire'&&(style.theme==='Icefield'||style.theme==='god_chaos'))wholeSprite(g,style.theme==='Icefield'?'ice':'void',w,h);
    else if(type==='rock')rock(g,r,w,h,style);
    else if(type==='fern')fern(g,r,w,h);
    else if(type==='reeds')reeds(g,r,w,h);
    else if(type==='stump')wood(g,r,w,h,false,style);
    else if(type==='mushrooms')mushrooms(g,r,w,h,style);
    else if(type==='puddle')puddle(g,r,w,h);
    else if(type==='roots')roots(g,r,w,h,style);
    else if(type==='grass')grass(g,r,0,0,w,35);
    else if(type==='shrub'||type==='dryGrass')shrub(g,r,w,h,style,type==='dryGrass');
    else if(type==='spire')spire(g,r,w,h,style);
    else if(type==='banner'||type==='sword')relic(g,r,w,h,style,type);
    else throw new Error('Unknown nature prop: '+type);
    g.restore();
  }
  function drawContact(g,x,y,width,seed,style) {
    g.save();g.translate(x,y);groundContact(g,rng(seed),width,!!style.moss,style);g.restore();
  }
  function drawSurface(g,type,w,h,seed,style) {
    var r=rng(seed);g.save();g.translate(w/2,h/2);
    if(type==='puddle')puddle(g,r,w*.8,h*.65);
    else if(type==='roots'){groundContact(g,r,w*.62,!!style.moss,style);roots(g,r,w*.7,h*.4,style);}
    else if(type==='litter'){
      wash(g,0,0,w*.46,h*.4,'rgba(30,28,20,.12)');
      for(var i=0;i<95;i++){
        var a=r()*Math.PI*2,d=Math.sqrt(r()),x=Math.cos(a)*w*.43*d,y=Math.sin(a)*h*.4*d;
        if(style.moss&&i%4===0){g.save();g.translate(x,y);g.rotate(r()*Math.PI*2);ellipse(g,0,0,1+r()*3,.7+r(),i%3?'#656c43':'#7e7b49');g.restore();}
        else pebble(g,r,x,y,.4+r()*1.4,style);
      }
    } else throw new Error('Unknown nature ground: '+type);
    g.restore();
  }
  return { drawBody:drawBody, drawContact:drawContact, drawSurface:drawSurface, drawArenaFloor:drawArenaFloor, loadImages:loadImages, registerImages:registerImages, spriteFiles:SPRITE_FILES };
})();
