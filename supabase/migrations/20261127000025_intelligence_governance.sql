-- Sinais verificáveis, aprendizado descritivo e governança operacional.
create function public.company_opportunity_signals(p_lead uuid)
returns jsonb language plpgsql stable security invoker set search_path=public as $$
declare l record;output jsonb;
begin
 if not public.is_active_user() then raise exception 'Usuário ativo necessário';end if;
 select ld.*,e.data_inicio_atividade into l from public.leads ld join public.establishments e on e.cnpj=ld.cnpj where ld.id=p_lead;
 if not found then raise exception 'Empresa indisponível';end if;
 with signals as (
  select 'abertura_recente' as type,'Empresa aberta recentemente' as label,
   jsonb_build_object('date',l.data_inicio_atividade,'reference',public.current_reference_date()) as evidence,
   'Receita Federal' as source,l.data_inicio_atividade::timestamptz as observed_at,
   'Investigar necessidades iniciais sem presumir intenção de compra.' as next_action,'normal' as urgency
  where l.data_inicio_atividade between public.current_reference_date()-30 and public.current_reference_date()
  union all
  select 'alteracao_cadastral','Mudança cadastral observada',r.changes,'Receita Federal — '||coalesce(r.competence,'não informada'),r.changed_at,
   'Revisar mudança e confirmar relevância antes de abordar.','normal'
  from public.registry_changes r where ((r.entity='empresa' and r.key=l.cnpj_basico) or (r.entity='estabelecimento' and r.key=l.cnpj)) and r.changed_at>now()-interval '90 days'
  union all
  select 'lacuna_digital',d.platform||': não localizado em pesquisa',d.evidence,d.source,d.last_checked_at,
   'Revisar evidências e compatibilidade com serviços existentes.','normal'
  from public.digital_channels d where d.cnpj_basico=l.cnpj_basico and d.status='nao_localizado'
   and d.last_checked_at between now()-interval '90 days' and now() and d.source is not null
   and jsonb_typeof(d.evidence)='array' and d.evidence<>'[]'
  union all
  select 'problema_tecnico','Problemas técnicos observados no site',d.result->'problemas',d.source,d.last_checked_at,
   'Preparar diagnóstico com problemas observados e propor investigação.','alta'
  from public.digital_channels d where d.cnpj_basico=l.cnpj_basico and d.platform='site' and d.status='verificado'
   and d.last_checked_at between now()-interval '30 days' and now()
   and jsonb_typeof(d.result->'problemas')='array' and d.result->'problemas'<>'[]'
 ), ranked as(select * from signals order by observed_at desc nulls last limit 30)
 select jsonb_build_object('signals',coalesce(jsonb_agg(to_jsonb(ranked)),'[]'),
 'services',coalesce((select jsonb_agg(to_jsonb(r)) from(select s.id,s.name,lr.reason,lr.relevance from public.lead_recommendations lr join public.service_catalog s on s.id=lr.service_id and s.active where lr.lead_id=p_lead order by lr.relevance desc limit 5)r),'[]'),
 'blocked',exists(select 1 from public.contact_suppressions where cnpj_basico=l.cnpj_basico),
 'methodology','Sinais descritivos, não previsão estatística de compra. Recência usa a data de referência da competência. Prioridade sugerida exige investigação humana. Dados inconclusivos/sem evidência não provam ausência.') into output from ranked;
 return output;
