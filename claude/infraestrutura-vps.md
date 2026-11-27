# Infraestrutura — VPS Integrator (produção self-hosted)

Status em 27/11/2026. Documenta o que está realmente no ar na VPS, sem valores secretos.

## Decisão de arquitetura

O JS Lead Hunter roda **inteiramente dentro da VPS**: banco (Postgres via Supabase
auto-hospedado), API, Auth, Storage, Edge Functions, frontend e worker. **Não há mais
vínculo com o Supabase em nuvem (SaaS)** para a operação do dia a dia — a cópia feita de lá
foi usada apenas como origem de uma migração única de dados, não como dependência contínua.

## Onde está

- VPS: `216.22.17.86` (hostname `vps12823.panel.icontainer.work`), Ubuntu, painel ICP.
- Pasta do projeto: `/srv/js-lead-hunter/` (fora do controle de versão deste repositório;
  é o checkout da branch `migracao-vps` feito direto na VPS).
- Site: `https://leadhunter.vps12823.panel.icontainer.work/` — HTTP 200 confirmado.
- API (Supabase self-hosted): `http://127.0.0.1:8000` dentro da VPS, sem porta exposta à
  internet; o proxy do painel ICP é quem expõe o domínio público.

## Containers Docker em produção (grupo `js-lead-hunter` / `supabase`)

| Container | Função | Observação |
|---|---|---|
| `supabase-db` | PostgreSQL 17.6 | limite 2.5 GB RAM / 2 vCPU |
| `supabase-auth`, `supabase-rest`, `supabase-storage`, `supabase-realtime`, `supabase-meta`, `supabase-studio`, `supabase-pooler`, `supabase-envoy`, `supabase-edge-functions`, `supabase-imgproxy` | stack Supabase auto-hospedado | todos `healthy` |
| `jslh-web` | Nginx servindo o build do frontend (`web/dist`) | porta `127.0.0.1:8090`, atrás do proxy do painel |
| `js-lead-hunter-worker-migrate-1` | aplica migrations pendentes | roda uma vez e sai (`restart: "no"`) |
| `js-lead-hunter-worker-worker-1` | importação Receita Federal | limite 3 GB RAM / 1.5 vCPU |
| `js-lead-hunter-worker-intel-1` | inteligência digital (fila de pesquisa) | limite 768 MB / 0.5 vCPU |
| `js-lead-hunter-worker-manutencao-1` | inventário diário + arquivamento (desligado por padrão, migration 012) | limite 256 MB / 0.25 vCPU |

Esses containers compartilham a VPS com outros projetos independentes (`consultorio-*`,
`inpi-agent-*`, `jsdesigner-workana-app`). Nenhum deles foi tocado nesta operação; todos
continuam saudáveis.

## Estado dos dados (confirmado via inventário do worker, 27/11/2026 01:26 UTC)

```json
{
  "empresas": 97354,
  "estabelecimentos": 98310,
  "leads": 91566,
  "leads_ativos": 91566,
  "leads_arquivados": 69320,
  "eventos": 91620,
  "eventos_comerciais": 54,
  "contatos": 4,
  "propostas": 0,
  "respostas": 0,
  "bloqueios": 0,
  "usuarios": 2,
  "competencia_vigente": "2026-11",
  "banco_mb": 472
}
```

Esses dados foram migrados do Supabase em nuvem para a VPS em 26/11/2026 às 21:10 (pasta
`/srv/js-lead-hunter/migracao/20261126-2110/`), usando o roteiro `deploy/vps/scripts/`
(`01-copiar-da-nuvem.sh` → `02-restaurar-na-vps.sh` → `03-conferir.sh`). A conferência
(`diferencas-inventario.txt`, `diferencas-permissoes.txt`) não apontou nenhuma diferença:
a cópia bateu linha a linha com a origem.

## O que foi feito nesta sessão (27/11/2026)

1. Confirmado que o Supabase self-hosted e o frontend já estavam no ar (migração de 26/11).
2. Configurado `/srv/js-lead-hunter/app/deploy/vps/worker/.env` (senha do banco lida
   diretamente de `/srv/js-lead-hunter/supabase/.env`, nunca exposta em texto).
3. Subido o worker (`docker compose up -d --build` em `deploy/vps/worker/`): `migrate`
   confirmou "nenhuma pendente", `worker`/`intel`/`manutencao` no ar.
4. Confirmado que os GitHub Actions deste repositório (`js-lead-hunter-3`) permanecem
   desligados por padrão (`vars.PERMITIR_WORKER` não definido) — sem risco de um segundo
   worker gravando no mesmo banco.
5. Agendado o backup diário (`crontab`, 03:30, `deploy/vps/scripts/05-backup-diario.sh`) e
   testado manualmente uma vez: OK, 76 tabelas, 51 MB, `SHA256SUMS` gerado.
6. Validado end-to-end: site `HTTP 200`, API `HTTP 401` (esperado sem token).

## Pendências reais (bloqueios, não simulados)

- **Chaves de API opcionais** (`GOOGLE_PLACES_API_KEY`, `BRAVE_SEARCH_API_KEY`): não
  configuradas no worker da VPS. Os canais correspondentes (Perfil no Google, Instagram,
  Facebook, LinkedIn, site via busca) ficam em **"pendente"**, nunca "não localizado" —
  comportamento correto do motor, não uma falha. Só o domínio do e-mail cadastral é
  verificado até que as chaves sejam fornecidas.
- **Backup externo (fora da VPS)**: `RCLONE_REMOTE` e `BACKUP_GPG_PASSPHRASE` não
  configurados em `migracao.env`. O backup diário por ora fica só dentro da própria VPS
  (`/srv/js-lead-hunter/backups/`, retenção de 14 dias) — recomendável configurar um
  destino externo (Google Drive, R2, Backblaze) para não depender só do mesmo disco.
- **SMTP**: usado para convites e recuperação de senha. Configurado durante a migração de
  26/11 (não revisado nesta sessão); confirme o envio de e-mail real antes de convidar
  novos usuários.
- **Supabase em nuvem**: segundo o roteiro de migração, deve permanecer intacto por até 30
  dias como plano de volta, e só depois ser desligado. Ainda não foi encerrado
  (decisão sua, fora do escopo técnico desta sessão).
