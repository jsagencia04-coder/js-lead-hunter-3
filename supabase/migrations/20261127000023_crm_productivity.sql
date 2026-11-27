-- CRM V4: múltiplos funis/equipes sem substituir etapas/histórico existentes.
create table public.sales_pipelines(
 id uuid primary key default gen_random_uuid(),name text not null unique check(length(trim(name)) between 1 and 120),
 active boolean not null default true,created_at timestamptz not null default now()
);
insert into public.sales_pipelines(id,name) values('00000000-0000-4000-8000-000000000001','Comercial principal');
create table public.pipeline_stage_members(
 pipeline_id uuid not null references public.sales_pipelines(id) on delete restrict,
 stage_code text not null references public.pipeline_stages(code) on update cascade on delete restrict,
 sort_order integer not null,primary key(pipeline_id,stage_code)
);
insert into public.pipeline_stage_members select '00000000-0000-4000-8000-000000000001',code,sort_order from public.pipeline_stages;
create table public.sales_teams(id uuid primary key default gen_random_uuid(),name text not null unique check(length(trim(name)) between 1 and 120),active boolean not null default true);
create table public.sales_team_members(team_id uuid not null references public.sales_teams(id) on delete restrict,user_id uuid not null references public.profiles(id) on delete restrict,primary key(team_id,user_id));
alter table public.opportunities add column pipeline_id uuid not null default '00000000-0000-4000-8000-000000000001' references public.sales_pipelines(id);
alter table public.opportunities add column team_id uuid references public.sales_teams(id);
alter table public.opportunities add column priority_level text not null default 'normal' check(priority_level in ('baixa','normal','alta','urgente'));
alter table public.opportunities add column probability_override smallint check(probability_override between 0 and 100);
create index opportunities_pipeline_idx on public.opportunities(pipeline_id,stage_code);
create index opportunities_team_idx on public.opportunities(team_id) where team_id is not null;
do $$ declare t text;begin foreach t in array array['sales_pipelines','pipeline_stage_members','sales_teams','sales_team_members'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('create policy %I on public.%I for select to authenticated using(public.is_active_user())',t||'_read',t);
 execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_trigger()',t||'_audit',t);
end loop;end $$;
create function public.configure_sales_pipeline(p_name text,p_stages text[],p_id uuid default null,p_active boolean default true)
returns uuid language plpgsql security definer set search_path=public as $$
declare n uuid;s text;pos integer:=0;
begin
 if not public.has_role(array['admin']::public.app_role[]) then raise exception 'Apenas administradores';end if;
 if coalesce(cardinality(p_stages),0)<2 or cardinality(p_stages)>50 then raise exception 'Selecione entre 2 e 50 etapas';end if;
 if cardinality(p_stages)<>(select count(distinct x) from unnest(p_stages)x) then raise exception 'Etapas duplicadas';end if;
 if exists(select 1 from unnest(p_stages)x where not exists(select 1 from public.pipeline_stages where code=x and active)) then raise exception 'Etapa inativa ou inexistente';end if;
 if not exists(select 1 from public.pipeline_stages where code=any(p_stages) and kind='aberta') then raise exception 'Funil precisa de etapa aberta';end if;
 -- Etapas terminais legadas permanecem em todos os funis para integração com contratos/perdas.
 p_stages:=p_stages||array(select code from public.pipeline_stages where kind in ('ganha','pos_venda','perdida') and not(code=any(p_stages)) order by sort_order);
 if p_id is null then insert into public.sales_pipelines(name,active) values(p_name,p_active) returning id into n;
 else
  if exists(select 1 from public.opportunities where pipeline_id=p_id and (not(stage_code=any(p_stages)) or (not p_active and status='aberta'))) then raise exception 'Preserve as etapas utilizadas por oportunidades e não desative funil com oportunidades abertas';end if;
  update public.sales_pipelines set name=p_name,active=p_active where id=p_id returning id into n;
  if n is null then raise exception 'Funil indisponível';end if;
 end if;
 delete from public.pipeline_stage_members where pipeline_id=n;
 foreach s in array p_stages loop pos:=pos+1;insert into public.pipeline_stage_members values(n,s,pos);end loop;
 return n;
end $$;
create function public.configure_sales_team(p_name text,p_users uuid[],p_id uuid default null,p_active boolean default true)
returns uuid language plpgsql security definer set search_path=public as $$
declare n uuid;
begin
 if not public.has_role(array['admin','gestor']::public.app_role[]) then raise exception 'Gestão necessária';end if;
 if coalesce(cardinality(p_users),0)>100 or exists(select 1 from unnest(p_users)x where not exists(select 1 from public.profiles where id=x and active)) then raise exception 'Membros devem ser usuários ativos (até 100)';end if;
 if p_id is null then insert into public.sales_teams(name,active) values(p_name,p_active) returning id into n;
 else update public.sales_teams set name=p_name,active=p_active where id=p_id returning id into n;if n is null then raise exception 'Equipe indisponível';end if;end if;
 delete from public.sales_team_members where team_id=n;
 insert into public.sales_team_members select n,x from unnest(p_users)x on conflict do nothing;
 return n;
end $$;
-- RLS de escrita anterior é preservada; trigger impede combinações inválidas por qualquer cliente.
create function public.validate_opportunity_pipeline() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from public.pipeline_stage_members where pipeline_id=new.pipeline_id and stage_code=new.stage_code) then
   raise exception 'Etapa não pertence ao funil';
 end if;
 if (tg_op='INSERT' or new.pipeline_id is distinct from old.pipeline_id) and not exists(select 1 from public.sales_pipelines where id=new.pipeline_id and active) then raise exception 'Funil inativo';end if;
 if new.team_id is not null and (tg_op='INSERT' or new.team_id is distinct from old.team_id) and not exists(select 1 from public.sales_teams where id=new.team_id and active) then raise exception 'Equipe inativa';end if;
 return new;
