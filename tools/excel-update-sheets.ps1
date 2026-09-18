param([Parameter(Mandatory=$true)][string]$DataPath,[Parameter(Mandatory=$true)][string]$WorkbookPath)
$ErrorActionPreference='Stop'
<# 以 Excel 原生 API 更新參數表（AI_RULES 8.5：禁止手工拼接／替換 xlsx 內部 XML）。
   與 tools/write-skills2-excel.ps1 的差別：不清空重寫整張表，只做兩件事——
     1. insertColumns：用 Excel 的插入整欄，在指定欄之前插入新欄（格式、篩選範圍、凍結窗格由 Excel 自己調整）
     2. 逐格比對 rows（插入後的完整目標內容），只寫入與目標不同的儲存格（寫成文字）
   說明頁（replace=true）整頁換成新內容。
   先改暫存副本，正常模式重開逐格驗證、繪圖物件數不變、再存一次重開仍不變，才覆蓋來源；
   來源 hash 在過程中被改動（使用者剛存檔）就停止，不覆蓋。
   DataPath 的 JSON：{ sheets: [ { name, rows: [[...]], insertColumns?: [{ before, headers: [...], width }], replace?: true } ] } #>
$target=[IO.Path]::GetFullPath($WorkbookPath)
$sourceHash=(Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
$tempBook=Join-Path ([IO.Path]::GetTempPath()) ('excel-update-'+[guid]::NewGuid().ToString()+[IO.Path]::GetExtension($target))
Copy-Item -LiteralPath $target -Destination $tempBook
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
$excel=$null;$book=$null;$written=0
try {
 $excel=New-Object -ComObject Excel.Application
 $excel.Visible=$false;$excel.DisplayAlerts=$false;$excel.EnableEvents=$false;$excel.AutomationSecurity=3
 $book=$excel.Workbooks.Open($tempBook,0,$false)
 $shapeCount=0;foreach($ws in $book.Worksheets){$shapeCount+=$ws.Shapes.Count}
 foreach($sheet in $data.sheets){
  $ws=$book.Worksheets.Item([string]$sheet.name)
  $rows=$sheet.rows;$rowCount=$rows.Count;$colCount=($rows|ForEach-Object{$_.Count}|Measure-Object -Maximum).Maximum
  if($sheet.replace){
   $ws.UsedRange.ClearContents() | Out-Null
   # 逐格寫入（說明頁只有一欄、百來列）。不用整塊陣列指定：PowerShell 的 COM 轉接器在同一個行程裡
   # 寫過單格字串後會把 Value2 當成字串屬性快取，之後指定二維陣列會丟 InvalidCastException。
   for($r=0;$r -lt $rowCount;$r++){for($c=0;$c -lt $colCount;$c++){
    $cell=$ws.Cells.Item($r+1,$c+1);$cell.NumberFormat='@';$cell.Value2=(Want $rows $r $c)
   }}
   $range=$ws.Range($ws.Cells.Item(1,1),$ws.Cells.Item($rowCount,$colCount))
   $ws.Columns.Item(1).ColumnWidth=125;$range.WrapText=$true;$range.Rows.AutoFit()|Out-Null
   continue
  }
  foreach($ins in @($sheet.insertColumns)){
   if(-not $ins){continue}
   $lastCol=$ws.UsedRange.Column+$ws.UsedRange.Columns.Count-1
   $at=0;$exists=$false
   for($c=1;$c -le $lastCol;$c++){
    $h=[string]$ws.Cells.Item(1,$c).Value2
    if($h -eq [string]$ins.before -and $at -eq 0){$at=$c}
    if($h -eq [string]$ins.headers[0]){$exists=$true}
   }
   if($exists){continue}   # 已經插過（重跑）
   if($at -eq 0){throw "找不到插入位置「$($ins.before)」"}
   for($k=0;$k -lt $ins.headers.Count;$k++){
    # xlShiftToRight／xlFormatFromRightOrBelow：新欄沿用右邊那一欄的格式，不複製左邊的下拉驗證
    $ws.Columns.Item($at).Insert(-4161,1) | Out-Null
   }
   for($k=0;$k -lt $ins.headers.Count;$k++){
    $col=$ws.Columns.Item($at+$k)
    $col.Validation.Delete()
    $col.NumberFormat='@'
    if($ins.width){$col.ColumnWidth=[double]$ins.width}
   }
  }
  foreach($label in @($sheet.clearValidationColumns)){
   if(-not $label){continue}
   $idx=[Array]::IndexOf([object[]]$rows[0],[string]$label)
   if($idx -lt 0){throw "找不到清除舊驗證的欄位「$label」"}
   $ws.Columns.Item($idx+1).Validation.Delete()
  }
  $got=$ws.Range($ws.Cells.Item(1,1),$ws.Cells.Item($rowCount,$colCount)).Value2
  for($r=0;$r -lt $rowCount;$r++){for($c=0;$c -lt $colCount;$c++){
   $want=Want $rows $r $c
   if([string]$got[($r+1),($c+1)] -cne $want){
    $cell=$ws.Cells.Item($r+1,$c+1);$cell.NumberFormat='@';$cell.Value2=$want;$written++
   }
  }}
 }
 $book.Save();$book.Close($false);$book=$null
 # CorruptLoad=0（預設正常開啟），不使用修復／擷取資料模式。
 $book=$excel.Workbooks.Open($tempBook,0,$true)
 $verifiedShapes=0;foreach($ws in $book.Worksheets){$verifiedShapes+=$ws.Shapes.Count}
 if($verifiedShapes -ne $shapeCount){throw '繪圖物件數量改變，保留原檔'}
 Verify $book $data
 $book.Close($false);$book=$null
 # 再儲存、再正常重開一次，確認存檔不會讓內容或物件漂移。
 $book=$excel.Workbooks.Open($tempBook,0,$false);$book.Save();$book.Close($false)
 $book=$excel.Workbooks.Open($tempBook,0,$true)
 $repeatedShapes=0;foreach($ws in $book.Worksheets){$repeatedShapes+=$ws.Shapes.Count}
 if($repeatedShapes -ne $shapeCount){throw '再次儲存後繪圖物件數量改變，保留原檔'}
 Verify $book $data
 $book.Close($false);$book=$null
 if((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $sourceHash){throw '來源 Excel 已被修改（可能剛被存檔），停止覆蓋'}
 Copy-Item -LiteralPath $tempBook -Destination $target -Force
 Write-Output "Excel 正常重開驗證通過：寫入 $written 格，所有儲存格一致，繪圖物件 $shapeCount 個保留。"
}finally{
 if($book){$book.Close($false)}
 if($excel){$excel.Quit();[Runtime.InteropServices.Marshal]::ReleaseComObject($excel)|Out-Null}
 if(Test-Path -LiteralPath $tempBook){Remove-Item -LiteralPath $tempBook}
}
