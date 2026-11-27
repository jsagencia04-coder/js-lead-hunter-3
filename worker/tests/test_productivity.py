import psycopg


def test_recorrencias_worker_idempotentes(fresh_db):
    from lead_hunter.operations import run_operations
    with psycopg.connect(fresh_db,autocommit=True) as c:
        c.execute("insert into auth.users(id,email) values('11111111-1111-1111-1111-111111111111','admin@teste.local')")
        c.execute("insert into companies(cnpj_basico) values('RECUR001')")
        c.execute("insert into establishments(cnpj,cnpj_basico,cnpj_ordem,cnpj_dv,identificador_matriz,situacao_cadastral) values('RECUR001000100','RECUR001','0001','00',1,'02')")
        lead=c.execute("insert into leads(cnpj_basico,cnpj) values('RECUR001','RECUR001000100') returning id").fetchone()[0]
        task=c.execute("insert into crm_tasks(lead_id,owner_id,title,due_at) values(%s,'11111111-1111-1111-1111-111111111111','Recorrencia',now()-interval '1 day') returning id",(lead,)).fetchone()[0]
        c.execute("select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false)")
        rule=c.execute('select create_task_recurrence(%s,2)',(task,)).fetchone()[0]
        assert c.execute('select create_task_recurrence(%s,2)',(task,)).fetchone()[0]==rule
    first=run_operations(fresh_db)
    second=run_operations(fresh_db)
    assert first['recurring_created']==1
    assert second['recurring_created']==0
    with psycopg.connect(fresh_db) as c:
        assert c.execute('select count(*) from crm_tasks where recurring_rule_id=%s',(rule,)).fetchone()[0]==1
