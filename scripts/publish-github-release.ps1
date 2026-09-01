param(
  [string]$Repo = "kasmkorkmaz07/apex"
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $root

$package = Get-Content ".\package.json" -Raw | ConvertFrom-Json
$version = [string]$package.version
$tag = "v$version"
$releaseTitle = "Apex $version"
$installerSource = ".\release\Apex-Kurulum-$version.exe"
$installerUpload = ".\release\Apex-Kurulum.exe"
$installerVersioned = ".\release\Apex-Kurulum-v$version.exe"

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  Write-Host "GitHub CLI bulunamadi." -ForegroundColor Yellow
  Write-Host "1) https://cli.github.com/ adresinden GitHub CLI kurun."
  Write-Host "2) PowerShell'de: gh auth login"
  Write-Host "3) Sonra bu scripti tekrar calistirin."
  exit 1
}

Write-Host "Apex paketleniyor: $version" -ForegroundColor Cyan
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
if (Test-Path ".\release") {
  Get-ChildItem ".\release" -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like "Apex-Kurulum*.exe" -or $_.Name -like "Apex-Kurulum*.blockmap" -or $_.Name -eq "builder-debug.yml" } |
    Remove-Item -Force
}
npm.cmd run dist

if (-not (Test-Path $installerSource)) {
  throw "Installer bulunamadi: $installerSource"
}

Copy-Item $installerSource $installerUpload -Force
Copy-Item $installerSource $installerVersioned -Force

$oldErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = "Continue"
& gh release view $tag --repo $Repo *> $null
$viewExitCode = $LASTEXITCODE
$ErrorActionPreference = $oldErrorActionPreference
if ($viewExitCode -eq 0) {
  Write-Host "Mevcut release guncelleniyor: $tag" -ForegroundColor Cyan
  & gh release upload $tag $installerUpload $installerVersioned --repo $Repo --clobber
} else {
  Write-Host "Yeni release olusturuluyor: $tag" -ForegroundColor Cyan
  & gh release create $tag $installerUpload $installerVersioned --repo $Repo --title $releaseTitle --notes "Apex $version"
}

Write-Host "Yayin tamamlandi." -ForegroundColor Green
Write-Host "Guncelleme adresi: https://github.com/$Repo/releases/latest"

Remove-Item $installerUpload, $installerVersioned -Force -ErrorAction SilentlyContinue
Get-ChildItem ".\release" -File -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -like "Apex-Kurulum*.blockmap" -or $_.Name -eq "builder-debug.yml" } |
  Remove-Item -Force -ErrorAction SilentlyContinue
Remove-Item ".\release\win-unpacked" -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "Yerel release kalintilari temizlendi; sadece $installerSource birakildi." -ForegroundColor Green
