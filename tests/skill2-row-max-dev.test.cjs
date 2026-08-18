'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadContext(hostname = 'localhost') {
  const root = path.resolve(__dirname, '..');
  const sandbox = {
    console,
    location: { hostname },
    window: { location: { hostname } },
    self: {},
    globalThis: {},
    UI: { dirty: {} },
    G: {
      player: {
        skills2: { levels: {} }
      }
    }
  };
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);

  const files = [
    'js/data.js',
    'js/skills.js',
    'js/skills2.js',
    'js/gm_exec.js'
  ];
  for (const rel of files) {
    const code = fs.readFileSync(path.join(root, rel), 'utf8');
    vm.runInContext(code, ctx, { filename: rel });
  }
  return ctx;
}

test('內測一鍵滿級：skill2max 能將指定技能群組升到滿級 Lv.10', () => {
  const c = loadContext('localhost');
  const res = c.executeGMCommand('skill2max icearrow');
  assert.equal(res.ok, true);
  assert.deepEqual(
    JSON.parse(JSON.stringify(c.G.player.skills2.levels.icearrow)),
    [10, 10, 10, 10, 10, 10, 10]
  );
  assert.equal(c.UI.dirty.skills, true);
});

test('內測一鍵滿級：skill2max all 能將所有群組全階升到滿級', () => {
  const c = loadContext('localhost');
  const res = c.executeGMCommand('skill2max all');
  assert.equal(res.ok, true);
  for (const gid in c.SKILLS2) {
    assert.deepEqual(
      JSON.parse(JSON.stringify(c.G.player.skills2.levels[gid])),
      [10, 10, 10, 10, 10, 10, 10],
      gid + ' 應全為 10 級'
    );
  }
});

test('安全限制：非本機環境下 skill2max 指令被拒絕', () => {
  const c = loadContext('game.example.com');
  const res = c.executeGMCommand('skill2max icearrow');
  assert.equal(res.ok, false);
});