end $$;
create function public.company_relationship_graph(p_lead uuid)
returns jsonb language plpgsql stable security invoker set search_path=public as $$
declare b record;output jsonb;
begin
 if not public.is_active_user() then raise exception 'Usuário ativo necessário';end if;
 select l.cnpj_basico,e.cnae_principal,e.uf,e.municipio_code into b from public.leads l join public.establishments e on e.cnpj=l.cnpj where l.id=p_lead;
 if not found then raise exception 'Empresa indisponível';end if;
 return jsonb_build_object('company_key',b.cnpj_basico,
 'establishments',coalesce((select jsonb_agg(to_jsonb(x)) from(select cnpj,nome_fantasia,identificador_matriz,uf,municipio_code,cnae_principal from public.establishments where cnpj_basico=b.cnpj_basico order by cnpj limit 50)x),'[]'),
 'services',coalesce((select jsonb_agg(to_jsonb(x)) from(select s.id,s.name,r.reason from public.lead_recommendations r join public.service_catalog s on s.id=r.service_id where r.lead_id=p_lead limit 20)x),'[]'),
 'campaigns',coalesce((select jsonb_agg(to_jsonb(x)) from(select c.id,c.name from public.sales_campaign_members m join public.sales_campaigns c on c.id=m.campaign_id where m.lead_id=p_lead limit 20)x),'[]'),
 'opportunities',coalesce((select jsonb_agg(to_jsonb(x)) from(select id,title,status,value from public.opportunities where lead_id=p_lead order by created_at desc limit 30)x),'[]'),
 'comparables',public.company_comparables(p_lead)->'items',
 'methodology','Relações explícitas da base: mesmo CNPJ básico indica estabelecimentos da mesma pessoa jurídica; CNAE/município indicam semelhança, não grupo econômico. Não infere sócios ou relações societárias ausentes. Limites: 50 estabelecimentos, 20 serviços/campanhas/comparáveis, 30 oportunidades.');
end $$;
create function public.commercial_learning(p_from date,p_to date)
returns jsonb language plpgsql stable security invoker set search_path=public as $$
declare output jsonb;
begin
 if not public.has_role(array['admin','gestor']::public.app_role[]) then raise exception 'Gestão necessária';end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>3660 then raise exception 'Período inválido';end if;
 with base as(select o.*,e.cnae_principal,e.uf from public.opportunities o join public.leads l on l.id=o.lead_id join public.establishments e on e.cnpj=l.cnpj where o.created_at::date between p_from and p_to),
 summary as(select cnae_principal,count(*) as sample,
 count(*) filter(where status in ('ganha','pos_venda','perdida')) as decided,
 count(*) filter(where status in ('ganha','pos_venda')) as won,
 count(*) filter(where status='perdida') as lost,
 round(avg(value) filter(where status in ('ganha','pos_venda')),2) as avg_ticket,
 round(avg(extract(epoch from (won_at-created_at))/86400) filter(where status in ('ganha','pos_venda')),1) as avg_days_to_win
 from base group by cnae_principal), rules as(
 select *,round(100.0*won/nullif(decided,0),2) as conversion,
 case when decided>=20 then 'Amostra disponível para revisão humana; comparar por período e evitar vieses de seleção.' else 'Amostra insuficiente para sugerir alteração de pesos.' end as limitation
 from summary)
 select jsonb_build_object('segments',coalesce((select jsonb_agg(to_jsonb(x)) from(select * from rules order by decided desc limit 50)x),'[]'),
 'loss_reasons',coalesce((select jsonb_agg(to_jsonb(x)) from(select coalesce(lost_reason,'Sem motivo') as reason,count(*) as total from base where status='perdida' group by lost_reason order by count(*) desc limit 20)x),'[]'),
 'from',p_from,'to',p_to,'methodology','Desfechos por data de criação da oportunidade. Conversão = ganhas/(ganhas+perdidas); abertas não entram no denominador. Amostras limitadas e seleção comercial podem distorcer resultados. Correlação não é causalidade. Nenhum peso é alterado automaticamente.') into output;
 return output;
