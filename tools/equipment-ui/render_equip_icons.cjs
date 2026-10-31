/* 以 Chrome headless 把 images/equip/*.svg 轉成透明底 PNG（512x512），並移除 SVG 中繼檔。
   用法：node tools/equipment-ui/render_equip_icons.cjs [--keep-svg] */
const fs = require('fs'), path = require('path'), cp = require('child_process');
const DIR = path.join(__dirname, '..', '..', 'images', 'equip');
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
if (!chrome) throw new Error('找不到 Chrome/Edge');
const keep = process.argv.includes('--keep-svg');
for (const f of fs.readdirSync(DIR).filter(n => n.endsWith('.svg'))) {
  const base = f.replace(/\.svg$/, '');
  const html = path.join(DIR, '_r.html');
  fs.writeFileSync(html, `<!doctype html><body style="margin:0;background:transparent"><img src="${f}" width="512" height="512" style="display:block">`);
  cp.execFileSync(chrome, ['--headless', '--disable-gpu', '--hide-scrollbars', '--default-background-color=00000000', '--allow-file-access-from-files',
    `--screenshot=${path.join(DIR, base + '.png')}`, '--window-size=512,512', 'file:///' + html.split(path.sep).join('/')], { stdio: 'ignore' });
  if (!keep) fs.unlinkSync(path.join(DIR, f));
}
for (const f of ['_r.html', '_names.json']) { try { fs.unlinkSync(path.join(DIR, f)); } catch (e) {} }
