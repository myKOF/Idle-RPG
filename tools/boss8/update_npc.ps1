param([Parameter(Mandatory=$true)][string]$DataPath,[Parameter(Mandatory=$true)][string]$WorkbookPath)
$ErrorActionPreference='Stop'
$target=[IO.Path]::GetFullPath($WorkbookPath)
if(Test-Path -LiteralPath (Join-Path (Split-Path $target) '~$NPC.xlsx')){throw 'NPC.xlsx is open; save and close it before editing.'}
$lock=[IO.File]::Open($target,'Open','ReadWrite','None');$lock.Dispose()
$hash=(Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
$temp=Join-Path ([IO.Path]::GetTempPath()) ('boss8-npc-'+[guid]::NewGuid()+'.xlsx')
Copy-Item -LiteralPath $target -Destination $temp
$data=Get-Content -LiteralPath $DataPath -Raw -Encoding UTF8|ConvertFrom-Json
$excel=$null;$book=$null
try {
 $excel=New-Object -ComObject Excel.Application
 $excel.Visible=$false;$excel.DisplayAlerts=$false;$excel.EnableEvents=$false;$excel.AutomationSecurity=3
 $book=$excel.Workbooks.Open($temp,0,$false)
 $sheet=$book.Worksheets.Item('NPC')
 $shapes=0;foreach($ws in $book.Worksheets){$shapes+=$ws.Shapes.Count}
 $formats=@{}
 foreach($change in $data.changes){
  $cell=$sheet.Range([string]$change.address)
  if([string]$cell.Value2 -cne [string]$change.before){throw "Source cell changed: $($change.address)"}
  $formats[$change.address]=[string]$cell.NumberFormat
  $cell.Value2=[string]$change.after
  if([string]$cell.NumberFormat -cne $formats[$change.address]){throw "Format changed: $($change.address)"}
 }
 $book.Save();$book.Close($false);$book=$null
 for($pass=1;$pass -le 2;$pass++){
  # Workbooks.Open uses Excel's normal load mode; never request repair/recovery.
  $book=$excel.Workbooks.Open($temp,0,$false)
  $sheet=$book.Worksheets.Item('NPC')
  foreach($change in $data.changes){
   $cell=$sheet.Range([string]$change.address)
   if([string]$cell.Value2 -cne [string]$change.after){throw "Reopen mismatch: $($change.address)"}
   if([string]$cell.NumberFormat -cne $formats[$change.address]){throw "Reopen format mismatch: $($change.address)"}
  }
  $got=0;foreach($ws in $book.Worksheets){$got+=$ws.Shapes.Count}
  if($got -ne $shapes){throw 'Drawing count changed'}
  $book.Save();$book.Close($false);$book=$null
 }
 if((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $hash){throw 'Source changed during native Excel edit'}
 $lock=[IO.File]::Open($target,'Open','ReadWrite','None');$lock.Dispose()
 Copy-Item -LiteralPath $temp -Destination $target -Force
 Write-Output "BOSS8_NATIVE_EXCEL_PASS: $($data.changes.Count) cells, two normal reopens, number formats and drawings preserved"
} finally {
 if($book){$book.Close($false)}
 if($excel){$excel.Quit();[Runtime.InteropServices.Marshal]::ReleaseComObject($excel)|Out-Null}
 if(Test-Path -LiteralPath $temp){Remove-Item -LiteralPath $temp}
}
