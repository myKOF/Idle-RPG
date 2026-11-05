'use strict';
/* 傳奇特效＋符文真言測試用例（docs/ANTIGRAVITY_LEGENDARY_RUNEWORD_TEST_CASES.md）與程式的條目數逐一對得上：
   每個 PASSIVE_POOL 傳奇特效鍵、每組符文真言 id，在人工註記與文件裡都各出現一次；用到的機制都有模板。
   只檢查覆蓋，不比對全文——資料表改了說明文字時重跑 node tools/gen_legendary_runeword_test_cases.cjs 即可。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadRuneEnv } = require('./helpers/runeword-env.cjs');
const NOTES = require('../tools/legendary_runeword_test_notes.cjs');

const root = path.resolve(__dirname, '..');
const doc = fs.readFileSync(path.join(root, 'docs', 'ANTIGRAVITY_LEGENDARY_RUNEWORD_TEST_CASES.md'), 'utf8');
const c = loadRuneEnv({ noState: true });
const legendKeys = Object.keys(c.PASSIVE_POOL).filter((k) => c.PASSIVE_POOL[k].legendary);
const wordIds = c.RUNEWORDS.map((w) => w.id);
const sorted = (a) => [...a].sort();   // vm 內的陣列換成本 realm 的陣列，deepEqual 才比得了

test('每個傳奇特效都有測試註記，且沒有過期的註記', () => {
  assert.deepEqual(sorted(Object.keys(NOTES.LEGEND)), sorted(legendKeys));
  legendKeys.forEach((k) => assert.ok(NOTES.LEGEND[k].s, k + ' 缺步驟與預期'));
  const groups = Array.from(new Set(legendKeys.map((k) => c.PASSIVE_POOL[k].relatedSkill).filter(Boolean)));
  assert.deepEqual(sorted(Object.keys(NOTES.GROUPS)), sorted(groups));
});

test('每組符文真言都有註記，用到的 fx／被動／觸發／動作都有模板', () => {
  assert.deepEqual(sorted(Object.keys(NOTES.RUNEWORD)), sorted(wordIds));
  c.RUNEWORDS.forEach((w) => {
    Object.keys(w.fx || {}).forEach((k) => assert.ok(k in NOTES.FX, w.id + ' 的 fx ' + k + ' 缺模板'));
    Object.keys(w.passives || {}).forEach((k) => assert.ok(NOTES.PASSIVE[k], w.id + ' 的被動 ' + k + ' 缺模板'));
    (w.procs || []).forEach((p) => {
      assert.ok(NOTES.TRIGGER[p.on], w.id + ' 的觸發 ' + p.on + ' 缺模板');
      p.acts.forEach((a) => assert.ok(NOTES.ACT[a.act], w.id + ' 的動作 ' + a.act + ' 缺模板'));
    });
  });
});

test('文件條目與程式一一對應：傳奇特效、符文真言各出現一次', () => {
  const legendHeads = doc.match(/^#### L\d{3} `[^`]+`/gm) || [];
  const wordHeads = doc.match(/^#### W\d{2} `[^`]+`/gm) || [];
  assert.deepEqual(sorted(legendHeads.map((h) => /`([^`]+)`/.exec(h)[1])), sorted(legendKeys));
  assert.deepEqual(sorted(wordHeads.map((h) => /`([^`]+)`/.exec(h)[1])), sorted(wordIds));
  assert.match(doc, new RegExp('\\*\\*傳奇特效合計\\*\\*.*\\*\\*' + legendKeys.length + '\\*\\*'));
  assert.doesNotMatch(doc, /缺註記|缺模板|找不到，請回報|沒有任何裝備有/);
});
