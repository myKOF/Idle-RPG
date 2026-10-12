const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('裝備tips與裝備詳情之寶石鑲孔高度與外框縮短約3px，鑲嵌界面保持不變', () => {
  const css = fs.readFileSync(path.join(root, 'css/ashen-forge.css'), 'utf8');

  // 1. 裝備詳情（唯讀孔位）：縮短高度與 padding，且排除鑲嵌分頁的 .socket-row 與符文孔 .it-runes
  assert.match(
    css,
    /#tab-equip\s+#detail-pane\s+\.it-sockets:not\(\.it-runes\)\s+\.socket:not\(\.socket-row\)\s*\{[\s\S]*padding:\s*1\.5px\s+8px;[\s\S]*line-height:\s*18px;/,
    '裝備詳情之唯讀寶石孔位應設定 padding: 1.5px 8px 與 line-height: 18px'
  );

  // 2. 裝備詳情（唯讀孔位）：行內寶石圖標縮放與垂直對齊微調，適用單顆與融合寶石
  assert.match(
    css,
    /#tab-equip\s+#detail-pane\s+\.it-sockets:not\(\.it-runes\)\s+\.socket:not\(\.socket-row\)\s+:is\(\.gem-ico\.gi-inline,\s*\.gem-ico-fused\.gi-inline\)\s*\{[\s\S]*width:\s*1\.35em;[\s\S]*height:\s*1\.35em;[\s\S]*vertical-align:\s*-0\.32em;/,
    '裝備詳情之行內寶石圖標尺寸應微調為 1.35em 並對齊'
  );

  // 3. 裝備 tips（滑鼠提示浮層）：縮短高度與 padding
  assert.match(
    css,
    /#sk-tooltip\s+\.it-sockets:not\(\.it-runes\)\s+\.socket,\s*\.equip-detail-card\s+\.it-sockets:not\(\.it-runes\)\s+\.socket\s*\{[\s\S]*padding:\s*1px\s+8px;[\s\S]*line-height:\s*18px;/,
    '裝備 tips 之寶石孔位應設定 padding: 1px 8px 與 line-height: 18px'
  );

  // 4. 裝備 tips（滑鼠提示浮層）：行內寶石圖標縮放與垂直對齊微調
  assert.match(
    css,
    /#sk-tooltip\s+\.it-sockets:not\(\.it-runes\)\s+\.socket\s+:is\(\.gem-ico\.gi-inline,\s*\.gem-ico-fused\.gi-inline\),\s*\.equip-detail-card\s+\.it-sockets:not\(\.it-runes\)\s+\.socket\s+:is\(\.gem-ico\.gi-inline,\s*\.gem-ico-fused\.gi-inline\)\s*\{[\s\S]*width:\s*1\.35em;[\s\S]*height:\s*1\.35em;[\s\S]*vertical-align:\s*-0\.32em;/,
    '裝備 tips 之行內寶石圖標尺寸應微調為 1.35em'
  );

  // 5. 寶石鑲嵌介面（操作列按鈕 .socket-row）保持原有 min-height: 30px 與 padding: 4px 8px 不變
  assert.match(
    css,
    /#tab-equip\s+#detail-pane\s+\.it-sockets\s+\.socket\.socket-row\s*\{[\s\S]*min-height:\s*30px;[\s\S]*padding:\s*4px\s+8px;/,
    '鑲嵌界面按鈕行應保持 min-height: 30px 與 padding: 4px 8px'
  );
});

test('空孔文字改為「寶石鑲孔」，操作列鑲嵌頁籤改為「寶石」', () => {
  const itemJs = fs.readFileSync(path.join(root, 'js/item.js'), 'utf8');
  const uiJs = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');

  // 空孔文字格式
  assert.match(itemJs, /text = '◇ 寶石鑲孔 ' \+ \(si \+ 1\) \+ '（空）';/);
  assert.doesNotMatch(itemJs, /text = '◇ 鑲孔 ' \+ \(si \+ 1\) \+ '（空）';/);

  // 卸下按鈕 aria-label
  assert.match(itemJs, /aria-label="卸下寶石鑲孔 ' \+ \(si \+ 1\) \+ ' 的寶石"/);

  // 操作列按鈕文字改為「寶石」
  assert.match(uiJs, /<button class="btn" disabled>寶石<\/button>/);
  assert.match(uiJs, /data-act="toggle-socket" aria-pressed="[^"]*">寶石<\/button>/);
  assert.doesNotMatch(uiJs, /data-act="toggle-socket" aria-pressed="[^"]*">鑲嵌<\/button>/);
});

