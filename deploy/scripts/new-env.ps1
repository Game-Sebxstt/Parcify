param(
  [Parameter(Mandatory = $true)][string]$Domain,
  [Parameter(Mandatory = $true)][string]$AcmeEmail,
  [string]$Target
)
$ErrorActionPreference = 'Stop'
$deployDir = Split-Path $PSScriptRoot -Parent
if (-not $Target) { $Target = Join-Path $deployDir '.env' }
$template = Join-Path $deployDir '.env.example'

if ($Domain -cnotmatch '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$') {
  throw "El dominio «$Domain» no es válido: usa solo el host, en minúsculas y sin https:// (p. ej. parcify.midominio.com)."
}
if ($AcmeEmail -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$') { throw "El correo «$AcmeEmail» no es válido." }
if (Test-Path $Target) { throw "Ya existe $Target; no se cambia nada. Bórralo a mano si de verdad quieres regenerarlo." }

$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
function New-Secret([int]$Bytes) {
  $buffer = New-Object byte[] $Bytes
  $rng.GetBytes($buffer)
  -join ($buffer | ForEach-Object { $_.ToString('x2') })
}

$values = @{
  DOMAIN               = $Domain
  ACME_EMAIL           = $AcmeEmail
  POSTGRES_PASSWORD    = New-Secret 24
  REDIS_PASSWORD       = New-Secret 24
  BETTER_AUTH_SECRET   = New-Secret 32
  COLLAB_TOKEN_SECRET  = New-Secret 32
  S3_ACCESS_KEY_ID     = "parcify$(New-Secret 8)"
  S3_SECRET_ACCESS_KEY = New-Secret 32
  METRICS_TOKEN        = New-Secret 24
}
$lines = [System.IO.File]::ReadAllLines($template) | ForEach-Object {
  if ($_ -match '^([A-Z0-9_]+)=$' -and $values.ContainsKey($Matches[1])) { "$($Matches[1])=$($values[$Matches[1]])" } else { $_ }
}
[System.IO.File]::WriteAllText($Target, (($lines -join "`n") + "`n"), (New-Object System.Text.UTF8Encoding $false))
Write-Host "Creado $Target con secretos nuevos."
Write-Host 'Falta el correo: MAIL_DRIVER y RESEND_API_KEY (o SMTP_URL). Google e IA son opcionales.'
