param(
  [int]$MaxFirmCount = 0,
  [int]$DownloadWaitSeconds = 50,
  [int]$FirmLoadWaitSeconds = 8,
  [string]$FirmListPath = ""
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@

$Shell = New-Object -ComObject WScript.Shell
$DataDir = if ([string]::IsNullOrWhiteSpace($FirmListPath)) { $PSScriptRoot } else { Split-Path -Parent $FirmListPath }
$RunLogPath = Join-Path $DataDir 'zirve-fatura-indir-log.txt'
$LastStatusPath = Join-Path $DataDir 'zirve-fatura-indir-son-durum.txt'
$StopFilePath = Join-Path $DataDir 'zirve-fatura-indir-durdur.txt'
$CompletedPath = Join-Path $DataDir 'zirve-fatura-indir-tamamlandi.txt'
if (Test-Path -LiteralPath $StopFilePath) { Remove-Item -LiteralPath $StopFilePath -Force -ErrorAction SilentlyContinue }

function Write-Step([string]$Message) {
  Write-Host ("[{0:HH:mm:ss}] {1}" -f (Get-Date), $Message)
}

function Write-RunLog([string]$FirmName, [string]$Stage) {
  $line = "{0:yyyy-MM-dd HH:mm:ss}`t{1}`t{2}" -f (Get-Date), $Stage, $FirmName
  Add-Content -LiteralPath $RunLogPath -Value $line -Encoding UTF8
  Set-Content -LiteralPath $LastStatusPath -Value $line -Encoding UTF8
}

function Stop-IfRequested {
  $escPressed = (([Win32]::GetAsyncKeyState(0x1B) -band 0x8000) -ne 0)
  if ($escPressed -or (Test-Path -LiteralPath $StopFilePath)) {
    Write-Step "Durdurma istegi algilandi. Robot durduruldu."
    Write-RunLog "GENEL" "DURDURULDU"
    exit 0
  }
}

function Focus-Zirve([int]$AfterMs = 350) {
  Stop-IfRequested
  $processes = @(Get-Process -Name 'ZirveMusavir' -ErrorAction SilentlyContinue)
  if ($processes.Count -eq 0) {
    Write-RunLog "GENEL" "ZIRVE_PENCERESI_BULUNAMADI"
    throw "ZirveMusavir calismiyor veya pencere bulunamadi."
  }
  foreach ($proc in $processes) {
    if ($proc.MainWindowHandle -ne [IntPtr]::Zero) {
      [void][Win32]::ShowWindow($proc.MainWindowHandle, 9)
      [void][Win32]::SetForegroundWindow($proc.MainWindowHandle)
      Start-Sleep -Milliseconds $AfterMs
      return
    }
  }
  [void]$Shell.AppActivate($processes[0].Id)
  Start-Sleep -Milliseconds $AfterMs
}

function Get-Screen {
  return [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
}

function Click-At([int]$X, [int]$Y, [int]$AfterMs = 250) {
  Stop-IfRequested
  Focus-Zirve 150
  [void][Win32]::SetCursorPos($X, $Y)
  Start-Sleep -Milliseconds 80
  [Win32]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 60
  [Win32]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds $AfterMs
}

function Click-Ratio([double]$XRatio, [double]$YRatio, [int]$AfterMs = 250) {
  $screen = Get-Screen
  Click-At ([int]($screen.Width * $XRatio)) ([int]($screen.Height * $YRatio)) $AfterMs
}

function Send-Key([string]$Keys, [int]$AfterMs = 250) {
  Stop-IfRequested
  Focus-Zirve 120
  [System.Windows.Forms.SendKeys]::SendWait($Keys)
  Start-Sleep -Milliseconds $AfterMs
}

function Send-TextSlow([string]$Text, [int]$CharDelayMs = 70) {
  Focus-Zirve 120
  foreach ($char in $Text.ToCharArray()) {
    Stop-IfRequested
    $key = [string]$char
    switch ($key) {
      '+' { $key = '{+}' }
      '^' { $key = '{^}' }
      '%' { $key = '{%}' }
      '~' { $key = '{~}' }
      '(' { $key = '{(}' }
      ')' { $key = '{)}' }
      '{' { $key = '{{}' }
      '}' { $key = '{}}' }
      '[' { $key = '{[}' }
      ']' { $key = '{]}' }
      default { }
    }
    [System.Windows.Forms.SendKeys]::SendWait($key)
    Start-Sleep -Milliseconds $CharDelayMs
  }
}

function Read-FirmList {
  if ([string]::IsNullOrWhiteSpace($FirmListPath) -or -not (Test-Path -LiteralPath $FirmListPath)) {
    throw "Firma listesi bulunamadi: $FirmListPath"
  }
  $names = Get-Content -LiteralPath $FirmListPath -Encoding UTF8 |
    ForEach-Object { "$_".Trim() } |
    Where-Object { $_ -and -not $_.StartsWith('#') }
  return @($names | Select-Object -Unique)
}

function Select-FirmByName([string]$FirmName) {
  Stop-IfRequested
  $name = $FirmName.Trim()
  Write-Step "Firma seciliyor: $name"
  Write-RunLog $name "FIRMA_SECIM_BASLADI"
  Send-Key "+{F8}" 900
  Send-Key "^a" 180
  Send-Key "{BACKSPACE}" 250
  Send-TextSlow $name 70
  Start-Sleep -Milliseconds 700
  Send-Key "{ENTER}" 900
  Start-Sleep -Seconds $FirmLoadWaitSeconds
}

function Open-ExpressScreen {
  Stop-IfRequested
  Write-Step "Express Aktarim aciliyor."
  Write-RunLog "GENEL" "EXPRESS_ACMA_BASLADI"
  $width = (Get-Screen).Width
  if ($width -gt 2200) {
    Click-Ratio 0.805 0.130 1200
    Click-Ratio 0.805 0.155 2200
  } else {
    Click-Ratio 0.805 0.132 1200
    Click-Ratio 0.805 0.158 2200
  }
  Focus-Zirve 500
}

function Close-WarningIfAny([string]$Stage) {
  Write-Step "${Stage}: varsa aktif uyari Enter ile kapatiliyor."
  Send-Key "{ENTER}" 350
}

function Download-CurrentDirection([string]$Direction, [string]$CodePrefix, [string]$FirmName) {
  Stop-IfRequested
  Write-Step "$Direction F3 ile indiriliyor. Bekleme: $DownloadWaitSeconds sn."
  Write-RunLog $FirmName "${CodePrefix}_F3_BASLADI"
  Close-WarningIfAny "$Direction oncesi"
  Send-Key "{F3}" 900
  Write-RunLog $FirmName "${CodePrefix}_F3_GONDERILDI"
  $end = (Get-Date).AddSeconds($DownloadWaitSeconds)
  $tick = 0
  while ((Get-Date) -lt $end) {
    Stop-IfRequested
    Start-Sleep -Seconds 5
    $tick += 5
    if (($tick % 15) -eq 0) {
      Write-RunLog $FirmName ("{0}_BEKLIYOR_{1}SN" -f $CodePrefix, $tick)
    }
  }
  Close-WarningIfAny "$Direction sonrasi"
  Start-Sleep -Seconds 2
}

function Select-Outgoing {
  Stop-IfRequested
  Write-Step "Giden (Satis) seciliyor."
  Write-RunLog "GENEL" "GIDEN_SEKME_SECILIYOR"
  $width = (Get-Screen).Width
  if ($width -gt 2200) {
    Click-Ratio 0.185 0.132 350
    Click-Ratio 0.205 0.132 700
  } else {
    Click-Ratio 0.207 0.149 350
    Click-Ratio 0.238 0.149 700
  }
  Start-Sleep -Seconds 1
}

function Close-ExpressScreen {
  Stop-IfRequested
  Write-Step "Express ekrani ESC ile kapatiliyor."
  Close-WarningIfAny "Kapatma oncesi"
  Send-Key "{ESC}" 1000
  Close-WarningIfAny "Kapatma sonrasi"
  Start-Sleep -Seconds 2
}

try {
  Write-Step "Apex Zirve fatura indir robotu basladi."
  Write-Step "Firma bekleme: $FirmLoadWaitSeconds sn. Indirme bekleme: $DownloadWaitSeconds sn."
  Write-Step "Log dosyasi: $RunLogPath"
  Write-RunLog "GENEL" "ROBOT_BASLADI"

  Focus-Zirve 500
  $firmList = Read-FirmList
  Write-Step "Liste firma sayisi: $($firmList.Count)"
  Write-RunLog "GENEL" ("LISTE_OKUNDU_{0}" -f $firmList.Count)

  $index = 0
  foreach ($firmName in $firmList) {
    Stop-IfRequested
    $index++
    if ($MaxFirmCount -gt 0 -and $index -gt $MaxFirmCount) { break }

    try {
      Write-Step "Firma $index / $($firmList.Count)"
      Write-RunLog $firmName "BASLADI"

      Select-FirmByName $firmName
      Write-RunLog $firmName "FIRMA_SECILDI"

      Open-ExpressScreen
      Write-RunLog $firmName "EXPRESS_ACILDI"

      Download-CurrentDirection "Gelen (Alis)" "GELEN" $firmName
      Write-RunLog $firmName "GELEN_F3_DENENDI"

      Select-Outgoing
      Download-CurrentDirection "Giden (Satis)" "GIDEN" $firmName
      Write-RunLog $firmName "GIDEN_F3_DENENDI"

      Close-ExpressScreen
      Write-RunLog $firmName "TAMAMLANDI"
      Write-Step "Sonraki firma icin sadece Shift+F8 kullanilacak."
    } catch {
      Write-RunLog $firmName ("HATA_" + $_.Exception.Message)
      throw
    }
  }

  Write-Step "Liste tamamlandi. Robot kapaniyor."
  Write-RunLog "GENEL" "LISTE_TAMAMLANDI"
  Set-Content -LiteralPath $CompletedPath -Value ("{0:yyyy-MM-dd HH:mm:ss}`tLISTE_TAMAMLANDI" -f (Get-Date)) -Encoding UTF8
} catch {
  Write-Step ("HATA: " + $_.Exception.Message)
  Write-RunLog "GENEL" ("ROBOT_HATA_" + $_.Exception.Message)
  throw
}