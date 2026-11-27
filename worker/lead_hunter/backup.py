"""Backup verificável do banco (dados do esquema public).

    python -m lead_hunter backup [PASTA]              # gera o backup
    python -m lead_hunter backup-verify PASTA         # confere arquivos x manifesto
    python -m lead_hunter restore-test PASTA URL      # restaura num banco VAZIO de teste e compara

O backup é tirado numa única transação somente leitura (REPEATABLE READ): todas
as tabelas refletem o mesmo instante. Cada tabela vira um CSV compactado (gzip),
e o manifesto guarda colunas, quantidade de linhas e SHA-256 de cada arquivo.

O backup contém dados pessoais (telefones e e-mails do cadastro público, histórico
comercial). Guarde-o em local protegido; nunca envie ao GitHub.
"""
from __future__ import annotations

import csv
import gzip
import hashlib
import io
import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

import psycopg
from psycopg import sql

log = logging.getLogger(__name__)
try:
    csv.field_size_limit(sys.maxsize)
except OverflowError:
    # Windows: o C long interno do csv é de 32 bits; sys.maxsize (64 bits) não cabe.
    csv.field_size_limit(2**31 - 1)

# Ordem de restauração (pais antes dos filhos); tabelas novas entram no fim
ORDER = [
    "app_migrations", "profiles", "cnae_catalog", "municipalities", "legal_natures", "companies",
    "company_simple_status", "establishments", "service_catalog", "cnae_service_rules", "scoring_rules",
    "import_jobs", "leads", "lead_events", "lead_recommendations", "lead_proposals", "lead_searches",
    "contact_suppressions", "message_templates", "message_logs", "integration_status", "audit_logs",
    "app_settings", "lead_archive", "registry_changes", "data_inventory_snapshots",
]


def _tables(conn: psycopg.Connection) -> list[str]:
    rows = conn.execute("""select table_name from information_schema.tables
                            where table_schema = 'public' and table_type = 'BASE TABLE'""").fetchall()
    names = {r[0] for r in rows}
    return [t for t in ORDER if t in names] + sorted(names - set(ORDER))