end $$;
revoke all on function public.validate_opportunity_pipeline() from public,anon,authenticated;
create trigger zz_validate_opportunity_pipeline before insert or update on public.opportunities for each row execute function public.validate_opportunity_pipeline();
create or replace view public.opportunity_list_v with(security_invoker=true) as
select o.id,o.lead_id,o.title,o.stage_code,ps.label as stage_label,ps.sort_order as stage_order,o.status,
 o.owner_id,p.full_name as owner_name,o.value,o.recurring_value,o.expected_close,o.service_ids,
 o.lost_reason,lr.label as lost_reason_label,o.won_at,o.lost_at,o.stage_changed_at,o.source,
 o.created_at,o.updated_at,l.cnpj,l.cnpj_basico,l.score,l.priority,c.razao_social,e.nome_fantasia,
 e.uf,m.name as municipio,e.has_phone,e.has_email,l.next_follow_up_at,
 (select count(*) from public.crm_tasks t where t.opportunity_id=o.id and t.done_at is null) as tarefas_abertas,
 o.pipeline_id,sp.name as pipeline_name,o.team_id,st.name as team_name,o.priority_level,
 coalesce(o.probability_override,ps.probability) as probability,
 round(coalesce(o.value,0)*coalesce(o.probability_override,ps.probability)/100,2) as weighted_value
from public.opportunities o join public.pipeline_stages ps on ps.code=o.stage_code
 join public.leads l on l.id=o.lead_id join public.establishments e on e.cnpj=l.cnpj
 join public.companies c on c.cnpj_basico=l.cnpj_basico
 left join public.municipalities m on m.code=e.municipio_code left join public.profiles p on p.id=o.owner_id
 left join public.loss_reasons lr on lr.id=o.lost_reason_id
 join public.sales_pipelines sp on sp.id=o.pipeline_id left join public.sales_teams st on st.id=o.team_id;
create function public.pipeline_counts_v4(p_pipeline uuid default null,p_team uuid default null,p_owner uuid default null,p_unassigned boolean default false,p_uf text default null)
returns table(stage_code text,total bigint,valor numeric,weighted numeric)
language sql stable security invoker set search_path=public as $$
 select v.stage_code,count(*),coalesce(sum(v.value),0),coalesce(sum(v.weighted_value),0) from public.opportunity_list_v v
 where (p_pipeline is null or v.pipeline_id=p_pipeline) and (p_team is null or v.team_id=p_team)
 and (p_owner is null or v.owner_id=p_owner) and (not p_unassigned or v.owner_id is null) and (p_uf is null or v.uf=p_uf)
 group by v.stage_code
$$;

