-- Dashboard filtrável, custos reais observados e disponibilidade de integrações.
create function public.executive_overview_v4(p_from date,p_to date,p_owner uuid default null,p_uf text default null,p_cnae text default null)
returns jsonb language plpgsql stable security invoker set search_path=public as $$
declare output jsonb;
begin
 if not public.is_active_user() then raise exception 'Usuário ativo necessário';end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>3660 then raise exception 'Período inválido';end if;
 if p_uf is not null and p_uf !~ '^[A-Z]{2}$' then raise exception 'UF inválida';end if;
 if p_cnae is not null and p_cnae !~ '^[0-9]{2,7}$' then raise exception 'CNAE inválido';end if;
 with base as(select o.*,e.uf,e.cnae_principal,ps.probability from public.opportunities o
 join public.leads l on l.id=o.lead_id join public.establishments e on e.cnpj=l.cnpj join public.pipeline_stages ps on ps.code=o.stage_code
 where o.created_at::date between p_from and p_to and (p_owner is null or o.owner_id=p_owner)
 and(p_uf is null or e.uf=p_uf) and(p_cnae is null or e.cnae_principal like p_cnae||'%')),
 receipts as(select r.* from public.contract_receipts r join public.contracts ct on ct.id=r.contract_id
 join public.leads l on l.id=ct.lead_id join public.establishments e on e.cnpj=l.cnpj
 left join public.opportunities o on o.id=ct.opportunity_id
 where r.voided_at is null and r.received_on between p_from and p_to and(p_owner is null or coalesce(o.owner_id,l.owner_id)=p_owner)
 and(p_uf is null or e.uf=p_uf) and(p_cnae is null or e.cnae_principal like p_cnae||'%')),
 contracted as(select ct.* from public.contracts ct join public.leads l on l.id=ct.lead_id join public.establishments e on e.cnpj=l.cnpj
 left join public.opportunities o on o.id=ct.opportunity_id where ct.status='ativo' and ct.signed_at between p_from and p_to
 and(p_owner is null or coalesce(o.owner_id,l.owner_id)=p_owner) and(p_uf is null or e.uf=p_uf) and(p_cnae is null or e.cnae_principal like p_cnae||'%'))
 select jsonb_build_object('metrics',jsonb_build_object('opportunities',(select count(*) from base),
 'open_value',(select coalesce(sum(value),0) from base where status='aberta'),
 'weighted_forecast',(select coalesce(sum(value*coalesce(probability_override,probability)/100),0) from base where status='aberta'),
 'won',(select count(*) from base where status in ('ganha','pos_venda')),'lost',(select count(*) from base where status='perdida'),
 'conversion',(select round(100.0*count(*) filter(where status in ('ganha','pos_venda'))/nullif(count(*) filter(where status in ('ganha','pos_venda','perdida')),0),2) from base),
 'contracted',(select coalesce(sum(total_value),0) from contracted),'received',(select coalesce(sum(amount),0) from receipts),
 'average_ticket',(select round(avg(total_value),2) from contracted)),
 'pipeline',coalesce((select jsonb_agg(to_jsonb(x)) from(select ps.label,ps.sort_order,count(*) as total,sum(b.value) as value from base b join public.pipeline_stages ps on ps.code=b.stage_code group by ps.label,ps.sort_order order by ps.sort_order)x),'[]'),
 'monthly',coalesce((select jsonb_agg(to_jsonb(x)) from(select to_char(date_trunc('month',created_at),'YYYY-MM') as month,count(*) as total,count(*) filter(where status in ('ganha','pos_venda')) as won from base group by 1 order by 1)x),'[]'),
 'methodology','Oportunidades por data de criação, com filtros indicados. Conversão: ganhas/(ganhas+perdidas), exclui abertas. Contratado por assinatura de contrato ativo; recebido por lançamento não estornado. Previsão ponderada usa probabilidade configurada e não é receita garantida. Ticket = média dos contratos no período. Ausência de amostra retorna taxa não calculável.',
 'updated_at',now()) into output;return output;
end $$;
create function public.operational_costs_v4()
returns jsonb language plpgsql stable security invoker set search_path=public as $$
begin
 if not public.has_role(array['admin','gestor']::public.app_role[]) then raise exception 'Gestão necessária';end if;
 return jsonb_build_object('providers',coalesce((select jsonb_agg(to_jsonb(x)) from(select provider,sum(calls) as calls,sum(cost_usd) as estimated_usd,sum(errors) as errors from public.provider_usage where day>=date_trunc('month',current_date) group by provider)x),'[]'),
 'research_runs',(select count(*) from public.enrichment_runs where started_at>=date_trunc('month',current_date)),
 'companies_processed',(select coalesce(sum(processed),0) from public.enrichment_runs where started_at>=date_trunc('month',current_date)),
 'agent_jobs',(select count(*) from public.operational_agent_jobs where created_at>=date_trunc('month',current_date)),
 'database_bytes',pg_database_size(current_database()),
 'integrations',coalesce((select jsonb_agg(jsonb_build_object('key',key,'label',label,'status',status,'last_seen_at',last_seen_at)) from public.integration_status),'[]'),
 'methodology','Custos de API são estimativas cadastradas por chamada, não fatura do provedor. Hospedagem/CPU/IA não medidos não recebem custo inventado. Os limites de pesquisa ficam na Inteligência Digital. Configurado não significa conexão testada. Nenhuma contratação automática.');
end $$;
revoke all on function public.executive_overview_v4(date,date,uuid,text,text) from public,anon;
revoke all on function public.operational_costs_v4() from public,anon;
grant execute on function public.executive_overview_v4(date,date,uuid,text,text) to authenticated;
grant execute on function public.operational_costs_v4() to authenticated;
