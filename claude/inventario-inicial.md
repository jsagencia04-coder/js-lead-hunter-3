# Inventário inicial — JS Lead Hunter 3.0

Data da auditoria: 27/11/2026
Branch de desenvolvimento: `feature/js-lead-hunter-v3`
Commit inicial (main): `2294a0c` — "Cópia de trabalho: desliga agendamentos e protege a produção"
Commit após correção de ONDA 1: `ef7a94b`

## 1. Identificação do repositório

- Repositório auditado: `jsagencia04-coder/js-lead-hunter-3` (público) — **cópia de trabalho/homologação**.
- Repositório de produção real: `jsagencia04-coder/js-lead-hunter` (conforme README, linha 3-6).
- Este repositório tem os agendamentos do GitHub Actions **desligados**; workers só rodam manualmente com `PERMITIR_WORKER=sim`.
- Branch `migracao-vps` (não mergeada em `main`): contém um pacote de migração para hospedar Supabase self-hosted numa VPS (`deploy/vps/*`), ainda não integrado a esta auditoria.

## 2. Stack técnica

| Camada | Tecnologia |
|---|---|
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS + React Router, Supabase JS client |
| Backend/Banco | Supabase (PostgreSQL + Auth + RLS + Edge Functions) |
| Worker | Python 3.12, DuckDB + Polars (ETL dos ZIPs da Receita), httpx |
| Edge Functions | Deno (`supabase/functions/invite-user`) |
| Infraestrutura | Docker Compose (worker/intel/manutenção), GitHub Actions (CI + importação agendada) |
| Frontend hosting | Vercel / Netlify / Cloudflare Pages (configurável via `vercel.json`/`netlify.toml`) |

## 3. Estrutura de pastas

```
├── supabase/
│   ├── migrations/      15 migrations (20261114 → 20261126), todas aditivas a partir da 011
│   ├── functions/       invite-user (Edge Function, service_role isolada no servidor)
│   └── tests/           testes SQL de RLS e regras de negócio (run.sh)
├── worker/
│   ├── lead_hunter/     módulo Python (import, enrich, intel, backup, jobs, migrate...)
│   ├── lead_hunter/intel/  motor de inteligência digital (audit, engine, match, netguard, providers)
│   ├── tests/           56 testes (pytest), incluindo pipeline e2e e preservação
│   └── windows/         atalhos .bat para rodar no Windows sem Docker
├── web/
│   └── src/              App React: Dashboard, Leads, Crm, Opportunities, Intelligence, MapPage,
│                          Imports, Agenda, Proposals, Clients, Services, Reports, Admin
├── .github/workflows/    ci.yml, worker.yml, inteligencia.yml, rf-probe.yml
└── docker-compose.yml    migrate / worker / intel / manutencao
```

## 4. Migrations (banco)

15 migrations aplicadas em ordem, sem erro, contra Postgres 17 limpo:

```
20261114000001_schema.sql
20261114000002_security.sql
20261114000003_business_config.sql
20261114000004_intelligence_crm.sql
20261114000005_reference_date.sql
20261116000006_cnae_rules.sql
20261116000007_digital_presence_fix.sql
20261116000008_accountant_domains.sql
20261116000009_scoring_weights.sql
20261116000010_lead_archive.sql
20261125000011_operacao_comercial.sql
20261126000012_preservacao_dados.sql
20261126000013_crm_profissional.sql
20261126000014_inteligencia_digital.sql
20261126000015_pontuacao_oportunidades.sql
```

Todas são aditivas a partir da 011 (preservação por design). Os `NOTICE: ... does not exist, skipping` observados na aplicação são normais (migrations fazem `drop ... if exists` antes de recriar).

## 5. Módulos já operacionais (confirmados por código + testes, não hipotéticos)