create table public.recurring_task_rules(
 id uuid primary key default gen_random_uuid(),lead_id uuid not null references public.leads(id) on delete restrict,
 source_task_id uuid not null unique references public.crm_tasks(id) on delete restrict,
 opportunity_id uuid references public.opportunities(id) on delete restrict,owner_id uuid not null references public.profiles(id),
 kind text not null check(kind in ('ligacao','reuniao','email','whatsapp','visita','tarefa','follow_up','pos_venda')),
 title text not null check(length(trim(title)) between 1 and 200),interval_days integer not null check(interval_days between 1 and 365),
 next_due_at timestamptz not null,paused boolean not null default false,created_by uuid not null references public.profiles(id),created_at timestamptz not null default now()
);
alter table public.crm_tasks add column recurring_rule_id uuid references public.recurring_task_rules(id) on delete restrict;
alter table public.crm_tasks add column recurring_occurrence timestamptz;
create unique index crm_tasks_recurring_unique on public.crm_tasks(recurring_rule_id,recurring_occurrence) where recurring_rule_id is not null;
alter table public.recurring_task_rules enable row level security;
revoke all on public.recurring_task_rules from public,anon,authenticated;
grant select on public.recurring_task_rules to authenticated;
create policy recurring_read on public.recurring_task_rules for select to authenticated using(public.is_active_user());
create trigger recurring_task_rules_audit after insert or update on public.recurring_task_rules for each row execute function public.audit_trigger();
create function public.create_task_recurrence(p_task uuid,p_days integer)
returns uuid language plpgsql security definer set search_path=public as $$
declare t public.crm_tasks%rowtype;n uuid;
begin
 if not public.has_role(array['admin','gestor','comercial']::public.app_role[]) then raise exception 'Sem permissão';end if;
 select * into t from public.crm_tasks where id=p_task and due_at is not null;
 if not found or t.owner_id is null then raise exception 'Tarefa com data e responsável necessária';end if;
 if t.owner_id<>auth.uid() and not public.has_role(array['admin','gestor']::public.app_role[]) then raise exception 'Somente responsável ou gestão';end if;
 if exists(select 1 from public.leads l join public.contact_suppressions s on s.cnpj_basico=l.cnpj_basico where l.id=t.lead_id) then raise exception 'Empresa bloqueada';end if;
 insert into public.recurring_task_rules(lead_id,source_task_id,opportunity_id,owner_id,kind,title,interval_days,next_due_at,created_by)
 values(t.lead_id,t.id,t.opportunity_id,t.owner_id,t.kind,t.title,p_days,t.due_at+make_interval(days=>p_days),auth.uid())
 on conflict(source_task_id) do nothing returning id into n;
 if n is null then select id into n from public.recurring_task_rules where source_task_id=t.id;end if;
 return n;
end $$;
create function public.pause_task_recurrence(p_id uuid,p_paused boolean)
returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.has_role(array['admin','gestor','comercial']::public.app_role[]) then raise exception 'Sem permissão';end if;
 update public.recurring_task_rules set paused=p_paused where id=p_id and (owner_id=auth.uid() or public.has_role(array['admin','gestor']::public.app_role[]));
 if not found then raise exception 'Regra indisponível';end if;
end $$;
create function public.schedule_recurring_tasks(p_limit integer default 100)
returns integer language plpgsql security definer set search_path=public as $$
declare r record;n integer:=0;
begin
 if not(auth.uid() is null and session_user in ('postgres','supabase_admin')) then raise exception 'Somente worker';end if;
 for r in select rule.* from public.recurring_task_rules rule join public.profiles p on p.id=rule.owner_id and p.active
 join public.leads l on l.id=rule.lead_id where not rule.paused and rule.next_due_at<=now()+interval '1 day'
 and not exists(select 1 from public.contact_suppressions s where s.cnpj_basico=l.cnpj_basico)
 order by rule.next_due_at for update of rule skip locked limit greatest(1,least(coalesce(p_limit,100),500)) loop
 insert into public.crm_tasks(lead_id,opportunity_id,owner_id,kind,title,due_at,recurring_rule_id,recurring_occurrence)
 values(r.lead_id,r.opportunity_id,r.owner_id,r.kind,r.title,r.next_due_at,r.id,r.next_due_at) on conflict do nothing;
 if found then n:=n+1;end if;
 update public.recurring_task_rules set next_due_at=r.next_due_at+make_interval(days=>r.interval_days) where id=r.id;
 end loop;return n;
end $$;
revoke all on function public.schedule_recurring_tasks(integer) from public,anon,authenticated;
do $$ declare s text;begin foreach s in array array['configure_sales_pipeline(text,text[],uuid,boolean)','configure_sales_team(text,uuid[],uuid,boolean)','pipeline_counts_v4(uuid,uuid,uuid,boolean,text)','create_task_recurrence(uuid,integer)','pause_task_recurrence(uuid,boolean)'] loop
 execute 'revoke all on function public.'||s||' from public,anon';execute 'grant execute on function public.'||s||' to authenticated';end loop;end $$;
