"""Aplica as migrations de supabase/migrations que ainda não foram aplicadas.

Controle em public.app_migrations. Se o banco foi criado manualmente pelo
SQL Editor (sem esse controle), as migrations cujos objetos já existem são
registradas como aplicadas antes de continuar.
"""
from __future__ import annotations

import logging
import os
from pathlib import Path

import psycopg

log = logging.getLogger(__name__)

# Objeto que comprova que cada migration já foi aplicada manualmente
MARKERS = {
    "20261114000001": "select to_regclass('public.leads') is not null",
    "20261114000002": "select to_regprocedure('public.current_app_role()') is not null",
    "20261114000003": "select exists (select 1 from public.service_catalog)",
    "20261114000004": "select to_regprocedure('public.cnpj_is_valid(text)') is not null",
    "20261114000005": "select to_regprocedure('public.current_reference_date()') is not null",
    "20261116000006": "select exists (select 1 from public.cnae_service_rules where cnae_prefix = '9602')",
    "20261116000007": "select false",
    "20261116000008": "select false",
    "20261116000010": "select to_regclass('public.lead_archive') is not null",
    "20261116000009": "select to_regclass('public.scoring_versions') is not null or exists (select 1 from public.scoring_rules where key = 'cnae_compativel' and points = 35)",
    "20261125000011": "select to_regclass('public.lead_proposals') is not null",
    "20261126000012": "select to_regclass('public.registry_changes') is not null",
    "20261126000013": "select to_regclass('public.opportunities') is not null",
    "20261126000014": "select to_regclass('public.digital_channels') is not null",
    "20261126000015": "select to_regclass('public.scoring_versions') is not null",
    "20261127000016": "select to_regprocedure('public.my_operation_summary()') is not null",
}


# Dados criados pelas pessoas (não recuperáveis da Receita). Pequenos: cabem no
# plano gratuito. Leads entram só se tiverem alguma ação comercial.
BACKUP_TABLES = {
    "profiles": "true",
    "leads": "stage <> 'novo' or owner_id is not null or next_follow_up_at is not null or website is not null",
    "lead_events": "event_type not in ('criado', 'pontuacao_alterada')",
    "lead_proposals": "true",
    "lead_searches": "true",
    "contact_suppressions": "true",
    "service_catalog": "true",
    "cnae_service_rules": "true",
    "scoring_rules": "true",
    "message_templates": "true",
    "app_settings": "true",
}


def backup_commercial_data(c: psycopg.Connection, label: str) -> str:
    """Cópia de segurança dos dados comerciais num esquema próprio, antes de migrations.

    O esquema não é exposto pela API do Supabase (só `public` é) e fica sem acesso
    para anon/authenticated. Restaurar: copiar as linhas de volta com INSERT ... SELECT.
    """
    from datetime import datetime, timezone

    schema = "backup_" + datetime.now(timezone.utc).strftime("%Y%m%d%H%M") + "_" + label
    c.execute(f'create schema if not exists "{schema}"')
    c.execute(f'revoke all on schema "{schema}" from public')
    for table, where in BACKUP_TABLES.items():
        if not c.execute("select to_regclass(%s) is not null", (f"public.{table}",)).fetchone()[0]:
            continue
        c.execute(f'create table "{schema}".{table} as select * from public.{table} where {where}')
    log.info("Cópia de segurança dos dados comerciais em %s", schema)
    return schema


def default_dir() -> Path:
    env = os.getenv("MIGRATIONS_DIR")
    return Path(env) if env else Path(__file__).resolve().parents[2] / "supabase" / "migrations"


def migrate(database_url: str, directory: Path | None = None) -> list[str]:
    directory = directory or default_dir()
    files = sorted(directory.glob("*.sql"))
    if not files:
        raise SystemExit(f"Nenhuma migration encontrada em {directory}")
    applied_now: list[str] = []
    with psycopg.connect(database_url, autocommit=True, cursor_factory=psycopg.ClientCursor) as c:
        c.execute("""
            create table if not exists public.app_migrations (
              version text primary key, name text not null, applied_at timestamptz not null default now())""")
        c.execute("alter table public.app_migrations enable row level security")
        c.execute("revoke all on public.app_migrations from anon, authenticated")
        applied = {r[0] for r in c.execute("select version from public.app_migrations")}

        if not applied and c.execute("select to_regclass('public.leads') is not null").fetchone()[0]:
            for f in files:
                version = f.name.split("_", 1)[0]
                marker = MARKERS.get(version)
                if marker and c.execute(marker).fetchone()[0]:
                    c.execute("insert into public.app_migrations (version, name) values (%s, %s)", (version, f.name))
                    applied.add(version)
                    log.info("Migration já presente no banco: %s", f.name)

        pending = [f for f in files if f.name.split("_", 1)[0] not in applied]
        if pending and c.execute("select to_regclass('public.leads') is not null").fetchone()[0]:
            backup_commercial_data(c, "pre_" + pending[0].name.split("_", 1)[0])

        for f in pending:
            version = f.name.split("_", 1)[0]
            log.info("Aplicando migration %s", f.name)
            with c.transaction():
                # migrations podem ser longas: sem o limite de tempo da conexão (Supabase)
                c.execute("set local statement_timeout = 0")
                c.execute(f.read_text(encoding="utf-8"))
                c.execute("insert into public.app_migrations (version, name) values (%s, %s)", (version, f.name))
            applied_now.append(f.name)
    return applied_now
