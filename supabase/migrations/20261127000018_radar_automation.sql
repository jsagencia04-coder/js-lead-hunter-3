-- V4: radar por evidências, watchlist e automações exclusivamente internas.
-- Alterações aditivas. Eventos consultam históricos reais, sem backfill inventado.
create table public.company_watchlist (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete restrict,
  owner_id uuid not null references public.profiles(id) on delete restrict,
  interval_days integer not null default 30 check(interval_days between 1 and 365),
  paused boolean not null default false,
  last_requested_at timestamptz,
  created_at timestamptz not null default now(),
  unique(lead_id,owner_id)
);
create index company_watchlist_due_idx on public.company_watchlist(last_requested_at) where not paused;
alter table public.company_watchlist enable row level security;
revoke all on public.company_watchlist from public,anon,authenticated;
grant select on public.company_watchlist to authenticated;
create policy watchlist_read on public.company_watchlist for select to authenticated
  using(public.is_active_user() and (owner_id=auth.uid() or public.has_role(array['admin','gestor']::public.app_role[])));

create function public.set_company_watch(p_lead_id uuid,p_enabled boolean,p_interval_days integer default 30,p_paused boolean default false)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.has_role(array['admin','gestor','comercial']::public.app_role[]) then raise exception 'Sem permissão'; end if;
  if p_enabled then
    if not exists(select 1 from public.leads where id=p_lead_id) then raise exception 'Empresa indisponível'; end if;
    insert into public.company_watchlist(lead_id,owner_id,interval_days,paused)
      values(p_lead_id,auth.uid(),p_interval_days,p_paused)
      on conflict(lead_id,owner_id) do update set interval_days=excluded.interval_days,paused=excluded.paused;
  else
    delete from public.company_watchlist where lead_id=p_lead_id and owner_id=auth.uid();
  end if;
end $$;
revoke all on function public.set_company_watch(uuid,boolean,integer,boolean) from public,anon;
grant execute on function public.set_company_watch(uuid,boolean,integer,boolean) to authenticated;

create view public.business_radar_v with(security_invoker=true) as
select 'digital:'||h.id as event_id,l.id as lead_id,l.cnpj_basico,l.cnpj,
  coalesce(e.nome_fantasia,c.razao_social) as empresa,'digital'::text as category,
  h.platform as change_type,h.detected_at as detected_at,
  h.previous as previous,h.current_data as current_data,
  h.current_data->>'source' as source,h.current_data->'evidence' as evidence,
  (h.current_data->>'confidence')::integer as confidence,
  case when h.previous is null then 'Primeiro registro de canal'
    when h.previous->>'url' is distinct from h.current_data->>'url' then 'Alteração de endereço digital'
    when h.previous->>'status' is distinct from h.current_data->>'status' then 'Alteração no estado da pesquisa'
    else 'Evidências digitais atualizadas' end as description
from public.digital_channel_history h join public.leads l on l.cnpj_basico=h.cnpj_basico
join public.companies c on c.cnpj_basico=l.cnpj_basico join public.establishments e on e.cnpj=l.cnpj
union all
select 'registry:'||r.id,l.id,l.cnpj_basico,l.cnpj,coalesce(e.nome_fantasia,c.razao_social),'cadastral',r.entity,r.changed_at,
  (select jsonb_object_agg(key,value->'de') from jsonb_each(r.changes)),
  (select jsonb_object_agg(key,value->'para') from jsonb_each(r.changes)),
  'Receita Federal — '||coalesce(r.competence,'competência não informada'),r.changes,null::integer,
  'Alteração cadastral observada na importação'
from public.registry_changes r join public.leads l
  on (r.entity='empresa' and r.key=l.cnpj_basico) or (r.entity='estabelecimento' and r.key=l.cnpj)
join public.companies c on c.cnpj_basico=l.cnpj_basico join public.establishments e on e.cnpj=l.cnpj;
revoke all on public.business_radar_v from public,anon;
grant select on public.business_radar_v to authenticated;

