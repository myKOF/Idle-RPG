// Deterministic instanced particles. The animation, nozzle transform and meters share one clock.
import * as THREE from 'three';

const vertex=`
attribute vec3 offset;
attribute vec4 particle;
attribute vec3 tint;
attribute float seed;
varying vec2 vUv;
varying vec3 vTint;
varying vec3 vInfo;
void main(){
  vUv=uv;vTint=tint;vInfo=vec3(particle.z,particle.w,seed);
  float c=cos(seed*6.2831),s=sin(seed*6.2831);
  vec2 p=mat2(c,-s,s,c)*position.xy*particle.xy;
  vec4 eye=modelViewMatrix*vec4(offset,1.0);
  eye.xy+=p;gl_Position=projectionMatrix*eye;
}`;
const fragment=`
precision highp float;
varying vec2 vUv;
varying vec3 vTint;
varying vec3 vInfo;
uniform float clock;
uniform float mode;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
 return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){return noise(p)*.57+noise(p*2.03+4.2)*.28+noise(p*4.17-2.8)*.15;}
void main(){
 vec2 p=(vUv-.5)*2.0;
 float n=fbm(p*3.9+vec2(vInfo.z*41.0,clock*-4.1));
 float edge=length(p)+.70*(n-.5);
 float a=(1.0-smoothstep(.26,.96,edge));
 if(mode<.5)a*=smoothstep(.25,.62,n+.25*(1.0-length(p)));
 a*=a*(.68+.32*n)*vInfo.x;
 if(a<.002)discard;
 vec3 hot=mix(vTint*.64,vTint*1.2,n);
 if(mode<.5){
   float heat=clamp((1.0-edge)*.55+n*.53-vInfo.y*.10,0.0,1.0);
   vec3 red=vec3(1.2,.025,.0003),orange=vec3(2.6,.14,.002),gold=vec3(4.4,.75,.020);
   hot=mix(red,orange,smoothstep(.18,.53,heat));
   hot=mix(hot,gold,smoothstep(.80,.99,heat));
 }
 gl_FragColor=vec4(hot,a);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
}`;

function random(seed){let s=seed>>>0;return ()=>{s^=s<<13;s^=s>>>17;s^=s<<5;return (s>>>0)/4294967296;};}
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const ease=x=>{x=clamp(x,0,1);return x*x*(3-2*x);};

export class DragonFire {
  constructor(scene,config,mouthAt) {
    this.config=config;this.mouthAt=mouthAt;this.layers=[];this.group=new THREE.Group();
    this.group.name='BOSS9_FireParticles';scene.add(this.group);
    const rnd=random(config.seed);
    for(const definition of config.layers){
      const particles=[];
      const count=Math.ceil((config.emitEnd-config.emitStart)*definition.rate);
      for(let i=0;i<count;i++)particles.push({birth:config.emitStart+(i+rnd())/definition.rate,
        a:rnd()*Math.PI*2,r:rnd(),j:rnd(),seed:rnd()});
      const base=new THREE.PlaneGeometry(2,2),g=new THREE.InstancedBufferGeometry();
      g.index=base.index;g.setAttribute('position',base.getAttribute('position'));g.setAttribute('uv',base.getAttribute('uv'));
      const positions=new Float32Array(count*3),params=new Float32Array(count*4),colors=new Float32Array(count*3),seeds=new Float32Array(count);
      for(const [name,array,size] of [['offset',positions,3],['particle',params,4],['tint',colors,3],['seed',seeds,1]])
        g.setAttribute(name,new THREE.InstancedBufferAttribute(array,size).setUsage(THREE.DynamicDrawUsage));
      const smoke=definition.kind==='smoke';
      const material=new THREE.ShaderMaterial({vertexShader:vertex,fragmentShader:fragment,
        uniforms:{clock:{value:0},mode:{value:smoke?2:definition.kind==='flame'?0:1}},transparent:true,depthWrite:false,
        blending:(smoke||definition.kind==='flame')?THREE.NormalBlending:THREE.AdditiveBlending,side:THREE.DoubleSide});
      const mesh=new THREE.Mesh(g,material);mesh.frustumCulled=false;mesh.renderOrder=smoke?2:3;
      this.group.add(mesh);base.dispose();
      this.layers.push({definition,particles,mesh,g,positions,params,colors,seeds});
    }
    this.light=new THREE.PointLight(0xff8a24,0,24,2);this.group.add(this.light);
  }
  update(time) {
    const c=this.config;
    this.stats={alive:0,maxDistance:0,layers:{}};
    for(const layer of this.layers){
      const {definition:d,particles,g,mesh,positions,params,colors,seeds}=layer;let n=0;
      for(const p of particles){
        const age=time-p.birth;if(age<0||age>=d.life)continue;
        const u=age/d.life;
        const mouth=this.mouthAt(p.birth);
        const forward=mouth.direction;
        const side=new THREE.Vector3().crossVectors(forward,new THREE.Vector3(0,1,0)).normalize();
        const up=new THREE.Vector3().crossVectors(side,forward).normalize();
        const travel=Math.min(c.range,age*c.speed);
        const spread=(.025+travel*.032)*Math.sqrt(p.r);
        const swirl=p.a+age*(3+p.j*4);
        const pos=mouth.position.clone().addScaledVector(forward,travel)
          .addScaledVector(side,Math.cos(swirl)*spread).addScaledVector(up,Math.sin(swirl)*spread);
        const smoke=d.kind==='smoke',ember=d.kind==='ember',core=d.kind==='core';
        if(smoke)pos.y+=u*u*1.6;
        if(ember){pos.y+=age*age*1.2;pos.addScaledVector(side,Math.sin(p.a)*u*.7);}
        const size=d.radius+d.growth*u;
        const ramp=ease((p.birth-c.emitStart)/.16)*ease((c.emitEnd-p.birth)/.20);
        const fade=ease(age/.04)*Math.pow(1-u,smoke?.65:.48)*ramp;
        positions.set(pos.toArray(),n*3);
        params.set([size*(ember?.36:1),size*(ember?3.5:1),d.opacity*fade,u],n*4);
        let rgb;
        if(smoke)rgb=[.24+.08*p.j,.12+.06*p.j,.065+.045*p.j];
        else if(core)rgb=[2.3,1.55,.55];
        else if(ember)rgb=[2.4,.65+.6*p.j,.035];
        else rgb=[1.7,Math.max(.11,.86-u*.80)+p.j*.15,Math.max(.012,.15-u*.20)];
        colors.set(rgb,n*3);seeds[n]=p.seed;
        n++;this.stats.maxDistance=Math.max(this.stats.maxDistance,travel);
      }
      for(const name of ['offset','particle','tint','seed'])g.attributes[name].needsUpdate=true;
      g.instanceCount=n;mesh.material.uniforms.clock.value=time;
      this.stats.alive+=n;this.stats.layers[d.kind]=n;
    }
    const mouth=this.mouthAt(time);this.light.position.copy(mouth.position);
    this.light.intensity=120*ease((time-c.emitStart)/.15)*ease((c.emitEnd+.1-time)/.25);
    return this.stats;
  }
  clear(){for(const l of this.layers)l.g.instanceCount=0;this.light.intensity=0;}
  dispose(){for(const l of this.layers){l.g.dispose();l.mesh.material.dispose();}this.light.dispose();this.group.removeFromParent();}
}
