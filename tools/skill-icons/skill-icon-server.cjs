#!/usr/bin/env node
/* 技能圖示工作站的本機伺服器：提供 skill-icon-studio.html，並把頁面畫好的 PNG 寫回專案。
 *
 *   node tools/skill-icons/skill-icon-server.cjs [--port 28390] [--preview-dir <資料夾>]
 *
 * 只接受兩種寫入：
 *   POST /save?gid=<群組id>        → images/skills/<群組id>.png（遊戲用的正式圖）
 *   POST /preview?name=<檔名>      → --preview-dir 底下（預設系統暫存區的 skill-icon-preview，不入庫）
 * 內容是 data:image/png;base64,... 字串。檔名只允許英數、底線、連字號。
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
var PORT = Number(arg('--port', 28390));
var ICON_DIR = path.join(ROOT, 'images', 'skills');
var PREVIEW_DIR = path.resolve(arg('--preview-dir', path.join(os.tmpdir(), 'skill-icon-preview')));

var TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.json': 'application/json' };

function readBody(req, cb) {
  var chunks = [];
  req.on('data', function (c) { chunks.push(c); });
  req.on('end', function () { cb(Buffer.concat(chunks).toString('utf8')); });
}

function writePng(dir, name, dataUrl, res) {
  if (!/^[A-Za-z0-9_-]+$/.test(name || '')) { res.writeHead(400); res.end('bad name'); return; }
  var m = /^data:image\/png;base64,(.+)$/.exec(dataUrl);
  if (!m) { res.writeHead(400); res.end('not a png data url'); return; }
  fs.mkdirSync(dir, { recursive: true });
  var file = path.join(dir, name + '.png');
  var buf = Buffer.from(m[1], 'base64');
  fs.writeFileSync(file, buf);
  console.log('wrote ' + path.relative(ROOT, file) + ' (' + buf.length + ' bytes)');
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end(path.relative(ROOT, file));
}

http.createServer(function (req, res) {
  var u = new URL(req.url, 'http://localhost');
  if (req.method === 'POST' && (u.pathname === '/save' || u.pathname === '/preview')) {
    readBody(req, function (body) {
      if (u.pathname === '/save') writePng(ICON_DIR, u.searchParams.get('gid'), body, res);
      else writePng(PREVIEW_DIR, u.searchParams.get('name'), body, res);
    });
    return;
  }
  /* 首頁導到實際路徑，頁面裡的相對路徑 script 才找得到 */
  if (u.pathname === '/') { res.writeHead(302, { Location: '/tools/skill-icons/skill-icon-studio.html' }); res.end(); return; }
  var rel = decodeURIComponent(u.pathname);
  var file = path.resolve(ROOT, '.' + rel);
  if (file.indexOf(ROOT) !== 0 || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, function () {
  console.log('skill icon studio: http://localhost:' + PORT + '/');
  console.log('preview dir: ' + PREVIEW_DIR);
});
