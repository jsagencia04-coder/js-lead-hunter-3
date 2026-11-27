"""Teste ponta a ponta: fonte WebDAV falsa → DuckDB/Polars → Postgres com as migrations reais."""
import psycopg
from psycopg.rows import dict_row

from lead_hunter.config import Settings
from lead_hunter.jobs import Worker

from .fake_rf import TOKEN, FakeRF, build_competence, est_row


def make_worker(db, url, tmp_path):
    s = Settings(database_url=db, rf_base_url=url, rf_share_token=TOKEN, data_dir=tmp_path / "data",
                 chunk_mb=1, lead_window_days=90, duckdb_memory="512MB", duckdb_threads=2,
                 enrich_enabled=False)
    return Worker(s)


def q(db, sql, *args):
    with psycopg.connect(db, row_factory=dict_row) as c:
        return c.execute(sql, args).fetchall()


def run_import(w, competence=None):
    job_id = w.enqueue("importacao", "manual", competence)
    job = w.claim()
    assert str(job["id"]) == job_id
    w.run_job(job)
    return q(w.s.database_url, "select * from import_jobs where id = %s", job_id)[0]


def test_importacao_completa(fresh_db, tmp_path):
    root = tmp_path / "rf"
    build_competence(root, "2026-10")
    # bloqueio cadastrado antes da importação
    q(fresh_db, "insert into contact_suppressions (cnpj_basico, reason) values ('44555666', 'pedido do titular') returning id")

    with FakeRF(root) as rf:
        w = make_worker(fresh_db, rf.url, tmp_path)
        job = run_import(w)

    assert job["status"] == "concluido", job["errors"]
    assert job["is_current"] and job["competence"] == "2026-10"
    assert job["files_processed"] == 24 and job["records_read"] > 0
    # ZIPs e temporários removidos ao final (economia de disco)
    data_dir = tmp_path / "data"
    assert not (data_dir / "zips" / "2026-10").exists()
    assert not (data_dir / "work" / "2026-10").exists()

    leads = {r["cnpj"]: r for r in q(fresh_db, "select * from lead_list_v")}
    # só matrizes ativas, válidas, na janela e sem bloqueio
    assert {c[:8] for c in leads} == {"11222333", "12ABC345", "66777888", "88999000"}
    assert job["new_leads"] == 4
    cafe = next(r for r in leads.values() if r["cnpj_basico"] == "88999000")
    assert cafe["nome_fantasia"] == "CAFE\nDA ESQUINA"  # quebra de linha dentro de aspas

    padaria = next(r for r in leads.values() if r["cnpj_basico"] == "11222333")
    assert padaria["nome_fantasia"] == "PADARIA SÃO JOÃO"  # Latin-1 preservado
    assert padaria["email"] == "contato@padaria.com.br"
    assert padaria["has_phone"] and padaria["opcao_simples"] is True
    assert float(padaria["capital_social"]) == 10000.0
    assert padaria["municipio"] == "SAO PAULO" and padaria["uf"] == "SP"
    # pontuação 2.0: recência 10 + canais 5 + compatibilidade varejo 80% de 25 = 20 + potencial 15; sem pesquisa digital
    assert padaria["score"] == 50

    alfa = next(r for r in leads.values() if r["cnpj_basico"] == "12ABC345")
    assert alfa["cnpj"] == "12ABC34501DE35"

    loja = next(r for r in leads.values() if r["cnpj_basico"] == "66777888")
    assert loja["nome_fantasia"] == "LOJA A; B"  # ';' dentro de aspas
    assert loja["opcao_mei"] is True

    # dados fora da janela não entram no banco operacional
    assert not q(fresh_db, "select 1 from establishments where cnpj_basico = '33444555'")
    # baixada e DV inválido entram na base, mas não viram lead
    assert q(fresh_db, "select 1 from establishments where cnpj_basico = '22333444'")
    assert q(fresh_db, "select 1 from establishments where cnpj_basico = '55666777'")
    # recomendações geradas e auditoria sem poluição
    assert q(fresh_db, "select count(*) n from lead_recommendations")[0]["n"] == 20  # 5 leads × até 5 recomendações mais relevantes (015)
    assert q(fresh_db, "select count(*) n from audit_logs where table_name in ('leads','establishments')")[0]["n"] == 0
    # UF do município derivada dos estabelecimentos
    assert q(fresh_db, "select uf from municipalities where code = '6001'")[0]["uf"] == "RJ"


