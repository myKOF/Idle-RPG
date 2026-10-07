#!/usr/bin/env node
/* 符文石圖示工作站的本機伺服器：提供 rune-stone-studio.html，並把頁面畫好的 PNG 寫到預覽資料夾。
 *
 *   node tools/rune-stones/rune-stone-server.cjs [--port 28395] [--preview-dir <資料夾>]
 *
 * 只接受一種寫入：
 *   POST /preview?name=<檔名>[&sub=<子資料夾>]   → <preview-dir>[/<sub>]/<檔名>.png
 * 內容是 data:image/png;base64,... 字串。檔名與子資料夾只允許英數、底線、連字號。
 * 這支不會寫入遊戲目錄（images／js／css 一律不碰）；靜態檔只提供 tools/rune-stones/ 與
 * js/runeword_data.js（讀符文清單用，唯讀）。
 */
'use strict';

var http = require('http');
var fs = require('fs');
var path = require('path');
var os = require('os');

var ROOT = path.resolve(__dirname, '..', '..');
var args = process.argv.slice(2);
function arg(name, dflt) {
  var i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
}
var PORT = Number(arg('--port', 28395));
var PREVIEW_DIR = path.resolve(arg('--preview-dir', path.join(os.tmpdir(), 'rune-stone-preview')));

var TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.json': 'application/json' };
var STATIC_OK = [path.join(ROOT, 'tools', 'rune-stones') + path.sep, path.join(ROOT, 'js', 'runeword_data.js')];

function readBody(req, cb) {
  var chunks = [];
  req.on('data', function (c) { chunks.push(c); });
  req.on('end', function () { cb(Buffer.concat(chunks).toString('utf8')); });
}

function writePng(name, sub, dataUrl, res) {
  var ok = /^[A-Za-z0-9_-]+$/;
  if (!ok.test(name || '') || (sub && !ok.test(sub))) { res.writeHead(400); res.end('bad name'); return; }
  var m = /^data:image\/png;base64,(.+)$/.exec(dataUrl);
  if (!m) { res.writeHead(400); res.end('not a png data url'); return; }
  var dir = sub ? path.join(PREVIEW_DIR, sub) : PREVIEW_DIR;
  fs.mkdirSync(dir, { recursive: true });
  var file = path.join(dir, name + '.png');
  var buf = Buffer.from(m[1], 'base64');
  fs.writeFileSync(file, buf);
  console.log('wrote ' + file + ' (' + buf.length + ' bytes)');
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end(file);
}

function staticAllowed(file) {
  for (var i = 0; i < STATIC_OK.length; i++) {
    if (file === STATIC_OK[i] || (STATIC_OK[i].slice(-1) === path.sep && file.indexOf(STATIC_OK[i]) === 0)) return true;
  }
  return false;
}

http.createServer(function (req, res) {
  var u = new URL(req.url, 'http://localhost');
  if (req.method === 'POST' && u.pathname === '/preview') {
    readBody(req, function (body) { writePng(u.searchParams.get('name'), u.searchParams.get('sub'), body, res); });
    return;
  }
  if (u.pathname === '/') { res.writeHead(302, { Location: '/tools/rune-stones/rune-stone-studio.html' }); res.end(); return; }
  var file = path.resolve(ROOT, '.' + decodeURIComponent(u.pathname));
  if (!staticAllowed(file) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, function () {
  console.log('rune stone studio: http://localhost:' + PORT + '/');
  console.log('preview dir: ' + PREVIEW_DIR);
});
