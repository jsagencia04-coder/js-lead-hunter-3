#!/usr/bin/env bash
# Passo 2: restaura uma cópia (feita pelo 01 ou pelo backup diário 05) no Supabase da VPS.
#   sudo bash /srv/js-lead-hunter/app/deploy/vps/scripts/02-restaurar-na-vps.sh [PASTA]
# PASTA padrão: $DUMP_DIR/ultimo
#
# Segurança: só roda num banco da VPS SEM tabelas no esquema public (instalação nova ou zerada
# pelo 00-zerar-ensaio.sh). Nunca apaga nada no destino.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
source "$DIR/comum.sh"
exige_container

SRC="$(readlink -f "${1:-$DUMP_DIR/ultimo}")"
[[ -f "$SRC/app.dump" && -f "$SRC/auth.sql" ]] || erro "pasta inválida: $SRC"

log "Conferindo os arquivos ($SRC)"
( cd "$SRC" && sha256sum -c --quiet SHA256SUMS ) || erro "os arquivos não batem com o SHA256SUMS"

n=$(vps_psql -Atc "select count(*) from pg_tables where schemaname = 'public'")
[[ "$n" == "0" ]] || erro "o banco da VPS já tem $n tabelas em public. Restaure só num banco novo (veja 00-zerar-ensaio.sh)."

log "Recriando extensões no mesmo esquema da nuvem"
while IFS=$'\t' read -r ext esquema; do
  [[ -n "$ext" ]] || continue
  vps_psql -qc "create schema if not exists \"$esquema\"; create extension if not exists \"$ext\" with schema \"$esquema\";"
  log "  $ext em $esquema"
done < "$SRC/extensoes.tsv"

log "Restaurando usuários do login (sem disparar gatilhos)"
{ echo "SET session_replication_role = replica;"; cat "$SRC/auth.sql"; } | vps_psql -q

log "Zerando os privilégios padrão do esquema public (as permissões vêm exatamente da origem)"
# Sem isto, o Supabase daria ALL para anon/authenticated em cada objeto restaurado e desfaria os
# REVOKE das migrations. O próprio app.dump recria os privilégios padrão da origem no fim.
vps_psql -q <<'SQL'
alter default privileges for role postgres in schema public revoke all on tables    from anon, authenticated, service_role, public;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated, service_role, public;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated, service_role, public;
SQL

log "Restaurando os esquemas public e backup_*"
docker cp "$SRC/app.dump" "$DB_CONTAINER:/tmp/app.dump"
docker exec "$DB_CONTAINER" sh -c "pg_restore -l /tmp/app.dump | grep -v ' SCHEMA - public ' > /tmp/app.list"
set +e
docker exec "$DB_CONTAINER" pg_restore -U supabase_admin -d postgres --no-owner --role=postgres \
  -L /tmp/app.list /tmp/app.dump 2> "$SRC/restauracao.log"
rc=$?
set -e
docker exec "$DB_CONTAINER" rm -f /tmp/app.dump /tmp/app.list
if [[ $rc -ne 0 ]]; then
  log "pg_restore terminou com avisos/erros (código $rc). Linhas de erro:"
  grep -i 'error' "$SRC/restauracao.log" | head -30 || true
  log "Log completo: $SRC/restauracao.log. O 03-conferir.sh diz se os dados ficaram completos."
fi

log "Recriando o gatilho que cria o perfil de usuários novos"
vps_psql -qc "drop trigger if exists on_auth_user_created on auth.users;
              create trigger on_auth_user_created after insert on auth.users
                for each row execute function public.handle_new_user();"

log "Avisando a API para recarregar o esquema"
vps_psql -qc "notify pgrst, 'reload schema';"

log "Restauração concluída. Agora rode: bash $DIR/03-conferir.sh $SRC"
