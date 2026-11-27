-- Campanhas organizam operação interna. Não existem disparos externos.
create table public.sales_campaigns(
 id uuid primary key default gen_random_uuid(), name text not null check(length(trim(name)) between 1 and 160),
 objective text not null default '',service_id uuid references public.service_catalog(id),
 starts_on date,ends_on date,status text not null default 'rascunho' check(status in ('rascunho','ativa','pausada','concluida')),
 owner_id uuid not null references public.profiles(id),created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check(ends_on is null or starts_on is null or ends_on>=starts_on)
);
create table public.sales_campaign_members(
 campaign_id uuid not null references public.sales_campaigns(id) on delete restrict,
 lead_id uuid not null references public.leads(id) on delete restrict,
 added_by uuid not null references public.profiles(id),added_at timestamptz not null default now(),
 primary key(campaign_id,lead_id)
);
create index sales_campaign_members_lead_idx on public.sales_campaign_members(lead_id);
alter table public.sales_campaigns enable row level security;
alter table public.sales_campaign_members enable row level security;
revoke all on public.sales_campaigns,public.sales_campaign_members from public,anon,authenticated;
grant select on public.sales_campaigns,public.sales_campaign_members to authenticated;
create policy campaigns_read on public.sales_campaigns for select to authenticated using(public.is_active_user());
create policy campaign_members_read on public.sales_campaign_members for select to authenticated using(public.is_active_user());
create trigger sales_campaign_updated before update on public.sales_campaigns for each row execute function public.set_updated_at();
create trigger sales_campaign_audit after insert or update on public.sales_campaigns for each row execute function public.audit_trigger();
create trigger sales_campaign_members_audit after insert on public.sales_campaign_members for each row execute function public.audit_trigger();

