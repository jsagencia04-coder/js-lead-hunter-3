import psycopg
import pytest


def setup(conn):
    conn.execute("insert into auth.users(id,email) values ('11111111-1111-1111-1111-111111111111','admin@teste.local')")
    conn.execute("insert into companies(cnpj_basico,razao_social) values ('AGENT001','SINTETICA AGENTES')")
    conn.execute("insert into establishments(cnpj,cnpj_basico,cnpj_ordem,cnpj_dv,identificador_matriz,situacao_cadastral) values ('AGENT001000100','AGENT001','0001','00',1,'02')")
    return str(conn.execute("insert into leads(cnpj_basico,cnpj) values ('AGENT001','AGENT001000100') returning id").fetchone()[0])


def request(conn,code,lead=None):
    conn.execute("select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false)")
    conn.execute("set role authenticated")
    try:
        return conn.execute('select request_operational_agent(%s,%s)',(code,lead)).fetchone()[0]
    finally:
        conn.execute('reset role')
        conn.execute("select set_config('request.jwt.claim.sub','',false)")


def test_todos_agentes_executam_ferramentas_reais(fresh_db):
    with psycopg.connect(fresh_db,autocommit=True) as c:
        lead=setup(c)
        agents=c.execute('select code,requires_lead from operational_agents order by code').fetchall()
        assert len(agents)==12
        for code,requires in agents:
            job=request(c,code,lead if requires else None)
            assert request(c,code,lead if requires else None)==job
            result=c.execute('select run_operational_agent_job()').fetchone()[0]
            row=c.execute('select status,result,error_code from operational_agent_jobs where id=%s',(job,)).fetchone()
            assert row[0]=='concluido',(code,result,row)
            assert row[1] is not None
        assert c.execute('select count(*) from operational_agent_jobs').fetchone()[0]==12
        assert c.execute("select current_setting('request.jwt.claim.sub',true)").fetchone()[0]==''


def test_pausa_cancelamento_e_revogacao_de_perfil(fresh_db):
    with psycopg.connect(fresh_db,autocommit=True) as c:
        setup(c)
        job=request(c,'executive_analyst')
        c.execute("update operational_agents set paused=true where code='executive_analyst'")
        assert c.execute('select run_operational_agent_job()').fetchone()[0]['status']=='vazio'
        c.execute("update operational_agents set paused=false where code='executive_analyst'")
        c.execute("update profiles set active=false where id='11111111-1111-1111-1111-111111111111'")
        assert c.execute('select run_operational_agent_job()').fetchone()[0]['status']=='erro'
        row=c.execute('select attempts,next_attempt_at>now() from operational_agent_jobs where id=%s',(job,)).fetchone()
        assert row==(1,True)


def test_usuario_nao_executa_worker_diretamente(fresh_db):
    with psycopg.connect(fresh_db,autocommit=True) as c:
        setup(c)
        c.execute('set role authenticated')
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            c.execute('select run_operational_agent_job()')
