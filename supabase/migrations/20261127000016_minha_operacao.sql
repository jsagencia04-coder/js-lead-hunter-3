-- JS Lead Hunter 3.0 — Minha Operação. Apenas função nova; nenhum dado alterado.
-- SECURITY INVOKER: mantém RLS. auth.uid() delimita a carteira pessoal.
-- Listas limitadas, totais completos e ordenação estável. Dia comercial: São Paulo.
create or replace function public.my_operation_summary()
returns jsonb
language sql stable security invoker set search_path = public as $$
  with limites as (
    select date_trunc('day', now() at time zone 'America/Sao_Paulo')
             at time zone 'America/Sao_Paulo' as inicio,
           (date_trunc('day', now() at time zone 'America/Sao_Paulo') + interval '1 day')
             at time zone 'America/Sao_Paulo' as fim
  ), minhas_oportunidades as (
    select o.id, o.lead_id, o.title, o.value, o.stage_code, ps.label as stage_label, o.expected_close
      from public.opportunities o
      join public.pipeline_stages ps on ps.code = o.stage_code
     where o.owner_id = auth.uid() and o.status = 'aberta'
  ), recomendadas as (
    select v.id, v.cnpj, coalesce(v.nome_fantasia, v.razao_social) as empresa, v.score, v.priority,
           v.servico_nome, v.municipio, v.uf
      from public.opportunity_center_v v
     where v.owner_id = auth.uid() and not v.no_funil and not v.bloqueado
       and v.stage not in ('perdido', 'convertido')
     order by v.score desc, v.id
     limit 10
  ), tarefas_atrasadas as (
    select t.id, t.title, t.due_at, t.kind, coalesce(e.nome_fantasia, c.razao_social) as empresa, t.lead_id
      from public.crm_tasks t
      join public.leads l on l.id = t.lead_id
      join public.establishments e on e.cnpj = l.cnpj
      join public.companies c on c.cnpj_basico = l.cnpj_basico
     where t.done_at is null and t.owner_id = auth.uid() and t.due_at < now()
  ), reunioes_hoje as (
    select t.id, t.title, t.due_at, coalesce(e.nome_fantasia, c.razao_social) as empresa, t.lead_id
      from public.crm_tasks t
      join public.leads l on l.id = t.lead_id
      join public.establishments e on e.cnpj = l.cnpj
      join public.companies c on c.cnpj_basico = l.cnpj_basico
      cross join limites b
     where t.done_at is null and t.owner_id = auth.uid() and t.kind = 'reuniao'
       and t.due_at >= b.inicio and t.due_at < b.fim
  ), propostas_pendentes as (
    select p.id, p.title, p.status, p.valid_until, p.amount, l.id as lead_id,
           coalesce(e.nome_fantasia, c.razao_social) as empresa
      from public.lead_proposals p
      join public.leads l on l.id = p.lead_id
      join public.establishments e on e.cnpj = l.cnpj
      join public.companies c on c.cnpj_basico = l.cnpj_basico
      left join public.opportunities o on o.id = p.opportunity_id
     where coalesce(o.owner_id, l.owner_id) = auth.uid()
       and p.status in ('enviada', 'em_negociacao')
  ), oportunidades_prioritarias as (
    select o.*, coalesce(e.nome_fantasia, c.razao_social) as empresa
      from minhas_oportunidades o
      join public.leads l on l.id = o.lead_id
      join public.establishments e on e.cnpj = l.cnpj
      join public.companies c on c.cnpj_basico = l.cnpj_basico
  )
  select jsonb_build_object(
    'empresas_recomendadas', coalesce((select jsonb_agg(to_jsonb(r) order by r.score desc, r.id) from recomendadas r), '[]'::jsonb),
    'follow_ups_atrasados', coalesce((select jsonb_agg(to_jsonb(t) order by t.due_at, t.id)
      from (select * from tarefas_atrasadas order by due_at, id limit 20) t), '[]'::jsonb),
    'reunioes_hoje', coalesce((select jsonb_agg(to_jsonb(r) order by r.due_at, r.id)
      from (select * from reunioes_hoje order by due_at, id limit 20) r), '[]'::jsonb),
    'propostas_pendentes', coalesce((select jsonb_agg(to_jsonb(p) order by p.valid_until nulls last, p.id)
      from (select * from propostas_pendentes order by valid_until nulls last, id limit 15) p), '[]'::jsonb),
    'oportunidades_prioritarias', coalesce((select jsonb_agg(to_jsonb(o) order by o.value desc nulls last, o.id)
      from (select * from oportunidades_prioritarias order by value desc nulls last, id limit 10) o), '[]'::jsonb),
    'total_oportunidades_abertas', (select count(*) from minhas_oportunidades),
    'total_tarefas_atrasadas', (select count(*) from tarefas_atrasadas),
    'total_reunioes_hoje', (select count(*) from reunioes_hoje),
    'total_propostas_pendentes', (select count(*) from propostas_pendentes),
    'atualizado_em', now(),
    'fuso_horario', 'America/Sao_Paulo'
  )
$$;
revoke all on function public.my_operation_summary() from public, anon;
grant execute on function public.my_operation_summary() to authenticated;