-- Comparáveis observados, não concorrência/faturamento presumidos. Limite no servidor.
create function public.company_comparables(p_lead_id uuid)
returns jsonb language plpgsql stable security invoker set search_path=public as $$
declare b record; output jsonb;
begin
 if not public.is_active_user() then raise exception 'Usuário ativo necessário'; end if;
 select l.id,l.cnpj_basico,e.cnae_principal,e.uf,e.municipio_code into b
 from public.leads l join public.establishments e on e.cnpj=l.cnpj where l.id=p_lead_id;
 if not found then raise exception 'Empresa indisponível'; end if;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into output from (
   select l.id,l.cnpj,coalesce(e.nome_fantasia,c.razao_social) as empresa,e.cnae_principal,e.uf,m.name as municipio,c.porte,
     d.status as site_status,d.url as site_url,d.confidence,d.last_checked_at,
     case when jsonb_typeof(d.result->'nota')='number' then (d.result->>'nota')::numeric end as website_score,
     'Mesmo CNAE principal e município; comparabilidade cadastral, não concorrência comprovada.' as reason
   from public.establishments e join public.leads l on l.cnpj=e.cnpj
   join public.companies c on c.cnpj_basico=l.cnpj_basico
   left join public.municipalities m on m.code=e.municipio_code
   left join public.digital_channels d on d.cnpj_basico=l.cnpj_basico and d.platform='site'
   where e.cnae_principal=b.cnae_principal and e.uf=b.uf and e.municipio_code=b.municipio_code
     and l.cnpj_basico<>b.cnpj_basico
   order by l.id limit 20
 ) x;
 return jsonb_build_object('items',output,'limit',20,'methodology','Mesma atividade principal e município na base disponível. Ausência de site pesquisado não comprova ausência de site. Não estima participação de mercado.');
end $$;
revoke all on function public.company_comparables(uuid) from public,anon;
grant execute on function public.company_comparables(uuid) to authenticated;

create table public.sales_automation_rules (
 code text primary key check(code in ('proposal_due','contract_renewal','idle_opportunity','overdue_task')),
 label text not null,enabled boolean not null default false,
 days integer not null check(days between 1 and 365),
 updated_at timestamptz not null default now()
);
insert into public.sales_automation_rules(code,label,days) values
 ('proposal_due','Criar follow-up de proposta próxima do vencimento',3),
 ('contract_renewal','Criar tarefa para contrato próximo da renovação',30),
 ('idle_opportunity','Alertar oportunidade sem atividade',14),
 ('overdue_task','Alertar tarefa atrasada',1);
create table public.sales_automation_runs (
 id uuid primary key default gen_random_uuid(), started_at timestamptz not null default now(),
 finished_at timestamptz,status text not null default 'executando' check(status in ('executando','concluido','falhou','ocupado')),
 created integer not null default 0,errors integer not null default 0,created_by uuid references public.profiles(id),message text
);
create table public.sales_automation_items (
 id bigint generated always as identity primary key,
 rule_code text not null references public.sales_automation_rules(code),source_id uuid not null,source_date date not null,
 run_id uuid references public.sales_automation_runs(id),
 task_id uuid references public.crm_tasks(id) on delete set null,
 created_at timestamptz not null default now(),unique(rule_code,source_id,source_date)
);
create table public.sales_automation_errors (
 rule_code text not null references public.sales_automation_rules(code),source_id uuid not null,source_date date not null,
 attempts integer not null default 0,next_attempt_at timestamptz not null default now(),
 sqlstate text not null,last_failed_at timestamptz not null default now(),
 primary key(rule_code,source_id,source_date)
);
create table public.operation_alerts (
 id uuid primary key default gen_random_uuid(),
 lead_id uuid not null references public.leads(id) on delete restrict,
 owner_id uuid not null references public.profiles(id) on delete restrict,
 automation_item_id bigint not null unique references public.sales_automation_items(id),
 title text not null,reason text not null,read_at timestamptz,created_at timestamptz not null default now()
);
create index operation_alerts_owner_idx on public.operation_alerts(owner_id,created_at desc);
do $$ declare t text; begin
 foreach t in array array['sales_automation_rules','sales_automation_runs','sales_automation_items','sales_automation_errors','operation_alerts'] loop
   execute format('alter table public.%I enable row level security',t);
   execute format('revoke all on public.%I from public,anon,authenticated',t);
   execute format('grant select on public.%I to authenticated',t);
 end loop;
end $$;
revoke all on sequence public.sales_automation_items_id_seq from public,anon,authenticated;
create policy automation_rules_read on public.sales_automation_rules for select to authenticated using(public.is_active_user());
create policy automation_runs_read on public.sales_automation_runs for select to authenticated using(public.has_role(array['admin','gestor']::public.app_role[]));
create policy automation_items_read on public.sales_automation_items for select to authenticated using(public.has_role(array['admin','gestor']::public.app_role[]));
create policy automation_errors_read on public.sales_automation_errors for select to authenticated using(public.has_role(array['admin','gestor']::public.app_role[]));
create policy operation_alerts_read on public.operation_alerts for select to authenticated
 using(public.is_active_user() and (owner_id=auth.uid() or public.has_role(array['admin','gestor']::public.app_role[])));

create function public.configure_sales_automation(p_code text,p_enabled boolean,p_days integer)
returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.has_role(array['admin']::public.app_role[]) then raise exception 'Apenas administradores'; end if;
 update public.sales_automation_rules set enabled=p_enabled,days=p_days,updated_at=now() where code=p_code;
 if not found then raise exception 'Regra desconhecida'; end if;
 insert into public.audit_logs(actor_id,action,table_name,record_id,new_data)
 values(auth.uid(),'UPDATE','sales_automation_rules',p_code,jsonb_build_object('enabled',p_enabled,'days',p_days));
