# Genera ..\.env.local-deploy con contraseñas y secretos aleatorios. Si ya existe, no lo toca.
$ErrorActionPreference = 'Stop'
$target = Join-Path (Split-Path $PSScriptRoot -Parent) '.env.local-deploy'
if (Test-Path $target) {
  Write-Host "Ya existe $target; no se cambia nada."
  exit 0
}

$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
function New-Secret([int]$Bytes = 32) {
  $buffer = New-Object byte[] $Bytes
  $rng.GetBytes($buffer)
  -join ($buffer | ForEach-Object { $_.ToString('x2') })
}

$pgPassword = New-Secret 24
$redisPassword = New-Secret 24
$lines = @(
  '# Secretos del despliegue local (compose.local.yml). No se versiona.',
  'POSTGRES_USER=parcify',
  'POSTGRES_DB=parcify',
  "POSTGRES_PASSWORD=$pgPassword",
  "REDIS_PASSWORD=$redisPassword",
  "DATABASE_URL=postgresql://parcify:$pgPassword@postgres:5432/parcify",
  "REDIS_URL=redis://:$redisPassword@redis:6379/0",
  "BETTER_AUTH_SECRET=$(New-Secret 32)",
  "COLLAB_TOKEN_SECRET=$(New-Secret 32)",
  "S3_ACCESS_KEY_ID=parcify_$(New-Secret 8)",
  "S3_SECRET_ACCESS_KEY=$(New-Secret 32)",
  "METRICS_TOKEN=$(New-Secret 24)"
)
[System.IO.File]::WriteAllText($target, (($lines -join "`n") + "`n"), (New-Object System.Text.UTF8Encoding $false))
Write-Host "Creado $target"