def _columns(conn: psycopg.Connection, table: str) -> list[str]:
    """Colunas gravadas (sem as geradas, que o banco recalcula na restauração)."""
    return [r[0] for r in conn.execute(
        """select column_name from information_schema.columns
            where table_schema = 'public' and table_name = %s and is_generated = 'NEVER'
            order by ordinal_position""", (table,)).fetchall()]


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for b in iter(lambda: fh.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def _count_csv_rows(path: Path) -> int:
    with gzip.open(path, "rt", encoding="utf-8", newline="") as fh:
        r = csv.reader(fh)
        next(r, None)
        return sum(1 for _ in r)


def backup(database_url: str, out_dir: Path) -> Path:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    dest = Path(out_dir) / f"js-lead-hunter-backup-{stamp}"
    dest.mkdir(parents=True, exist_ok=False)
    manifest: dict = {"criado_em": datetime.now(timezone.utc).isoformat(), "formato": 1, "tabelas": {}}
    with psycopg.connect(database_url) as c:
        c.execute("set transaction isolation level repeatable read, read only")
        manifest["servidor"] = c.execute("show server_version").fetchone()[0]
        manifest["banco_mb"] = round(c.execute("select pg_database_size(current_database())").fetchone()[0] / 1048576)
        tables = _tables(c)
        for t in tables:
            cols = _columns(c, t)
            n = c.execute(sql.SQL("select count(*) from public.{}").format(sql.Identifier(t))).fetchone()[0]
            path = dest / f"{t}.csv.gz"
            q = sql.SQL("COPY (SELECT {} FROM public.{}) TO STDOUT WITH (FORMAT csv, HEADER true)").format(
                sql.SQL(", ").join(sql.Identifier(x) for x in cols), sql.Identifier(t))
            with gzip.open(path, "wb", compresslevel=6) as gz, c.cursor().copy(q) as cp:
                for chunk in cp:
                    gz.write(bytes(chunk))
            manifest["tabelas"][t] = {"linhas": n, "colunas": cols, "arquivo": path.name, "sha256": _sha256(path)}
            log.info("Backup %s: %d linhas", t, n)
        c.rollback()
    (dest / "manifesto.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    problems = verify(dest)
    if problems:
        raise RuntimeError("Backup gerado, mas a verificação falhou: " + "; ".join(problems))
    return dest


def verify(folder: Path) -> list[str]:
    """Confere hash e quantidade de linhas de cada arquivo contra o manifesto."""
    folder = Path(folder)
    manifest = json.loads((folder / "manifesto.json").read_text(encoding="utf-8"))
    problems = []
    for t, info in manifest["tabelas"].items():
        path = folder / info["arquivo"]
        if not path.exists():
            problems.append(f"{t}: arquivo ausente")
            continue
        if _sha256(path) != info["sha256"]:
            problems.append(f"{t}: arquivo alterado ou corrompido (SHA-256 diferente)")
            continue
        n = _count_csv_rows(path)
        if n != info["linhas"]:
            problems.append(f"{t}: {n} linhas no arquivo, {info['linhas']} no manifesto")
    return problems


def restore(folder: Path, target_url: str) -> dict:
    """Restaura num banco de TESTE já com a estrutura (migrations) e sem dados.

    Recusa bancos que já tenham leads ou empresas: nunca sobrescreve uma base real.
    Exige superusuário (desliga gatilhos e chaves durante a carga).
    """
    folder = Path(folder)
    manifest = json.loads((folder / "manifesto.json").read_text(encoding="utf-8"))
    result: dict[str, dict] = {}
    with psycopg.connect(target_url) as c:
        for guard in ("leads", "companies", "lead_events"):
            if c.execute(sql.SQL("select exists (select 1 from public.{})").format(sql.Identifier(guard))).fetchone()[0]:
                raise RuntimeError(f"O banco de destino já tem dados em {guard}: a restauração só roda num banco vazio")
        c.execute("set session_replication_role = replica")
        present = set(_tables(c))
        for t in [t for t in ORDER if t in manifest["tabelas"]] + sorted(set(manifest["tabelas"]) - set(ORDER)):
            info = manifest["tabelas"][t]
            if t not in present:
                result[t] = {"esperado": info["linhas"], "restaurado": None, "erro": "tabela inexistente no destino"}
                continue
            # dados de referência criados pelas migrations são substituídos pelos do backup
            c.execute(sql.SQL("delete from public.{}").format(sql.Identifier(t)))
            cols = sql.SQL(", ").join(sql.Identifier(x) for x in info["colunas"])
            c.execute(sql.SQL("create temp table _r (like public.{} including defaults) on commit drop").format(sql.Identifier(t)))
            c.execute("alter table _r alter column " + ", alter column ".join(
                f'"{x}" drop not null' for x in info["colunas"]) if info["colunas"] else "select 1")
            with gzip.open(folder / info["arquivo"], "rb") as gz, c.cursor().copy(
                    sql.SQL("COPY _r ({}) FROM STDIN WITH (FORMAT csv, HEADER true)").format(cols)) as cp:
                while b := gz.read(1 << 20):
                    cp.write(b)
            c.execute(sql.SQL("insert into public.{} ({}) overriding system value select {} from _r").format(
                sql.Identifier(t), cols, cols))
            c.execute("drop table _r")
            n = c.execute(sql.SQL("select count(*) from public.{}").format(sql.Identifier(t))).fetchone()[0]
            result[t] = {"esperado": info["linhas"], "restaurado": n}
        # sequências de identidade voltam a continuar do maior id restaurado
        for t, col in c.execute("""select table_name, column_name from information_schema.columns
                                    where table_schema = 'public' and is_identity = 'YES'""").fetchall():
            c.execute(sql.SQL("select setval(pg_get_serial_sequence({}, {}), coalesce((select max({}) from public.{}), 0) + 1, false)")
                      .format(sql.Literal(f"public.{t}"), sql.Literal(col), sql.Identifier(col), sql.Identifier(t)))
        c.execute("set session_replication_role = origin")
    return result


def main_backup(database_url: str, out: str | None) -> int:
    dest = backup(database_url, Path(out or "backups"))
    m = json.loads((dest / "manifesto.json").read_text(encoding="utf-8"))
    total = sum(i["linhas"] for i in m["tabelas"].values())
    print(f"Backup verificado em {dest}: {len(m['tabelas'])} tabelas, {total} linhas.")
    for t, i in m["tabelas"].items():
        print(f"  {t:32s} {i['linhas']:>10}")
    print("ATENÇÃO: o backup contém dados pessoais. Guarde em local protegido e não envie ao GitHub.")
    return 0


def main_verify(folder: str) -> int:
    problems = verify(Path(folder))
    if problems:
        print("Backup com problemas:\n  " + "\n  ".join(problems))
        return 2
    print("Backup íntegro: todos os arquivos conferem com o manifesto.")
    return 0


def main_restore_test(folder: str, target: str) -> int:
    res = restore(Path(folder), target)
    bad = {t: r for t, r in res.items() if r.get("restaurado") != r["esperado"]}
    buf = io.StringIO()
    for t, r in res.items():
        buf.write(f"  {t:32s} esperado {r['esperado']:>10}  restaurado {r.get('restaurado')}\n")
    print(buf.getvalue())
    if bad:
        print("Restauração com divergências: " + ", ".join(bad))
        return 2
    print("Restauração de teste concluída: todas as tabelas conferem.")
    return 0
