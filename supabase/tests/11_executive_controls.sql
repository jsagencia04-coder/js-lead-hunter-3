\set ON_ERROR_STOP 1
begin;
create function pg_temp.exec_assert(ok boolean,label text) returns void language plpgsql as $$begin if ok is not true then raise exception 'FALHA Executivo: %',label;end if;raise notice 'ok Executivo: %',label;end $$;
create function pg_temp.exec_denied(command text) returns void language plpgsql as $$begin begin execute command;exception when others then return;end;raise exception 'Deveria negar';end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',true);
select pg_temp.exec_assert(executive_overview_v4(current_date-365,current_date)->'metrics' ? 'received','receita recebida separada');
select pg_temp.exec_assert(executive_overview_v4(current_date-365,current_date,null,'SP','47') ? 'methodology','filtros globais com metodologia');
select pg_temp.exec_assert(operational_costs_v4() ? 'providers','custos baseados em uso real');
select pg_temp.exec_denied($$select executive_overview_v4(current_date,current_date-1)$$);
select pg_temp.exec_denied($$select executive_overview_v4(current_date-30,current_date,null,'SP;')$$);
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',true);
select pg_temp.exec_denied($$select operational_costs_v4()$$);
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',true);
select pg_temp.exec_denied($$select executive_overview_v4(current_date-30,current_date)$$);
reset role;rollback;
