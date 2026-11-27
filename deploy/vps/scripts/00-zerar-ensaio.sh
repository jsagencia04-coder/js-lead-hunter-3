#!/usr/bin/env bash
# Zera o banco do Supabase DA VPS para repetir o ensaio ou fazer a virada com dados novos.
# NÃO toca no Supabase em nuvem. Recusa rodar depois da virada (arquivo $BASE_DIR/PRODUCAO).
# Os dados antigos não são apagados: a pasta é renomeada para volumes/db/data.descartado-<data>.
#   sudo bash /srv/js-lead-hunter/app/deploy/vps/scripts/00-zerar-ensaio.sh
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
source "$DIR/comum.sh"

[[ -e "$MARCA_PRODUCAO" ]] && erro "a VPS já é PRODUÇÃO ($MARCA_PRODUCAO existe). Este script não pode rodar."

echo "Isto vai desligar o Supabase da VPS e começar um banco novo e vazio."
read -r -p "Digite ZERAR para continuar: " resp
[[ "$resp" == "ZERAR" ]] || erro "cancelado"

cd "$SUPABASE_DIR"
docker compose down
if [[ -d volumes/db/data ]]; then
  mv volumes/db/data "volumes/db/data.descartado-$(date +%Y%m%d-%H%M)"
fi
docker compose up -d
log "Aguardando o banco ficar pronto"
for _ in $(seq 1 60); do
  docker exec "$DB_CONTAINER" pg_isready -U postgres -h localhost >/dev/null 2>&1 && break
  sleep 5
done
log "Banco novo pronto. Pastas antigas em $SUPABASE_DIR/volumes/db/ podem ser apagadas depois da virada."
