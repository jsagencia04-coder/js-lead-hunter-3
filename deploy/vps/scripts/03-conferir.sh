#!/usr/bin/env bash
# Passo 3: compara a VPS com a origem em duas frentes:
#   1. quantidade de linhas de cada tabela (inventário);
#   2. permissões de cada tabela, view, sequência e função (segurança: ninguém pode ganhar acesso).
#   sudo bash /srv/js-lead-hunter/app/deploy/vps/scripts/03-conferir.sh [PASTA]
# Sai com código 0 só se as duas comparações baterem.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
source "$DIR/comum.sh"
exige_container

SRC="$(readlink -f "${1:-$DUMP_DIR/ultimo}")"
pega() { for f in "$@"; do [[ -f "$SRC/$f" ]] && { echo "$SRC/$f"; return; }; done; erro "não achei $* em $SRC"; }
INV_ORIGEM="$(pega inventario-nuvem.tsv inventario-origem.tsv)"
PERM_ORIGEM="$(pega permissoes-nuvem.tsv permissoes-origem.tsv)"

vps_psql -At -F $'\t' < "$DIR/inventario.sql" > "$SRC/inventario-vps.tsv"
vps_psql -At -F $'\t' < "$DIR/permissoes.sql" > "$SRC/permissoes-vps.tsv"

ok=1
if diff -u "$INV_ORIGEM" "$SRC/inventario-vps.tsv" > "$SRC/diferencas-inventario.txt"; then
  log "OK inventário: $(wc -l < "$INV_ORIGEM") tabelas com a mesma quantidade de linhas."
else
  ok=0
  log "DIFERENÇAS no inventário (origem '-' x VPS '+'):"
  grep -E '^[-+][^-+]' "$SRC/diferencas-inventario.txt" || true
  log "No ensaio, com o worker da nuvem ligado, pequenas diferenças são esperadas. Na virada, não pode haver nenhuma."
fi

if diff -u "$PERM_ORIGEM" "$SRC/permissoes-vps.tsv" > "$SRC/diferencas-permissoes.txt"; then
  log "OK permissões: $(wc -l < "$PERM_ORIGEM") objetos com as mesmas permissões da origem."
else
  ok=0
  log "DIFERENÇAS de permissão (origem '-' x VPS '+'). NÃO libere o sistema enquanto houver alguma:"
  grep -E '^[-+][^-+]' "$SRC/diferencas-permissoes.txt" | head -40 || true
fi

# Teste direto: sem login (papel anon) não se lê nenhuma tabela de dados
if vps_psql -Atc "set role anon; select count(*) from public.leads;" > /dev/null 2>&1; then
  ok=0; log "FALHA DE SEGURANÇA: o papel anon conseguiu ler public.leads"
else
  log "OK: sem login não há acesso aos leads."
fi

vps_psql -Atc "select 'usuários: ' || count(*) from auth.users; select 'perfis: ' || count(*) from public.profiles;"
[[ $ok -eq 1 ]] && { log "CONFERÊNCIA APROVADA"; exit 0; }
log "CONFERÊNCIA REPROVADA (detalhes em $SRC/diferencas-*.txt)"; exit 1
