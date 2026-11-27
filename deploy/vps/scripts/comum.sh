#!/usr/bin/env bash
# Funções e variáveis comuns aos scripts de migração. Não execute diretamente.
set -euo pipefail

CONF="${MIGRACAO_ENV:-/srv/js-lead-hunter/migracao.env}"
if [[ ! -f "$CONF" ]]; then
  echo "ERRO: não encontrei $CONF. Copie deploy/vps/migracao.env.example para lá e preencha." >&2
  exit 1
fi
if [[ "$(stat -c %a "$CONF")" != "600" ]]; then
  echo "ERRO: $CONF tem senhas e precisa de permissão 600:  chmod 600 $CONF" >&2
  exit 1
fi
# Lê CHAVE=VALOR literalmente (sem executar nada), para senhas com qualquer caractere
while IFS= read -r linha || [[ -n "$linha" ]]; do
  linha="${linha%$'\r'}"
  [[ -z "$linha" || "$linha" == \#* || "$linha" != *=* ]] && continue
  chave="${linha%%=*}"; valor="${linha#*=}"
  [[ "$chave" =~ ^[A-Z_][A-Z0-9_]*$ ]] || continue
  if [[ "$valor" =~ ^\"(.*)\"$ || "$valor" =~ ^\'(.*)\'$ ]]; then valor="${BASH_REMATCH[1]}"; fi
  export "$chave=$valor"
done < "$CONF"
unset linha chave valor

: "${BASE_DIR:=/srv/js-lead-hunter}"
: "${DUMP_DIR:?}" "${SUPABASE_DIR:?}" "${DB_CONTAINER:?}"
PG_CLIENT_IMAGE="postgres:17-alpine"
MARCA_PRODUCAO="$BASE_DIR/PRODUCAO"

log() { printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }
erro() { printf 'ERRO: %s\n' "$*" >&2; exit 1; }

# psql/pg_dump contra o Supabase em nuvem (cliente PostgreSQL 17 em container descartável)
nuvem() { docker run --rm -i --network host -v "$DUMP_DIR:/dump" "$PG_CLIENT_IMAGE" "$@"; }

# psql como superusuário no banco da VPS
vps_psql() { docker exec -i "$DB_CONTAINER" psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres "$@"; }

exige_container() {
  docker ps --format '{{.Names}}' | grep -qx "$DB_CONTAINER" \
    || erro "o container $DB_CONTAINER não está rodando (cd $SUPABASE_DIR && docker compose up -d)"
}