create function public.save_sales_campaign(p_name text,p_objective text,p_service_id uuid default null,p_start date default null,p_end date default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare n uuid;
begin
 if not public.has_role(array['admin','gestor','comercial']::public.app_role[]) then raise exception 'Sem permissão'; end if;
 if p_service_id is not null and not exists(select 1 from public.service_catalog where id=p_service_id and active) then raise exception 'Serviço indisponível'; end if;
 insert into public.sales_campaigns(name,objective,service_id,starts_on,ends_on,owner_id,created_by)
 values(p_name,p_objective,p_service_id,p_start,p_end,auth.uid(),auth.uid()) returning id into n;
 return n;
end $$;
create function public.set_sales_campaign_status(p_id uuid,p_status text)
returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.has_role(array['admin','gestor','comercial']::public.app_role[]) then raise exception 'Sem permissão'; end if;
 update public.sales_campaigns set status=p_status where id=p_id and (owner_id=auth.uid() or public.has_role(array['admin','gestor']::public.app_role[]));
 if not found then raise exception 'Campanha indisponível'; end if;
end $$;
create function public.add_campaign_members(p_id uuid,p_lead_ids uuid[])
returns integer language plpgsql security definer set search_path=public as $$
declare n integer;
begin
 if not public.has_role(array['admin','gestor','comercial']::public.app_role[]) then raise exception 'Sem permissão'; end if;
 if coalesce(cardinality(p_lead_ids),0)>500 then raise exception 'Selecione até 500 empresas por operação'; end if;
 if not exists(select 1 from public.sales_campaigns where id=p_id and status<>'concluida'
   and (owner_id=auth.uid() or public.has_role(array['admin','gestor']::public.app_role[]))) then raise exception 'Campanha indisponível'; end if;
 insert into public.sales_campaign_members(campaign_id,lead_id,added_by)
 select p_id,l.id,auth.uid() from public.leads l where l.id=any(p_lead_ids)
  and not exists(select 1 from public.contact_suppressions s where s.cnpj_basico=l.cnpj_basico)
 on conflict do nothing;
 get diagnostics n=row_count;return n;
end $$;
create function public.sales_campaign_metrics(p_id uuid)
returns jsonb language plpgsql stable security invoker set search_path=public as $$
declare c public.sales_campaigns%rowtype;
begin
 if not public.is_active_user() then raise exception 'Usuário ativo necessário'; end if;
 select * into c from public.sales_campaigns where id=p_id;
 if not found then raise exception 'Campanha indisponível'; end if;
 return (with members as(select * from public.sales_campaign_members where campaign_id=p_id),
 events as(select e.* from public.lead_events e join members m on m.lead_id=e.lead_id where e.created_at>=m.added_at),
 proposals as(select p.* from public.lead_proposals p join members m on m.lead_id=p.lead_id where p.created_at>=m.added_at),
 contracts as(select x.* from public.contracts x join members m on m.lead_id=x.lead_id where x.created_at>=m.added_at)
 select jsonb_build_object('empresas',(select count(*) from members),
 'contatadas',(select count(distinct lead_id) from events where event_type='contato'),
 'respostas',(select count(*) from events where event_type='resposta_recebida'),
 'reunioes',(select count(*) from events where event_type='reuniao'),
 'propostas',(select count(*) from proposals),'aceitas',(select count(*) from proposals where status='aceita'),
 'receita_contratada',(select coalesce(sum(total_value),0) from contracts where status='ativo'),
 'methodology','Atividades de membros registradas após inclusão na carteira. Associação temporal, não atribuição causal: uma empresa pode estar em várias campanhas. Receita contratada não é receita recebida.'));
end $$;
do $$ declare s text; begin
 foreach s in array array['save_sales_campaign(text,text,uuid,date,date)','set_sales_campaign_status(uuid,text)','add_campaign_members(uuid,uuid[])','sales_campaign_metrics(uuid)'] loop
 execute 'revoke all on function public.'||s||' from public,anon';
 execute 'grant execute on function public.'||s||' to authenticated';
 end loop;
end $$;

-- Histórico de proposta preserva payload a cada alteração relevante; sem envio automático.
alter table public.lead_proposals add column scope text;
alter table public.lead_proposals add column payment_terms text;
alter table public.lead_proposals add column delivery_terms text;
create table public.proposal_versions(
 id bigint generated always as identity primary key,
 proposal_id uuid not null references public.lead_proposals(id) on delete restrict,
 revision integer not null,payload jsonb not null,created_by uuid references public.profiles(id),created_at timestamptz not null default now(),
 unique(proposal_id,revision)
);
alter table public.proposal_versions enable row level security;
revoke all on public.proposal_versions from public,anon,authenticated;
revoke all on sequence public.proposal_versions_id_seq from public,anon,authenticated;
grant select on public.proposal_versions to authenticated;
create policy proposal_versions_read on public.proposal_versions for select to authenticated using(public.is_active_user());
create function public.track_proposal_version() returns trigger language plpgsql security definer set search_path=public as $$
declare rev integer;
begin
 if tg_op='UPDATE' and (to_jsonb(new)-'updated_at')=(to_jsonb(old)-'updated_at') then return new; end if;
 select coalesce(max(revision),0)+1 into rev from public.proposal_versions where proposal_id=new.id;
 insert into public.proposal_versions(proposal_id,revision,payload,created_by) values(new.id,rev,to_jsonb(new),auth.uid());
 return new;
end $$;
revoke all on function public.track_proposal_version() from public,anon,authenticated;
create trigger proposal_version_track after insert or update on public.lead_proposals for each row execute function public.track_proposal_version();

create function public.proposal_document(p_id uuid)
returns jsonb language plpgsql stable security invoker set search_path=public as $$
declare output jsonb;
begin
 if not public.is_active_user() then raise exception 'Usuário ativo necessário'; end if;
 select jsonb_build_object('proposal',to_jsonb(p),'company',jsonb_build_object('cnpj',l.cnpj,'name',coalesce(e.nome_fantasia,c.razao_social),'legal_name',c.razao_social),
 'services',coalesce((select jsonb_agg(jsonb_build_object('name',s.name,'description',s.description,'deliverables',s.deliverables)) from public.service_catalog s where s.id=any(p.service_ids)),'[]'::jsonb),
 'revision',(select max(revision) from public.proposal_versions where proposal_id=p.id),
 'issuer','JS Designer','generated_at',now()) into output
 from public.lead_proposals p join public.leads l on l.id=p.lead_id
 join public.companies c on c.cnpj_basico=l.cnpj_basico join public.establishments e on e.cnpj=l.cnpj where p.id=p_id;
 if output is null then raise exception 'Proposta indisponível'; end if;
 return output;
end $$;
revoke all on function public.proposal_document(uuid) from public,anon;
grant execute on function public.proposal_document(uuid) to authenticated;