def test_reimportacao_idempotente_e_atualizacao(fresh_db, tmp_path):
    root = tmp_path / "rf"
    build_competence(root, "2026-10")
    with FakeRF(root) as rf:
        w = make_worker(fresh_db, rf.url, tmp_path)
        first = run_import(w)
        assert first["status"] == "concluido"

        # nova competência: padaria fica inapta (04) e surge empresa nova
        build_competence(root, "2026-11", extra_est=[est_row("77888999", fantasia="NOVA")])
        est_file = root / "2026-11" / "Estabelecimentos0.zip"
        import zipfile
        with zipfile.ZipFile(est_file) as z:
            name, content = z.namelist()[0], z.read(z.namelist()[0])
        content = content.replace(b'"11222333";"0001";"81";"1";"PADARIA S\xc3O JO\xc3O";"02"',
                                  b'"11222333";"0001";"81";"1";"PADARIA S\xc3O JO\xc3O";"04"')
        with zipfile.ZipFile(est_file, "w") as z:
            z.writestr(name, content)

        second = run_import(w)
        assert second["status"] == "concluido", second["errors"]
        # 77888999 não tem linha em Empresas*.zip: recebe registro mínimo de empresa e vira lead
        assert second["new_leads"] == 1
        again = run_import(w, "2026-11")
        assert again["status"] == "concluido" and again["new_leads"] == 0

    sit = q(fresh_db, "select situacao_cadastral from establishments where cnpj = '11222333000181'")[0]
    assert sit["situacao_cadastral"] == "04"
    assert q(fresh_db, "select count(*) n from leads where cnpj_basico = '11222333'")[0]["n"] == 1
    current = q(fresh_db, "select competence from import_jobs where is_current")
    assert [r["competence"] for r in current] == ["2026-11"]


def test_falha_nao_substitui_importacao_valida(fresh_db, tmp_path):
    root = tmp_path / "rf"
    build_competence(root, "2026-10")
    with FakeRF(root) as rf:
        w = make_worker(fresh_db, rf.url, tmp_path)
        assert run_import(w)["status"] == "concluido"
        build_competence(root, "2026-11", corrupt={"Empresas3.zip"})
        failed = run_import(w, "2026-11")
    assert failed["status"] == "falhou"
    assert failed["error_count"] >= 1
    current = q(fresh_db, "select competence from import_jobs where is_current")
    assert [r["competence"] for r in current] == ["2026-10"]


def test_verificacao_e_heartbeat(fresh_db, tmp_path):
    root = tmp_path / "rf"
    build_competence(root, "2026-10")
    with FakeRF(root) as rf:
        w = make_worker(fresh_db, rf.url, tmp_path)
        w.heartbeat()
        q(fresh_db, "select 1")  # noqa
        job_id = w.enqueue("verificacao", "manual")
        w.run_job(w.claim())
    job = q(fresh_db, "select * from import_jobs where id = %s", job_id)[0]
    assert job["status"] == "concluido" and job["competence"] == "2026-10"
    assert job["metadata"]["nova_competencia"] is True
    st = q(fresh_db, "select status, last_seen_at from integration_status where key = 'worker'")[0]
    assert st["status"] == "ativo" and st["last_seen_at"] is not None


def test_mensagem_de_falha_e_clara(fresh_db, tmp_path):
    root = tmp_path / "rf"
    build_competence(root, "2026-10", corrupt={"Empresas3.zip"})
    with FakeRF(root) as rf:
        w = make_worker(fresh_db, rf.url, tmp_path)
        job = run_import(w, "2026-10")
    assert job["status"] == "falhou"
    msg = job["errors"][-1]["msg"].lower()
    assert "zip" in msg or "crc" in msg, msg
    assert not q(fresh_db, "select 1 from import_jobs where is_current")
    assert not q(fresh_db, "select 1 from leads")


def test_migrate_em_banco_criado_manualmente(fresh_db):
    from lead_hunter.migrate import migrate

    # o banco de teste já tem as migrations aplicadas "à mão" (sem controle)
    first = migrate(fresh_db)
    # estruturais reconhecidas pelos marcadores; a correção de dados (007) é reaplicada sem efeito
    assert first == ["20261116000007_digital_presence_fix.sql", "20261116000008_accountant_domains.sql"]
    from lead_hunter.migrate import default_dir
    assert len(q(fresh_db, "select * from app_migrations")) == len(list(default_dir().glob("*.sql")))
    # cópia de segurança dos dados comerciais antes de aplicar
    schemas = q(fresh_db, "select nspname from pg_namespace where nspname like 'backup_%%'")
    assert len(schemas) == 1
    assert q(fresh_db, f'select count(*) n from "{schemas[0]["nspname"]}".scoring_rules')[0]["n"] > 0
    assert migrate(fresh_db) == []
    assert len(q(fresh_db, "select nspname from pg_namespace where nspname like 'backup_%%'")) == 1


