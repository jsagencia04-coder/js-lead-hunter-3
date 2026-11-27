\set ON_ERROR_STOP 1
begin;
create function pg_temp.revenue_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is not true then raise exception 'FALHA Receita: %',label;end if;raise notice 'ok Receita: %',label;end $$;
create function pg_temp.revenue_denied(command text) returns void language plpgsql as $$
begin begin execute command;exception when others then return;end;raise exception 'Deveria negar operacao';end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',true);
insert into contracts(lead_id,title,total_value,signed_at,status)
select id,'Contrato receita teste',5000,current_date,'ativo' from leads where cnpj_basico='12ABC345';
select set_config('app.receipt_contract',(select id::text from contracts where title='Contrato receita teste'),true);
select set_config('app.receipt_id',record_contract_receipt(current_setting('app.receipt_contract')::uuid,500,current_date,'parcela-1')::text,true);
select pg_temp.revenue_assert((revenue_summary(current_date,current_date)->>'received_period')::numeric=500,'recebido usa lançamento real');
select pg_temp.revenue_assert((revenue_summary(current_date,current_date)->>'contracted_period')::numeric>=5000,'contratado separado de recebido');
select pg_temp.revenue_denied($$select record_contract_receipt(current_setting('app.receipt_contract')::uuid,500,current_date,'parcela-1')$$);
select pg_temp.revenue_denied($$select record_contract_receipt(current_setting('app.receipt_contract')::uuid,500,current_date+1,'futuro')$$);
select void_contract_receipt(current_setting('app.receipt_id')::uuid,'Cancelamento registrado');
select pg_temp.revenue_assert((revenue_summary(current_date,current_date)->>'received_period')::numeric=0,'estorno nao apaga historico nem soma recebido');
select pg_temp.revenue_assert((select count(*)=1 from contract_receipts where voided_at is not null),'registro estornado preservado');
select pg_temp.revenue_assert(save_intelligence_segment('Segmento sintetico','Teste',array['47','56'],array(select id from service_catalog where active limit 1),'ICP registrado') is not null,'segmento configuravel com servico real');
select pg_temp.revenue_denied($$select save_intelligence_segment('Invalido','',array['SQL;'],array[]::uuid[],'')$$);
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',true);
select pg_temp.revenue_denied($$select record_contract_receipt(current_setting('app.receipt_contract')::uuid,100,current_date,'comercial')$$);
select pg_temp.revenue_denied($$select save_intelligence_segment('Comercial','',array['47'],array[]::uuid[],'')$$);
select pg_temp.revenue_denied($$update contract_receipts set amount=9999$$);
reset role;
select pg_temp.revenue_assert(not has_function_privilege('anon','public.revenue_summary(date,date)','execute'),'receita nao anonima');
rollback;
