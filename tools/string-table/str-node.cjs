'use strict';
/* Node 端的 STR()：工具腳本在沙盒裡 eval 遊戲資料字面值（config_tables.cjs 等）時，字面值裡的 STR(編號) 要能解出繁體中文，
   結果與遊戲內預設語言相同。資料來源是 js/strings_data.js（apply_strings.cjs 產生）。 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
let DATA = null;

function data() {
  if (DATA) return DATA;
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'strings_data.js'), 'utf8'), ctx);
  DATA = vm.runInContext('STRING_DATA', ctx);
  return DATA;
}

function STR(id, first) {
  const row = data()[id];
  if (!row) return '[#' + id + ']';
  const template = row[0];
  if (arguments.length < 2) return template;
  const args = (arguments.length === 2 && first !== null && typeof first === 'object') ? first : Array.prototype.slice.call(arguments, 1);
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (whole, key) => (args[key] === undefined ? whole : (args[key] === null ? '' : String(args[key]))));
}

/* 沙盒要載入的檔案（接在 util.js 之後） */
const STRING_FILES = ['strings_data.js', 'strings.js'];

module.exports = { STR, STRING_FILES };
