-- Fixtures apenas no banco descartável; rollback ao final.
\set ON_ERROR_STOP 1
begin;
create function pg_temp.twin_assert(ok boolean, label text) returns void language plpgsql as $$
begin if ok is not true then raise exception 'FALHA Twin: %',label; end if; raise notice 'ok Twin: %',label; end $$;
create function pg_temp.twin_denied(command text) returns void language plpgsql as $$
begin
  begin execute command; exception when others then return; end;
  raise exception 'FALHA Twin: acesso deveria ser negado';
end $$;
insert into companies(cnpj_basico,razao_social) values('TWIN0001','EMPRESA SINTETICA TWIN');
insert into establishments(cnpj,cnpj_basico,cnpj_ordem,cnpj_dv,identificador_matriz,situacao_cadastral,cnae_principal)
values('TWIN0001000100','TWIN0001','0001','00',1,'02','4781400');
insert into leads(id,cnpj_basico,cnpj) values('eeeeeeee-0000-0000-0000-000000000001','TWIN0001','TWIN0001000100');
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',true);
select pg_temp.twin_assert(company_digital_twin('eeeeeeee-0000-0000-0000-000000000001') #>> '{scores,digital_opportunity}' is null,'sem pesquisa não inventa ausência');
select pg_temp.twin_assert((company_digital_twin('eeeeeeee-0000-0000-0000-000000000001') #>> '{scores,data_confidence}')::int=0,'sem pesquisa confiança zero');
select pg_temp.twin_assert(jsonb_array_length(company_digital_twin('eeeeeeee-0000-0000-0000-000000000001')->'dimensions')=10,'dez dimensões explícitas');
select pg_temp.twin_assert(company_digital_twin('eeeeeeee-0000-0000-0000-000000000001') #>> '{scores,commercial_fit}' is not null,'fit baseado no catálogo existente');
reset role;
insert into digital_channels(cnpj_basico,lead_id,platform,status,source,evidence,confidence,last_checked_at)
values('TWIN0001','eeeeeeee-0000-0000-0000-000000000001','site','inconclusivo','teste','[{"detalhe":"timeout"}]',90,now());
set local role authenticated;
select pg_temp.twin_assert(company_digital_twin('eeeeeeee-0000-0000-0000-000000000001') #>> '{scores,digital_opportunity}' is null,'timeout não pontua ausência');
reset role;
update digital_channels set status='nao_localizado',evidence='[{"detalhe":"pesquisa conclusiva"}]',confidence=80 where cnpj_basico='TWIN0001';
set local role authenticated;
select pg_temp.twin_assert((company_digital_twin('eeeeeeee-0000-0000-0000-000000000001') #>> '{scores,digital_opportunity}')::int=100,'ausência conclusiva pontua DOS');
select pg_temp.twin_assert((company_digital_twin('eeeeeeee-0000-0000-0000-000000000001') #>> '{scores,coverage_percent}')::int=40,'cobertura parcial explícita');
select pg_temp.twin_assert((company_digital_twin('eeeeeeee-0000-0000-0000-000000000001') #>> '{scores,data_confidence}')::int=32,'confiança ponderada sem virar probabilidade');
reset role;
update digital_channels set status='verificado',url='https://example.test',result='{"disponivel":true,"nota":75,"checks":{"https":true,"responsivo":true,"seo":{"titulo":true,"descricao":true,"h1":1,"noindex":false},"contato":{"formulario":true}}}' where cnpj_basico='TWIN0001';
set local role authenticated;
select pg_temp.twin_assert((company_digital_twin('eeeeeeee-0000-0000-0000-000000000001') #>> '{scores,digital_opportunity}')::int=25,'nota técnica separada de oportunidade digital');
select pg_temp.twin_assert(capture_company_twin('eeeeeeee-0000-0000-0000-000000000001')=capture_company_twin('eeeeeeee-0000-0000-0000-000000000001'),'captura idempotente');
select pg_temp.twin_assert((select count(*)=1 from company_twin_snapshots where lead_id='eeeeeeee-0000-0000-0000-000000000001'),'histórico sem duplicatas');
select pg_temp.twin_denied($$update company_twin_snapshots set payload='{}'$$);
select pg_temp.twin_denied($$update twin_score_versions set name='forjado'$$);
select pg_temp.twin_denied($$select create_twin_score_version('Pesos inválidos','{"site":200}',90)$$);
select pg_temp.twin_assert(create_twin_score_version('Versão teste','{"site":50,"instagram":10,"facebook":10,"google_business":10,"linkedin":10,"whatsapp":10}',30)>1,'admin versiona regras');
reset role;
update digital_channels set last_checked_at=now()-interval '40 days' where cnpj_basico='TWIN0001';
set local role authenticated;
select pg_temp.twin_assert(company_digital_twin('eeeeeeee-0000-0000-0000-000000000001') #>> '{scores,digital_opportunity}' is null,'evidência vencida não vira prova atual');
reset role;
select pg_temp.twin_assert((select count(*)=3 from digital_channel_history where cnpj_basico='TWIN0001'),'histórico de mudanças sem heartbeat duplicado');
set local role authenticated;
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',true);
select pg_temp.twin_denied($$select create_twin_score_version('Vendedor','{}',90)$$);
select pg_temp.twin_denied($$insert into digital_channel_history(cnpj_basico,platform,current_data) values('TWIN0001','site','{}')$$);
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',true);
select pg_temp.twin_denied($$select company_digital_twin('eeeeeeee-0000-0000-0000-000000000001')$$);
reset role;
select pg_temp.twin_assert(not has_function_privilege('anon','public.company_digital_twin(uuid)','execute'),'anônimo sem acesso');
select pg_temp.twin_assert((select score=0 from leads where cnpj_basico='TWIN0001'),'score legado não sobrescrito');
update cnae_service_rules set active=false;
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',true);
select pg_temp.twin_assert(company_digital_twin('eeeeeeee-0000-0000-0000-000000000001') #>> '{scores,commercial_fit}' is null,'regras inativas não recomendam compatibilidade');
reset role;
update digital_channels set evidence='{}',last_checked_at=now(),status='nao_localizado' where cnpj_basico='TWIN0001';
set local role authenticated;
select pg_temp.twin_assert(company_digital_twin('eeeeeeee-0000-0000-0000-000000000001') #>> '{scores,digital_opportunity}' is null,'evidência malformada não pontua nem derruba consulta');
reset role;
rollback;