- **Importação CNPJ (Receita Federal):** download retomável em partes, DuckDB + Polars, CNPJ alfanumérico (DV), conversão Latin-1→UTF-8, transação única (idempotente), heartbeat/lock entre workers concorrentes, trava de espaço em banco (`DB_SIZE_LIMIT_MB`).
- **Preservação de dados:** arquivamento não-destrutivo, restauração de leads arquivados, histórico de alterações cadastrais (`registry_changes`), inventário por rodada (`data_inventory_snapshots`), backup verificável com SHA-256 + manifesto + teste de restauração em banco vazio.
- **Inteligência digital:** arquitetura de provedores intercambiáveis (`GooglePlaces`, `BraveSearch`, domínio do e-mail), cache de 30 dias, orçamento/limite diário por provedor, proteção SSRF completa (IP público, DNS rebinding, limite de redirecionamentos, limite de corpo), status nunca confunde bloqueio/erro com ausência.
- **Auditoria de site:** disponibilidade, HTTPS, SEO básico, contatos, links quebrados, domínio estacionado — passiva, sem exploração.
- **Pontuação (scoring):** versionada, explicável (`score_reasons`, `scoring_versions`), por critério, com recalculável via admin.
- **CRM:** Kanban com 12 etapas, múltiplas oportunidades por empresa, motivos de perda, reativação, histórico imutável.
- **RLS:** todas as tabelas sem acesso anônimo; papéis verificados no banco (confirmado nos testes de comportamento — bloqueios de leitura→admin, cliente→worker, etc. todos passam).
- **Edge Function `invite-user`:** `service_role` nunca sai do servidor; só admin ativo convida; valida papel e e-mail; grava auditoria.

## 6. Baseline de testes (ambiente local, banco descartável)

| Suite | Resultado |
|---|---|
| SQL (`supabase/tests/run.sh`, 15 migrations + `01_behaviour.sql`) | **100% das asserções passaram** (RLS, scoring, CRM, preservação, restauração, indicadores) |
| Worker Python (`pytest`, 56 testes) | **56/56 passaram** após corrigir `backup.py` (ver ONDA 1) |
| Frontend (`tsc -b && vite build`) | **Build limpo**, sem erros TypeScript. 1 aviso de chunk >500 kB (otimização, não bloqueante) |

Banco de teste usado: Postgres 17 descartável via Docker, porta 55432 — **não é o banco de homologação/produção real**, nenhum dado de produção foi tocado.

## 7. Dados reais em produção

Não houve acesso ao `DATABASE_URL` de produção/homologação nesta auditoria (credencial não fornecida nesta sessão). Portanto:

- Quantidade real de empresas, leads, clientes, propostas, contratos etc. **não pôde ser lida** — bloqueado por ausência de credencial, conforme diretriz de não assumir dados fictícios em produção.
- Qualquer "relatório baseline" com volumetria real do banco de produção/homologação depende de receber o `DATABASE_URL` correspondente (ver seção de bloqueios no relatório principal).

## 8. Variáveis de ambiente mapeadas (sem valores secretos)

**Worker** (`worker/.env.example`): `DATABASE_URL`, `RF_MODE`, `RF_BASE_URL`, `RF_SHARE_TOKEN`, `DATA_DIR`, `LEAD_WINDOW_DAYS`, `INCLUDE_BRANCHES`, `CHECK_INTERVAL_HOURS`, `AUTO_IMPORT`, `POLL_SECONDS`, `DOWNLOAD_CONNECTIONS`, `DOWNLOAD_CHUNK_MB`, `KEEP_LOCAL_ZIPS`, `DUCKDB_MEMORY`, `DUCKDB_THREADS`, `S3_*` (opcional), `GOOGLE_PLACES_API_KEY` (opcional), `BRAVE_SEARCH_API_KEY` (opcional), `INTEL_IN_WORKER`, `INTEL_MINUTES`, `DB_SIZE_LIMIT_MB`.

**Frontend** (`web/.env.example`): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (só a chave pública/anon).

**GitHub Actions** (conforme README): Secret `DATABASE_URL`; Variable opcional `LEAD_WINDOW_DAYS`.

## 9. Estado atual conhecido (conforme README, 25/11/2026)

- Banco: Supabase gratuito, ~447 MB de 500 MB, **sem backups automáticos**.
- Worker: GitHub Actions de repositório **público**.
- Frontend: Netlify.
- Risco já documentado pelo próprio projeto: sem Supabase Pro, toda competência nova força arquivamento sem poder restaurar; `DATABASE_URL` de produção depende de um repositório público.
