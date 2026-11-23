(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.Boss9Melee=api;
})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const EPS=1e-10;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const ease=u=>{u=clamp(u,0,1);return u*u*(3-2*u);};
  const finite=(n,label)=>{if(!Number.isFinite(n))throw new TypeError(label+' must be finite');return n;};
  function rootDistance(spec,t){const r=spec.rootMotion;return r.distance*ease((t-r.start)/(r.end-r.start));}
  function hitboxAt(spec,t){const h=spec.hitbox,u=ease((t-h.on)/(h.fullReachAt-h.on));return {...h,range:h.initialRange+(h.range-h.initialRange)*u};}
  function phaseAt(spec,t){return t>=spec.duration?'Idle':t>=spec.phases.activeEnd?'Recovery':t>=spec.phases.windupEnd?'Active':'Windup';}
  function validate(spec){
    for(const n of [spec.duration,spec.phases.windupEnd,spec.phases.activeEnd,spec.rootMotion.start,spec.rootMotion.end,spec.rootMotion.distance,spec.hitbox.on,spec.hitbox.off])finite(n,'timeline');
    if(!(0<spec.phases.windupEnd&&spec.phases.windupEnd<spec.phases.activeEnd&&spec.phases.activeEnd<spec.duration&&spec.hitbox.on>=spec.phases.windupEnd&&spec.hitbox.on<spec.hitbox.off&&spec.hitbox.off<=spec.phases.activeEnd&&spec.rootMotion.start>=spec.phases.windupEnd&&spec.rootMotion.end<=spec.phases.activeEnd&&spec.rootMotion.end>spec.rootMotion.start&&spec.rootMotion.distance>=0))throw new RangeError('Invalid phase, root motion or hit window');
    const h=spec.hitbox,c=spec.bossCapsule,p=spec.previewOnly;
    for(const n of [h.fullReachAt,h.initialRange,h.range,h.angleDegrees,h.minY,h.maxY,c.radius,c.height,c.offsetForward,c.skin,p.physicalDamage,p.targetHP,p.knockbackDistance,p.knockbackSeconds])finite(n,'collision parameters');
    if(!(h.fullReachAt>h.on&&h.fullReachAt<=h.off&&h.initialRange>=0&&h.range>=h.initialRange&&h.angleDegrees>0&&h.angleDegrees<=180&&h.minY<=h.maxY&&c.radius>0&&c.height>=2*c.radius&&c.skin>=0&&p.physicalDamage>=0&&p.targetHP>0&&p.knockbackDistance>=0&&p.knockbackSeconds>0))throw new RangeError('Invalid collision parameters');
    if(spec.phases.recoveryEnd!==spec.duration||!(spec.timing.rightPlant>=spec.phases.activeEnd&&spec.timing.rightPlant<spec.duration))throw new RangeError('Invalid recovery timing');
    const required={WindupStart:0,ActiveStart:spec.phases.windupEnd,RootMotionOn:spec.rootMotion.start,HitboxOn:spec.hitbox.on,HitboxOff:spec.hitbox.off,RootMotionOff:spec.rootMotion.end,RecoveryStart:spec.phases.activeEnd,RightClawPlant:spec.timing.rightPlant,RecoveryEnd:spec.duration};
    let previous=-Infinity;
    for(const e of spec.notifies){if(!Number.isFinite(e.time)||e.time<previous||e.time<0||e.time>spec.duration)throw new RangeError('Unsorted animation notifies');previous=e.time;}
    for(const [name,time] of Object.entries(required)){const matches=spec.notifies.filter(e=>e.name===name);if(matches.length!==1||Math.abs(matches[0].time-time)>EPS)throw new RangeError('Notify mismatch '+name);}
  }
  function shaft(c){return [c.y+c.radius,c.y+c.height-c.radius];}
  function verticalGap(a,b){const aa=shaft(a),bb=shaft(b);return Math.max(0,aa[0]-bb[1],bb[0]-aa[1]);}
  function capsuleGap(a,b){return Math.hypot(a.x-b.x,a.z-b.z,verticalGap(a,b))-a.radius-b.radius;}
  // Continuous horizontal sweep of vertical capsules, including their caps.
  function sweepCapsule(a,delta,obstacles,skin=0){
    const length2=delta.x*delta.x+delta.z*delta.z;
    let fraction=1,blocker=null;
    if(length2===0)return {x:a.x,z:a.z,fraction,blocker};
    for(const b of obstacles){
      const gap=verticalGap(a,b),radius=a.radius+b.radius+skin;
      if(gap>=radius)continue;
      const r2=radius*radius-gap*gap,px=a.x-b.x,pz=a.z-b.z;
      const c=px*px+pz*pz-r2,dot=px*delta.x+pz*delta.z;
      if(c<=EPS){if(dot<0){fraction=0;blocker=b.id;}continue;}
      const discriminant=4*dot*dot-4*length2*c;
      if(discriminant<0)continue;
      const t=(-2*dot-Math.sqrt(discriminant))/(2*length2);
      if(t>=0&&t<fraction&&t<=1){fraction=Math.max(0,t-1e-8);blocker=b.id;}
    }
    return {x:a.x+delta.x*fraction,z:a.z+delta.z*fraction,fraction,blocker};
  }
  function pointSegmentDistance2(px,pz,ex,ez){const den=ex*ex+ez*ez,t=den?clamp((px*ex+pz*ez)/den,0,1):0;return (px-ex*t)**2+(pz-ez*t)**2;}
  function sectorTouchesCapsule(origin,facing,hitbox,target){
    const s=shaft(target),gap=Math.max(0,hitbox.minY-s[1],s[0]-hitbox.maxY);
    if(gap>target.radius)return false;
    const radius=Math.sqrt(Math.max(0,target.radius**2-gap**2));
    const dx=target.x-origin.x,dz=target.z-origin.z;
    const forward=dx*facing.x+dz*facing.z,right=dx*facing.z-dz*facing.x,distance=Math.hypot(right,forward),range=hitbox.range;
    if(distance<=radius)return true;
    if(distance>range+radius)return false;
    const half=hitbox.angleDegrees*Math.PI/360;
    if(forward/distance>=Math.cos(half))return true;
    return Math.min(pointSegmentDistance2(right,forward,range*Math.sin(half),range*Math.cos(half)),pointSegmentDistance2(right,forward,-range*Math.sin(half),range*Math.cos(half)))<=radius*radius+EPS;
  }
  class Attack {
    constructor(spec,options={}){
      validate(spec);this.spec=spec;this.time=0;this.cursor=0;this.hitbox=false;this.rootEnabled=false;this.hits=[];this.events=[];this.hitIDs=new Set();this.blockedDistance=0;this.contacts=0;
      this.onNotify=options.onNotify||(()=>{});this.onHit=options.onHit||(()=>{});
      this.position={x:options.position?.x??spec.axisX,z:options.position?.z??0,y:options.position?.y??spec.ground};this.start={...this.position};
      const f=options.facing||{x:0,z:1},length=Math.hypot(f.x,f.z);if(!Number.isFinite(length)||length<EPS)throw new RangeError('Invalid facing');this.facing={x:f.x/length,z:f.z/length};
      const ids=new Set();
      this.targets=(options.targets||[]).map(t=>{if(ids.has(t.id))throw new RangeError('Duplicate target id');ids.add(t.id);for(const n of [t.x,t.z,t.radius,t.height])finite(n,'capsule');if(t.radius<=0||t.height<2*t.radius)throw new RangeError('Invalid target capsule');return {...t,y:t.y??spec.ground,hp:t.hp??spec.previewOnly.targetHP,kb:null};});
      this.dispatch();
    }
    body(){const c=this.spec.bossCapsule;return {...this.position,...c,x:this.position.x+this.facing.x*c.offsetForward,z:this.position.z+this.facing.z*c.offsetForward};}
    dispatch(){
      while(this.cursor<this.spec.notifies.length&&this.spec.notifies[this.cursor].time<=this.time){
        const e={...this.spec.notifies[this.cursor++]};
        if(e.name==='HitboxOn')this.hitbox=true;
        if(e.name==='HitboxOff')this.hitbox=false;
        if(e.name==='RootMotionOn')this.rootEnabled=true;
        if(e.name==='RootMotionOff')this.rootEnabled=false;
        this.events.push(e);this.onNotify(e);
        if(e.name==='HitboxOn')this.evaluateHits(this.time);
      }
    }
    evaluateHits(t){
      const s=this.spec;
      if(!this.hitbox||t<s.hitbox.on-EPS||t>=s.hitbox.off-EPS||phaseAt(s,t)!=='Active')return;
      for(const target of this.targets){
        if(this.hitIDs.has(target.id)||!sectorTouchesCapsule(this.position,this.facing,hitboxAt(s,t),target))continue;
        this.hitIDs.add(target.id);
        const dx=target.x-this.position.x,dz=target.z-this.position.z,len=Math.hypot(dx,dz),direction=len>EPS?{x:dx/len,z:dz/len}:this.facing;
        const p=s.previewOnly;target.hp=Math.max(0,target.hp-p.physicalDamage);
        target.kb={start:t,duration:p.knockbackSeconds,dx:direction.x*p.knockbackDistance,dz:direction.z*p.knockbackDistance,ratio:0};
        const hit={targetId:target.id,time:t,damageType:'physical',damage:p.physicalDamage,knockback:{x:direction.x,z:direction.z,distance:p.knockbackDistance}};
        this.hits.push(hit);this.onHit(hit);
      }
    }
    advanceTo(requested){
      finite(requested,'time');if(requested<this.time)throw new RangeError('Use a new attack when seeking backwards');
      const until=Math.min(requested,this.spec.duration);this.dispatch();
      while(this.time<until-EPS){
        const event=this.spec.notifies[this.cursor];
        const end=Math.min(until,this.time+1/240,event?event.time:Infinity),mid=(this.time+end)/2;
        if(this.rootEnabled){
          const amount=rootDistance(this.spec,end)-rootDistance(this.spec,this.time);
          const body=this.body(),move=sweepCapsule(body,{x:this.facing.x*amount,z:this.facing.z*amount},this.targets,this.spec.bossCapsule.skin);
          this.position.x+=move.x-body.x;this.position.z+=move.z-body.z;this.blockedDistance+=amount*(1-move.fraction);if(move.blocker!==null)this.contacts++;
        }
        for(const target of this.targets){if(!target.kb)continue;const k=target.kb,ratio=ease((end-k.start)/k.duration),change=ratio-k.ratio;target.x+=k.dx*change;target.z+=k.dz*change;k.ratio=ratio;}
        this.evaluateHits(mid);this.time=end;this.dispatch();
      }
      // Substeps may end a few ulps short of a notify. Preserve the caller's
      // exact boundary so the reported phase and dispatched events agree.
      this.time=until;this.dispatch();return this.snapshot();
    }
    moveTarget(id,position){const target=this.targets.find(t=>t.id===id);if(!target)throw new RangeError('Unknown target');Object.assign(target,position);target.kb=null;}
    snapshot(){return {time:this.time,phase:phaseAt(this.spec,this.time),hitbox:this.hitbox,hitboxRange:hitboxAt(this.spec,this.time).range,bodyCapsule:this.body(),rootEnabled:this.rootEnabled,position:{...this.position},authoredDistance:rootDistance(this.spec,this.time),actualDistance:(this.position.x-this.start.x)*this.facing.x+(this.position.z-this.start.z)*this.facing.z,blockedDistance:this.blockedDistance,contacts:this.contacts,events:this.events.map(e=>({...e})),hits:this.hits.map(h=>({...h,knockback:{...h.knockback}})),targets:this.targets.map(t=>({id:t.id,x:t.x,z:t.z,y:t.y,radius:t.radius,height:t.height,hp:t.hp}))};}
  }
  return {Attack,rootDistance,hitboxAt,phaseAt,capsuleGap,sweepCapsule,sectorTouchesCapsule,validate};
});
