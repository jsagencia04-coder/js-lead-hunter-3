-- V4: Business Digital Twin e três scores independentes. Somente aditivo.
-- Não modifica score legado, CRM ou dados cadastrais. Nenhum acesso externo.
create table public.twin_score_versions (
  id bigint generated always as identity primary key,
  name text not null check (length(trim(name)) between 1 and 120),
  channel_weights jsonb not null,
  max_age_days integer not null check (max_age_days between 1 and 365),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create table public.company_twin_snapshots (
  id bigint generated always as identity primary key,
  lead_id uuid not null references public.leads(id) on delete restrict,
  version_id bigint not null references public.twin_score_versions(id),
  fingerprint text not null,
  payload jsonb not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique(lead_id, fingerprint)
);
create index company_twin_snapshots_history_idx on public.company_twin_snapshots(lead_id, created_at desc);
create table public.digital_channel_history (
  id bigint generated always as identity primary key,
  cnpj_basico text not null,
  platform text not null,
  previous jsonb,
  current_data jsonb not null,
  actor_id uuid references public.profiles(id),
  detected_at timestamptz not null default now()
);
create index digital_channel_history_company_idx on public.digital_channel_history(cnpj_basico, detected_at desc);

alter table public.twin_score_versions enable row level security;
alter table public.company_twin_snapshots enable row level security;
alter table public.digital_channel_history enable row level security;
revoke all on public.twin_score_versions, public.company_twin_snapshots, public.digital_channel_history from public, anon, authenticated;
revoke all on sequence public.twin_score_versions_id_seq, public.company_twin_snapshots_id_seq,
  public.digital_channel_history_id_seq from public, anon, authenticated;
grant select on public.twin_score_versions, public.company_twin_snapshots, public.digital_channel_history to authenticated;
create policy twin_versions_read on public.twin_score_versions for select to authenticated using(public.is_active_user());
create policy twin_snapshots_read on public.company_twin_snapshots for select to authenticated using(public.is_active_user());
create policy channel_history_read on public.digital_channel_history for select to authenticated using(public.is_active_user());

insert into public.twin_score_versions(name, channel_weights, max_age_days)
values ('DOS V4 — evidências de canais v1', '{"site":40,"instagram":15,"facebook":10,"google_business":15,"linkedin":10,"whatsapp":10}', 90);

-- Histórico somente quando há mudança semântica; heartbeat/reverificação igual não duplica.
create function public.track_digital_channel_history() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and (old.status, old.url, old.confidence, old.source, old.evidence, old.result, old.manual)
    is not distinct from (new.status, new.url, new.confidence, new.source, new.evidence, new.result, new.manual) then
    return new;
  end if;
  insert into public.digital_channel_history(cnpj_basico, platform, previous, current_data, actor_id)
    values(new.cnpj_basico, new.platform, case when tg_op='UPDATE' then to_jsonb(old) end, to_jsonb(new), auth.uid());
  return new;
end $$;
revoke all on function public.track_digital_channel_history() from public, anon, authenticated;
create trigger digital_channel_history_track after insert or update on public.digital_channels
for each row execute function public.track_digital_channel_history();

create function public.create_twin_score_version(p_name text, p_weights jsonb, p_max_age_days integer)
returns bigint language plpgsql security definer set search_path = public as $$
declare n bigint; total numeric;
begin
  if not public.has_role(array['admin']::public.app_role[]) then raise exception 'Apenas administradores'; end if;
  if jsonb_typeof(p_weights) is distinct from 'object' then raise exception 'Pesos devem ser objeto'; end if;
  if (select count(*) from jsonb_object_keys(p_weights)) <> 6
     or not p_weights ?& array['site','instagram','facebook','google_business','linkedin','whatsapp'] then
    raise exception 'Informe os seis canais conhecidos';
  end if;
  if exists(select 1 from jsonb_each(p_weights) where jsonb_typeof(value) <> 'number') then
    raise exception 'Pesos devem ser numéricos';
  end if;
  select sum(value::numeric) into total from jsonb_each_text(p_weights);
  if total <> 100 or exists(select 1 from jsonb_each_text(p_weights) where value::numeric < 0 or value::numeric > 100) then
    raise exception 'Pesos entre 0 e 100 devem somar 100';
  end if;
  insert into public.twin_score_versions(name, channel_weights, max_age_days, created_by)
    values(p_name, p_weights, p_max_age_days, auth.uid()) returning id into n;
  insert into public.audit_logs(actor_id, action, table_name, record_id, new_data)
    values(auth.uid(), 'INSERT', 'twin_score_versions', n::text,
      jsonb_build_object('name',p_name,'weights',p_weights,'max_age_days',p_max_age_days));
  return n;
end $$;
revoke all on function public.create_twin_score_version(text,jsonb,integer) from public, anon;
grant execute on function public.create_twin_score_version(text,jsonb,integer) to authenticated;

-- Cálculo ao consultar a ficha, sem gravar automaticamente. Recalcular/persistir é ação explícita.
create function public.company_digital_twin(p_lead_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  v public.twin_score_versions%rowtype;
  base record;
  channels jsonb;
  dimensions jsonb;
  recs jsonb;
  coverage numeric;
  opportunity numeric;
  score_confidence numeric;
  fit numeric;
  twin_payload jsonb;
begin
  if not public.is_active_user() then raise exception 'Usuário ativo necessário'; end if;
  select l.id, l.cnpj, l.cnpj_basico, l.stage, l.owner_id, c.razao_social, c.porte, c.natureza_juridica,
         e.nome_fantasia, e.cnae_principal, e.cnaes_secundarios, e.situacao_cadastral, e.data_inicio_atividade,
         e.logradouro, e.numero, e.bairro, e.cep, e.uf, e.municipio_code, e.source_competence,
         e.updated_at as registry_updated_at
    into base from public.leads l join public.companies c on c.cnpj_basico=l.cnpj_basico
    join public.establishments e on e.cnpj=l.cnpj where l.id=p_lead_id;
  if not found then raise exception 'Empresa indisponível'; end if;
  select * into v from public.twin_score_versions order by id desc limit 1;

  with facts as (
    select w.key as platform, w.value::numeric as weight, d.url, d.status, d.source, d.evidence,
           d.result, d.confidence, d.last_checked_at, d.next_check_at, d.manual,
           d.status in ('verificado','nao_localizado') and d.source is not null
             and jsonb_typeof(d.evidence)='array' and d.evidence <> '[]'::jsonb and d.last_checked_at is not null
             and d.last_checked_at >= now()-make_interval(days=>v.max_age_days)
             and d.last_checked_at <= now()
             and (d.status <> 'verificado' or d.url is not null) as usable
      from jsonb_each_text(v.channel_weights) w
      left join public.digital_channels d on d.cnpj_basico=base.cnpj_basico and d.platform=w.key
  ), scored as (
    select *, case when usable then case when status='nao_localizado' then 100::numeric
      when platform='site' then case
        when result->>'disponivel'='true' and jsonb_typeof(result->'nota')='number'
          then 100 - greatest(0,least(100,(result->>'nota')::numeric))
        else null end
      else 0 end else null end as gap from facts
  )
  select coalesce(jsonb_agg(jsonb_build_object('platform',platform,'weight',weight,'url',url,
    'status',coalesce(status,'pendente'),'source',source,'evidence',case when jsonb_typeof(evidence)='array' then evidence else '[]'::jsonb end,
    'confidence',coalesce(confidence,0),'checked_at',last_checked_at,'next_check_at',next_check_at,
    'manual',coalesce(manual,false),'usable',coalesce(usable,false),'opportunity',gap,
    'audit',case when platform='site' then result end) order by platform),'[]'::jsonb),
    coalesce(sum(weight) filter(where gap is not null),0),
    round(sum(gap*weight) filter(where gap is not null)/nullif(sum(weight) filter(where gap is not null),0)),
    round(coalesce(sum(confidence*weight) filter(where usable),0)/100)
    into channels, coverage, opportunity, score_confidence from scored;

  -- Fit apenas pelas regras CNAE existentes e serviços ativos (não confunde com intenção).
  select max(r.relevance) into fit from public.cnae_service_rules r
    join public.service_catalog s on s.id=r.service_id and s.active
   where r.active and (r.cnae_prefix='*' or base.cnae_principal like r.cnae_prefix || '%');
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into recs from (
    select s.id as service_id, s.name, r.relevance, r.reason
      from public.lead_recommendations r join public.service_catalog s on s.id=r.service_id
     where r.lead_id=p_lead_id and s.active order by r.relevance desc,s.id limit 5) x;

  -- Dimensões observáveis, sem converter ausência de pesquisa em nota zero.
  with observed_site as (
    select d.* from public.digital_channels d where d.cnpj_basico=base.cnpj_basico and d.platform='site'
      and d.status in ('verificado','nao_localizado')
      and d.last_checked_at between now()-make_interval(days=>v.max_age_days) and now()
      and jsonb_typeof(d.evidence)='array' and d.evidence <> '[]'::jsonb and d.source is not null
      and (d.status <> 'verificado' or d.url is not null)
  ), site as (
    select * from observed_site where status='verificado' and result->>'disponivel'='true'
  ), dim as (
    select 'identidade_digital' as id, 'Identidade digital' as label,
      (select confidence::numeric from public.digital_channels where cnpj_basico=base.cnpj_basico and platform='site'
        and status='verificado' and last_checked_at between now()-make_interval(days=>v.max_age_days) and now()
        and source is not null and jsonb_typeof(evidence)='array' and evidence <> '[]'::jsonb) as note,
      'Índice de correspondência da identidade; não é probabilidade estatística.' as method
    union all select 'presenca_online','Presença online',
      (select case when value->>'status'='verificado' then 100::numeric else 0 end
        from jsonb_array_elements(channels) where value->>'platform'='site' and (value->>'usable')::boolean),
      'Site verificado ou não localizado em pesquisa conclusiva recente.'
    union all select 'comunicacao','Comunicação',
      (select case when result->'checks' ? 'contato' then case when
        result #>> '{checks,contato,formulario}'='true' or result #>> '{checks,contato,whatsapp}'='true'
        or jsonb_array_length(coalesce(result #> '{checks,contato,telefones_texto}','[]'))>0
        or jsonb_array_length(coalesce(result #> '{checks,contato,emails_texto}','[]'))>0
        or jsonb_array_length(coalesce(result #> '{checks,contato,links_telefone}','[]'))>0
        or jsonb_array_length(coalesce(result #> '{checks,contato,links_email}','[]'))>0 then 100 else 0 end end from site),
      'Contatos encontrados na página analisada, não em toda a empresa.'
    union all select 'conversao','Conversão',
      (select case when result #> '{checks,contato}' ? 'formulario' then
        case when result #>> '{checks,contato,formulario}'='true' then 100 else 0 end end from site),
      'Presença de formulário na página; não mede taxa de conversão.'
    union all select 'experiencia_mobile','Experiência mobile',
      (select case when result->'checks' ? 'responsivo' then
        case when result #>> '{checks,responsivo}'='true' then 100 else 0 end end from site),
      'Proxy técnico por viewport; não equivale a teste visual/mobile de desempenho.'
    union all select 'visibilidade','Visibilidade em buscadores',
      (select case when result->'checks' ? 'seo' then
        (case when result #>> '{checks,seo,titulo}'='true' then 25 else 0 end
        +case when result #>> '{checks,seo,descricao}'='true' then 25 else 0 end
        +case when coalesce((result #>> '{checks,seo,h1}')::integer,0)>0 then 25 else 0 end
        +case when result #>> '{checks,seo,noindex}'='false' then 25 else 0 end)::numeric end from site),
      'Checklist de SEO básico; não mede posição ou tráfego em buscadores.'
    union all select 'recursos_comerciais','Recursos comerciais',null::numeric,'Catálogo/loja/agendamento ainda não aferidos.'
    union all select 'atualizacao','Atualização',null::numeric,'Ano do rodapé não comprova atualização do conteúdo.'
    union all select 'credibilidade','Credibilidade digital',
      (select case when result->'checks' ? 'https' then
        case when result #>> '{checks,https}'='true' then 100 else 0 end end from site),
      'Sinal técnico HTTPS; não representa reputação ou credibilidade comercial comprovada.'
    union all select 'diferenciacao','Diferenciação competitiva',null::numeric,'Requer benchmarking comparável ainda não calculado.'
  )
  select jsonb_agg(jsonb_build_object('id',id,'label',label,'score',note,'methodology',method,
    'status',case when note is null then 'nao_aferido' else 'observado' end,
    'source',(select source from observed_site),'checked_at',(select last_checked_at from observed_site),
    'confidence',(select confidence from observed_site),'evidence',(select evidence from observed_site),
    'url',(select url from observed_site)) order by id) into dimensions from dim;

  twin_payload := jsonb_build_object('company',to_jsonb(base),'version',jsonb_build_object('id',v.id,'name',v.name,
    'max_age_days',v.max_age_days,'weights',v.channel_weights,
    'fit_rules_fingerprint',(select md5(coalesce(string_agg(r.cnae_prefix||':'||r.service_id::text||':'||r.relevance::text,',' order by r.cnae_prefix,r.service_id),''))
      from public.cnae_service_rules r join public.service_catalog s on s.id=r.service_id and s.active
      where r.active and (r.cnae_prefix='*' or base.cnae_principal like r.cnae_prefix||'%'))), 'channels',channels,'dimensions',dimensions,
    'scores',jsonb_build_object('digital_opportunity',opportunity,'commercial_fit',fit,'data_confidence',score_confidence,
      'coverage_percent',coverage), 'recommendations',recs,
    'methodology',jsonb_build_object('digital_opportunity','Média ponderada somente de lacunas conclusivas recentes; cobertura informada separadamente. Site: 100 menos nota técnica quando auditado.',
      'commercial_fit','Maior relevância de regra CNAE de serviço ativo, incluindo regra genérica; não mede intenção de compra.',
      'data_confidence','Confiança ponderada dos seis canais com evidências conclusivas recentes; desconhecidos contribuem zero para cobertura, não para ausência digital.'),
    'blocked_for_contact',exists(select 1 from public.contact_suppressions where cnpj_basico=base.cnpj_basico),
    'calculated_at',now());
  return twin_payload;
end $$;
revoke all on function public.company_digital_twin(uuid) from public, anon;
grant execute on function public.company_digital_twin(uuid) to authenticated;

-- Captura explicita, versionada e idempotente. Clientes não podem forjar payload/histórico.
create function public.capture_company_twin(p_lead_id uuid)
returns bigint language plpgsql security definer set search_path = public as $$
declare data jsonb; fp text; n bigint;
begin
  if not public.has_role(array['admin','gestor','comercial']::public.app_role[]) then raise exception 'Sem permissão'; end if;
  data := public.company_digital_twin(p_lead_id);
  fp := md5((data-'calculated_at')::text);
  insert into public.company_twin_snapshots(lead_id,version_id,fingerprint,payload,created_by)
    values(p_lead_id,(data #>> '{version,id}')::bigint,fp,data,auth.uid())
    on conflict(lead_id,fingerprint) do nothing returning id into n;
  if n is null then select id into n from public.company_twin_snapshots where lead_id=p_lead_id and fingerprint=fp; end if;
  return n;
end $$;
revoke all on function public.capture_company_twin(uuid) from public, anon;
grant execute on function public.capture_company_twin(uuid) to authenticated;
