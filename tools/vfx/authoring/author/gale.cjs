'use strict';
const kit=require('../preset-kit.cjs');
const {A,sprite,particle,deg}=kit;
function burst(){
  const flash=[[0,0],[0.09,1],[0.28,0.9],[1,0]];
  const base={blend:'add',duration:0.24,alphaOverLife:flash};
  const layers=[
    sprite({...base,id:'amber-halo',asset:A.glowSoft,size:108,tint:'#ffb339',alpha:0.5}),
    sprite({...base,id:'burst-spikes',asset:A.star08,size:136,rotDeg:18,tint:'#ffb844',alpha:1,scaleOverLife:[[0,0.4],[0.17,1],[1,1.12]]}),
    sprite({...base,id:'cross-spikes',asset:A.star08,size:96,rotDeg:-13,tint:'#fff0a3',alpha:0.9}),
    sprite({...base,id:'white-impact',asset:A.star04,size:72,tint:'#ffffff',alpha:1}),
    sprite({...base,id:'hot-core',asset:A.glowSoft,size:32,tint:'#fffdf0',alpha:1})
  ];
  for(let i=0;i<5;i++)layers.push(sprite({...base,id:'fracture-'+i,asset:A.bolt06H,
    x:Math.cos(i*1.25)*24,y:Math.sin(i*1.25)*24,sizeX:48,sizeY:9,
    rotation:i*1.25,tint:'#ffe2a0',alpha:0.55,delay:0.015+i*0.004}));
  layers.push(particle({id:'sparks',asset:A.trace02H,blend:'add',tint:'#ffd475',burst:9,
    duration:0.26,lifetime:[0.09,0.2],spawnRadius:8,speed:[70,160],direction:0,spread:360,
    startPx:[3,7],alignToVelocity:true,drag:4,alphaOverLife:[[0,1],[1,0]],scaleOverLife:[[0,1],[1,0.15]]}));
  layers.forEach((l,i)=>l.zIndex=i);
  return {id:'hit-gale-burst',duration:0.27,sizing:{shape:'custom',widthM:6,heightM:6,authored:{width:120,height:120}},layers};
}
function moon(){
  return {
  "schemaVersion": 1,
  "id": "slash-gale-moon",
  "duration": 0.29,
  "loop": false,
  "layers": [
    {
      "id": "blade-face",
      "type": "sprite",
      "assetId": "codex-authored/moon/moon-polished-body.svg",
      "scale": {
        "x": 0.34,
        "y": 0.34
      },
      "alpha": 1,
      "blendMode": "normal",
      "duration": 0.29,
      "alphaOverLife": [
        [
          0,
          0
        ],
        [
          0.1,
          1
        ],
        [
          0.32,
          0.8
        ],
        [
          0.65,
          0.42
        ],
        [
          1,
          0
        ]
      ],
      "rotationOverLife": [
        [
          0,
          -0.75
        ],
        [
          0.35,
          -0.25
        ],
        [
          0.7,
          0.25
        ],
        [
          1,
          0.48
        ]
      ]
    },
    {
      "id": "thin-edge",
      "type": "sprite",
      "assetId": "codex-authored/moon/moon-polished-edge.svg",
      "zIndex": 1,
      "scale": {
        "x": 0.34,
        "y": 0.34
      },
      "blendMode": "normal",
      "duration": 0.29,
      "alphaOverLife": [
        [
          0,
          0
        ],
        [
          0.1,
          1
        ],
        [
          0.25,
          1
        ],
        [
          0.55,
          0.75
        ],
        [
          0.8,
          0.4
        ],
        [
          1,
          0
        ]
      ],
      "rotationOverLife": [
        [
          0,
          -0.75
        ],
        [
          0.35,
          -0.25
        ],
        [
          0.7,
          0.25
        ],
        [
          1,
          0.48
        ]
      ]
    },
    {
      "id": "blade-shards",
      "type": "particle",
      "assetId": "particle-pack/png-black-background/rotated/trace_02_rotated.png",
      "zIndex": 2,
      "position": {
        "x": 26,
        "y": 12
      },
      "alpha": 0.65,
      "tint": "#aaafff",
      "blendMode": "add",
      "delay": 0.018,
      "duration": 0.25,
      "emission": {
        "count": 7,
        "mode": "burst"
      },
      "lifetime": [
        0.09,
        0.19
      ],
      "spawn": {
        "height": 86,
        "shape": "box",
        "width": 42
      },
      "speed": [
        45,
        85
      ],
      "direction": 65,
      "spread": 32,
      "startScale": [
        0.0039,
        0.0078
      ],
      "alignToVelocity": true,
      "alphaOverLife": [
        [
          0,
          0
        ],
        [
          0.08,
          0.85
        ],
        [
          0.55,
          0.45
        ],
        [
          1,
          0
        ]
      ],
      "scaleOverLife": [
        [
          0,
          1
        ],
        [
          1,
          0.1
        ]
      ]
    },
    {
      "id": "spectral-accents",
      "type": "sprite",
      "assetId": "codex-authored/moon/moon-polished-accents.svg",
      "zIndex": 3,
      "scale": {
        "x": 0.34,
        "y": 0.34
      },
      "blendMode": "normal",
      "duration": 0.29,
      "alphaOverLife": [
        [
          0,
          0
        ],
        [
          0.12,
          1
        ],
        [
          0.4,
          0.8
        ],
        [
          0.75,
          0.35
        ],
        [
          1,
          0
        ]
      ],
      "rotationOverLife": [
        [
          0,
          -0.85
        ],
        [
          0.35,
          -0.25
        ],
        [
          0.7,
          0.35
        ],
        [
          1,
          0.63
        ]
      ]
    }
  ],
  "sizing": {
    "authored": {
      "height": 100,
      "radius": 50,
      "width": 100
    },
    "heightM": 10,
    "shape": "custom",
    "widthM": 10
  }
};
}
function write(){return [kit.write(burst()),kit.write(moon())];}
if(require.main===module)console.log(write().join('\n'));
module.exports={burst,moon,write};
