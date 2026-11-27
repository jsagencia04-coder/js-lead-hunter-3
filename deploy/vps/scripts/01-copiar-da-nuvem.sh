#!/usr/bin/env bash
# Passo 1: copia o banco do Supabase em nuvem para arquivos na VPS. SÓ LEITURA na nuvem.
#   sudo bash /srv/js-lead-hunter/app/deploy/vps/scripts/01-copiar-da-nuvem.sh
#
# Gera em $DUMP_DIR/<data-hora>/:
#   app.dump               esquemas public e backup_* (estrutura + dados), formato custom do pg_dump
#   auth.sql               usuários e identidades do login (auth.users, auth.identities), só dados
#   extensoes.tsv          em que esquema cada extensão usada está (para recriar igual)
#   inventario-nuvem.tsv   quantidade exata de linhas por tabela
#   SHA256SUMS             para conferir os arquivos antes de restaurar
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
source "$DIR/comum.sh"
: "${CLOUD_DATABASE_URL:?preencha CLOUD_DATABASE_URL em $CONF}"

STAMP="$(date +%Y%m%d-%H%M)"
OUT="$DUMP_DIR/$STAMP"
mkdir -p "$OUT"; chmod 700 "$DUMP_DIR" "$OUT"

log "Testando a conexão com o Supabase em nuvem"
nuvem psql "$CLOUD_DATABASE_URL" -Atc "select 'conectado: ' || current_database() || ' / ' || split_part(version(), ' ', 2)"

log "Registrando extensões"
nuvem psql "$CLOUD_DATABASE_URL" -At -F $'\t' -c \
  "select e.extname, n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace
    where e.extname in ('pg_trgm', 'unaccent', 'pgcrypto') order by 1" > "$OUT/extensoes.tsv"
cat "$OUT/extensoes.tsv"

log "Copiando os esquemas public e backup_* (pode levar alguns minutos)"
nuvem pg_dump "$CLOUD_DATABASE_URL" -Fc --no-owner -n public -n 'backup_*' -f "/dump/$STAMP/app.dump"

log "Copiando usuários do login (auth.users e auth.identities)"
nuvem pg_dump "$CLOUD_DATABASE_URL" --data-only --column-inserts \
  -t auth.users -t auth.identities -f "/dump/$STAMP/auth.sql"

log "Contando linhas por tabela"
nuvem psql "$CLOUD_DATABASE_URL" -At -F $'\t' -f - > "$OUT/inventario-nuvem.tsv" < "$DIR/inventario.sql"

log "Registrando permissões (para conferir depois que ficaram iguais)"
nuvem psql "$CLOUD_DATABASE_URL" -At -F $'\t' -f - > "$OUT/permissoes-nuvem.tsv" < "$DIR/permissoes.sql"

( cd "$OUT" && sha256sum app.dump auth.sql extensoes.tsv inventario-nuvem.tsv permissoes-nuvem.tsv > SHA256SUMS )
chmod 600 "$OUT"/*
ln -sfn "$OUT" "$DUMP_DIR/ultimo"

log "Concluído: $OUT"
log "Tabelas: $(wc -l < "$OUT/inventario-nuvem.tsv")  |  tamanho: $(du -sh "$OUT" | cut -f1)"
log "Atenção: esses arquivos têm dados pessoais e senhas criptografadas. Não copie para fora da VPS sem criptografia."
