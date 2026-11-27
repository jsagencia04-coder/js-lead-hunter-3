-- Agentes são ferramentas internas autorizadas, não processos LLM simulados.
create table public.operational_agents(
 code text primary key,name text not null,objective text not null,
 requires_lead boolean not null default false,manager_only boolean not null default false,paused boolean not null default false
);
insert into public.operational_agents values
('company_scout','Company Scout','Consulta competência e estado da importação; importar continua sendo uma ação explícita na central.',false,true,false),
('digital_scout','Digital Scout','Solicita pesquisa real na fila de inteligência existente.',true,false,false),
('website_analyst','Website Analyst','Consolida última auditoria do site; não inventa auditoria quando não pesquisado.',true,false,false),
('opportunity_analyst','Opportunity Analyst','Calcula e registra retrato de evidências e scores do Twin.',true,false,false),
('market_radar','Market Radar','Consolida mudanças observadas na empresa.',true,false,false),
('competitive_analyst','Competitive Analyst','Consulta comparáveis de CNAE e município, sem presumir concorrência.',true,false,false),
('sales_advisor','Sales Advisor','Consulta diagnóstico comercial com recomendações existentes.',true,false,false),
('proposal_assistant','Proposal Assistant','Consulta sugestão comercial baseada no cadastro; não envia nem aprova proposta.',true,false,false),
('followup_assistant','Follow-up Assistant','Consolida tarefas e propostas do usuário solicitante.',false,false,false),
('executive_analyst','Executive Analyst','Consolida indicadores reais e denominadores já definidos.',false,true,false),
('data_quality_guardian','Data Quality Guardian','Verifica integridade referencial e duplicidade por identificador.',false,true,false),
('learning_analyst','Commercial Learning Analyst','Analisa desfechos por CNAE com amostra explícita, sem ajustar pesos.',false,true,false);
create table public.operational_agent_jobs(
 id uuid primary key default gen_random_uuid(),agent_code text not null references public.operational_agents(code),
 lead_id uuid references public.leads(id) on delete restrict,requested_by uuid not null references public.profiles(id),
 status text not null default 'pendente' check(status in ('pendente','executando','concluido','erro','cancelado')),
 attempts integer not null default 0,next_attempt_at timestamptz not null default now(),
 locked_at timestamptz,finished_at timestamptz,created_at timestamptz not null default now(),result jsonb,error_code text
);
create index agent_jobs_pending_idx on public.operational_agent_jobs(next_attempt_at,created_at) where status in ('pendente','erro');
create unique index agent_jobs_dedup_idx on public.operational_agent_jobs(agent_code,coalesce(lead_id,'00000000-0000-0000-0000-000000000000'::uuid),requested_by) where status in ('pendente','executando','erro') and attempts<6;
alter table public.operational_agents enable row level security;
alter table public.operational_agent_jobs enable row level security;
revoke all on public.operational_agents,public.operational_agent_jobs from public,anon,authenticated;
grant select on public.operational_agents,public.operational_agent_jobs to authenticated;
create policy operational_agents_read on public.operational_agents for select to authenticated using(public.is_active_user());
create policy operational_jobs_read on public.operational_agent_jobs for select to authenticated using(public.is_active_user() and (requested_by=auth.uid() or public.has_role(array['admin','gestor']::public.app_role[])));
create function public.request_operational_agent(p_code text,p_lead_id uuid default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare a public.operational_agents%rowtype;n uuid;
begin
 if not public.has_role(array['admin','gestor','comercial']::public.app_role[]) then raise exception 'Sem permissão'; end if;
 select * into a from public.operational_agents where code=p_code;
 if not found or a.paused then raise exception 'Agente indisponível/pausado'; end if;
 if a.manager_only and not public.has_role(array['admin','gestor']::public.app_role[]) then raise exception 'Gestão necessária'; end if;
 if a.requires_lead and not exists(select 1 from public.leads where id=p_lead_id) then raise exception 'Selecione empresa existente'; end if;
 if not a.requires_lead then p_lead_id:=null; end if;
 if exists(select 1 from public.leads l join public.contact_suppressions s on s.cnpj_basico=l.cnpj_basico where l.id=p_lead_id)
  and p_code='digital_scout' then raise exception 'Empresa bloqueada'; end if;
 perform pg_advisory_xact_lock(hashtext('agent:'||auth.uid()::text));
 select id into n from public.operational_agent_jobs where agent_code=p_code and lead_id is not distinct from p_lead_id
  and requested_by=auth.uid() and status in ('pendente','executando','erro') and attempts<6 limit 1;
 if n is not null then return n; end if;
 if (select count(*) from public.operational_agent_jobs where requested_by=auth.uid() and created_at>now()-interval '1 hour')>=50 then raise exception 'Limite de 50 solicitações por hora'; end if;
 insert into public.operational_agent_jobs(agent_code,lead_id,requested_by) values(p_code,p_lead_id,auth.uid()) returning id into n;
 return n;
end $$;
create function public.set_operational_agent_paused(p_code text,p_paused boolean)
returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.has_role(array['admin']::public.app_role[]) then raise exception 'Apenas administradores'; end if;
 update public.operational_agents set paused=p_paused where code=p_code;
 if not found then raise exception 'Agente desconhecido'; end if;
 insert into public.audit_logs(actor_id,action,table_name,record_id,new_data)
 values(auth.uid(),'UPDATE','operational_agents',p_code,jsonb_build_object('paused',p_paused));
end $$;
create function public.cancel_operational_agent_job(p_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.is_active_user() then raise exception 'Usuário ativo necessário'; end if;
 update public.operational_agent_jobs set status='cancelado',finished_at=now()
 where id=p_id and requested_by=auth.uid() and status in ('pendente','erro');
 if not found then raise exception 'Execução indisponível ou já em processamento'; end if;
end $$;
do $$ declare s text;begin
 foreach s in array array['request_operational_agent(text,uuid)','set_operational_agent_paused(text,boolean)','cancel_operational_agent_job(uuid)'] loop
 execute 'revoke all on function public.'||s||' from public,anon';execute 'grant execute on function public.'||s||' to authenticated';end loop;
end $$;

-- Worker executa uma ferramenta fixa por transação, com SKIP LOCKED, timeout e resultado persistente.
create function public.run_operational_agent_job()
returns jsonb language plpgsql security definer set search_path=public as $$
declare j public.operational_agent_jobs%rowtype;a public.operational_agents%rowtype;output jsonb;oldsub text;oldclaims text;
begin
 if not (auth.uid() is null and session_user in ('postgres','supabase_admin')) then raise exception 'Somente worker do servidor'; end if;
 select q.* into j from public.operational_agent_jobs q join public.operational_agents ag on ag.code=q.agent_code and not ag.paused
 where q.status in ('pendente','erro') and q.attempts<6 and q.next_attempt_at<=now()
 order by q.created_at for update of q skip locked limit 1;
 if not found then return jsonb_build_object('status','vazio'); end if;
 oldsub:=current_setting('request.jwt.claim.sub',true);oldclaims:=current_setting('request.jwt.claims',true);
 update public.operational_agent_jobs set status='executando',attempts=attempts+1,locked_at=now() where id=j.id;
 begin
  select * into a from public.operational_agents where code=j.agent_code;
  perform set_config('request.jwt.claim.sub',j.requested_by::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',j.requested_by,'role','authenticated')::text,true);
  if not public.has_role(array['admin','gestor','comercial']::public.app_role[]) then raise exception 'Solicitante sem acesso'; end if;
  if a.manager_only and not public.has_role(array['admin','gestor']::public.app_role[]) then raise exception 'Solicitante sem gestão'; end if;
  case j.agent_code
  when 'company_scout' then select jsonb_build_object('current_competence',(select max(competence) from public.import_jobs where is_current),
    'latest_jobs',coalesce((select jsonb_agg(to_jsonb(x)) from(select job_type,status,competence,created_at from public.import_jobs order by created_at desc limit 5)x),'[]')) into output;
  when 'digital_scout' then output:=jsonb_build_object('queued',public.request_enrichment(array[j.lead_id]),'note','Solicitação registrada; pesquisa depende das fontes configuradas.');
  when 'website_analyst' then select jsonb_build_object('status',coalesce(d.status,'pendente'),'source',d.source,'checked_at',d.last_checked_at,'audit',d.result,'evidence',d.evidence,
    'note','Última auditoria disponível, não uma nova medição.') into output from public.leads l left join public.digital_channels d on d.cnpj_basico=l.cnpj_basico and d.platform='site' where l.id=j.lead_id;
  when 'opportunity_analyst' then output:=jsonb_build_object('snapshot_id',public.capture_company_twin(j.lead_id));
  when 'market_radar' then select jsonb_build_object('events',coalesce(jsonb_agg(to_jsonb(x)),'[]')) into output from(select event_id,category,change_type,detected_at,description,source,evidence from public.business_radar_v where lead_id=j.lead_id order by detected_at desc limit 20)x;
  when 'competitive_analyst' then output:=public.company_comparables(j.lead_id);
  when 'sales_advisor' then output:=public.sales_assistant(j.lead_id);
  when 'proposal_assistant' then output:=jsonb_build_object('suggestion',public.sales_assistant(j.lead_id)->'sugestao_proposta','note','Sugestão para revisão humana; não cria, envia ou aprova proposta.');
  when 'followup_assistant' then output:=public.my_operation_summary();
  when 'executive_analyst' then output:=public.executive_metrics();
  when 'data_quality_guardian' then select jsonb_build_object('unvalidated_foreign_keys',(select count(*) from pg_constraint where contype='f' and not convalidated),
    'duplicate_company_keys',(select count(*) from(select cnpj_basico from public.companies group by 1 having count(*)>1)x),
    'duplicate_lead_identifiers',(select count(*) from(select cnpj from public.leads group by 1 having count(*)>1)x),'checked_at',now()) into output;
  when 'learning_analyst' then select jsonb_build_object('segments',coalesce(jsonb_agg(to_jsonb(x)),'[]'),
    'methodology','Desfechos registrados por CNAE principal. Conversão = ganhas/(ganhas+perdidas). Amostras pequenas não sustentam previsão; correlação não é causalidade. Nenhum peso é alterado.') into output
    from(select e.cnae_principal,count(*) as sample,count(*) filter(where o.status in ('ganha','pos_venda')) as won,
    count(*) filter(where o.status='perdida') as lost,round(100.0*count(*) filter(where o.status in ('ganha','pos_venda'))/nullif(count(*) filter(where o.status in ('ganha','pos_venda','perdida')),0),2) as conversion,
    avg(o.value) filter(where o.status in ('ganha','pos_venda')) as average_won_value
    from public.opportunities o join public.leads l on l.id=o.lead_id join public.establishments e on e.cnpj=l.cnpj
    group by e.cnae_principal order by count(*) desc limit 20)x;
  else raise exception 'Ferramenta desconhecida';
  end case;
  update public.operational_agent_jobs set status='concluido',result=output,error_code=null,finished_at=now(),locked_at=null where id=j.id;
 exception when others then
  update public.operational_agent_jobs set status='erro',error_code=SQLSTATE,locked_at=null,
    next_attempt_at=now()+make_interval(mins=>least(1440,(5*power(2,least(j.attempts,8)))::integer)) where id=j.id;
 end;
 perform set_config('request.jwt.claim.sub',coalesce(oldsub,''),true);perform set_config('request.jwt.claims',coalesce(oldclaims,''),true);
 return (select jsonb_build_object('status',status,'agent',agent_code,'job_id',id,'attempts',attempts) from public.operational_agent_jobs where id=j.id);
end $$;
revoke all on function public.run_operational_agent_job() from public,anon,authenticated;
