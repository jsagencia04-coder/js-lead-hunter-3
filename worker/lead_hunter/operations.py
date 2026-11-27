"""Rodadas limitadas de automações internas/watchlists; sem mensagens externas ou IA paga."""
from __future__ import annotations

import logging
import signal
import threading

import psycopg

log = logging.getLogger(__name__)


def run_operations(database_url: str, limit: int = 100) -> dict:
    # Cada função é transacional e tem lock/idempotência no banco.
    with psycopg.connect(database_url, autocommit=True, connect_timeout=15) as conn:
        conn.execute("set statement_timeout = '60s'")
        watched = conn.execute('select public.schedule_company_watches(%s)', (limit,)).fetchone()[0]
        result = conn.execute('select public.run_sales_automations(%s)', (limit,)).fetchone()[0]
        agents = []
        for _ in range(min(10, max(1, limit))):
            job = conn.execute('select public.run_operational_agent_job()').fetchone()[0]
            if job['status'] == 'vazio':
                break
            agents.append(job)
    return {**result, 'watches_scheduled': watched, 'agent_jobs_processed': len(agents),
            'agent_errors': sum(j['status'] == 'erro' for j in agents)}


def serve_operations(database_url: str, *, interval: int = 300, stop: threading.Event | None = None) -> None:
    stop = stop or threading.Event()
    if threading.current_thread() is threading.main_thread():
        signal.signal(signal.SIGTERM, lambda *_: stop.set())
        signal.signal(signal.SIGINT, lambda *_: stop.set())
    while not stop.is_set():
        try:
            result = run_operations(database_url)
            # Somente totais/status; nenhum dado comercial ou credencial no log.
            log.info('Operações internas: status=%s criadas=%s erros=%s pesquisas_agendadas=%s agentes=%s erros_agentes=%s',
                     result.get('status'), result.get('created', 0), result.get('errors', 0), result['watches_scheduled'],
                     result.get('agent_jobs_processed', 0), result.get('agent_errors', 0))
        except Exception as exc:
            # Rodada falha não encerra o processo; fila/ledger permanecem no banco.
            log.error('Operações internas indisponíveis: %s; nova tentativa em %ss', type(exc).__name__, interval)
        stop.wait(max(30, interval))
