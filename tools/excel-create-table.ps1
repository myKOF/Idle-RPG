param([Parameter(Mandatory=$true)][string]$DataPath,[Parameter(Mandatory=$true)][string]$WorkbookPath)
$ErrorActionPreference='Stop'
<# 以 Excel 原生 API 建立一份「新」的參數表 xlsx（AI_RULES 8.5：禁止手工拼接 xlsx 內部 XML）。
   與 excel-update-sheets.ps1（更新既有表）的分工：本腳本只負責初次建立，目標檔已存在就拒絕，不覆蓋。
   做法：Excel 新增活頁簿 → 逐表寫入（全部儲存格存成文字，與其他參數表一致）→ 第一張表加表頭樣式、欄寬、凍結窗格與篩選 →
   存檔後「正常模式」重開逐格驗證兩次（不使用修復／擷取資料模式）才放到目標位置。
   DataPath 的 JSON：{ sheets: [ { name, rows: [[...]], widths?: [欄寬...], table?: true } ] }
     table=true（第一張表預設）：第 1 列為表頭＋凍結窗格＋自動篩選；其餘表（說明頁）整頁自動換行。 #>
$target=[IO.Path]::GetFullPath($WorkbookPath)
if(Test-Path -LiteralPath $target){throw "目標已存在，本腳本只建立新檔、不覆蓋：$target"}
$tempBook=Join-Path ([IO.Path]::GetTempPath()) ('excel-create-'+[guid]::NewGuid().ToString()+'.xlsx')
$data=Get-Content -LiteralPath $DataPath -Raw -Encoding UTF8 | ConvertFrom-Json
function Want($rows,$r,$c){ if($c -lt $rows[$r].Count){ return [string]$rows[$r][$c] } return '' }
function Verify($book,$data){
 foreach($sheet in $data.sheets){
  $ws=$book.Worksheets.Item([string]$sheet.name)
  $rows=$sheet.rows;$rowCount=$rows.Count;$colCount=($rows|ForEach-Object{$_.Count}|Measure-Object -Maximum).Maximum
  $used=$ws.UsedRange
  $lastRow=[Math]::Max($rowCount,$used.Row+$used.Rows.Count-1);$lastCol=[Math]::Max($colCount,$used.Column+$used.Columns.Count-1)
  $got=$ws.Range($ws.Cells.Item(1,1),$ws.Cells.Item($lastRow,$lastCol)).Value2
  for($r=0;$r -lt $lastRow;$r++){for($c=0;$c -lt $lastCol;$c++){
   $want=if($r -lt $rowCount){Want $rows $r $c}else{''}
   if([string]$got[($r+1),($c+1)] -cne $want){throw "Excel 重開資料不符：$($sheet.name) R$($r+1)C$($c+1)"}
  }}
 }
}
$excel=$null;$book=$null
try {
 $excel=New-Object -ComObject Excel.Application
 $excel.Visible=$false;$excel.DisplayAlerts=$false;$excel.EnableEvents=$false;$excel.AutomationSecurity=3
 $book=$excel.Workbooks.Add(-4167)   # xlWBATWorksheet：只含一張空白工作表
 $first=$true;$index=0
 foreach($sheet in $data.sheets){
  if($first){$ws=$book.Worksheets.Item(1);$first=$false}
  else{$ws=$book.Worksheets.Add([Type]::Missing,$book.Worksheets.Item($book.Worksheets.Count))}
  $ws.Name=[string]$sheet.name
  $rows=$sheet.rows;$rowCount=$rows.Count;$colCount=($rows|ForEach-Object{$_.Count}|Measure-Object -Maximum).Maximum
  $values=New-Object 'object[,]' ([int]$rowCount),([int]$colCount)
  for($r=0;$r -lt $rowCount;$r++){for($c=0;$c -lt $rows[$r].Count;$c++){$values[$r,$c]=[string]$rows[$r][$c]}}
  $range=$ws.Range($ws.Cells.Item(1,1),$ws.Cells.Item($rowCount,$colCount))
  $range.NumberFormat='@';$range.Value2=$values
  $isTable=($index -eq 0) -or ($sheet.table -eq $true)
  if($isTable){
   $ws.Rows.Item(1).Font.Bold=$true;$ws.Rows.Item(1).WrapText=$true
   for($c=1;$c -le $colCount;$c++){
    $w=14;if($sheet.widths -and $c -le $sheet.widths.Count){$w=[double]$sheet.widths[$c-1]}
    $ws.Columns.Item($c).ColumnWidth=$w
   }
   $range.VerticalAlignment=-4160   # xlTop
   $range.AutoFilter() | Out-Null
   $ws.Activate();$excel.ActiveWindow.FreezePanes=$false;$ws.Cells.Item(2,4).Select()|Out-Null;$excel.ActiveWindow.FreezePanes=$true
  }else{
   $ws.Columns.Item(1).ColumnWidth=125;$range.WrapText=$true;$range.Rows.AutoFit()|Out-Null
  }
  $index++
 }
 $book.Worksheets.Item(1).Activate()
 $book.SaveAs($tempBook,51);$book.Close($false);$book=$null
 # 正常模式重開（CorruptLoad=0）驗證；再存一次、再重開一次，確認內容不漂移。
 $book=$excel.Workbooks.Open($tempBook,0,$true);Verify $book $data;$book.Close($false);$book=$null
 $book=$excel.Workbooks.Open($tempBook,0,$false);$book.Save();$book.Close($false)
 $book=$excel.Workbooks.Open($tempBook,0,$true);Verify $book $data;$book.Close($false);$book=$null
 if(Test-Path -LiteralPath $target){throw "目標在過程中出現，停止：$target"}
 [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target))|Out-Null
 Copy-Item -LiteralPath $tempBook -Destination $target
 Write-Output "Excel 正常重開驗證通過（兩次）：已建立 $target"
}finally{
 if($book){$book.Close($false)}
 if($excel){$excel.Quit();[Runtime.InteropServices.Marshal]::ReleaseComObject($excel)|Out-Null}
 if(Test-Path -LiteralPath $tempBook){Remove-Item -LiteralPath $tempBook}
}
