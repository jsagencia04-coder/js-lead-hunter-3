\set ON_ERROR_STOP 1
begin;
create function pg_temp.ops_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is not true then raise exception 'FALHA Operacoes: %',label; end if; raise notice 'ok Operacoes: %',label; end $$;
create function pg_temp.ops_denied(command text) returns void language plpgsql as $$
begin begin execute command; exception when others then return; end; raise exception 'Operacao deveria ser negada'; end $$;
insert into companies(cnpj_basico,razao_social) values('OPS00001','SINTETICA OPERACAO'),('OPS00002','SINTETICA COMPARAVEL');
insert into establishments(cnpj,cnpj_basico,cnpj_ordem,cnpj_dv,identificador_matriz,situacao_cadastral,cnae_principal,uf,municipio_code)
values('OPS00001000100','OPS00001','0001','00',1,'02','4781400','SP','7107'),('OPS00002000100','OPS00002','0001','00',1,'02','4781400','SP','7107');
insert into leads(id,cnpj_basico,cnpj,owner_id) values
('abababab-0000-0000-0000-000000000001','OPS00001','OPS00001000100','11111111-1111-1111-1111-111111111111'),
('abababab-0000-0000-0000-000000000002','OPS00002','OPS00002000100','33333333-3333-3333-3333-333333333333');
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',true);
select set_company_watch('abababab-0000-0000-0000-000000000001',true,7,false);
select set_company_watch('abababab-0000-0000-0000-000000000001',true,7,false);
select pg_temp.ops_assert((select count(*)=1 from company_watchlist),'watchlist idempotente');
select pg_temp.ops_assert(schedule_company_watches()=1,'watchlist agenda pesquisa');
select pg_temp.ops_assert(schedule_company_watches()=0,'frequencia impede pesquisa duplicada');
reset role;
update enrichment_queue set status='em_processamento',attempts=2,locked_by='worker-real' where lead_id='abababab-0000-0000-0000-000000000001';
update company_watchlist set last_requested_at=now()-interval '8 days';
set local role authenticated;
select pg_temp.ops_assert(schedule_company_watches()=0,'watchlist nao rouba pesquisa em andamento');
reset role;
select pg_temp.ops_assert(exists(select 1 from enrichment_queue where lead_id='abababab-0000-0000-0000-000000000001' and locked_by='worker-real' and attempts=2),'lock e tentativas preservados');
set local role authenticated;
select pg_temp.ops_assert(exists(select 1 from jsonb_array_elements(company_comparables('abababab-0000-0000-0000-000000000001')->'items') x where x->>'id'='abababab-0000-0000-0000-000000000002'),'comparavel do mesmo CNAE e municipio retornado');
-- configuração requer admin; rotinas de worker só têm permissão operacional definida.
select configure_sales_automation('proposal_due',true,3);
insert into lead_proposals(lead_id,title,status,valid_until,created_by)
values('abababab-0000-0000-0000-000000000001','Teste vencimento','enviada',current_date+2,auth.uid());
select pg_temp.ops_assert((run_sales_automations()->>'created')::int=1,'automacao cria tarefa real');
select pg_temp.ops_assert((run_sales_automations()->>'created')::int=0,'automacao idempotente');
select pg_temp.ops_assert((select count(*)=1 from sales_automation_items where rule_code='proposal_due'),'ledger unico');
select pg_temp.ops_assert(exists(select 1 from crm_tasks where title='Acompanhar proposta: Teste vencimento'),'tarefa integrada a agenda');
-- Provoca falha controlada só no banco de teste para validar retry/backoff sem ledger falso.
reset role;
create function pg_temp.break_ops_task() returns trigger language plpgsql as $$ begin raise exception 'falha sintetica'; end $$;
create trigger test_break_ops before insert on public.crm_tasks for each row execute function pg_temp.break_ops_task();
set local role authenticated;
insert into lead_proposals(lead_id,title,status,valid_until,created_by)
values('abababab-0000-0000-0000-000000000001','Proposta com falha','enviada',current_date+1,auth.uid());
select pg_temp.ops_assert((run_sales_automations()->>'errors')::int=1,'falha por item registrada sem falso sucesso');
select pg_temp.ops_assert((select attempts=1 and next_attempt_at>now() from sales_automation_errors where rule_code='proposal_due'),'backoff persistente');
select pg_temp.ops_assert((run_sales_automations()->>'created')::int=0,'backoff impede retry imediato');
select retry_sales_automation('proposal_due',(select id from lead_proposals where title='Proposta com falha'),current_date+1);
reset role;
drop trigger test_break_ops on public.crm_tasks;
set local role authenticated;
select pg_temp.ops_assert((run_sales_automations()->>'created')::int=1,'retry controlado cria tarefa apos correcao');
select pg_temp.ops_assert((select count(*)=0 from sales_automation_errors),'erro resolvido removido da fila');
select configure_sales_automation('overdue_task',true,1);
insert into crm_tasks(lead_id,owner_id,title,due_at,created_by) values('abababab-0000-0000-0000-000000000002',auth.uid(),'Atraso sintetico',now()-interval '3 days',auth.uid());
select pg_temp.ops_assert((run_sales_automations()->>'created')::int>=1,'alerta de tarefa atrasada');
select mark_operation_alert_read((select id from operation_alerts where owner_id=auth.uid() limit 1));
select pg_temp.ops_assert(exists(select 1 from operation_alerts where read_at is not null),'alerta lido pelo proprio usuario');
select configure_sales_automation('proposal_due',false,3);
select pg_temp.ops_assert((select not enabled from sales_automation_rules where code='proposal_due'),'pausa persistente');
reset role;
insert into digital_channels(cnpj_basico,lead_id,platform,status,source,evidence,last_checked_at)
values('OPS00001','abababab-0000-0000-0000-000000000001','site','inconclusivo','teste','[{"detalhe":"timeout"}]',now());
update digital_channels set status='verificado',url='https://example.test',confidence=80 where cnpj_basico='OPS00001';
update establishments set logradouro='Rua nova' where cnpj_basico='OPS00001';
set local role authenticated;
select pg_temp.ops_assert((select count(*)=2 from business_radar_v where lead_id='abababab-0000-0000-0000-000000000001' and category='digital'),'radar usa historico real de canais');
select pg_temp.ops_assert(exists(select 1 from business_radar_v where lead_id='abababab-0000-0000-0000-000000000001' and category='cadastral'),'radar usa mudanca cadastral real');
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',true);
select pg_temp.ops_assert((select count(*)=0 from operation_alerts),'comercial nao le alertas alheios');
select pg_temp.ops_assert((select count(*)=0 from company_watchlist),'comercial nao le watchlist alheia');
select pg_temp.ops_denied($$select configure_sales_automation('proposal_due',true,3)$$);
select pg_temp.ops_denied($$select run_sales_automations()$$);
select pg_temp.ops_denied($$insert into operation_alerts(lead_id,owner_id,title,reason) values('abababab-0000-0000-0000-000000000001',auth.uid(),'forjado','forjado')$$);
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',true);
select pg_temp.ops_assert((select count(*)=0 from business_radar_v),'inativo nao le radar');
select pg_temp.ops_denied($$select set_company_watch('abababab-0000-0000-0000-000000000001',true,7,false)$$);
reset role;
select pg_temp.ops_assert(not has_function_privilege('anon','public.run_sales_automations(integer)','execute'),'anon sem automacao');
rollback;
