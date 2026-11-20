param(
  [string]$MigrateFrom,
  [switch]$CheckMigration
)
$ErrorActionPreference = 'Stop'
if ($CheckMigration -and !$MigrateFrom) { throw 'Specify the previous app.asar path.' }
if ($MigrateFrom) {
  $stream = [IO.File]::OpenRead((Resolve-Path -LiteralPath $MigrateFrom).Path)
  $reader = [IO.BinaryReader]::new($stream)
  try {
    $null = $reader.ReadUInt32()
    $headerLength = $reader.ReadUInt32()
    $null = $reader.ReadUInt32()
    $jsonLength = $reader.ReadUInt32()
    if ($jsonLength -gt 16MB) { throw 'Invalid ASAR header.' }
    $header = [Text.Encoding]::UTF8.GetString($reader.ReadBytes($jsonLength)) | ConvertFrom-Json
    $entry = $header.files.'main.js'
    if (!$entry -or $entry.unpacked -or $entry.size -gt 4MB) { throw 'Invalid main.js entry.' }
    $stream.Position = 8 + [long]$headerLength + [long]$entry.offset
    $legacy = [Text.Encoding]::UTF8.GetString($reader.ReadBytes([int]$entry.size))
    if ($legacy -notmatch "(?m)^const PROFILE_PASSWORD_HASH = '([a-f0-9]{64})';") { throw 'Legacy verifier was not found.' }
    $digest = $Matches[1]
  } finally { $reader.Dispose() }
  if ($CheckMigration) { Write-Output 'Migration check passed.'; return }
} else {
  $password = Read-Host 'Yeni Apex profil parolasi' -AsSecureString
  if (!$password.Length) { throw 'Parola bos olamaz.' }
  $bytes = [Text.Encoding]::UTF8.GetBytes([Net.NetworkCredential]::new('', $password).Password)
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try { $digest = [BitConverter]::ToString($algorithm.ComputeHash($bytes)).Replace('-', '').ToLowerInvariant() }
  finally { [Array]::Clear($bytes, 0, $bytes.Length); $algorithm.Dispose(); $password.Dispose() }
}
$machine = [Microsoft.Win32.RegistryKey]::OpenBaseKey('LocalMachine', 'Registry64')
try {
  $key = $machine.CreateSubKey('SOFTWARE\Apex\ProfileAuth')
  try {
    if ($MigrateFrom -and $key.GetValue('Verifier')) { return }
    $key.SetValue('Verifier', $digest, 'String')
  } finally { $key.Dispose() }
} finally { $machine.Dispose() }
