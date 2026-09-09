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
  "duration": 0.37,
  "loop": false,
  "layers": [
    {
      "id": "violet-afterimage",
      "type": "sprite",
      "assetId": "codex-authored/moon-opaque/moon-original-02.png",
      "zIndex": 0,
      "scale": {
        "x": 0.4141,
        "y": 0.3516
      },
      "alpha": 0.264,
      "tint": "#7d36f3",
      "blendMode": "add",
      "duration": 0.34,
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
          0.62,
          1
        ],
        [
          1,
          0
        ]
      ],
      "rotationOverLife": [
        [
          0,
          -2.7053
        ],
        [
          0.4,
          -1.4835
        ],
        [
          0.72,
          -0.3491
        ],
        [
          1,
          0.2618
        ]
      ]
    },
    {
      "id": "swing-trail",
      "type": "sprite",
      "assetId": "codex-authored/moon-opaque/moon-original-01.png",
      "zIndex": 0,
      "position": {
        "x": -18,
        "y": -7
      },
      "scale": {
        "x": 0.3984,
        "y": 0.3203
      },
      "alpha": 0.33,
      "tint": "#8058ff",
      "blendMode": "add",
      "delay": 0.018,
      "duration": 0.34,
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
          0.62,
          1
        ],
        [
          1,
          0
        ]
      ],
      "rotationOverLife": [
        [
          0,
          -2.7227
        ],
        [
          0.4,
          -1.6057
        ],
        [
          1,
          0
        ]
      ]
    },
    {
      "id": "outer-echo",
      "type": "sprite",
      "assetId": "codex-authored/moon-opaque/moon-original-01.png",
      "zIndex": 0,
      "position": {
        "x": -32,
        "y": -12
      },
      "scale": {
        "x": 0.3516,
        "y": 0.2969
      },
      "alpha": 0.192,
      "tint": "#577eff",
      "blendMode": "add",
      "delay": 0.025,
      "duration": 0.34,
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
          0.62,
          1
        ],
        [
          1,
          0
        ]
      ],
      "rotationOverLife": [
        [
          0,
          -2.7227
        ],
        [
          0.4,
          -1.7104
        ],
        [
          1,
          -0.1396
        ]
      ]
    },
    {
      "id": "purple-crescent",
      "type": "sprite",
      "assetId": "codex-authored/moon-opaque/moon-opaque-02.svg",
      "zIndex": 0,
      "scale": {
        "x": 0.41,
        "y": 0.33
      },
      "alpha": 1,
      "tint": "#542080",
      "blendMode": "normal",
      "duration": 0.34,
      "alphaOverLife": [
        [
          0,
          0
        ],
        [
          0.08,
          1
        ],
        [
          0.75,
          1
        ],
        [
          1,
          0
        ]
      ],
      "rotationOverLife": [
        [
          0,
          -2.7053
        ],
        [
          0.4,
          -1.4835
        ],
        [
          0.72,
          -0.3491
        ],
        [
          1,
          0.2618
        ]
      ]
    },
    {
      "id": "blue-blade",
      "type": "sprite",
      "assetId": "codex-authored/moon-opaque/moon-opaque-02.svg",
      "zIndex": 0,
      "scale": {
        "x": 0.375,
        "y": 0.3
      },
      "alpha": 1,
      "tint": "#9b4de5",
      "blendMode": "normal",
      "duration": 0.34,
      "alphaOverLife": [
        [
          0,
          0
        ],
        [
          0.08,
          1
        ],
        [
          0.75,
          1
        ],
        [
          1,
          0
        ]
      ],
      "rotationOverLife": [
        [
          0,
          -2.7053
        ],
        [
          0.4,
          -1.4835
        ],
        [
          0.72,
          -0.3491
        ],
        [
          1,
          0.2618
        ]
      ]
    },
    {
      "id": "white-edge",
      "type": "sprite",
      "assetId": "codex-authored/moon-opaque/moon-opaque-02.svg",
      "zIndex": 0,
      "scale": {
        "x": 0.34,
        "y": 0.26
      },
      "alpha": 1,
      "tint": "#fff4ff",
      "blendMode": "normal",
      "duration": 0.34,
      "alphaOverLife": [
        [
          0,
          0
        ],
        [
          0.08,
          1
        ],
        [
          0.75,
          1
        ],
        [
          1,
          0
        ]
      ],
      "rotationOverLife": [
        [
          0,
          -2.7053
        ],
        [
          0.4,
          -1.4835
        ],
        [
          0.72,
          -0.3491
        ],
        [
          1,
          0.2618
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
