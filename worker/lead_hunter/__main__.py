"""CLI do worker.

    python -m lead_hunter run                 # laço contínuo (produção)
    python -m lead_hunter check               # mostra a competência mais recente na fonte
    python -m lead_hunter import [AAAA-MM]    # importa agora (sem esperar a interface)
    python -m lead_hunter intel [--minutos N]  # inteligência digital (processo separado da importação)
    python -m lead_hunter maintenance         # manutenção: arquivamento (se ligado) e inventário
    python -m lead_hunter inventory           # quantidades de registros (antes/depois de mudanças)
    python -m lead_hunter backup [PASTA]      # backup verificável (CSV.gz + manifesto com SHA-256)
    python -m lead_hunter backup-verify PASTA
    python -m lead_hunter restore-test PASTA URL_DE_UM_BANCO_VAZIO_DE_TESTE
"""
from __future__ import annotations

import argparse
import logging
import sys

from .config import Settings
from .jobs import Worker
from .rf_source import RFSource, reference_date


def _setup_logging() -> None:
    """Console + arquivo rotativo em DATA_DIR/logs/worker.log (para acompanhar remotamente)."""
    import os
    from logging.handlers import RotatingFileHandler
    from pathlib import Path

    from .config import load_env_file

    load_env_file()
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    console = logging.StreamHandler()
    console.setFormatter(fmt)
    root.addHandler(console)
    # Uma linha por site verificado expõe domínios de empresas nos logs (públicos no
    # GitHub Actions de repositório público). Só avisos e erros dessas bibliotecas.
    for noisy in ("httpx", "httpcore"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    try:
        data_dir = Path(os.getenv("DATA_DIR") or (Path(__file__).resolve().parents[1] / "data"))
        (data_dir / "logs").mkdir(parents=True, exist_ok=True)
        fh = RotatingFileHandler(data_dir / "logs" / "worker.log", maxBytes=5_000_000, backupCount=3, encoding="utf-8")
        fh.setFormatter(fmt)
        root.addHandler(fh)
    except OSError:
        root.warning("Não foi possível criar o arquivo de log")


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="lead_hunter", description="Worker de importação do JS Lead Hunter")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("run", help="laço contínuo: atende a interface e verifica novas competências")
    sub.add_parser("check", help="lista a competência mais recente disponível")
    sub.add_parser("once", help="uma rodada (para execução agendada, ex.: GitHub Actions)")
    sub.add_parser("migrate", help="aplica as migrations pendentes do banco")
    sub.add_parser("inventory", help="registra e mostra as quantidades de registros")
    it = sub.add_parser("intel", help="processa a fila de inteligência digital")
    it.add_argument("--minutos", type=int, default=40, help="tempo máximo da rodada (padrão 40)")
    it.add_argument("--max", type=int, default=None, help="máximo de empresas nesta rodada")
    sub.add_parser("maintenance", help="manutenção: arquivamento (se ligado) e inventário")
    op = sub.add_parser("operations", help="automações internas e watchlists persistentes")
    op.add_argument("--once", action="store_true", help="executa uma única rodada")
    bk = sub.add_parser("backup", help="backup verificável do banco")
    bk.add_argument("folder", nargs="?", help="pasta de destino (padrão: ./backups)")
    bv = sub.add_parser("backup-verify", help="confere um backup")
    bv.add_argument("folder")
    rt = sub.add_parser("restore-test", help="restaura um backup num banco vazio de teste e compara")
    rt.add_argument("folder")
    rt.add_argument("target_url")
    imp = sub.add_parser("import", help="importa uma competência imediatamente")
    imp.add_argument("competence", nargs="?", help="AAAA-MM (padrão: mais recente completa)")
    args = p.parse_args(argv)

    _setup_logging()

    if args.cmd == "check":
        import os

        from .config import load_env_file

        load_env_file()
        os.environ.setdefault("DATABASE_URL", "postgresql://nao-usado")
        src = RFSource(Settings.from_env())
        try:
            found = src.latest_complete_competence()
        except Exception as exc:  # noqa: BLE001
            print(f"Não foi possível consultar a fonte da Receita: {exc}")
            print("Verifique a internet do servidor, RF_BASE_URL e RF_SHARE_TOKEN (ou use RF_MODE=local).")
            return 2
        if not found:
            print("Nenhuma competência completa encontrada.")
            return 1
        comp, files = found
        total = sum(f.size or 0 for f in files)
        print(f"Competência: {comp} | referência: {reference_date(files)} | {len(files)} arquivos | {total / 1e9:.1f} GB")
        return 0

    if args.cmd in ("backup", "backup-verify", "restore-test"):
        from . import backup as bk

        if args.cmd == "backup":
            return bk.main_backup(Settings.from_env().database_url, args.folder)
        if args.cmd == "backup-verify":
            return bk.main_verify(args.folder)
        return bk.main_restore_test(args.folder, args.target_url)

    if args.cmd == "intel":
        import json
        import time

        from .intel.engine import IntelEngine

        s = Settings.from_env()
        eng = IntelEngine(s.database_url, db_size_limit_mb=s.db_size_limit_mb)
        stats = eng.run(deadline=time.monotonic() + args.minutos * 60, max_items=args.max)
        print("Inteligência digital: " + json.dumps(stats, ensure_ascii=False))
        return 0 if stats.get("situacao") != "falhou" else 2

    if args.cmd == "operations":
        from .operations import run_operations, serve_operations
        import json
        settings = Settings.from_env()
        if args.once:
            result = run_operations(settings.database_url)
            print(json.dumps(result, ensure_ascii=False))
            return 2 if result.get('status') == 'falhou' else 0
        serve_operations(settings.database_url)
        return 0

    if args.cmd == "migrate":
        from .migrate import migrate

        done = migrate(Settings.from_env().database_url)
        print("Migrations aplicadas: " + (", ".join(done) if done else "nenhuma pendente"))
        return 0

    worker = Worker(Settings.from_env())
    try:
        if args.cmd == "run":
            worker.loop()
        elif args.cmd == "maintenance":
            worker.inventory("manutenção (início)")
            worker.recalc()
            worker.archive()
            worker.inventory("manutenção (fim)")
        elif args.cmd == "inventory":
            import json

            counts = worker.inventory("manual")
            print(json.dumps(counts, ensure_ascii=False, indent=2) if counts else "Inventário indisponível (aplique as migrations)")
        elif args.cmd == "once":
            worker.once()
        elif args.cmd == "import":
            job_id = worker.enqueue("importacao", "manual", args.competence)
            job = worker.claim()
            if not job or str(job["id"]) != job_id:
                print("Há outro job pendente na fila; ele será executado primeiro pelo laço do worker.")
                return 1
            worker.run_job(job)
            status = worker.state.execute("SELECT status FROM public.import_jobs WHERE id = %s", (job_id,)).fetchone()
            print(f"Job {job_id}: {status['status']}")
            return 0 if status["status"] == "concluido" else 2
    finally:
        worker.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
