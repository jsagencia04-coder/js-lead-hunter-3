#!/usr/bin/env bash
# Passo 4: compila as telas apontando para a API da VPS e publica em $BASE_DIR/www.
# Cada publicação fica numa pasta própria; voltar a anterior é trocar o link "www".
#   sudo bash /srv/js-lead-hunter/app/deploy/vps/scripts/04-publicar-frontend.sh
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
source "$DIR/comum.sh"

ANON_KEY="$(grep '^ANON_KEY=' "$SUPABASE_DIR/.env" | cut -d= -f2-)"
[[ -n "$ANON_KEY" ]] || erro "ANON_KEY não encontrada em $SUPABASE_DIR/.env"

# Evita duas publicações concorrentes e colisões entre versões no mesmo minuto.
exec 9>"$BASE_DIR/.publicacao.lock"
flock -n 9 || erro "já existe uma publicação em andamento"
COMMIT="$(git -C "$APP_DIR" rev-parse --short HEAD)"
REL="$BASE_DIR/www-versoes/$(date +%Y%m%d-%H%M%S)-$COMMIT"
mkdir -p "$REL"

log "Testando e compilando o frontend (Node 22 em container)"
docker run --rm -v "$APP_DIR/web:/web" -w /web \
  -e VITE_SUPABASE_URL="https://$API_DOMAIN" -e VITE_SUPABASE_ANON_KEY="$ANON_KEY" \
  node:22-alpine sh -c "npm ci --no-audit --no-fund && npm test && npm run build"

cp -a "$APP_DIR/web/dist/." "$REL/"
# Preserva chunks já referenciados por abas abertas antes da atualização (rotas lazy).
if [[ -d "$BASE_DIR/www-versoes/atual/assets" ]]; then
  cp -an "$BASE_DIR/www-versoes/atual/assets/." "$REL/assets/"
fi
printf '{"commit":"%s","publicado_em":"%s"}\n' "$COMMIT" "$(date -u +%FT%TZ)" > "$REL/release.json"
chmod -R a+rX "$REL"
# rename(2) no mesmo filesystem: o link antigo permanece até a troca completa.
ln -s "$REL" "$BASE_DIR/.www-novo-$$"
mv -Tf "$BASE_DIR/.www-novo-$$" "$BASE_DIR/www"
# Link relativo usado pelo container jslh-web (que só enxerga www-versoes).
ln -s "$(basename "$REL")" "$BASE_DIR/www-versoes/.atual-novo-$$"
mv -Tf "$BASE_DIR/www-versoes/.atual-novo-$$" "$BASE_DIR/www-versoes/atual"
log "Publicado em $REL (links $BASE_DIR/www e www-versoes/atual). Para voltar: ln -sfn <versão anterior> $BASE_DIR/www-versoes/atual"
log "A chave publicada é a ANON (pública). A SERVICE_ROLE nunca vai para o frontend."
