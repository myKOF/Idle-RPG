const fs = require('fs');

let content = fs.readFileSync('js/ui.js', 'utf-8');

// Fix normal enemy portrait logic
content = content.replace(
    /var iconClass = m\.isBoss \? 'cb-icon boss' : 'cb-icon monster';\s+var mvImg = \$id\('mv-emoji'\)\.querySelector\('img'\);\s+var targetSrc = 'images\/icon_avatar\.png';\s+if \(!mvImg\) \{[\s\S]*?\} else \{[\s\S]*?\}[\s\S]*?if \(mvImg\.className !== iconClass\) mvImg\.className = iconClass;\s+\}/,
    `    if (m.img && !m.imgFailed) {
      var iconClass = m.isBoss ? 'cb-icon boss' : 'cb-icon monster';
      var mvImg = $id('mv-emoji').querySelector('img');
      var targetSrc = 'images/' + m.img;
      if (!mvImg) {
        $id('mv-emoji').innerHTML = '<img src="' + targetSrc + '" class="' + iconClass + '" data-src="' + targetSrc + '">';
        mvImg = $id('mv-emoji').querySelector('img');
        if (mvImg) mvImg.onerror = function () { m.imgFailed = true; };
      } else {
        if (mvImg.getAttribute('data-src') !== targetSrc) {
          mvImg.setAttribute('data-src', targetSrc);
          mvImg.setAttribute('src', targetSrc);
          mvImg.onerror = function () { m.imgFailed = true; };
        }
        if (mvImg.className !== iconClass) mvImg.className = iconClass;
      }
    } else {
      $id('mv-emoji').innerHTML = '<span style="font-size:48px;">' + (m.emoji || '👾') + '</span>';
    }`
);

// Fix empty enemy portrait logic
content = content.replace(
    /var mvImgEmpty = \$id\('mv-emoji'\)\.querySelector\('img'\);\s+var targetSrcEmpty = 'images\/icon_avatar\.png';\s+if \(!mvImgEmpty\) \{[\s\S]*?\} else \{[\s\S]*?\}[\s\S]*?if \(mvImgEmpty\.className !== 'cb-icon'\) mvImgEmpty\.className = 'cb-icon';\s+\}/,
    `$id('mv-emoji').innerHTML = '<span style="font-size:48px;">🔍</span>';`
);

// Fix leftover empty enemy portrait logic from bad replace
content = content.replace(
    /        mvImgEmpty\.setAttribute\('src', targetSrcEmpty\);\s+mvImgEmpty\.onerror = function \(\) \{ this\.onerror = null; this\.src = 'images\/icon_avatar\.png'; \};\s+\}\s+if \(mvImgEmpty\.className !== 'cb-icon'\) mvImgEmpty\.className = 'cb-icon';\s+\}/,
    `$id('mv-emoji').innerHTML = '<span style="font-size:48px;">🔍</span>';`
);


// Fix boss list left panel logic
content = content.replace(
    /var bossIcon = bd\.img \? 'images\/' \+ bd\.img : 'images\/icon_avatar\.png';\s+h \+= '<div class="tower-floor' \+ \(cleared \? ' cleared' : ''\) \+ \(unlocked \? '' : ' locked'\) \+ '" data-tower-tip="' \+ fl \+ '">' \+\s+'<span class="tf-emoji" style="margin-right:12px;"><img src="' \+ bossIcon \+ '" style="width:32px;height:32px;vertical-align:middle;border-radius:4px;box-shadow:0 0 5px #000;"><\/span>' \+\s+'<span class="tf-name" style="vertical-align:middle;">第 ' \+ fl \+ ' 層・' \+ bd\.name \+ \(cleared \? ' ✅' : ''\) \+ '<\/span>' \+/,
    `      var bossIcon = (bd.img && !bd.imgFailed) ? 'images/' + bd.img : null;
      var bossIdx = (fl - 1) % BOSS_LIST.length;
      var iconHtml = bossIcon
        ? '<img src="' + bossIcon + '" style="width:32px;height:32px;vertical-align:middle;border-radius:4px;box-shadow:0 0 5px #000;" onerror="BOSS_LIST[' + bossIdx + '].imgFailed=true; this.outerHTML=\\'<span style=&quot;font-size:24px;vertical-align:middle;&quot;>\\' + (bd.emoji || \\'👾\\') + \\'</span>\\';">'
        : '<span style="font-size:24px;vertical-align:middle;">' + (bd.emoji || '👾') + '</span>';

      h += '<div class="tower-floor' + (cleared ? ' cleared' : '') + (unlocked ? '' : ' locked') + '" data-tower-tip="' + fl + '">' +
        '<span class="tf-emoji" style="margin-right:12px;">' + iconHtml + '</span>' +
        '<span class="tf-name" style="vertical-align:middle;">第 ' + fl + ' 層・' + bd.name + (cleared ? ' ✅' : '') + '</span>' +`
);

// Fix tower fight portrait logic
content = content.replace(
    /var bossImgSrc = TOWER\.boss\.img \? 'images\/' \+ TOWER\.boss\.img : 'images\/icon_avatar\.png';\s+var tbImg = \$id\('tb-emoji'\)\.querySelector\('img'\);\s+if \(!tbImg\) \{[\s\S]*?\} else \{[\s\S]*?\}[\s\S]*?if \(tbImg\.className !== 'cb-icon boss'\) tbImg\.className = 'cb-icon boss';\s+\}/,
    `if (b.img && !b.imgFailed) {
    var bossImgSrc = 'images/' + b.img;
    var tbImg = $id('tb-emoji').querySelector('img');
    if (!tbImg) {
      $id('tb-emoji').innerHTML = '<img src="' + bossImgSrc + '" class="cb-icon boss" data-src="' + bossImgSrc + '">';
      tbImg = $id('tb-emoji').querySelector('img');
      if (tbImg) tbImg.onerror = function () { b.imgFailed = true; };
    } else {
      if (tbImg.getAttribute('data-src') !== bossImgSrc) {
        tbImg.setAttribute('data-src', bossImgSrc);
        tbImg.setAttribute('src', bossImgSrc);
        tbImg.onerror = function () { b.imgFailed = true; };
      }
      if (tbImg.className !== 'cb-icon boss') tbImg.className = 'cb-icon boss';
    }
  } else {
    $id('tb-emoji').innerHTML = '<span style="font-size:48px;">' + (b.emoji || '👾') + '</span>';
  }`
);

fs.writeFileSync('js/ui.js', content, 'utf-8');
console.log("ui.js updated via node script");