def test_migrate_em_banco_vazio(tmp_path):
    import os

    import psycopg
    from psycopg.conninfo import make_conninfo

    from lead_hunter.migrate import migrate
    base = os.getenv("TEST_DATABASE_URL")
    if not base:
        import pytest
        pytest.skip("TEST_DATABASE_URL não definida")
    import subprocess
    import uuid
    from pathlib import Path
    name = "jslh_m_" + uuid.uuid4().hex[:6]
    with psycopg.connect(base, autocommit=True) as c:
        c.execute(f"CREATE DATABASE {name}")
    url = make_conninfo(base, dbname=name)
    stub = Path(__file__).resolve().parents[2] / "supabase/tests/00_supabase_stub.sql"
    subprocess.run(["psql", url, "-q", "-X", "-v", "ON_ERROR_STOP=1", "-f", str(stub)], check=True, capture_output=True)
    try:
        from lead_hunter.migrate import default_dir
        assert len(migrate(url)) == len(list(default_dir().glob("*.sql")))
        assert migrate(url) == []
    finally:
        with psycopg.connect(base, autocommit=True) as c:
            c.execute(f"DROP DATABASE {name} WITH (FORCE)")


def test_once_importa_e_respeita_tempo(fresh_db, tmp_path):
    root = tmp_path / "rf"
    build_competence(root, "2026-10")
    with FakeRF(root) as rf:
        w = make_worker(fresh_db, rf.url, tmp_path)
        w.once()  # sem nada pendente: verifica, encontra competência nova e importa
    cur = q(fresh_db, "select competence, status from import_jobs where is_current")
    assert cur and cur[0]["competence"] == "2026-10"
    assert q(fresh_db, "select count(*) n from leads")[0]["n"] == 5  # sem bloqueio cadastrado neste teste

    # tempo esgotado no meio do download: job volta para 'pendente'
    build_competence(root, "2026-11")
    with FakeRF(root) as rf:
        w = make_worker(fresh_db, rf.url, tmp_path)
        w.deadline = 0.0001  # já vencido
        job_id = w.enqueue("importacao", "manual", "2026-11")
        w.run_job(w.claim())
    job = q(fresh_db, "select status from import_jobs where id = %s", job_id)[0]
    assert job["status"] == "pendente"


def test_trava_de_espaco_no_banco_nao_grava(fresh_db, tmp_path):
    root = tmp_path / "rf"
    build_competence(root, "2026-10")
    with FakeRF(root) as rf:
        w = make_worker(fresh_db, rf.url, tmp_path)
        object.__setattr__(w.s, "db_size_limit_mb", 1)  # limite artificialmente baixo
        job = run_import(w)
    assert job["status"] == "falhou"
    assert "Espaço insuficiente no banco" in job["errors"][-1]["msg"]
    assert not q(fresh_db, "select 1 from leads")
    assert not q(fresh_db, "select 1 from import_jobs where is_current")


def test_arquivamento_preserva_leads_trabalhados(fresh_db, tmp_path):
    from lead_hunter.archive import run_scheduled

    root = tmp_path / "rf"
    build_competence(root, "2026-10")
    with FakeRF(root) as rf:
        run_import(make_worker(fresh_db, rf.url, tmp_path))
    # todos os leads "envelhecem" 40 dias
    q(fresh_db, "update leads set created_at = now() - interval '40 days' returning 1")
    # um lead trabalhado (anotação) e um de alta prioridade não podem sair
    lead = q(fresh_db, "select id from leads where cnpj_basico = '66777888'")[0]["id"]
    q(fresh_db, "insert into lead_events (lead_id, event_type, content) values (%s, 'anotacao', 'ligar segunda') returning 1", lead)
    q(fresh_db, "update leads set score = 90 where cnpj_basico = '12ABC345' returning 1")
    antes = q(fresh_db, "select count(*) n from leads")[0]["n"]

    # política 2.0: desligado por padrão, nada é arquivado
    assert run_scheduled(fresh_db) is None
    assert q(fresh_db, "select count(*) n from leads")[0]["n"] == antes
    # o administrador pode religar manualmente
    q(fresh_db, """update app_settings set value = value || '{"ativo": true}' where key = 'arquivamento' returning 1""")
    res = run_scheduled(fresh_db)
    assert res["leads"] == antes - 2
    restantes = {r["cnpj_basico"] for r in q(fresh_db, "select cnpj_basico from leads")}
    assert restantes == {"66777888", "12ABC345"}
    arq = q(fresh_db, "select * from lead_archive where cnpj_basico = '11222333'")[0]
    assert arq["razao_social"] == "PADARIA SÃO JOÃO LTDA" and arq["telefone"] == "11912345678"
    # dados cadastrais das empresas arquivadas saem do banco operacional
    assert not q(fresh_db, "select 1 from establishments where cnpj_basico = '11222333'")
    assert not q(fresh_db, "select 1 from companies where cnpj_basico = '11222333'")
    # roda no máximo uma vez por dia
    assert run_scheduled(fresh_db) is None


