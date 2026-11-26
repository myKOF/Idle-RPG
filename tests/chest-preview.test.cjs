'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { coalesceShortFrames } = require('../tools/chest-opening/preview.cjs');

test('GIF短幀合併保持150ms掀蓋及1650ms獎勵邊界，所有延遲至少20ms', () => {
  const frames = [
    { file: 'shake.png', duration: 1500 },
    ...Array.from({ length: 15 }, (_, n) => ({ file: 'opening-' + n + '.png', duration: 10 })),
    { file: 'opened.png', duration: 100 }, { file: 'reward.png', duration: 100 }
  ];
  const original = JSON.stringify(frames), result = coalesceShortFrames(frames);
  assert.equal(JSON.stringify(frames), original, '不改寫擷取來源');
  assert.ok(result.every(frame => frame.duration >= 20));
  assert.deepEqual(result.slice(1, 8).map(frame => frame.duration), [20,20,20,20,20,20,30]);
  const completed = result.findIndex(frame => frame.file === 'opened.png');
  assert.equal(result.slice(0, completed).reduce((sum, frame) => sum + frame.duration, 0), 1650);
  assert.equal(result.reduce((sum, frame) => sum + frame.duration, 0), 1850);
  assert.equal(result[completed].duration, 100);
});

test('GIF一般幀保持原時長，尾部短幀不延長總時間，無法表示的輸入拒絕編碼', () => {
  assert.deepEqual(coalesceShortFrames([{file:'a',duration:50},{file:'b',duration:20},{file:'c',duration:10}]), [{file:'a',duration:50},{file:'b',duration:30}]);
  for (const frames of [[],[{file:'a',duration:10}],[{file:'a',duration:15}],[{file:'a',duration:0}]]) {
    assert.throws(() => coalesceShortFrames(frames));
  }
});
