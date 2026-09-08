'use strict';
/* ============================================================
   spine-probe.cjs — 認出一批 Spine 素材的版本、格式與成本

   為什麼需要：Spine 的 **runtime 版本必須與匯出它的編輯器版本相符**，
   4.1／4.2／4.3 的檔案格式互不相容。而官方的 spine-pixi-v8 只有
   4.2 與 4.3 兩支——素材若是 4.1，Pixi v8 上就沒有官方 runtime 可用，
   得先用編輯器重新匯出。所以「這批是幾版」是整件事的第一個岔路口，
   不能用猜的。

   幸好版本就寫在檔案裡：
     .json  → skeleton.spine 欄位
     .skel  → 二進位標頭裡的版本字串

   同時量 atlas 的成本。Spine 的 atlas 常常是好幾張 page，每一張都是
   一張完整的貼圖常駐 VRAM；「有幾張圖」與「要吃多少記憶體」是兩件事，
   前者看不出後者（這一整個專案的 VRAM 問題都是這樣來的）。

   用法：
     node tools/spine/spine-probe.cjs <資料夾或檔案...>
     node tools/spine/spine-probe.cjs D:/MyGame/new_download/spine --json
   ============================================================ */

const fs = require('fs');
const path = require('path');

const VER_RE = /(\d+)\.(\d+)\.(\d+)(?:-[A-Za-z0-9.]+)?/;

/* ---------------- 版本 ---------------- */

function versionFromJson(buf) {
  let j;
  try { j = JSON.parse(buf.toString('utf8')); } catch (e) { return null; }
  if (!j || typeof j !== 'object') return null;
  const sk = j.skeleton || {};
  return {
    version: sk.spine || null,
    hash: sk.hash || null,
    images: sk.images || null,
    bones: Array.isArray(j.bones) ? j.bones.length : null,
    slots: Array.isArray(j.slots) ? j.slots.length : null,
    /* animations 在 JSON 匯出裡是物件，鍵就是動畫名 */
    animations: j.animations ? Object.keys(j.animations) : [],
    skins: Array.isArray(j.skins) ? j.skins.map(function (s) { return s.name; })
      : (j.skins ? Object.keys(j.skins) : [])
  };
}

/* 二進位標頭：4.0/4.1 是「hash 字串 + 版本字串」，4.2 起改成
   「8 byte hash + 版本字串」。與其為兩種佈局各寫一套解析（讀錯一個
   varint 就整個歪掉），這裡只在開頭幾十個位元組裡找「像版本號的 ASCII」——
   探測器的職責是回答「這是幾版」，不是把骨架解出來。 */
function versionFromSkel(buf) {
  const head = buf.subarray(0, 128).toString('latin1');
  const m = head.match(/[34]\.\d+\.\d+[A-Za-z0-9.\-]*/);
  return { version: m ? m[0] : null, hash: null, binary: true };
}

/* ---------------- atlas ---------------- */

/* .atlas 是純文字：空行分段，每段第一行是 page 檔名，接著是 key: value，
   再接著是一條條 region。這裡只取需要的幾樣，不做完整解析。 */
function parseAtlas(text) {
  const lines = text.split(/\r?\n/);
  const pages = [];
  let cur = null;
  let regions = 0;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line) { cur = null; continue; }
    if (!cur) {
      /* 段落的第一行是 page 檔名 */
      cur = { file: line, size: null, format: null, filter: null, regions: 0 };
      pages.push(cur);
      continue;
    }
    const kv = line.match(/^([a-zA-Z]+)\s*:\s*(.+)$/);
    /* 縮排的 key: value 是 region 的屬性；不縮排的才是 page 屬性。
       region 名稱那一行是不含冒號的裸字串。 */
    if (kv && raw[0] !== ' ' && raw[0] !== '\t') {
      if (kv[1] === 'size') {
        const wh = kv[2].split(',').map(function (n) { return parseInt(n, 10); });
        cur.size = { w: wh[0], h: wh[1] };
      } else if (kv[1] === 'format') cur.format = kv[2];
      else if (kv[1] === 'filter') cur.filter = kv[2].trim();
    } else if (!kv) {
      regions++; cur.regions++;
    }
  }
  return { pages: pages, regions: regions };
}

/* ---------------- 掃描 ---------------- */

function walk(target, out) {
  const st = fs.statSync(target);
  if (st.isDirectory()) {
    fs.readdirSync(target).forEach(function (f) { walk(path.join(target, f), out); });
  } else {
    out.push(target);
  }
  return out;
}

function probe(targets) {
  const files = [];
  targets.forEach(function (t) { walk(t, files); });

  const skeletons = [];
  const atlases = [];
  const pngs = {};
  files.forEach(function (f) {
    const ext = path.extname(f).toLowerCase();
    if (ext === '.png' || ext === '.jpg' || ext === '.webp') { pngs[path.basename(f).toLowerCase()] = f; return; }
    if (ext === '.atlas' || f.toLowerCase().endsWith('.atlas.txt')) {
      atlases.push({ file: f, info: parseAtlas(fs.readFileSync(f, 'utf8')) });
      return;
    }
    if (ext === '.skel') {
      skeletons.push({ file: f, info: versionFromSkel(fs.readFileSync(f)) });
      return;
    }
    if (ext === '.json') {
      const info = versionFromJson(fs.readFileSync(f));
      /* 專案裡到處都是 .json，只有帶 skeleton.spine 的才是 Spine 骨架 */
      if (info && info.version) skeletons.push({ file: f, info: info });
    }
  });
  return { skeletons: skeletons, atlases: atlases, pngs: pngs, fileCount: files.length };
}