end $$;
create table public.governance_requests(
 id uuid primary key default gen_random_uuid(),request_type text not null check(request_type in ('acesso','correcao','oposicao','exclusao','retencao')),
 cnpj_basico text not null check(cnpj_basico ~ '^[0-9A-Z]{8}$'),details text not null check(length(trim(details))>0),
 status text not null default 'aberta' check(status in ('aberta','em_analise','concluida','indeferida')),
 resolution text,created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.data_governance_policies(
 key text primary key check(key in ('source','purpose','legal_basis_review','retention','sharing')),
 description text not null,reviewed_by uuid references public.profiles(id),reviewed_at timestamptz
);
insert into public.data_governance_policies(key,description) values
 ('source','Cadastros da base pública do CNPJ; canais e evidências das fontes configuradas.'),
 ('purpose','Inteligência empresarial e operação comercial interna, sujeita a revisão jurídica.'),
 ('legal_basis_review','Pendente de definição e avaliação jurídica especializada. Não declarar conformidade integral.'),
 ('retention','Histórico preservado; prazo e hipóteses legais de exclusão dependem de política aprovada.'),
 ('sharing','Modelos externos não autorizados/configurados nesta operação.');
do $$declare t text;begin foreach t in array array['governance_requests','data_governance_policies'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant select on public.%I to authenticated',t);
 execute format('create policy %I on public.%I for select to authenticated using(public.has_role(array[''admin'',''gestor'']::public.app_role[]))',t||'_read',t);
 execute format('create trigger %I after insert or update on public.%I for each row execute function public.audit_trigger()',t||'_audit',t);end loop;end $$;
create function public.record_governance_request(p_type text,p_company text,p_details text)
returns uuid language plpgsql security definer set search_path=public as $$
declare n uuid;begin
 if not public.has_role(array['admin','gestor']::public.app_role[]) then raise exception 'Gestão necessária';end if;
 insert into public.governance_requests(request_type,cnpj_basico,details,created_by) values(p_type,p_company,p_details,auth.uid()) returning id into n;
 if p_type='oposicao' then insert into public.contact_suppressions(cnpj_basico,reason,origin,created_by) values(p_company,p_details,'pedido_titular',auth.uid()) on conflict(cnpj_basico) do nothing;end if;return n;
end $$;
create function public.resolve_governance_request(p_id uuid,p_status text,p_resolution text)
returns void language plpgsql security definer set search_path=public as $$begin
 if not public.has_role(array['admin','gestor']::public.app_role[]) then raise exception 'Gestão necessária';end if;
 if coalesce(length(trim(p_resolution)),0)=0 then raise exception 'Resolução justificada necessária';end if;
 update public.governance_requests set status=p_status,resolution=p_resolution,updated_at=now() where id=p_id;
 if not found then raise exception 'Solicitação indisponível';end if;
end $$;
create function public.save_governance_policy(p_key text,p_description text)
returns void language plpgsql security definer set search_path=public as $$begin
 if not public.has_role(array['admin']::public.app_role[]) then raise exception 'Apenas administradores';end if;
 if coalesce(length(trim(p_description)),0)=0 then raise exception 'Descrição necessária';end if;
 update public.data_governance_policies set description=p_description,reviewed_by=auth.uid(),reviewed_at=now() where key=p_key;
 if not found then raise exception 'Política indisponível';end if;
end $$;
create function public.security_overview()
returns jsonb language plpgsql stable security invoker set search_path=public as $$
begin
 if not public.has_role(array['admin','gestor']::public.app_role[]) then raise exception 'Gestão necessária';end if;
 return jsonb_build_object('public_tables',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and relkind='r'),
 'tables_without_rls',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and relkind='r' and not relrowsecurity),
 'unvalidated_foreign_keys',(select count(*) from pg_constraint where contype='f' and not convalidated),
 'database_bytes',pg_database_size(current_database()),'suppressed_companies',(select count(*) from public.contact_suppressions),
 'open_requests',(select count(*) from public.governance_requests where status in ('aberta','em_analise')),
 'updated_at',now(),'limitations','Metadados de controle não comprovam segurança integral. Backup/restauração, testes de aplicação, revisão de permissões e análise jurídica devem ter evidências próprias.');
end $$;
do $$declare s text;begin foreach s in array array['company_opportunity_signals(uuid)','company_relationship_graph(uuid)','commercial_learning(date,date)','record_governance_request(text,text,text)','resolve_governance_request(uuid,text,text)','save_governance_policy(text,text)','security_overview()'] loop
 execute 'revoke all on function public.'||s||' from public,anon';execute 'grant execute on function public.'||s||' to authenticated';end loop;end $$;
