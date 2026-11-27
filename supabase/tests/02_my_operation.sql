-- Apenas no banco descartável, após 01_behaviour.sql. Tudo é revertido ao final.
\set ON_ERROR_STOP 1
begin;
create function pg_temp.check_operation(ok boolean, label text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FALHA Minha Operação: %', label; end if;
  raise notice 'ok Minha Operação: %', label;
end $$;
insert into auth.users (id, email) values
 ('aaaaaaaa-1111-0000-0000-000000000001', 'operacao-a@teste.local'),
 ('aaaaaaaa-1111-0000-0000-000000000002', 'operacao-b@teste.local'),
 ('aaaaaaaa-1111-0000-0000-000000000003', 'operacao-inativo@teste.local');
update profiles set active = true, role = 'comercial'
 where id in ('aaaaaaaa-1111-0000-0000-000000000001', 'aaaaaaaa-1111-0000-0000-000000000002');
insert into companies (cnpj_basico, razao_social) values ('OPTEST01', 'SINTETICA OPERACAO 1'), ('OPTEST02', 'SINTETICA OPERACAO 2');
insert into establishments (cnpj, cnpj_basico, cnpj_ordem, cnpj_dv, identificador_matriz, situacao_cadastral, source_competence)
 values ('OPTEST01000100', 'OPTEST01', '0001', '00', 1, '02', '2026-11'),
        ('OPTEST02000100', 'OPTEST02', '0001', '00', 1, '02', '2026-11');
insert into leads (id, cnpj_basico, cnpj, owner_id, score) values
 ('bbbbbbbb-1111-0000-0000-000000000001', 'OPTEST01', 'OPTEST01000100', 'aaaaaaaa-1111-0000-0000-000000000001', 80),
 ('bbbbbbbb-1111-0000-0000-000000000002', 'OPTEST02', 'OPTEST02000100', 'aaaaaaaa-1111-0000-0000-000000000002', 90);
insert into crm_tasks (lead_id, owner_id, kind, title, due_at)
 select 'bbbbbbbb-1111-0000-0000-000000000001', 'aaaaaaaa-1111-0000-0000-000000000001', 'follow_up',
        'Atrasada ' || n, now() - make_interval(days => n) from generate_series(1, 25) n;
insert into crm_tasks (lead_id, owner_id, kind, title, due_at) values
 ('bbbbbbbb-1111-0000-0000-000000000002', 'aaaaaaaa-1111-0000-0000-000000000002', 'follow_up', 'OUTRO RESPONSAVEL', now() - interval '1 day'),
 ('bbbbbbbb-1111-0000-0000-000000000001', 'aaaaaaaa-1111-0000-0000-000000000001', 'reuniao', 'Reuniao do dia',
  (date_trunc('day', now() at time zone 'America/Sao_Paulo') + interval '23 hours') at time zone 'America/Sao_Paulo');
insert into lead_proposals (lead_id, title, status, amount, valid_until)
 select 'bbbbbbbb-1111-0000-0000-000000000001', 'Proposta ' || n, 'enviada', n * 100, current_date + n
 from generate_series(1, 18) n;
insert into opportunities (id, lead_id, title, owner_id, value) values
 ('cccccccc-1111-0000-0000-000000000001', 'bbbbbbbb-1111-0000-0000-000000000002', 'Oportunidade atribuida A',
  'aaaaaaaa-1111-0000-0000-000000000001', 3500);
insert into lead_proposals (lead_id, opportunity_id, title, status)
 values ('bbbbbbbb-1111-0000-0000-000000000002', 'cccccccc-1111-0000-0000-000000000001', 'Proposta responsavel oportunidade', 'enviada');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-1111-0000-0000-000000000001', true);
select pg_temp.check_operation(jsonb_array_length(my_operation_summary()->'empresas_recomendadas') = 1, 'somente empresas do responsavel fora do funil');
select pg_temp.check_operation(my_operation_summary()->'empresas_recomendadas'->0->>'id' = 'bbbbbbbb-1111-0000-0000-000000000001', 'empresa correta');
select pg_temp.check_operation((my_operation_summary()->>'total_tarefas_atrasadas')::int =
  (select count(*) from crm_tasks where owner_id = auth.uid() and done_at is null and due_at < now()),
  'total completo maior que limite da lista (inclui reunioes vencidas)');
select pg_temp.check_operation(jsonb_array_length(my_operation_summary()->'follow_ups_atrasados') = 20, 'lista limitada a 20 tarefas');
select pg_temp.check_operation(my_operation_summary()->'follow_ups_atrasados'->0->>'title' = 'Atrasada 25', 'mais antiga primeiro');
select pg_temp.check_operation((my_operation_summary()->>'total_reunioes_hoje')::int = 1, 'reuniao no dia de Sao Paulo');
select pg_temp.check_operation((my_operation_summary()->>'total_propostas_pendentes')::int = 19, 'responsavel da oportunidade prevalece sobre lead');
select pg_temp.check_operation(jsonb_array_length(my_operation_summary()->'propostas_pendentes') = 15, 'propostas limitadas a 15');
select pg_temp.check_operation((my_operation_summary()->>'total_oportunidades_abertas')::int = 1, 'oportunidade atribuida ao usuario');
select pg_temp.check_operation(my_operation_summary()->'oportunidades_prioritarias'->0->>'stage_label' is not null, 'rotulo da etapa retornado');
select set_config('request.jwt.claim.sub', 'aaaaaaaa-1111-0000-0000-000000000002', true);
select pg_temp.check_operation((my_operation_summary()->>'total_tarefas_atrasadas')::int = 1, 'outro usuario nao recebe tarefas de A');
select pg_temp.check_operation((my_operation_summary()->>'total_propostas_pendentes')::int = 0, 'proposta atribuida A nao aparece para B');
select pg_temp.check_operation((my_operation_summary()->>'total_oportunidades_abertas')::int = 0, 'oportunidade de A nao aparece para B');
select set_config('request.jwt.claim.sub', 'aaaaaaaa-1111-0000-0000-000000000003', true);
select pg_temp.check_operation((my_operation_summary()->>'total_tarefas_atrasadas')::int = 0, 'inativo sem dados');
select pg_temp.check_operation(jsonb_array_length(my_operation_summary()->'empresas_recomendadas') = 0, 'RLS usuario inativo');
reset role;
insert into contact_suppressions (cnpj_basico, reason) values ('OPTEST01', 'Oposicao de teste');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-1111-0000-0000-000000000001', true);
select pg_temp.check_operation(jsonb_array_length(my_operation_summary()->'empresas_recomendadas') = 0, 'bloqueio de contato exclui recomendacao');
reset role;
select pg_temp.check_operation(not has_function_privilege('anon', 'public.my_operation_summary()', 'execute'), 'anon sem acesso');
select pg_temp.check_operation(has_function_privilege('authenticated', 'public.my_operation_summary()', 'execute'), 'autenticado pode executar');
rollback;
