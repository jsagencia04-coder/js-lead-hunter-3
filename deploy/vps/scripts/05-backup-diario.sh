#!/usr/bin/env bash
# Backup diário do banco da VPS, no MESMO formato da migração (o 02 restaura qualquer um deles).
# Agende no cron do root:   30 3 * * *  bash /srv/js-lead-hunter/app/deploy/vps/scripts/05-backup-diario.sh >> /var/log/js-lead-hunter-backup.log 2>&1
#
# Guarda $BACKUP_KEEP_DAYS dias na VPS e, se RCLONE_REMOTE estiver definido, envia uma cópia
# criptografada (gpg simétrico com BACKUP_GPG_PASSPHRASE) para fora da VPS.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
source "$DIR/comum.sh"
exige_container

STAMP="$(date +%Y%m%d-%H%M)"
OUT="$BACKUP_DIR/$STAMP"
mkdir -p "$OUT"; chmod 700 "$BACKUP_DIR" "$OUT"

log "Backup em $OUT"
docker exec "$DB_CONTAINER" sh -c "pg_dump -U supabase_admin -d postgres -Fc --no-owner -n public -n 'backup_*'" > "$OUT/app.dump"
docker exec "$DB_CONTAINER" sh -c "pg_dump -U supabase_admin -d postgres --data-only --column-inserts -t auth.users -t auth.identities" > "$OUT/auth.sql"
vps_psql -At -F $'\t' -c \
  "select e.extname, n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace
    where e.extname in ('pg_trgm', 'unaccent', 'pgcrypto') order by 1" > "$OUT/extensoes.tsv"
vps_psql -At -F $'\t' < "$DIR/inventario.sql" > "$OUT/inventario-origem.tsv"
vps_psql -At -F $'\t' < "$DIR/permissoes.sql" > "$OUT/permissoes-origem.tsv"

# O arquivo precisa ser legível pelo pg_restore; senão o backup é inválido
docker exec -i "$DB_CONTAINER" pg_restore -l < "$OUT/app.dump" > /dev/null || erro "app.dump inválido"
( cd "$OUT" && sha256sum app.dump auth.sql extensoes.tsv inventario-origem.tsv permissoes-origem.tsv > SHA256SUMS )
chmod 600 "$OUT"/*
log "OK: $(du -sh "$OUT" | cut -f1), $(wc -l < "$OUT/inventario-origem.tsv") tabelas"

if [[ -n "${RCLONE_REMOTE:-}" ]]; then
  command -v rclone >/dev/null || erro "RCLONE_REMOTE definido, mas o rclone não está instalado"
  : "${BACKUP_GPG_PASSPHRASE:?defina BACKUP_GPG_PASSPHRASE em $CONF para criptografar a cópia externa}"
  ARQ="$BACKUP_DIR/$STAMP.tar.gpg"
  tar -C "$BACKUP_DIR" -cf - "$STAMP" \
    | gpg --batch --yes --pinentry-mode loopback --passphrase "$BACKUP_GPG_PASSPHRASE" --symmetric --cipher-algo AES256 -o "$ARQ"
  rclone copy "$ARQ" "$RCLONE_REMOTE/" && log "Cópia externa enviada para $RCLONE_REMOTE"
  rm -f "$ARQ"
fi

find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '20*' -mtime +"${BACKUP_KEEP_DAYS:-14}" -print -exec rm -rf {} +
log "Fim do backup"
