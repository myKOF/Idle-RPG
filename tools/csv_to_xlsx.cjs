'use strict';
/* =============================================================================
   csv_to_xlsx.cjs — 將 config/CSV/game_parameters.csv 轉成 config/Excel/game_parameters.xlsx
   -----------------------------------------------------------------------------
   用途：當修改 CSV 後，將最新數值與新增列同步更新回 Excel (.xlsx) 主檔。
   特點：純 Node（內建 zlib），不需第三方套件，生成標準 2 頁 OpenXML XLSX。
   ============================================================================= */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
/* 預設轉主參數表；帶一個表名參數就轉同名的那張（例如 Zone_Stage_Waves）：
     node tools/csv_to_xlsx.cjs                    → game_parameters
     node tools/csv_to_xlsx.cjs Zone_Stage_Waves   → Zone_Stage_Waves */
const TABLE_NAME = (process.argv[2] || 'game_parameters').replace(/\.(csv|xlsx)$/i, '');
const CSV_PATH = path.join(ROOT, 'config', 'CSV', TABLE_NAME + '.csv');
const XLSX_PATH = path.join(ROOT, 'config', 'Excel', TABLE_NAME + '.xlsx');

function parseCSV(text) {
  const rows = [];
  let cur = [];
  let field = '';
  let inQuotes = false;
  
  // 移除 BOM
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        cur.push(field);
        field = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && i + 1 < text.length && text[i + 1] === '\n') i++;
        cur.push(field);
        if (cur.length > 1 || cur[0] !== '') rows.push(cur);
        cur = [];
        field = '';
      } else {
        field += ch;
      }
    }
  }
  if (field !== '' || cur.length > 0) {
    cur.push(field);
    if (cur.length > 1 || cur[0] !== '') rows.push(cur);
  }
  return rows;
}

