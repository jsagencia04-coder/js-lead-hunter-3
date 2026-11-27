-- Inteligência territorial explicita cobertura; copiloto usa intenções autorizadas, nunca SQL livre.
create function public.market_coverage(p_uf text default null)
returns jsonb language plpgsql stable security invoker set search_path=public as $$
declare output jsonb;
begin
 if not public.is_active_user() then raise exception 'Usuário ativo necessário'; end if;
 if p_uf is not null and p_uf !~ '^[A-Z]{2}$' then raise exception 'UF inválida'; end if;
 with base as (
  select e.uf,e.municipio_code,m.name as municipio,e.cnpj_basico,l.id as lead_id,
   exists(select 1 from public.lead_events ev where ev.lead_id=l.id and ev.event_type='contato') as contacted,
   exists(select 1 from public.contracts c where c.lead_id=l.id and c.status='ativo') as customer,
   d.status as site_status,
   d.status in ('verificado','nao_localizado') and d.last_checked_at between now()-interval '90 days' and now()
    and d.source is not null and jsonb_typeof(d.evidence)='array' and d.evidence<>'[]'::jsonb as researched
  from public.establishments e left join public.leads l on l.cnpj=e.cnpj
   left join public.municipalities m on m.code=e.municipio_code
   left join public.digital_channels d on d.cnpj_basico=e.cnpj_basico and d.platform='site'
  where p_uf is null or e.uf=p_uf
 ), grouped as (
  select uf,municipio_code,municipio,count(*) as establishments,count(distinct cnpj_basico) as companies,
   count(lead_id) as leads,count(*) filter(where researched) as researched,
   count(*) filter(where researched and site_status='nao_localizado') as confirmed_site_gaps,
   count(*) filter(where contacted) as contacted,count(*) filter(where customer) as customers,
   round(100.0*count(*) filter(where researched)/nullif(count(*),0),2) as research_coverage_percent
  from base group by uf,municipio_code,municipio
 ) select jsonb_build_object('regions',coalesce((select jsonb_agg(to_jsonb(x)) from(select * from grouped order by leads-contacted desc,companies desc,uf,municipio_code limit 100)x),'[]'),
  'totals',(select jsonb_build_object('establishments',count(*),'researched',count(*) filter(where researched),'confirmed_site_gaps',count(*) filter(where researched and site_status='nao_localizado')) from base),
  'methodology','Ranking por leads ainda sem contato registrado na cobertura atual da base. Não representa todo o mercado nacional. Lacuna de site exige pesquisa conclusiva com evidência recente (90 dias). Ausência de pesquisa não comprova ausência digital. Máximo 100 municípios.',
  'updated_at',now()) into output;
 return output;
end $$;
revoke all on function public.market_coverage(text) from public,anon;
grant execute on function public.market_coverage(text) to authenticated;

create function public.sales_copilot_query(p_intent text)
returns jsonb language plpgsql stable security invoker set search_path=public as $$
declare payload jsonb;
begin
 if not public.is_active_user() then raise exception 'Usuário ativo necessário'; end if;
 case p_intent
 when 'priorities' then
  select jsonb_build_object('records',coalesce(jsonb_agg(to_jsonb(x)),'[]'),
    'methodology','Até 20 empresas atribuídas a você, sem oposição ao contato, ordenadas pelo score comercial atual. Pontuação não comprova intenção de compra.') into payload
  from(select l.id as lead_id,l.cnpj,coalesce(e.nome_fantasia,c.razao_social) as empresa,l.score,l.priority,l.score_reasons
   from public.leads l join public.establishments e on e.cnpj=l.cnpj join public.companies c on c.cnpj_basico=l.cnpj_basico
   where l.owner_id=auth.uid() and l.stage not in ('perdido','convertido')
    and not exists(select 1 from public.contact_suppressions s where s.cnpj_basico=l.cnpj_basico)
   order by l.score desc,l.id limit 20)x;
 when 'followups' then payload:=public.my_operation_summary();
 when 'site_gaps' then
  select jsonb_build_object('records',coalesce(jsonb_agg(to_jsonb(x)),'[]'),'methodology','Site não localizado em pesquisa conclusiva recente com fonte e evidência. Não significa inexistência absoluta de site. Até 20 registros visíveis, sem oposição ao contato.') into payload
  from(select l.id as lead_id,l.cnpj,coalesce(e.nome_fantasia,c.razao_social) as empresa,d.source,d.evidence,d.confidence,d.last_checked_at
   from public.digital_channels d join public.leads l on l.cnpj_basico=d.cnpj_basico join public.establishments e on e.cnpj=l.cnpj join public.companies c on c.cnpj_basico=l.cnpj_basico
   where d.platform='site' and d.status='nao_localizado' and d.last_checked_at between now()-interval '90 days' and now()
    and d.source is not null and jsonb_typeof(d.evidence)='array' and d.evidence<>'[]'::jsonb
    and not exists(select 1 from public.contact_suppressions s where s.cnpj_basico=l.cnpj_basico)
   order by d.last_checked_at desc,l.id limit 20)x;
 when 'changes' then select jsonb_build_object('records',coalesce(jsonb_agg(to_jsonb(x)),'[]'),'methodology','Até 20 mudanças observadas nos históricos. Não afirma expansão ou compra sem evidência.') into payload
  from(select event_id,lead_id,empresa,description,source,evidence,detected_at from public.business_radar_v order by detected_at desc,event_id limit 20)x;
 when 'proposals' then
  select jsonb_build_object('records',coalesce(jsonb_agg(to_jsonb(x)),'[]'),'methodology','Propostas em aberto da sua carteira. Até 20, pela validade; não significa receita contratada/recebida.') into payload
  from(select p.id as proposal_id,p.lead_id,p.title,p.status,p.amount,p.valid_until,coalesce(e.nome_fantasia,c.razao_social) as empresa
   from public.lead_proposals p join public.leads l on l.id=p.lead_id
   join public.establishments e on e.cnpj=l.cnpj join public.companies c on c.cnpj_basico=l.cnpj_basico
   left join public.opportunities o on o.id=p.opportunity_id
   where coalesce(o.owner_id,l.owner_id)=auth.uid() and p.status in ('enviada','em_negociacao')
   order by p.valid_until nulls last,p.id limit 20)x;
 when 'unassigned' then
  if not public.has_role(array['admin','gestor']::public.app_role[]) then raise exception 'Gestão necessária'; end if;
  select jsonb_build_object('records',coalesce(jsonb_agg(to_jsonb(x)),'[]'),'methodology','Oportunidades abertas sem responsável. Até 20 registros para distribuição manual.') into payload
  from(select id as opportunity_id,lead_id,title,stage_code,value from public.opportunities where owner_id is null and status='aberta' order by created_at limit 20)x;
 else raise exception 'Intenção não autorizada';
 end case;
 return jsonb_build_object('intent',p_intent,'data',payload,'updated_at',now(),'mode','deterministico','note','Consulta guiada por ferramentas internas; não utiliza LLM externo, não executa SQL livre e não altera registros.');
end $$;
revoke all on function public.sales_copilot_query(text) from public,anon;
grant execute on function public.sales_copilot_query(text) to authenticated;
