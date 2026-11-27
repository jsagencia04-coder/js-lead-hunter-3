\set ON_ERROR_STOP 1
begin;
create function pg_temp.campaign_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is not true then raise exception 'FALHA Campanhas: %',label; end if; raise notice 'ok Campanhas: %',label; end $$;
create function pg_temp.campaign_denied(command text) returns void language plpgsql as $$
begin begin execute command; exception when others then return; end; raise exception 'Deveria negar operacao'; end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',true);
select set_config('app.campaign_test',save_sales_campaign('Campanha sintetica','Validar atribuicao temporal')::text,true);
select pg_temp.campaign_assert(add_campaign_members(current_setting('app.campaign_test')::uuid,array(select id from leads where cnpj_basico='12ABC345'))=1,'inclusao real na campanha');
select pg_temp.campaign_assert(add_campaign_members(current_setting('app.campaign_test')::uuid,array(select id from leads where cnpj_basico='12ABC345'))=0,'inclusao idempotente');
select pg_temp.campaign_assert(add_campaign_members(current_setting('app.campaign_test')::uuid,array(select id from leads where cnpj_basico='11222333'))=0,'oposicao ao contato preservada');
select pg_temp.campaign_assert((sales_campaign_metrics(current_setting('app.campaign_test')::uuid)->>'empresas')::int=1,'contador real de membros');
insert into lead_proposals(lead_id,title,amount,status,scope,payment_terms,delivery_terms,created_by)
select id,'Documento sintetico',1234,'rascunho','Escopo real do teste','2 parcelas','30 dias',auth.uid() from leads where cnpj_basico='12ABC345';
select set_config('app.proposal_test',(select id::text from lead_proposals where title='Documento sintetico'),true);
select pg_temp.campaign_assert((proposal_document(current_setting('app.proposal_test')::uuid)->>'revision')::int=1,'versao inicial registrada');
select pg_temp.campaign_assert(proposal_document(current_setting('app.proposal_test')::uuid)#>>'{proposal,scope}'='Escopo real do teste','documento usa escopo registrado');
update lead_proposals set status='enviada' where id=current_setting('app.proposal_test')::uuid;
select pg_temp.campaign_assert((proposal_document(current_setting('app.proposal_test')::uuid)->>'revision')::int=2,'historico versionado de alteracoes');
select pg_temp.campaign_assert((sales_campaign_metrics(current_setting('app.campaign_test')::uuid)->>'propostas')::int=1,'proposta depois da inclusao conta na campanha');
select pg_temp.campaign_denied($$update proposal_versions set payload='{}'$$);
select set_sales_campaign_status(current_setting('app.campaign_test')::uuid,'concluida');
select pg_temp.campaign_denied($$select add_campaign_members(current_setting('app.campaign_test')::uuid,array(select id from leads))$$);
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',true);
select pg_temp.campaign_denied($$select set_sales_campaign_status(current_setting('app.campaign_test')::uuid,'ativa')$$);
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',true);
select pg_temp.campaign_denied($$select proposal_document(current_setting('app.proposal_test')::uuid)$$);
reset role;
select pg_temp.campaign_assert(not has_function_privilege('anon','public.proposal_document(uuid)','execute'),'documento sem acesso anonimo');
rollback;