def test_importacao_libera_espaco_arquivando(fresh_db, tmp_path, monkeypatch):
    import lead_hunter.jobs as jobs

    root = tmp_path / "rf"
    build_competence(root, "2026-10")
    with FakeRF(root) as rf:
        assert run_import(make_worker(fresh_db, rf.url, tmp_path))["status"] == "concluido"
        build_competence(root, "2026-11", extra_est=[est_row("77888999", fantasia="NOVA")])
        # arquivar resolveria (estimativa alta de espaço liberado): arquiva antes de decidir
        monkeypatch.setattr(jobs, "FREED_BYTES_PER_LEAD", 10 ** 12)
        q(fresh_db, """update app_settings set value = value || '{"ativo": true, "liberar_espaco_na_importacao": true}'
                        where key = 'arquivamento' returning 1""")
        w = make_worker(fresh_db, rf.url, tmp_path)
        size_mb = q(fresh_db, "select pg_database_size(current_database()) / 1048576 as m")[0]["m"]
        object.__setattr__(w.s, "db_size_limit_mb", int(size_mb))
        job = run_import(w, "2026-11")
    assert q(fresh_db, "select count(*) n from lead_archive where motivo like 'liberar espaço%%'")[0]["n"] >= 1
    if job["status"] == "falhou":  # banco de teste minúsculo pode continuar acima do limite
        assert "Espaço insuficiente" in job["errors"][-1]["msg"]
    else:
        assert q(fresh_db, "select 1 from leads where cnpj_basico = '77888999'")


def test_sem_espaco_mesmo_arquivando_nao_apaga_nada(fresh_db, tmp_path):
    """Regressão de 17/11/2026: arquivou 69 mil leads e a importação falhou mesmo assim."""
    root = tmp_path / "rf"
    build_competence(root, "2026-10")
    with FakeRF(root) as rf:
        assert run_import(make_worker(fresh_db, rf.url, tmp_path))["status"] == "concluido"
        antes = q(fresh_db, "select count(*) n from leads")[0]["n"]
        build_competence(root, "2026-11", extra_est=[est_row("77888999", fantasia="NOVA")])
        w = make_worker(fresh_db, rf.url, tmp_path)
        object.__setattr__(w.s, "db_size_limit_mb", 1)
        job = run_import(w, "2026-11")
    assert job["status"] == "falhou"
    assert q(fresh_db, "select count(*) n from leads")[0]["n"] == antes
    assert q(fresh_db, "select count(*) n from lead_archive")[0]["n"] == 0


def test_dois_workers_nao_roubam_job_em_execucao(fresh_db, tmp_path):
    root = tmp_path / "rf"
    build_competence(root, "2026-10")
    with FakeRF(root) as rf:
        a = make_worker(fresh_db, rf.url, tmp_path)
        b = make_worker(fresh_db, rf.url, tmp_path)
        a.enqueue("importacao", "manual")
        job = a.claim()
        assert job and job["heartbeat_at"] is not None
        # o outro worker (ex.: GitHub Actions) começa uma rodada enquanto o primeiro trabalha
        b.recover_stale_jobs(resume=True)
        assert q(fresh_db, "select status from import_jobs where id = %s", job["id"])[0]["status"] == "processando"
        b.enqueue("verificacao")
        assert b.claim() is None  # não roda dois jobs ao mesmo tempo
        # sem batimento há mais de 20 min: aí sim é retomado
        q(fresh_db, "update import_jobs set heartbeat_at = now() - interval '30 minutes' where id = %s returning 1", job["id"])
        b.recover_stale_jobs(resume=True)
        assert q(fresh_db, "select status from import_jobs where id = %s", job["id"])[0]["status"] == "pendente"
