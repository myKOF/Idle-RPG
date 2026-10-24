"""Validate the actual GLB payload rather than trusting source-model statistics."""
import argparse
import json
import math
import struct
from pathlib import Path

p=argparse.ArgumentParser()
p.add_argument('model')
p.add_argument('--report')
a=p.parse_args()
data=Path(a.model).read_bytes()
magic,version,length=struct.unpack_from('<III',data)
assert magic==0x46546c67 and version==2 and length==len(data)
size,kind=struct.unpack_from('<II',data,12)
assert kind==0x4e4f534a
j=json.loads(data[20:20+size])
offset=20+size
size,kind=struct.unpack_from('<II',data,offset)
assert kind==0x004e4942
binary=data[offset+8:offset+8+size]
types={5120:('b',1),5121:('B',1),5122:('h',2),5123:('H',2),5125:('I',4),5126:('f',4)}
counts={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}
def read(index):
    ac=j['accessors'][index]
    view=j['bufferViews'][ac['bufferView']]
    typ,width=types[ac['componentType']]
    count=counts[ac['type']]
    stride=view.get('byteStride',width*count)
    start=view.get('byteOffset',0)+ac.get('byteOffset',0)
    assert start+(ac['count']-1)*stride+width*count<=len(binary)
    result=[struct.unpack_from('<'+typ*count,binary,start+i*stride) for i in range(ac['count'])]
    assert all(math.isfinite(v) for row in result for v in row)
    return result

assert len(j['meshes'])==1 and len(j['meshes'][0]['primitives'])==1
assert len(j['materials'])==1 and len(j['skins'])==1
assert len(j['skins'][0]['joints'])==16
assert len(j['textures'])==2 and len(j['images'])==2
assert all('uri' not in im and 'bufferView' in im for im in j['images'])
assert not j.get('cameras') and not j.get('extensions',{}).get('KHR_lights_punctual')
primitive=j['meshes'][0]['primitives'][0]
attrs=primitive['attributes']
positions=read(attrs['POSITION'])
indices=[v[0] for v in read(primitive['indices'])]
assert len(indices)%3==0 and max(indices)<len(positions)
assert len(indices)//3<=12000, 'Candidate exceeds the revised authoring budget'
assert set(['NORMAL','TEXCOORD_0','JOINTS_0','WEIGHTS_0'])<=attrs.keys()
weights=read(attrs['WEIGHTS_0'])
joints=read(attrs['JOINTS_0'])
assert len(weights)==len(positions)==len(joints)
assert all(abs(sum(w)-1)<.0001 for w in weights)
assert all(all(0<=v<16 for v in row) for row in joints)
assert all(sum(v>0 for v in row)==1 for row in weights), 'Expected rigid one-bone armor weights'
animations={an['name']:an for an in j['animations']}
expected={'idle':30,'walk':15,'attack1':15,'attack2':15,'cast':15,'die':30}
assert set(animations)==set(expected)
clips={}
for name,an in animations.items():
    times=[v[0] for s in an['samplers'] for v in read(s['input'])]
    for s in an['samplers']:
        read(s['output'])
        samples=[v[0] for v in read(s['input'])]
        assert all(b>a for a,b in zip(samples,samples[1:]))
    duration=max(times)-min(times)
    assert abs(duration-(expected[name]-1)/30)<.0001
    assert len(an['channels'])==48
    clips[name]={'channels':len(an['channels']),'keySpanSeconds':round(duration,6)}
report={'result':'PASS','bytes':len(data),'triangles':len(indices)//3,
        'exportedVertices':len(positions),'meshes':1,'primitives':1,'materials':1,
        'skeletonJoints':16,'embeddedTextures':2,'weightsPerVertex':1,'clips':clips}
if a.report:
    Path(a.report).write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report,indent=2))
