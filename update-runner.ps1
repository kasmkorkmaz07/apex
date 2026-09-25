param([Parameter(Mandatory=$true)][string]$ConfigPath)
$ErrorActionPreference='Stop'
$c=Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
function Log([string]$message){Add-Content -LiteralPath $c.log -Encoding UTF8 -Value ("[{0}] {1}" -f (Get-Date -Format o),$message)}
function Read-AppVersion([string]$installDir){
  $archive=Join-Path $installDir 'resources\app.asar'
  if(!(Test-Path -LiteralPath $archive)){throw 'Kurulu app.asar bulunamadı.'}
  $stream=[IO.File]::OpenRead($archive);$reader=New-Object IO.BinaryReader($stream)
  try{
    $null=$reader.ReadUInt32();$headerSize=$reader.ReadUInt32();$null=$reader.ReadUInt32();$jsonSize=$reader.ReadUInt32()
    if($jsonSize -gt 16777216){throw 'Geçersiz ASAR başlığı.'}
    $header=[Text.Encoding]::UTF8.GetString($reader.ReadBytes($jsonSize)) | ConvertFrom-Json
    $entry=$header.files.'package.json'
    if(!$entry -or $entry.unpacked -or $entry.size -gt 1048576){throw 'Paket sürümü okunamadı.'}
    $stream.Position=8+[long]$headerSize+[long]$entry.offset
    return ([Text.Encoding]::UTF8.GetString($reader.ReadBytes([int]$entry.size)) | ConvertFrom-Json).version
  }finally{$reader.Dispose();$stream.Dispose()}
}
try{
  if(!(Test-Path -LiteralPath $c.installer)){throw 'Kurulum paketi bulunamadı.'}
  if((Get-FileHash -LiteralPath $c.installer -Algorithm SHA256).Hash -ne $c.sha256){throw 'Kurulum paketi doğrulaması başarısız.'}
  if([version](Get-Item -LiteralPath $c.installer).VersionInfo.ProductVersion -ne [version]($c.expectedVersion+'.0')){throw 'Kurulum dosyasının sürümü yanlış.'}
  $probe=Join-Path $c.installDir ('.apex-write-'+[guid]::NewGuid()+'.tmp')
  [IO.File]::WriteAllText($probe,'test');Remove-Item -LiteralPath $probe
  @{ok=$true}|ConvertTo-Json|Set-Content -LiteralPath $c.ready -Encoding UTF8
  $old=Get-Process -Id $c.appPid -ErrorAction SilentlyContinue
  if($old -and !$old.WaitForExit(120000)){throw 'Apex kapanmadı; kurulum başlatılmadı.'}
  $closingDeadline=(Get-Date).AddSeconds(30)
  do {
    $remaining=Get-Process Apex -ErrorAction SilentlyContinue | Where-Object {try{$_.Path -eq $c.exe}catch{$false}}
    if(!$remaining){break}
    Start-Sleep -Milliseconds 200
  } while((Get-Date) -lt $closingDeadline)
  if($remaining){throw 'Apex işlemi hâlâ açık; kurulum başlatılmadı.'}
  Log ('Kurulum başlıyor: '+$c.expectedVersion)
  $p=Start-Process -FilePath $c.installer -ArgumentList ('/S /D='+$c.installDir) -PassThru -WindowStyle Hidden
  if(!$p.WaitForExit(600000)){throw 'Kurulum zamanında tamamlanmadı. İkinci kurulum başlatılmadı.'}
  $p.Refresh();if($p.ExitCode -ne 0){throw ('Kurulum çıkış kodu: '+$p.ExitCode)}
  $actual=Read-AppVersion $c.installDir
  if($actual -ne $c.expectedVersion){throw ('Kurulum doğrulanamadı. Beklenen: '+$c.expectedVersion+'; kurulu: '+$actual)}
  @{ok=$true;expectedVersion=$c.expectedVersion;installedVersion=$actual;at=(Get-Date -Format o)}|ConvertTo-Json|Set-Content -LiteralPath $c.result -Encoding UTF8
  Log ('Doğrulandı: '+$actual)
  Start-Process -FilePath $c.exe
}catch{
  $message=$_.Exception.Message
  @{ok=$false;error=$message}|ConvertTo-Json|Set-Content -LiteralPath $c.ready -Encoding UTF8
  @{ok=$false;expectedVersion=$c.expectedVersion;error=$message;at=(Get-Date -Format o)}|ConvertTo-Json|Set-Content -LiteralPath $c.result -Encoding UTF8
  Log $message
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.MessageBox]::Show($message+"`nGüncelleme başarılı olarak işaretlenmedi.",'Apex güncellemesi')|Out-Null
  exit 1
}
