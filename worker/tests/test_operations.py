import threading
from unittest.mock import MagicMock

import psycopg
import pytest

from lead_hunter.operations import run_operations, serve_operations


def test_operacoes_reais_e_idempotentes(fresh_db):
    a=run_operations(fresh_db)
    b=run_operations(fresh_db)
    assert a['status']=='concluido' and a['created']==0
    assert b['status']=='concluido' and b['created']==0
    with psycopg.connect(fresh_db) as c:
        assert c.execute('select count(*) from sales_automation_runs').fetchone()[0]==2
        assert c.execute('select count(*) from sales_automation_items').fetchone()[0]==0


def test_duas_rodadas_nao_disputam_lock(fresh_db):
    with psycopg.connect(fresh_db) as c:
        c.execute('select pg_advisory_xact_lock(734001802)')
        result=run_operations(fresh_db)
        assert result['status']=='ocupado'
        assert result['created']==0


def test_worker_reagenda_falha_sem_encerrar(monkeypatch):
    stop=threading.Event()
    calls=[]
    def fail(_):
        calls.append(1)
        stop.set()
        raise RuntimeError('segredo que nao deve ir ao log')
    monkeypatch.setattr('lead_hunter.operations.run_operations',fail)
    serve_operations('unused',stop=stop,interval=30)
    assert len(calls)==1


def test_loop_nao_roda_quando_parado(monkeypatch):
    stop=threading.Event();stop.set()
    fn=MagicMock()
    monkeypatch.setattr('lead_hunter.operations.run_operations',fn)
    serve_operations('unused',stop=stop)
    fn.assert_not_called()
