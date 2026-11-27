-- Receita recebida é lançamento manual, separada de contratos e pipeline; sem cobrança automática.
create table public.contract_receipts(
 id uuid primary key default gen_random_uuid(),contract_id uuid not null references public.contracts(id) on delete restrict,
 amount numeric(14,2) not null check(amount>0),received_on date not null,
 reference text not null check(length(trim(reference)) between 1 and 240),
 created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),
 voided_at timestamptz,voided_by uuid references public.profiles(id),void_reason text,
 unique(contract_id,reference),check(voided_at is null or length(trim(void_reason))>0)
);
create index receipts_date_idx on public.contract_receipts(received_on);
alter table public.contract_receipts enable row level security;
revoke all on public.contract_receipts from public,anon,authenticated;
grant select on public.contract_receipts to authenticated;
create policy receipts_read on public.contract_receipts for select to authenticated using(public.is_active_user());
create trigger contract_receipts_audit after insert or update on public.contract_receipts for each row execute function public.audit_trigger();
create function public.record_contract_receipt(p_contract uuid,p_amount numeric,p_date date,p_reference text)
returns uuid language plpgsql security definer set search_path=public as $$
declare n uuid;
begin
 if not public.has_role(array['admin','gestor']::public.app_role[]) then raise exception 'Gestão necessária'; end if;
 if p_date>current_date or p_date is null then raise exception 'Data de recebimento deve ser real e não futura'; end if;
 insert into public.contract_receipts(contract_id,amount,received_on,reference,created_by)
 values(p_contract,p_amount,p_date,trim(p_reference),auth.uid()) returning id into n;
 return n;
end $$;
create function public.void_contract_receipt(p_id uuid,p_reason text)
returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.has_role(array['admin','gestor']::public.app_role[]) then raise exception 'Gestão necessária'; end if;
 if coalesce(length(trim(p_reason)),0)=0 then raise exception 'Justifique o estorno'; end if;
 update public.contract_receipts set voided_at=now(),voided_by=auth.uid(),void_reason=trim(p_reason)
 where id=p_id and voided_at is null;
 if not found then raise exception 'Recebimento indisponível ou já estornado'; end if;
end $$;
create function public.revenue_summary(p_from date,p_to date)
returns jsonb language plpgsql stable security invoker set search_path=public as $$
begin
 if not public.is_active_user() then raise exception 'Usuário ativo necessário'; end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>3660 then raise exception 'Período inválido (máximo 10 anos)'; end if;
 return jsonb_build_object('from',p_from,'to',p_to,
  'potential_open',(select coalesce(sum(value),0) from public.opportunities where status='aberta'),
  'contracted_period',(select coalesce(sum(total_value),0) from public.contracts where status='ativo' and signed_at between p_from and p_to),
  'received_period',(select coalesce(sum(amount),0) from public.contract_receipts where voided_at is null and received_on between p_from and p_to),
  'receipt_count',(select count(*) from public.contract_receipts where voided_at is null and received_on between p_from and p_to),
  'methodology','Potencial: valor de oportunidades abertas na data da consulta, não previsão garantida. Contratado: contratos ativos assinados no período. Recebido: lançamentos manuais não estornados pela data de recebimento. Sem inferir recebimento a partir de proposta ou contrato.');
end $$;
do $$ declare s text;begin foreach s in array array['record_contract_receipt(uuid,numeric,date,text)','void_contract_receipt(uuid,text)','revenue_summary(date,date)'] loop
 execute 'revoke all on function public.'||s||' from public,anon';execute 'grant execute on function public.'||s||' to authenticated';end loop;end $$;

-- Pacotes de segmento configuráveis sem aplicações separadas e sem presets fictícios.
create table public.intelligence_segments(
 id uuid primary key default gen_random_uuid(),name text not null unique check(length(trim(name)) between 1 and 120),
 description text not null default '',cnae_prefixes text[] not null default '{}',service_ids uuid[] not null default '{}',
 icp text not null default '',active boolean not null default true,
 created_by uuid not null references public.profiles(id),updated_at timestamptz not null default now()
);
alter table public.intelligence_segments enable row level security;
revoke all on public.intelligence_segments from public,anon,authenticated;
grant select on public.intelligence_segments to authenticated;
create policy segments_read on public.intelligence_segments for select to authenticated using(public.is_active_user());
create trigger intelligence_segments_audit after insert or update on public.intelligence_segments for each row execute function public.audit_trigger();
create function public.save_intelligence_segment(p_name text,p_description text,p_cnaes text[],p_services uuid[],p_icp text,p_id uuid default null,p_active boolean default true)
returns uuid language plpgsql security definer set search_path=public as $$
declare n uuid;
begin
 if not public.has_role(array['admin','gestor']::public.app_role[]) then raise exception 'Gestão necessária'; end if;
 if coalesce(cardinality(p_cnaes),0)>100 or exists(select 1 from unnest(p_cnaes)x where x !~ '^[0-9]{2,7}$') then raise exception 'CNAEs devem conter de 2 a 7 dígitos (até 100)'; end if;
 if exists(select 1 from unnest(p_services)x where not exists(select 1 from public.service_catalog s where s.id=x and s.active)) then raise exception 'Serviço indisponível'; end if;
 if p_id is null then insert into public.intelligence_segments(name,description,cnae_prefixes,service_ids,icp,active,created_by)
 values(p_name,p_description,coalesce(p_cnaes,'{}'),coalesce(p_services,'{}'),p_icp,p_active,auth.uid()) returning id into n;
 else update public.intelligence_segments set name=p_name,description=p_description,cnae_prefixes=coalesce(p_cnaes,'{}'),service_ids=coalesce(p_services,'{}'),icp=p_icp,active=p_active,updated_at=now()
 where id=p_id returning id into n;
 if n is null then raise exception 'Segmento indisponível'; end if; end if;
 return n;
end $$;
revoke all on function public.save_intelligence_segment(text,text,text[],uuid[],text,uuid,boolean) from public,anon;
grant execute on function public.save_intelligence_segment(text,text,text[],uuid[],text,uuid,boolean) to authenticated;
