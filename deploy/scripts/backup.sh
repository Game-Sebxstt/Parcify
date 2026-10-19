#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Uso:
  deploy/scripts/backup.sh backup [carpeta]     Copia Postgres y el bucket (por defecto en deploy/backups/<fecha>)
  deploy/scripts/backup.sh restore <carpeta>    Restaura una copia: sustituye la base de datos y el bucket
Variables: ENV_FILE (por defecto deploy/.env), YES=1 para no pedir confirmación al restaurar.
EOF
  exit 2
}

deploy_dir="$(cd "$(dirname "$0")/.." && pwd)"
env_file="${ENV_FILE:-$deploy_dir/.env}"
[ -f "$env_file" ] || { echo "No existe $env_file" >&2; exit 1; }
compose=(docker compose -f "$deploy_dir/compose.prod.yml" --env-file "$env_file")

bucket_sync() {
  "${compose[@]}" run --rm --no-deps -T -v "$1:/backup" --entrypoint sh rclone -c "$2"
}

backup() {
  local dir="${1:-$deploy_dir/backups/$(date -u +%Y%m%d-%H%M%S)}"
  mkdir -p "$dir/bucket"
  dir="$(cd "$dir" && pwd)"
  echo "Postgres → $dir/postgres.dump"
  "${compose[@]}" exec -T postgres pg_dump -U parcify -d parcify -Fc > "$dir/postgres.dump.tmp"
  mv "$dir/postgres.dump.tmp" "$dir/postgres.dump"
  echo "Bucket → $dir/bucket"
  bucket_sync "$dir/bucket" 'rclone sync "bucket:$S3_BUCKET" /backup --fast-list'
  echo "Copia terminada en $dir"
}

restore() {
  local dir="${1:-}"
  [ -n "$dir" ] || usage
  [ -f "$dir/postgres.dump" ] || { echo "No hay $dir/postgres.dump" >&2; exit 1; }
  dir="$(cd "$dir" && pwd)"
  if [ "${YES:-}" != "1" ]; then
    read -r -p "Se sustituirán la base de datos y el bucket actuales por la copia de $dir. Escribe «restaurar» para seguir: " answer
    [ "$answer" = "restaurar" ] || { echo "Cancelado."; exit 1; }
  fi
  echo "Parando api y collab"
  "${compose[@]}" stop api collab
  echo "Restaurando Postgres"
  "${compose[@]}" exec -T postgres pg_restore -U parcify -d parcify --clean --if-exists --no-owner --single-transaction < "$dir/postgres.dump"
  if [ -d "$dir/bucket" ]; then
    echo "Restaurando el bucket"
    bucket_sync "$dir/bucket" 'rclone sync /backup "bucket:$S3_BUCKET" --fast-list'
  fi
  echo "Arrancando api y collab"
  "${compose[@]}" start api collab
  echo "Restauración terminada."
}

case "${1:-}" in
  backup) shift; backup "$@" ;;
  restore) shift; restore "$@" ;;
  *) usage ;;
esac
