#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Uso: $0 <dominio> <correo para Let's Encrypt> [archivo de salida, por defecto deploy/.env]" >&2
  exit 2
}

[ "$#" -ge 2 ] || usage
domain="$1"
acme_email="$2"
deploy_dir="$(cd "$(dirname "$0")/.." && pwd)"
target="${3:-$deploy_dir/.env}"
template="$deploy_dir/.env.example"

if ! printf '%s' "$domain" | grep -Eq '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'; then
  echo "El dominio «$domain» no es válido: usa solo el host, en minúsculas y sin https:// (p. ej. parcify.midominio.com)." >&2
  exit 1
fi
if ! printf '%s' "$acme_email" | grep -Eq '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'; then
  echo "El correo «$acme_email» no es válido." >&2
  exit 1
fi
if [ -e "$target" ]; then
  echo "Ya existe $target; no se cambia nada. Bórralo a mano si de verdad quieres regenerarlo." >&2
  exit 1
fi

secret() {
  od -An -N"$1" -tx1 /dev/urandom | tr -d ' \n'
}

umask 077
awk \
  -v domain="$domain" \
  -v acme="$acme_email" \
  -v pg="$(secret 24)" \
  -v redis="$(secret 24)" \
  -v auth="$(secret 32)" \
  -v collab="$(secret 32)" \
  -v s3key="parcify$(secret 8)" \
  -v s3secret="$(secret 32)" \
  -v metrics="$(secret 24)" '
  /^DOMAIN=$/ { print "DOMAIN=" domain; next }
  /^ACME_EMAIL=$/ { print "ACME_EMAIL=" acme; next }
  /^POSTGRES_PASSWORD=$/ { print "POSTGRES_PASSWORD=" pg; next }
  /^REDIS_PASSWORD=$/ { print "REDIS_PASSWORD=" redis; next }
  /^BETTER_AUTH_SECRET=$/ { print "BETTER_AUTH_SECRET=" auth; next }
  /^COLLAB_TOKEN_SECRET=$/ { print "COLLAB_TOKEN_SECRET=" collab; next }
  /^S3_ACCESS_KEY_ID=$/ { print "S3_ACCESS_KEY_ID=" s3key; next }
  /^S3_SECRET_ACCESS_KEY=$/ { print "S3_SECRET_ACCESS_KEY=" s3secret; next }
  /^METRICS_TOKEN=$/ { print "METRICS_TOKEN=" metrics; next }
  { print }
' "$template" > "$target"

echo "Creado $target con secretos nuevos."
echo "Falta el correo: MAIL_DRIVER y RESEND_API_KEY (o SMTP_URL). Google e IA son opcionales."
