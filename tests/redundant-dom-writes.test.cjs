const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');

/* 2026-09-13：使用者機器的 Performance trace 顯示主執行緒 34% 的時間耗在 Commit
  （單筆最長 230ms），而 Commit 會等合成器消化點陣化——失效越多就等越久。
   接著用「多餘寫入」探針直接量：10 秒內全站 DOM 寫入 6345 次，其中 5266 次
   寫的是**相同的值**（83%）。那些寫入不改變畫面，卻每一次都讓元素進重繪佇列。
   逐一補上「沒變就不寫」之後降到 26 次（2%）。

   這一檔釘的是「別再退回去」：每一支高頻渲染函式都必須走 *IfChanged 系列。 */

const NL = String.fromCharCode(10);
function loadGuards() {
  const ctx = { String };
  vm.createContext(ctx);
  /* 用字串定位切出函式本體，不用從字串組正則：跳脫字元經過多層引號很容易被吃掉，
     而那種失敗長得像「函式不存在」，會把讀測試的人帶去錯的方向。 */
  const src = ['setTextIfChanged', 'setHtmlIfChanged', 'setAttrIfChanged',
    'removeAttrIfPresent', 'setClassIfChanged']
    .map((name) => {
      const head = 'function ' + name + '(';
      const a = ui.indexOf(head);
      assert.ok(a >= 0, '找不到 ' + name);
      const b = ui.indexOf(NL + '}', a);
      assert.ok(b > a, name + ' 的結尾抓不到');
      return ui.slice(a, b + 2);
    }).join(NL);
  vm.runInContext(src, ctx);
  return ctx;
}

function fakeEl(initial) {
  const attrs = Object.assign({}, initial || {});
  return {
    textContent: '', innerHTML: '', className: '',
    writes: 0,
    getAttribute(n) { return Object.prototype.hasOwnProperty.call(attrs, n) ? attrs[n] : null; },
    setAttribute(n, v) { attrs[n] = String(v); this.writes++; },
    hasAttribute(n) { return Object.prototype.hasOwnProperty.call(attrs, n); },
    removeAttribute(n) { delete attrs[n]; this.writes++; },
  };
}

test('屬性守門：值相同不寫，值不同才寫', () => {
  const { setAttrIfChanged } = loadGuards();
  const el = fakeEl({ 'data-x': '1' });
  setAttrIfChanged(el, 'data-x', '1');
  assert.equal(el.writes, 0, '相同值不得寫入');
  setAttrIfChanged(el, 'data-x', 1);          // 數字也要先轉字串再比
  assert.equal(el.writes, 0, '型別不同但字面相同，仍算沒變');
  setAttrIfChanged(el, 'data-x', '2');
  assert.equal(el.writes, 1);
  setAttrIfChanged(null, 'data-x', '3');      // null 不得丟例外
});

test('移除屬性：本來就沒有就不動作', () => {
  const { removeAttrIfPresent } = loadGuards();
  const el = fakeEl({ title: 'x' });
  removeAttrIfPresent(el, 'nope');
  assert.equal(el.writes, 0);
  removeAttrIfPresent(el, 'title');
  assert.equal(el.writes, 1);
  removeAttrIfPresent(null, 'title');
});

test('class 守門：相同字串不得重新指派', () => {
  const { setClassIfChanged } = loadGuards();
  const el = fakeEl();
  el.className = 'a b';
  setClassIfChanged(el, 'a b');
  assert.equal(el.className, 'a b');
  setClassIfChanged(el, 'a c');
  assert.equal(el.className, 'a c');
});

/* 高頻路徑：這幾支每秒跑好幾次，一旦有人改回無條件寫入，多餘寫入會立刻回到數千次。 */
function sectionOf(startMarker, endMarker) {
  const a = ui.indexOf(startMarker);
  assert.ok(a >= 0, '找不到 ' + startMarker);
  const b = ui.indexOf(endMarker, a);
  assert.ok(b > a, '找不到 ' + endMarker);
  return ui.slice(a, b);
}

test('戰鬥技能格不得無條件重寫屬性', () => {
  const fn = sectionOf('function syncBattleSkillSlot(slot, state) {', '\nfunction ');
  assert.doesNotMatch(fn, /slot\.setAttribute\(/);
  assert.doesNotMatch(fn, /slot\.removeAttribute\(/);
  assert.doesNotMatch(fn, /slot\.className = /);
  assert.match(fn, /setAttrIfChanged\(slot, 'data-battle-skill-key'/);
});

test('增益徽章不得無條件重寫屬性', () => {
  const fn = sectionOf('function syncBattleBuffBadge(badge, st) {', '\nfunction ');
  assert.doesNotMatch(fn, /badge\.setAttribute\(/);
  assert.doesNotMatch(fn, /badge\.className = /);
  assert.match(fn, /setAttrIfChanged\(badge, 'data-buff-key'/);
});

test('頂欄資源與角色欄不得無條件重寫', () => {
  assert.doesNotMatch(ui, /\$id\('r-gold'\)\.textContent = /);
  assert.doesNotMatch(ui, /\$id\('p-level'\)\.textContent = /);
  assert.match(ui, /setTextIfChanged\(\$id\('r-gold'\), fmt\(p\.gold\)\)/);
  assert.match(ui, /setTextIfChanged\(\$id\('p-level'\), levelText\)/);
  const tip = sectionOf('function updateResourceTip(id, title, desc) {', '\n  }');
  assert.doesNotMatch(tip, /\.setAttribute\(/);
});

test('屬性面板每一列都要先比對再寫', () => {
  const fn = sectionOf('var el = panel.querySelector', 'setHtmlIfChanged($id(' + String.fromCharCode(39) + 'active-buffs' + String.fromCharCode(39) + ')');
  assert.doesNotMatch(fn, /el\.innerHTML = /);
  assert.match(fn, /setHtmlIfChanged\(el, row\[1\]\(st\)\)/);
});
