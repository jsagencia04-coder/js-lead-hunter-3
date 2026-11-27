#!/usr/bin/env bash
# Ajusta o .env do Supabase auto-hospedado para o JS Lead Hunter.
# Rode DEPOIS do setup.sh oficial (que gera as senhas e chaves) e ANTES do primeiro "docker compose up".
#   sudo bash /srv/js-lead-hunter/app/deploy/vps/supabase/configurar-env.sh
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
source "$DIR/../scripts/comum.sh"

ENV_FILE="$SUPABASE_DIR/.env"
[[ -f "$ENV_FILE" ]] || erro "não encontrei $ENV_FILE. Rode o setup.sh oficial antes (ver README)."
grep -q '^POSTGRES_PASSWORD=your-super-secret' "$ENV_FILE" && erro "o .env ainda tem as senhas padrão; rode o setup.sh oficial"

cp -p "$ENV_FILE" "$ENV_FILE.antes-jslh.$(date +%Y%m%d%H%M%S)"

define() {  # define CHAVE VALOR (substitui a linha ou acrescenta no fim)
  local k="$1" v="$2" esc
  esc=$(printf '%s' "$v" | sed -e 's/[&|\\]/\\&/g')
  if grep -q "^$k=" "$ENV_FILE"; then sed -i "s|^$k=.*$|$k=$esc|" "$ENV_FILE"; else echo "$k=$v" >> "$ENV_FILE"; fi
}

define COMPOSE_FILE "docker-compose.yml:docker-compose.jslh.yml"
define SUPABASE_PUBLIC_URL "https://$API_DOMAIN"
define API_EXTERNAL_URL "https://$API_DOMAIN/auth/v1"
define SITE_URL "https://$APP_DOMAIN"
define ADDITIONAL_REDIRECT_URLS "https://$APP_DOMAIN/redefinir-senha"
define ALLOWED_ORIGIN "https://$APP_DOMAIN"
# Acesso só por convite, como no Supabase em nuvem
define DISABLE_SIGNUP "true"
define ENABLE_EMAIL_SIGNUP "true"
define ENABLE_EMAIL_AUTOCONFIRM "false"
define ENABLE_PHONE_SIGNUP "false"
define ENABLE_PHONE_AUTOCONFIRM "false"
define ENABLE_ANONYMOUS_USERS "false"
# E-mail de convites e senhas
define SMTP_HOST "$SMTP_HOST"
define SMTP_PORT "$SMTP_PORT"
define SMTP_USER "$SMTP_USER"
define SMTP_PASS "$SMTP_PASS"
define SMTP_ADMIN_EMAIL "$SMTP_ADMIN_EMAIL"
define SMTP_SENDER_NAME "$SMTP_SENDER_NAME"
define FUNCTIONS_MEMORY_LIMIT "512m"

cp "$DIR/docker-compose.jslh.yml" "$SUPABASE_DIR/docker-compose.jslh.yml"
mkdir -p "$SUPABASE_DIR/volumes/functions/invite-user"
cp "$APP_DIR/supabase/functions/invite-user/index.ts" "$SUPABASE_DIR/volumes/functions/invite-user/index.ts"
chmod 600 "$ENV_FILE"

log "Pronto. Confira e suba:  cd $SUPABASE_DIR && docker compose config >/dev/null && docker compose up -d"
log "Senha do painel (Studio): veja DASHBOARD_USERNAME e DASHBOARD_PASSWORD em $ENV_FILE"