function colName(colIdx) {
  let s = '';
  let n = colIdx;
  while (n >= 0) {
    s = String.fromCharCode((n % 26) + 65) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

function encodeXml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildXlsx(rows) {
  const sharedStrings = [];
  const stringMap = new Map();

  function getSharedStringIndex(val) {
    if (stringMap.has(val)) return stringMap.get(val);
    const idx = sharedStrings.length;
    sharedStrings.push(val);
    stringMap.set(val, idx);
    return idx;
  }

  function renderSheetXml() {
    let xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    xml += '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ';
    xml += 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">\n';
    xml += '  <sheetData>\n';

    rows.forEach((row, rIdx) => {
      const rowNum = rIdx + 1;
      xml += '    <row r="' + rowNum + '">\n';
      row.forEach((val, cIdx) => {
        const ref = colName(cIdx) + rowNum;
        val = String(val === undefined ? '' : val);
        const isNum = val !== '' && !isNaN(Number(val)) && !/^\s+$/.test(val) && !/^0\d+/.test(val) && val !== 'NaN';

        if (isNum) {
          xml += '      <c r="' + ref + '"><v>' + encodeXml(val) + '</v></c>\n';
        } else {
          const sIdx = getSharedStringIndex(val);
          xml += '      <c r="' + ref + '" t="s"><v>' + sIdx + '</v></c>\n';
        }
      });
      xml += '    </row>\n';
    });

    xml += '  </sheetData>\n';
    xml += '</worksheet>';
    return xml;
  }

  const sheet1Xml = renderSheetXml();
  const sheet2Xml = sheet1Xml;

  // sharedStrings.xml
  let ssXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  ssXml += '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ';
  ssXml += 'count="' + sharedStrings.length + '" uniqueCount="' + sharedStrings.length + '">\n';
  sharedStrings.forEach(str => {
    ssXml += '  <si><t xml:space="preserve">' + encodeXml(str) + '</t></si>\n';
  });
  ssXml += '</sst>';

  // [Content_Types].xml
  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

  // _rels/.rels
  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  // xl/workbook.xml
  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="${TABLE_NAME}" sheetId="1" r:id="rId1"/>
    <sheet name="計算表" sheetId="2" r:id="rId2"/>
  </sheets>
</workbook>`;

  // xl/_rels/workbook.xml.rels
  const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  // xl/styles.xml
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
  <fills count="2"><fill><patternFill fillType="none"/></fill><fill><patternFill fillType="gray125"/></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>
</styleSheet>`;

  const files = [
    { name: '[Content_Types].xml', data: contentTypesXml },
    { name: '_rels/.rels', data: relsXml },
    { name: 'xl/workbook.xml', data: workbookXml },
    { name: 'xl/_rels/workbook.xml.rels', data: workbookRelsXml },
    { name: 'xl/styles.xml', data: stylesXml },
    { name: 'xl/sharedStrings.xml', data: ssXml },
    { name: 'xl/worksheets/sheet1.xml', data: sheet1Xml },
    { name: 'xl/worksheets/sheet2.xml', data: sheet2Xml }
  ];

  return createZip(files);
}

function createZip(files) {
  const fileBuffers = [];
  const cdEntries = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, 'utf8');
    const dataBuf = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data, 'utf8');
    const compBuf = zlib.deflateRawSync(dataBuf);
    const crc = zlib.crc32 ? zlib.crc32(dataBuf) : 0;

    const lfh = Buffer.alloc(30 + nameBuf.length);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt16LE(0, 6);
    lfh.writeUInt16LE(8, 8);
    lfh.writeUInt16LE(0, 10);
    lfh.writeUInt16LE(0, 12);
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(compBuf.length, 18);
    lfh.writeUInt32LE(dataBuf.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(0, 28);
    nameBuf.copy(lfh, 30);

    fileBuffers.push(lfh, compBuf);

    const cdh = Buffer.alloc(46 + nameBuf.length);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(20, 4);
    cdh.writeUInt16LE(20, 6);
    cdh.writeUInt16LE(0, 8);
    cdh.writeUInt16LE(8, 10);
    cdh.writeUInt16LE(0, 12);
    cdh.writeUInt16LE(0, 14);
    cdh.writeUInt32LE(crc, 16);
    cdh.writeUInt32LE(compBuf.length, 20);
    cdh.writeUInt32LE(dataBuf.length, 24);
    cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt16LE(0, 30);
    cdh.writeUInt16LE(0, 32);
    cdh.writeUInt16LE(0, 34);
    cdh.writeUInt16LE(0, 36);
    cdh.writeUInt32LE(0, 38);
    cdh.writeUInt32LE(offset, 42);
    nameBuf.copy(cdh, 46);

    cdEntries.push(cdh);
    offset += lfh.length + compBuf.length;
  }

  const cdOffset = offset;
  let cdSize = 0;
  for (const cdh of cdEntries) {
    fileBuffers.push(cdh);
    cdSize += cdh.length;
  }

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(cdEntries.length, 8);
  eocd.writeUInt16LE(cdEntries.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20);

  fileBuffers.push(eocd);
  return Buffer.concat(fileBuffers);
}

function main() {
  const text = fs.readFileSync(CSV_PATH, 'utf8');
  const rows = parseCSV(text);
  const zipBuf = buildXlsx(rows);
  try {
    fs.writeFileSync(XLSX_PATH, zipBuf);
    console.log('✅ [csv_to_xlsx] 成功將 ' + rows.length + ' 列資料轉寫至 ' + path.relative(ROOT, XLSX_PATH));
  } catch (err) {
    if (err.code === 'EBUSY' || err.code === 'EPERM') {
      const tempPath = path.join(ROOT, 'config', 'Excel', TABLE_NAME + '_updated.xlsx');
      fs.writeFileSync(tempPath, zipBuf);
      console.log('⚠️ [csv_to_xlsx] 檢測到 ' + TABLE_NAME + '.xlsx 正被 Excel 開啟鎖定中！');
      console.log('  最新擴充好的 ' + rows.length + ' 列資料已先轉寫至：' + path.relative(ROOT, tempPath));
      console.log('  請在 Excel 關閉後，將該檔案替換/儲存為 ' + TABLE_NAME + '.xlsx。');
    } else {
      throw err;
    }
  }
}

main();
