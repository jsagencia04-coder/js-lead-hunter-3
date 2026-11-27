-- Propostas detalhadas, catálogo e pós-venda. Sem cobrança/assinatura SaaS.
alter table public.service_catalog add column item_type text not null default 'servico' check(item_type in ('servico','produto','pacote'));
alter table public.service_catalog add column category text;
alter table public.service_catalog add column unit_cost numeric(14,2) check(unit_cost>=0);
alter table public.service_catalog add column delivery_days integer check(delivery_days>=0);
alter table public.lead_proposals add column line_items jsonb not null default '[]';
alter table public.lead_proposals add column document_template text not null default 'comercial' check(document_template in ('comercial','diagnostico','renovacao'));
alter table public.lead_proposals add column approved_at timestamptz;
alter table public.lead_proposals add column approved_by uuid references public.profiles(id);
create function public.save_proposal_document(p_id uuid,p_title text,p_scope text,p_payment text,p_delivery text,p_notes text,p_items jsonb,p_template text default 'comercial')
returns void language plpgsql security definer set search_path=public as $$
declare item jsonb;total numeric:=0;quantity numeric;price numeric;discount numeric;services uuid[]:='{}';sid uuid;
begin
 if not public.has_role(array['admin','gestor','comercial']::public.app_role[]) then raise exception 'Sem permissão';end if;
 perform 1 from public.lead_proposals where id=p_id and status='rascunho' for update;
 if not found then raise exception 'Somente rascunhos podem ser editados; duplique uma proposta enviada';end if;
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)>100 then raise exception 'Até 100 itens';end if;
 for item in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(item) is distinct from 'object' or coalesce(length(trim(item->>'description')),0)=0 then raise exception 'Descrição necessária em cada item';end if;
  if jsonb_typeof(item->'quantity') is distinct from 'number' or jsonb_typeof(item->'unit_price') is distinct from 'number' or jsonb_typeof(item->'discount_percent') is distinct from 'number' then raise exception 'Valores dos itens devem ser numéricos';end if;
  quantity:=(item->>'quantity')::numeric;price:=(item->>'unit_price')::numeric;discount:=(item->>'discount_percent')::numeric;
  if quantity<=0 or quantity>100000 or price<0 or price>100000000 or discount<0 or discount>100 then raise exception 'Quantidade, preço ou desconto inválido';end if;
  sid:=nullif(item->>'service_id','')::uuid;
  if sid is not null then
   if not exists(select 1 from public.service_catalog where id=sid and active) then raise exception 'Serviço indisponível';end if;
   services:=array_append(services,sid);
  end if;
  total:=total+round(quantity*price*(1-discount/100),2);
 end loop;
 update public.lead_proposals set title=p_title,scope=p_scope,payment_terms=p_payment,delivery_terms=p_delivery,notes=p_notes,
  line_items=p_items,document_template=p_template,amount=total,service_ids=services,approved_at=null,approved_by=null where id=p_id;
