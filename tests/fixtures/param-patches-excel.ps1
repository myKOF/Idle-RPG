param([string]$Root, [ValidateSet('init', 'inspect', 'edit', 'duplicate', 'lock', 'open')][string]$Mode = 'init')
$ErrorActionPreference = 'Stop'
$file = Join-Path $Root 'config/Excel/Test.xlsx'
if ($Mode -eq 'lock') {
  $stream = [IO.File]::Open($file, 'Open', 'ReadWrite', 'None')
  try { Write-Output 'LOCKED'; [Console]::Out.Flush(); [Console]::ReadLine() | Out-Null }
  finally { $stream.Dispose() }
  exit
}
$excel = $null; $book = $null
try {
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false; $excel.DisplayAlerts = $false
  if ($Mode -eq 'init') {
    [IO.Directory]::CreateDirectory((Split-Path -Parent $file)) | Out-Null
    $book = $excel.Workbooks.Add()
    $sheet = $book.Worksheets.Item(1); $sheet.Name = 'Data'
    $matrix = @(@('ID', 'Tier', 'Value', 'Text'), @('beta', 1.0, 20.0, 'user saved'), @('alpha', 1.0, 10.0, 'original'))
    for ($r = 0; $r -lt 3; $r++) {
      for ($c = 0; $c -lt 4; $c++) {
        $cell = $sheet.Cells.Item($r + 1, $c + 1)
        if ($matrix[$r][$c] -is [string]) { $cell.Value2 = [string]$matrix[$r][$c] }
        else { $cell.Value2 = [double]$matrix[$r][$c] }
      }
    }
    $sheet.Range('C3').NumberFormat = '0.00'
    $sheet.Range('C3').Interior.Color = 65535
    $sheet.Range('C3').AddComment('keep note') | Out-Null
    $sheet.Range('D3').WrapText = $true
    $sheet.Columns.Item(4).ColumnWidth = 30
    $sheet.Rows.Item(3).RowHeight = 28
    $sheet.Range('E3').Formula = '=C3*2'
    $sheet.Range('C3').Validation.Add(1, 1, 1, 0, 100)
    $sheet.Range('A1:D3').AutoFilter() | Out-Null
    $extra = $book.Worksheets.Add(); $extra.Name = 'Hidden'
    $extra.Range('A1').Value2 = 'preserved'; $extra.Visible = 0
    $sheet.Activate()
    $book.SaveAs($file, 51)
    $book.SaveCopyAs((Join-Path (Split-Path -Parent $file) 'Second.xlsx'))
  } else {
    $book = $excel.Workbooks.Open($file, 0, $false)
    $sheet = $book.Worksheets.Item('Data')
    if ($Mode -eq 'open') { Write-Output 'LOCKED'; [Console]::Out.Flush(); [Console]::ReadLine() | Out-Null }
    elseif ($Mode -eq 'edit') { $sheet.Range('C3').Value2 = 99.0; $book.Save() }
    elseif ($Mode -eq 'duplicate') { $sheet.Range('A2').Value2 = 'alpha'; $book.Save() }
    else {
      $result = @{ alpha = $sheet.Range('C3').Value2; beta = $sheet.Range('C2').Value2;
        text = $sheet.Range('D3').Value2; textFormula = $sheet.Range('D3').HasFormula;
        formula = $sheet.Range('E3').Formula; calculated = $sheet.Range('E3').Value2;
        format = $sheet.Range('C3').NumberFormat; color = $sheet.Range('C3').Interior.Color;
        note = $sheet.Range('C3').Comment.Text(); validation = $sheet.Range('C3').Validation.Type;
        rowHeight = $sheet.Rows.Item(3).RowHeight; columnWidth = $sheet.Columns.Item(4).ColumnWidth;
        wrap = $sheet.Range('D3').WrapText; filter = $sheet.AutoFilterMode;
        hidden = $book.Worksheets.Item('Hidden').Visible; sheetCount = $book.Worksheets.Count;
        saved = $book.Saved; repair = [bool]$book.RepairMode }
      Write-Output ($result | ConvertTo-Json -Compress)
    }
  }
} finally {
  if ($null -ne $book) { $book.Close($false) }
  if ($null -ne $excel) { $excel.Quit(); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel) }
  [GC]::Collect(); [GC]::WaitForPendingFinalizers()
}