/* ---------------- 報告 ---------------- */

function report(r, root) {
  const rel = function (f) { return path.relative(root, f).replace(/\\/g, '/'); };
  console.log('掃描 ' + r.fileCount + ' 個檔');
  console.log('');

  if (!r.skeletons.length) {
    console.log('✗ 找不到 Spine 骨架檔（.json 帶 skeleton.spine，或 .skel）');
  } else {
    const vers = {};
    r.skeletons.forEach(function (s) {
      const v = s.info.version || '(讀不出來)';
      const mm = (v.match(VER_RE) || [])[0];
      const key = mm ? mm.split('.').slice(0, 2).join('.') : v;
      (vers[key] = vers[key] || []).push(s);
    });
    console.log('骨架 ' + r.skeletons.length + ' 份，版本分布：');
    Object.keys(vers).sort().forEach(function (k) {
      console.log('  Spine ' + k + '　' + vers[k].length + ' 份　' +
        (vers[k][0].info.binary ? '（.skel 二進位）' : '（.json）'));
    });
    console.log('');
    r.skeletons.slice(0, 6).forEach(function (s) {
      const i = s.info;
      console.log('  ' + rel(s.file));
      console.log('      版本 ' + (i.version || '?') +
        (i.bones !== null && i.bones !== undefined ? '　骨 ' + i.bones + '　slot ' + i.slots : '') +
        (i.animations && i.animations.length ? '　動畫 ' + i.animations.length + ' 段' : ''));
      if (i.animations && i.animations.length) {
        console.log('      ' + i.animations.slice(0, 8).join('、') +
          (i.animations.length > 8 ? ' …' : ''));
      }
    });
    if (r.skeletons.length > 6) console.log('  …其餘 ' + (r.skeletons.length - 6) + ' 份');
  }

  console.log('');
  if (!r.atlases.length) {
    console.log('✗ 找不到 .atlas');
  } else {
    let totalPages = 0, totalRegions = 0, vram = 0, missing = [];
    r.atlases.forEach(function (a) {
      a.info.pages.forEach(function (p) {
        totalPages++;
        totalRegions += p.regions;
        if (p.size) vram += p.size.w * p.size.h * 4;
        if (!r.pngs[p.file.toLowerCase()]) missing.push(p.file);
      });
    });
    console.log('atlas ' + r.atlases.length + ' 份，共 ' + totalPages + ' 張 page、' +
      totalRegions + ' 個 region');
    console.log('  全部常駐 VRAM 約 ' + (vram / 1048576).toFixed(0) + ' MB' +
      '（page 是整張貼圖，region 數不影響記憶體）');
    if (missing.length) {
      console.log('  ⚠️ 有 ' + missing.length + ' 張 page 的圖檔找不到：' +
        missing.slice(0, 5).join('、') + (missing.length > 5 ? ' …' : ''));
    }
    r.atlases.slice(0, 4).forEach(function (a) {
      console.log('  ' + rel(a.file));
      a.info.pages.forEach(function (p) {
        console.log('      ' + p.file + '　' +
          (p.size ? p.size.w + 'x' + p.size.h : '尺寸未寫') +
          '　' + p.regions + ' region　filter=' + (p.filter || '?'));
      });
    });
  }

  console.log('');
  console.log('─── 這批能不能用 ───');
  const majors = new Set();
  r.skeletons.forEach(function (s) {
    const m = (s.info.version || '').match(VER_RE);
    if (m) majors.add(m[1] + '.' + m[2]);
  });
  if (!majors.size) {
    console.log('  版本讀不出來，沒辦法判斷');
  } else {
    majors.forEach(function (v) {
      if (v === '4.2' || v === '4.3') {
        console.log('  ✓ Spine ' + v + '：官方有 @esotericsoftware/spine-pixi-v8@' + v + '.x，可直接用');
      } else {
        console.log('  ✗ Spine ' + v + '：官方的 spine-pixi-v8 只出 4.2 與 4.3，' +
          '這批要先用編輯器重新匯出成 4.2 或 4.3');
      }
    });
    if (majors.size > 1) {
      console.log('  ⚠️ 這批混了不只一個版本。runtime 一次只能載一個版本，' +
        '混版的話要全部統一到同一版');
    }
  }
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const asJson = argv.indexOf('--json') >= 0;
  const targets = argv.filter(function (a) { return a !== '--json'; });
  if (!targets.length) {
    console.error('用法：node tools/spine/spine-probe.cjs <資料夾或檔案...> [--json]');
    process.exit(2);
  }
  targets.forEach(function (t) {
    if (!fs.existsSync(t)) { console.error('[ERROR] 找不到：' + t); process.exit(2); }
  });
  const r = probe(targets);
  if (asJson) {
    console.log(JSON.stringify({
      skeletons: r.skeletons.map(function (s) { return { file: s.file, info: s.info }; }),
      atlases: r.atlases.map(function (a) { return { file: a.file, pages: a.info.pages, regions: a.info.regions }; })
    }, null, 1));
  } else {
    report(r, fs.statSync(targets[0]).isDirectory() ? targets[0] : path.dirname(targets[0]));
  }
}

module.exports = { probe: probe, parseAtlas: parseAtlas, versionFromJson: versionFromJson, versionFromSkel: versionFromSkel };