end $$;
create function public.approve_proposal_document(p_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.has_role(array['admin','gestor']::public.app_role[]) then raise exception 'Gestão necessária';end if;
 update public.lead_proposals set approved_at=now(),approved_by=auth.uid() where id=p_id and status='rascunho' and amount is not null and coalesce(length(trim(scope)),0)>0;
 if not found then raise exception 'Rascunho com escopo e valor necessário';end if;
end $$;
create function public.duplicate_proposal_document(p_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare n uuid;
begin
 if not public.has_role(array['admin','gestor','comercial']::public.app_role[]) then raise exception 'Sem permissão';end if;
 insert into public.lead_proposals(lead_id,opportunity_id,title,service_ids,amount,status,valid_until,scope,payment_terms,delivery_terms,notes,line_items,document_template,created_by)
 select lead_id,opportunity_id,title||' (revisão)',service_ids,amount,'rascunho',null,scope,payment_terms,delivery_terms,notes,line_items,document_template,auth.uid() from public.lead_proposals where id=p_id returning id into n;
 if n is null then raise exception 'Proposta indisponível';end if;return n;
end $$;
-- Evita que alterações de conteúdo mantenham aprovação obsoleta.
create function public.invalidate_proposal_approval() returns trigger language plpgsql as $$
begin
 if tg_op='INSERT' then
  if new.approved_at is not null or new.approved_by is not null then raise exception 'Aprovação deve ser registrada pela operação autorizada';end if;
  return new;
 end if;
 if old.status<>'rascunho' and (new.title,new.scope,new.payment_terms,new.delivery_terms,new.notes,new.amount,new.line_items,new.service_ids,new.document_template)
  is distinct from (old.title,old.scope,old.payment_terms,old.delivery_terms,old.notes,old.amount,old.line_items,old.service_ids,old.document_template) then
  raise exception 'Preserve a proposta enviada; crie uma cópia para revisão';
 end if;
 if (new.title,new.scope,new.payment_terms,new.delivery_terms,new.notes,new.amount,new.line_items,new.service_ids,new.document_template)
  is distinct from (old.title,old.scope,old.payment_terms,old.delivery_terms,old.notes,old.amount,old.line_items,old.service_ids,old.document_template) then
  new.approved_at:=null;new.approved_by:=null;
 elsif (new.approved_at,new.approved_by) is distinct from (old.approved_at,old.approved_by) then
  if not public.has_role(array['admin','gestor']::public.app_role[]) then raise exception 'Gestão necessária para aprovação';end if;
 end if;return new;
end $$;
create trigger proposal_approval_guard before insert or update on public.lead_proposals for each row execute function public.invalidate_proposal_approval();

create table public.proposal_templates(
 id uuid primary key default gen_random_uuid(),name text not null check(length(trim(name)) between 1 and 120),
 scope text not null,payment_terms text,delivery_terms text,active boolean not null default true,
 created_by uuid not null references public.profiles(id),updated_at timestamptz not null default now()
);
create table public.customer_reviews(
 id uuid primary key default gen_random_uuid(),contract_id uuid not null references public.contracts(id) on delete restrict,
 satisfaction smallint check(satisfaction between 1 and 5),notes text not null check(length(trim(notes))>0),
 next_contact_on date,created_by uuid not null references public.profiles(id),created_at timestamptz not null default now()
);
do $$declare t text;begin foreach t in array array['proposal_templates','customer_reviews'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant select on public.%I to authenticated',t);
 execute format('create policy %I on public.%I for select to authenticated using(public.is_active_user())',t||'_read',t);
 execute format('create trigger %I after insert or update on public.%I for each row execute function public.audit_trigger()',t||'_audit',t);
end loop;end $$;
create function public.save_proposal_template(p_name text,p_scope text,p_payment text,p_delivery text,p_id uuid default null,p_active boolean default true)
returns uuid language plpgsql security definer set search_path=public as $$
declare n uuid;begin
 if not public.has_role(array['admin','gestor']::public.app_role[]) then raise exception 'Gestão necessária';end if;
 if p_id is null then insert into public.proposal_templates(name,scope,payment_terms,delivery_terms,created_by) values(p_name,p_scope,p_payment,p_delivery,auth.uid()) returning id into n;
 else update public.proposal_templates set name=p_name,scope=p_scope,payment_terms=p_payment,delivery_terms=p_delivery,active=p_active,updated_at=now() where id=p_id returning id into n;end if;
 if n is null then raise exception 'Modelo indisponível';end if;return n;
end $$;
create function public.record_customer_review(p_contract uuid,p_satisfaction integer,p_notes text,p_next date default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare n uuid;begin
 if not public.has_role(array['admin','gestor','comercial']::public.app_role[]) then raise exception 'Sem permissão';end if;
 insert into public.customer_reviews(contract_id,satisfaction,notes,next_contact_on,created_by) values(p_contract,p_satisfaction,p_notes,p_next,auth.uid()) returning id into n;
 return n;
end $$;
create function public.create_catalog_item(p_code text,p_name text,p_type text,p_description text,p_price numeric,p_cost numeric,p_category text,p_days integer)
returns uuid language plpgsql security definer set search_path=public as $$
declare n uuid;begin
 if not public.has_role(array['admin']::public.app_role[]) then raise exception 'Apenas administradores';end if;
 if p_code !~ '^[a-z0-9_]{2,60}$' then raise exception 'Código deve usar letras minúsculas/números/underscore';end if;
 insert into public.service_catalog(code,name,item_type,description,price_from,unit_cost,category,delivery_days)
 values(p_code,p_name,p_type,p_description,p_price,p_cost,p_category,p_days) returning id into n;return n;
end $$;
do $$declare s text;begin foreach s in array array['save_proposal_document(uuid,text,text,text,text,text,jsonb,text)','approve_proposal_document(uuid)','duplicate_proposal_document(uuid)','save_proposal_template(text,text,text,text,uuid,boolean)','record_customer_review(uuid,integer,text,date)','create_catalog_item(text,text,text,text,numeric,numeric,text,integer)'] loop
 execute 'revoke all on function public.'||s||' from public,anon';execute 'grant execute on function public.'||s||' to authenticated';end loop;end $$;