end $$;
revoke all on function public.configure_sales_automation(text,boolean,integer) from public,anon;
grant execute on function public.configure_sales_automation(text,boolean,integer) to authenticated;
create function public.mark_operation_alert_read(p_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.is_active_user() then raise exception 'Usuário ativo necessário'; end if;
 update public.operation_alerts set read_at=now() where id=p_id and owner_id=auth.uid();
 if not found then raise exception 'Alerta indisponível'; end if;
end $$;
revoke all on function public.mark_operation_alert_read(uuid) from public,anon;
grant execute on function public.mark_operation_alert_read(uuid) to authenticated;

-- Uma transação por rodada: crash reverte tarefas/ledger juntos; advisory lock evita concorrência.
-- Erro por item é isolado em subtransação e reportado; próxima rodada reavalia fontes reais.
create function public.run_sales_automations(p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r record; item bigint; task uuid; run uuid; n integer:=0; error_count integer:=0; bound integer;
begin
 if not public.has_role(array['admin','gestor']::public.app_role[]) and not
   (auth.uid() is null and session_user in ('postgres','supabase_admin')) then raise exception 'Sem permissão'; end if;
 bound:=greatest(1,least(coalesce(p_limit,100),500));
 if not pg_try_advisory_xact_lock(734001802) then return jsonb_build_object('status','ocupado','created',0); end if;
 insert into public.sales_automation_runs(created_by) values(auth.uid()) returning id into run;
 for r in
  select * from (
   select 'proposal_due'::text as rule_code,p.id as source_id,p.valid_until as source_date,p.lead_id,p.opportunity_id,
     coalesce(o.owner_id,l.owner_id) as owner_id,'Acompanhar proposta: '||p.title as title,
     'Proposta enviada/em negociação próxima do vencimento registrado.'::text as reason,'task'::text as action
   from public.lead_proposals p join public.leads l on l.id=p.lead_id
   left join public.opportunities o on o.id=p.opportunity_id
   join public.sales_automation_rules a on a.code='proposal_due' and a.enabled
   where p.status in ('enviada','em_negociacao') and p.valid_until between current_date and current_date+a.days
   union all
   select 'contract_renewal',c.id,c.end_date,c.lead_id,c.opportunity_id,l.owner_id,'Revisar renovação: '||c.title,
     'Contrato ativo próximo do término registrado.','task'
   from public.contracts c join public.leads l on l.id=c.lead_id
   join public.sales_automation_rules a on a.code='contract_renewal' and a.enabled
   where c.status='ativo' and c.end_date between current_date and current_date+a.days
   union all
   select 'idle_opportunity',o.id,o.stage_changed_at::date,o.lead_id,o.id,o.owner_id,'Oportunidade sem atividade: '||o.title,
     'Nenhum evento comercial observado após o período configurado.','alert'
   from public.opportunities o join public.sales_automation_rules a on a.code='idle_opportunity' and a.enabled
   where o.status='aberta' and greatest(o.stage_changed_at,coalesce((select max(e.created_at) from public.lead_events e
     where e.opportunity_id=o.id and e.event_type not in ('pontuacao_alterada','tarefa_criada')),o.stage_changed_at))<now()-make_interval(days=>a.days)
   union all
   select 'overdue_task',t.id,t.due_at::date,t.lead_id,t.opportunity_id,t.owner_id,'Atividade atrasada: '||t.title,
     'Prazo registrado ultrapassado pelo período configurado.','alert'
   from public.crm_tasks t join public.sales_automation_rules a on a.code='overdue_task' and a.enabled
   where t.done_at is null and t.due_at<now()-make_interval(days=>a.days)
  ) x where owner_id is not null
    and exists(select 1 from public.profiles p where p.id=x.owner_id and p.active)
    and not exists(select 1 from public.leads l join public.contact_suppressions s on s.cnpj_basico=l.cnpj_basico where l.id=x.lead_id)
    and not exists(select 1 from public.sales_automation_items i where i.rule_code=x.rule_code and i.source_id=x.source_id and i.source_date=x.source_date)
    and not exists(select 1 from public.sales_automation_errors er where er.rule_code=x.rule_code and er.source_id=x.source_id and er.source_date=x.source_date and (er.attempts>=6 or er.next_attempt_at>now()))
  order by source_date,rule_code,source_id limit bound
 loop
  begin
   insert into public.sales_automation_items(rule_code,source_id,source_date,run_id) values(r.rule_code,r.source_id,r.source_date,run)
    on conflict do nothing returning id into item;
   if item is null then continue; end if;
   if r.action='task' then
    insert into public.crm_tasks(lead_id,opportunity_id,owner_id,kind,title,notes,due_at,created_by)
     values(r.lead_id,r.opportunity_id,r.owner_id,'follow_up',r.title,r.reason||' Revisão humana necessária antes de contato externo.',r.source_date::timestamp at time zone 'America/Sao_Paulo',auth.uid()) returning id into task;
    update public.sales_automation_items set task_id=task where id=item;
   else
    insert into public.operation_alerts(lead_id,owner_id,automation_item_id,title,reason)
     values(r.lead_id,r.owner_id,item,r.title,r.reason);
   end if;
   delete from public.sales_automation_errors where rule_code=r.rule_code and source_id=r.source_id and source_date=r.source_date;
   n:=n+1;
  exception when others then
   error_count:=error_count+1;
   insert into public.sales_automation_errors(rule_code,source_id,source_date,attempts,next_attempt_at,sqlstate)
    values(r.rule_code,r.source_id,r.source_date,1,now()+interval '10 minutes',SQLSTATE)
    on conflict(rule_code,source_id,source_date) do update set
     attempts=sales_automation_errors.attempts+1,last_failed_at=now(),sqlstate=excluded.sqlstate,
     next_attempt_at=now()+make_interval(mins=>least(1440,(10*power(2,least(sales_automation_errors.attempts,7)))::integer));
  end;
 end loop;
 update public.sales_automation_runs set finished_at=now(),status=case when error_count>0 then 'falhou' else 'concluido' end,
   created=n,errors=error_count,message=case when error_count>0 then 'Itens com erro serão reavaliados na próxima rodada; nenhuma mensagem externa foi enviada.' end where id=run;
 return jsonb_build_object('status',case when error_count>0 then 'falhou' else 'concluido' end,'created',n,'errors',error_count,'run_id',run);
end $$;
revoke all on function public.run_sales_automations(integer) from public,anon;
grant execute on function public.run_sales_automations(integer) to authenticated;

create function public.retry_sales_automation(p_rule text,p_source uuid,p_date date)
returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.has_role(array['admin','gestor']::public.app_role[]) then raise exception 'Sem permissão'; end if;
 update public.sales_automation_errors set attempts=0,next_attempt_at=now() where rule_code=p_rule and source_id=p_source and source_date=p_date;
 if not found then raise exception 'Erro indisponível'; end if;
 insert into public.audit_logs(actor_id,action,table_name,record_id,new_data)
 values(auth.uid(),'UPDATE','sales_automation_errors',p_source::text,jsonb_build_object('retry_requested',true,'rule',p_rule));
end $$;
revoke all on function public.retry_sales_automation(text,uuid,date) from public,anon;
grant execute on function public.retry_sales_automation(text,uuid,date) to authenticated;

-- Watchlist apenas agenda a fila de pesquisa existente, respeitando supressão e pausa.
create function public.schedule_company_watches(p_limit integer default 100)
returns integer language plpgsql security definer set search_path=public as $$
declare w record; n integer:=0;
begin
 if not public.has_role(array['admin','gestor']::public.app_role[]) and not
   (auth.uid() is null and session_user in ('postgres','supabase_admin')) then raise exception 'Sem permissão'; end if;
 if not pg_try_advisory_xact_lock(734001803) then return 0; end if;
 if coalesce((select (value->>'pausado')::boolean from public.app_settings where key='inteligencia'),false) then return 0; end if;
 for w in select watch.* from public.company_watchlist watch join public.profiles p on p.id=watch.owner_id and p.active
  join public.leads l on l.id=watch.lead_id where not watch.paused
  and (watch.last_requested_at is null or watch.last_requested_at<now()-make_interval(days=>watch.interval_days))
  and not exists(select 1 from public.contact_suppressions s where s.cnpj_basico=l.cnpj_basico)
  order by watch.last_requested_at nulls first,watch.id limit greatest(1,least(coalesce(p_limit,100),500))
 loop
  insert into public.enrichment_queue(cnpj_basico,lead_id,priority,requested_by)
   select cnpj_basico,id,score*10,w.owner_id from public.leads where id=w.lead_id
   on conflict(cnpj_basico) do update set status='pendente',attempts=0,next_attempt_at=now(),updated_at=now()
     where enrichment_queue.status in ('concluido','erro');
  if found then n:=n+1; end if;
  -- Uma pesquisa já pendente/em andamento atende todos os observadores sem resetar attempts/lock.
  update public.company_watchlist set last_requested_at=now() where id=w.id;
 end loop;
 return n;
end $$;
revoke all on function public.schedule_company_watches(integer) from public,anon;
grant execute on function public.schedule_company_watches(integer) to authenticated;
