\set ON_ERROR_STOP 1
begin;
create function pg_temp.intel_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is not true then raise exception 'FALHA Intel: %',label; end if; raise notice 'ok Intel: %',label; end $$;
create function pg_temp.intel_denied(command text) returns void language plpgsql as $$
begin begin execute command;exception when others then return;end;raise exception 'Deveria negar consulta';end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',true);
select pg_temp.intel_assert(market_coverage('SP')->'totals' ? 'researched','cobertura explicita pesquisa');
select pg_temp.intel_assert(jsonb_array_length(market_coverage('SP')->'regions')<=100,'ranking limitado no servidor');
select pg_temp.intel_assert(sales_copilot_query('priorities')->>'mode'='deterministico','modo real sem LLM simulado');
select pg_temp.intel_assert(sales_copilot_query('followups')->'data' ? 'total_tarefas_atrasadas','copiloto usa operacao real');
select pg_temp.intel_assert(sales_copilot_query('changes')->'data' ? 'records','copiloto referencia mudancas');
select pg_temp.intel_assert(sales_copilot_query('proposals')->'data' ? 'methodology','receita nao presumida');
select pg_temp.intel_denied($$select sales_copilot_query('select * from auth.users')$$);
select pg_temp.intel_denied($$select market_coverage('SP;drop table leads')$$);
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',true);
select pg_temp.intel_denied($$select sales_copilot_query('unassigned')$$);
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',true);
select pg_temp.intel_denied($$select market_coverage()$$);
select pg_temp.intel_denied($$select sales_copilot_query('priorities')$$);
reset role;
select pg_temp.intel_assert(not has_function_privilege('anon','public.sales_copilot_query(text)','execute'),'copiloto nao anonimo');
rollback;
