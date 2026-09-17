param([Parameter(Mandatory=$true)][string]$DataPath,[Parameter(Mandatory=$true)][string]$WorkbookPath,[switch]$RemoveBlankArtifacts)
$ErrorActionPreference='Stop'
# 使用Excel原生API；先編輯副本，正常模式重開驗證後才替換來源。禁止XML手工修補。
$target=[IO.Path]::GetFullPath($WorkbookPath)
$sourceHash=(Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
$tempBook=Join-Path ([IO.Path]::GetTempPath()) ('skills2-geometry-'+[guid]::NewGuid().ToString()+'.xlsx')
Copy-Item -LiteralPath $target -Destination $tempBook
$data=Get-Content -LiteralPath $DataPath -Raw -Encoding UTF8 | ConvertFrom-Json
$excel=$null;$book=$null
try {
 $excel=New-Object -ComObject Excel.Application
 $excel.Visible=$false;$excel.DisplayAlerts=$false;$excel.EnableEvents=$false;$excel.AutomationSecurity=3
 $book=$excel.Workbooks.Open($tempBook,0,$false)
 if($RemoveBlankArtifacts){
  # 舊隱藏物件無法由Shapes索引，DrawingObjects.Delete後仍會再生。
  # 透過Excel API複製儲存格至乾淨工作簿，不複製損壞繪圖容器。
  foreach($ws in $book.Worksheets){foreach($shape in $ws.Shapes){
   if($shape.Name -notmatch '^(AutoShape 2|Text Box 2)$' -or [string]$shape.TextFrame2.TextRange.Text -ne ''){throw '存在非空白繪圖物件，停止清理'}
  }}
  $excel.CopyObjectsWithCells=$false
  $clean=$excel.Workbooks.Add(-4167)
  $first=$true
  foreach($src in $book.Worksheets){
   if($first){$dst=$clean.Worksheets.Item(1);$first=$false}else{$dst=$clean.Worksheets.Add([Type]::Missing,$clean.Worksheets.Item($clean.Worksheets.Count))}
   $dst.Name=$src.Name
   $src.UsedRange.Copy($dst.Range('A1')) | Out-Null
   if($dst.Shapes.Count -ne 0){throw '儲存格複製意外帶入繪圖物件，停止'}
  }
  $book.Close($false);$book=$clean
  $book.SaveAs($tempBook,51)
 }
 $shapeCount=0;foreach($ws in $book.Worksheets){$shapeCount+=$ws.Shapes.Count}
 foreach($sheet in $data.sheets){
  $ws=$book.Worksheets.Item([string]$sheet.name)
  $rowCount=$sheet.rows.Count;$colCount=($sheet.rows|ForEach-Object{$_.Count}|Measure-Object -Maximum).Maximum
  $values=New-Object 'object[,]' ([int]$rowCount),([int]$colCount)
  for($r=0;$r -lt $rowCount;$r++){for($c=0;$c -lt $sheet.rows[$r].Count;$c++){$values[$r,$c]=[string]$sheet.rows[$r][$c]}}
  $ws.UsedRange.ClearContents() | Out-Null
  $range=$ws.Range($ws.Cells.Item(1,1),$ws.Cells.Item($rowCount,$colCount))
  $range.NumberFormat='@';$range.Value2=$values
  if($sheet.name -eq 'Skills2'){
   $ws.Rows.Item(1).WrapText=$true;$ws.Rows.Item(1).RowHeight=54
   $ws.Rows.Item(1).Font.Bold=$true
   for($c=1;$c -le $colCount;$c++){
    $label=[string]$sheet.rows[0][$c-1];$width=18
    if($label -match '說明|模板|JSON'){$width=48}
    if($label -match '特效|子彈'){$width=28}
    $ws.Columns.Item($c).ColumnWidth=$width
   }
   if($ws.AutoFilterMode){$ws.AutoFilterMode=$false}
   $range.AutoFilter() | Out-Null
   $ws.Activate();$excel.ActiveWindow.FreezePanes=$false;$ws.Cells.Item(2,4).Select()|Out-Null;$excel.ActiveWindow.FreezePanes=$true
  }else{$ws.Columns.Item(1).ColumnWidth=125;$ws.UsedRange.WrapText=$true;$ws.UsedRange.Rows.AutoFit()|Out-Null}
 }
 $book.Worksheets.Item('Skills2').Activate();$book.Save();$book.Close($false);$book=$null
 # CorruptLoad=0（預設正常開啟），不使用修復／擷取資料模式。
 $book=$excel.Workbooks.Open($tempBook,0,$true)
 $verifiedShapes=0;foreach($ws in $book.Worksheets){$verifiedShapes+=$ws.Shapes.Count}
 if($verifiedShapes -ne $shapeCount){throw '繪圖物件數量改變，保留原檔'}
 foreach($sheet in $data.sheets){
  $ws=$book.Worksheets.Item([string]$sheet.name)
  $got=$ws.UsedRange.Value2
  for($r=0;$r -lt $sheet.rows.Count;$r++){for($c=0;$c -lt $sheet.rows[$r].Count;$c++){
   if([string]$got[($r+1),($c+1)] -cne [string]$sheet.rows[$r][$c]){throw "Excel重開資料不符：$($sheet.name) R$($r+1)C$($c+1)"}
  }}
 }
 $book.Close($false);$book=$null
 # 再儲存、再正常重開一次，確認空白圖形不會隨存檔增加。
 $book=$excel.Workbooks.Open($tempBook,0,$false)
 $book.Save();$book.Close($false);$book=$excel.Workbooks.Open($tempBook,0,$true)
 $repeatedShapes=0;foreach($ws in $book.Worksheets){$repeatedShapes+=$ws.Shapes.Count}
 if($repeatedShapes -ne $shapeCount){throw '再次儲存後繪圖物件數量改變，保留原檔'}
 $book.Close($false);$book=$null
 if((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $sourceHash){throw '來源Excel已被修改，停止覆蓋'}
 Copy-Item -LiteralPath $tempBook -Destination $target -Force
 Write-Output "Excel正常重開驗證通過；所有儲存格一致，繪圖物件 $shapeCount 個保留。"
}finally{
 if($book){$book.Close($false)}
 if($excel){$excel.Quit();[Runtime.InteropServices.Marshal]::ReleaseComObject($excel)|Out-Null}
 # 僅清除本次明確建立的暫存工作簿。
 if(Test-Path -LiteralPath $tempBook){Remove-Item -LiteralPath $tempBook}
}
