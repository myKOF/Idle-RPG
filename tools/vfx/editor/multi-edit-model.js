'use strict';
/* ============================================================
   multi-edit-model.js — Inspector 多選批次編輯的純資料運算

   多選時的 Inspector 不是另一個面板：它與單選共用同一份欄位程式，差別只在
   「要寫幾層」。另外做一個批次編輯面板的話，每加一種欄位都要記得兩邊一起加，
   漏掉的那一邊不會報錯，只會變成「多選時改了沒反應」。

   這裡回答那份欄位程式需要的幾個問題，全部不碰 DOM：

     targetLayerIds   選取（圖層 key ＋ 群組 key）實際對應到哪些圖層
     sharedFields     這些圖層共同擁有哪些欄位（型別不同時取交集）
     commonValue      某個欄位在這些圖層上是不是同一個值
     writeAll         同一個值寫進每一層，各給一份複本
     captureField／restoreField
                      「把輸入框清空＝不改了」要放回去的原值

   **各層不同時一律回報 mixed，不挑任何一層的值出來。** 挑出來的數字看起來就像
   共同值：使用者只是想改 alpha，順手點進 scale 再離開，全部圖層就可能被寫成
   那一層的 scale——而且畫面上完全沒有跡象。
   ============================================================ */

(function (root, factory) {
  /* 選取 key 的格式與群組查找只有 layer-model 一份實作，這裡不另寫。 */
  var layerModel = (typeof module !== 'undefined' && module.exports)
    ? require('./layer-model.js')
    : root.VFXLayerModel;
  var api = factory(layerModel);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VFXMultiEditModel = api;
})(typeof self !== 'undefined' ? self : this, function (M) {

  /* ---------------- 選取 → 圖層 ---------------- */

  /* 群組 key 展開成成員：群組在 preset 裡不存在，它沒有自己的 alpha 或 scale，
     「改這個群組的參數」只能是改成員的參數。

     回傳順序跟 preset.layers 一致，與點選順序無關——同一組選取不管是怎麼點出來的，
     寫入順序都一樣；重複的 id 也只出現一次。 */
  function targetLayerIds(preset, layout, selectedKeys) {
    var wanted = Object.create(null);
    (selectedKeys || []).forEach(function (key) {
      var kind = M.keyKind(key);
      var id = M.keyId(key);
      if (kind === 'layer') { wanted[id] = true; return; }
      if (kind !== 'group') return;
      var group = M.groupById(layout, id);
      if (group) group.layerIds.forEach(function (lid) { wanted[lid] = true; });
    });
    return ((preset && preset.layers) || [])
      .filter(function (l) { return wanted[l.id] === true; })
      .map(function (l) { return l.id; });
  }

  /* ---------------- 比較 ---------------- */

  /* 比較用的正規化字串：物件鍵排序，值是 undefined 的鍵略過（與 JSON 相同）。
     {x:1,y:2} 與 {y:2,x:1} 是同一個值——Inspector 補欄位時建物件的順序
     不一定與檔案裡相同，逐字比對會把它們誤判成「各層不同」。 */
  function canonical(v) {
    if (v === undefined) return 'undefined';
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
    return '{' + Object.keys(v).sort()
      .filter(function (k) { return v[k] !== undefined; })
      .map(function (k) { return JSON.stringify(k) + ':' + canonical(v[k]); })
      .join(',') + '}';
  }

  /* 回傳 { mixed, value }。read 決定「值」是什麼——例如 enabled 沒寫就是 true，
     要先換算成 true 再比，否則沒寫的一層與寫了 true 的一層會被當成不同。
     mixed 時 value 一律是 undefined。 */
  function commonValue(layers, read) {
    var list = layers || [];
    if (!list.length) return { mixed: false, value: undefined };
    var first = read(list[0]);
    var key = canonical(first);
    for (var i = 1; i < list.length; i++) {
      if (canonical(read(list[i])) !== key) return { mixed: true, value: undefined };
    }
    return { mixed: false, value: first };
  }

  /* 全部符合 → true、全部不符合 → false、混著 → null。
     區塊層級的判斷用：分軸縮放曲線只有「全部都是 sprite／procedural」時畫得出來。 */
  function allOrNone(layers, predicate) {
    var list = layers || [];
    var n = list.filter(predicate).length;
    if (n === list.length) return true;
    return n === 0 ? false : null;
  }

  /* ---------------- 欄位 ---------------- */

  /* 欄位清單的交集（以 key 比對），順序沿用第一份。
     sprite 與 procedural 一起選時，共同的型別欄位只剩 outerScale；再混進 particle
     就一個都沒有。顯示一格只有部分圖層吃得到的欄位，填了之後另一半沒反應，
     比不顯示更糟。 */
  function sharedFields(lists) {
    if (!lists || !lists.length) return [];
    return lists[0].filter(function (f) {
      return lists.every(function (list) {
        return list.some(function (g) { return g.key === f.key; });
      });
    });
  }

  /* ---------------- 寫入與還原 ---------------- */

  function cloneValue(v) {
    return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  }

  /* 同一個值寫進每一層，各給一份複本。共用同一個陣列或物件的話，之後單獨改其中
     一層（例如拖它的曲線）會連帶改到其他層——畫面上看不出來，存檔後才發現。

     undefined＝移除欄位，要 delete 而不是寫 undefined：canonical 比對與存檔的
     未知欄位檢查看的是實際的鍵。 */
  function writeAll(layers, key, value) {
    (layers || []).forEach(function (l) {
      if (value === undefined) delete l[key];
      else l[key] = cloneValue(value);
    });
  }

  /* 每一層各記一份原值，連「本來就沒有這個欄位」也要記：還原時沒有的要刪掉，
     不能變成一個寫著預設值的欄位——那會讓 preset 多出原本沒有的鍵、dirty 亮起來。 */
  function captureField(layers, key) {
    return (layers || []).map(function (l) {
      return Object.prototype.hasOwnProperty.call(l, key)
        ? { has: true, value: cloneValue(l[key]) }
        : { has: false };
    });
  }

  function restoreField(layers, key, captured) {
    (layers || []).forEach(function (l, i) {
      var c = captured && captured[i];
      if (!c) return;
      if (c.has) l[key] = cloneValue(c.value);
      else delete l[key];
    });
  }

  return {
    targetLayerIds: targetLayerIds,
    canonical: canonical,
    commonValue: commonValue,
    allOrNone: allOrNone,
    sharedFields: sharedFields,
    cloneValue: cloneValue,
    writeAll: writeAll,
    captureField: captureField,
    restoreField: restoreField
  };
});
