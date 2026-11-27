// Blocos de CRM da ficha do lead: oportunidades, tarefas, contratos, canais digitais, tags e assistente.
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { CheckCircle2, ExternalLink, Plus, RotateCcw, Search, ShieldCheck, Tag as TagIcon, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { brl, formatDate, formatDateTime } from '@/lib/utils'
import {
  CHANNEL_STATUS, CONTRACT_STATUS, PLATFORM, RECURRENCE, TASK_KIND,
  type Contract, type DigitalChannel, type LossReason, type PipelineStage, type Task,
} from '@/lib/crm'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Alert } from '@/components/ui/alert'

interface Opp {
  id: string; title: string; stage_code: string; status: string; value: number | null; recurring_value: number | null
  owner_id: string | null; expected_close: string | null; lost_reason: string | null; lost_reason_id: string | null
  won_at: string | null; created_at: string; source: string; pipeline_id:string;team_id:string|null;probability_override:number|null;priority_level:string
}

function useErr() {
  const [error, setError] = useState<string | null>(null)
  return { error, setError, view: error ? <Alert tone="error" className="mb-2">{error}</Alert> : null }
}

// ------------------------------------------------------------------ oportunidades
export function OpportunitiesSection({ leadId, canEdit, suppressed, userId, owners, onChanged, onOpenOpp }: {
  leadId: string; canEdit: boolean; suppressed: boolean; userId: string
  owners: { id: string; full_name: string | null; email: string }[]
  onChanged: () => void; onOpenOpp?: (id: string | null) => void
}) {
  const [opps, setOpps] = useState<Opp[]>([])
  const [stages, setStages] = useState<PipelineStage[]>([])
  const [reasons, setReasons] = useState<LossReason[]>([])
  const [pipelines,setPipelines]=useState<{id:string;name:string}[]>([])
  const [pipelineMembers,setPipelineMembers]=useState<{pipeline_id:string;stage_code:string}[]>([])
  const [teams,setTeams]=useState<{id:string;name:string}[]>([])
  const [newPipeline,setNewPipeline]=useState('00000000-0000-4000-8000-000000000001')
  const [title, setTitle] = useState('')
  const [value, setValue] = useState('')
  const [losing, setLosing] = useState<{ id: string; reason_id: string; text: string } | null>(null)
  const e = useErr()

  const load = useCallback(async () => {
    const [o, s, r] = await Promise.all([
      supabase.from('opportunities').select('*').eq('lead_id', leadId).order('created_at', { ascending: false }),
      supabase.from('pipeline_stages').select('*').eq('active', true).order('sort_order'),
      supabase.from('loss_reasons').select('*').eq('active', true).order('sort_order'),
    ])
    if (o.error) e.setError(o.error.message)
    setOpps((o.data as Opp[]) ?? [])
    setStages((s.data as PipelineStage[]) ?? [])
    setReasons((r.data as LossReason[]) ?? [])
    onOpenOpp?.(((o.data as Opp[]) ?? []).find((x) => x.status === 'aberta')?.id ?? null)
  }, [leadId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [load])
  useEffect(()=>{
    supabase.from('sales_pipelines').select('id,name').eq('active',true).order('name').then(({data})=>setPipelines(data??[]))
    supabase.from('pipeline_stage_members').select('pipeline_id,stage_code').then(({data})=>setPipelineMembers(data??[]))
    supabase.from('sales_teams').select('id,name').eq('active',true).order('name').then(({data})=>setTeams(data??[]))
  },[])

  const done = async (p: PromiseLike<{ error: { message: string } | null }>) => {
    e.setError(null)
    const { error } = await p
    if (error) { e.setError(error.message); return false }
    await load(); onChanged(); return true
  }
  const parseMoney = (v: string) => (v.trim() ? Number(v.replace(/\./g, '').replace(',', '.')) : null)

  async function create(ev: FormEvent) {
    ev.preventDefault()
    if (!title.trim()) return
    if (await done(supabase.from('opportunities').insert({ lead_id: leadId, title: title.trim(), pipeline_id:newPipeline,
      stage_code:stages.find(s=>s.kind==='aberta'&&pipelineMembers.some(m=>m.pipeline_id===newPipeline&&m.stage_code===s.code))?.code??'novo_lead',value: parseMoney(value), created_by: userId }))) {
      setTitle(''); setValue('')
    }
  }
  function move(o: Opp, code: string) {
    const st = stages.find((s) => s.code === code)
    if (st?.kind === 'perdida') { setLosing({ id: o.id, reason_id: reasons[0]?.id ?? '', text: '' }); return }
    done(supabase.from('opportunities').update({ stage_code: code }).eq('id', o.id))
  }

  return (
    <div className="space-y-2 text-sm">
      {e.view}
      {opps.length === 0 && <p className="text-muted-foreground">Nenhuma oportunidade. A empresa ainda não está no funil.</p>}
      {opps.map((o) => (
        <div key={o.id} className="rounded-md border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="font-medium">{o.title}</p>
              <p className="text-xs text-muted-foreground">
                {o.value != null ? brl.format(o.value) : 'sem valor'}{o.recurring_value ? ` + ${brl.format(o.recurring_value)}/mês` : ''}
                {' · '}{owners.find((x) => x.id === o.owner_id)?.full_name ?? 'sem responsável'} · criada {formatDate(o.created_at)}
                {o.source === 'reativacao' && ' · reativada'}{o.lost_reason && ` · perda: ${o.lost_reason}`}
              </p>
            </div>
            {canEdit && o.status === 'aberta' ? (
              <Select value={o.stage_code} onChange={(ev) => move(o, ev.target.value)} className="w-48" aria-label="Etapa">
                {stages.filter(s=>pipelineMembers.some(m=>m.pipeline_id===o.pipeline_id&&m.stage_code===s.code)).map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
              </Select>
            ) : (
              <div className="flex items-center gap-2">
                <Badge variant={o.status === 'perdida' ? 'danger' : 'success'}>{stages.find((s) => s.code === o.stage_code)?.label ?? o.stage_code}</Badge>
                {canEdit && o.status === 'ganha' && (
                  <Button size="sm" variant="outline" onClick={() => done(supabase.from('opportunities').update({ stage_code: 'pos_venda' }).eq('id', o.id))}>Pós-venda</Button>
                )}
                {canEdit && o.status !== 'aberta' && !suppressed && (
                  <Button size="sm" variant="outline" onClick={() => done(supabase.rpc('reopen_opportunity', { p_id: o.id, p_stage: 'em_qualificacao' }))}>
                    <RotateCcw className="h-3.5 w-3.5" /> Reativar
                  </Button>
                )}
              </div>
            )}
          </div>
          {canEdit && o.status === 'aberta' && (
            <div className="mt-2 grid gap-2 md:grid-cols-3">
              <Select value={o.owner_id ?? ''} onChange={(ev) => done(supabase.from('opportunities').update({ owner_id: ev.target.value || null }).eq('id', o.id))} aria-label="Responsável">
                <option value="">Sem responsável</option>
                {owners.map((x) => <option key={x.id} value={x.id}>{x.full_name ?? x.email}</option>)}
              </Select>
              <Input defaultValue={o.value ?? ''} placeholder="Valor (R$)" inputMode="decimal"
                onBlur={(ev) => { const v = parseMoney(ev.target.value); if (v !== o.value) done(supabase.from('opportunities').update({ value: v }).eq('id', o.id)) }} />
              <Input type="date" defaultValue={o.expected_close ?? ''} aria-label="Previsão de fechamento"
                onBlur={(ev) => { if ((ev.target.value || null) !== o.expected_close) done(supabase.from('opportunities').update({ expected_close: ev.target.value || null }).eq('id', o.id)) }} />
            </div>
          )}
          {canEdit&&o.status==='aberta'&&<div className="mt-2 grid gap-2 md:grid-cols-3"><Select aria-label="Equipe da oportunidade" value={o.team_id??''} onChange={e=>done(supabase.from('opportunities').update({team_id:e.target.value||null}).eq('id',o.id))}><option value="">Sem equipe</option>{teams.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</Select><Select aria-label="Prioridade da oportunidade" value={o.priority_level} onChange={e=>done(supabase.from('opportunities').update({priority_level:e.target.value}).eq('id',o.id))}>{['baixa','normal','alta','urgente'].map(x=><option key={x}>{x}</option>)}</Select><label className="text-xs">Probabilidade configurada (não comprovada)<Input type="number" min={0} max={100} defaultValue={o.probability_override??''} placeholder="Usar etapa" onBlur={e=>{const p=e.target.value===''?null:Number(e.target.value);if(p!==o.probability_override)done(supabase.from('opportunities').update({probability_override:p}).eq('id',o.id))}}/></label></div>}
          {losing?.id === o.id && (
            <div className="mt-2 grid gap-2 rounded-md bg-red-50 p-2 md:grid-cols-[1fr_1fr_auto_auto]">
              <Select value={losing.reason_id} onChange={(ev) => setLosing({ ...losing, reason_id: ev.target.value })} aria-label="Motivo da perda">
                {reasons.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </Select>
              <Input value={losing.text} onChange={(ev) => setLosing({ ...losing, text: ev.target.value })} placeholder="Detalhe (opcional)" />
              <Button size="sm" variant="destructive" onClick={async () => {
                if (await done(supabase.from('opportunities').update({
                  stage_code: 'perdido', lost_reason_id: losing.reason_id || null,
                  lost_reason: losing.text.trim() || reasons.find((r) => r.id === losing.reason_id)?.label || null,
                }).eq('id', o.id))) setLosing(null)
              }}>Marcar como perdida</Button>
              <Button size="sm" variant="ghost" onClick={() => setLosing(null)}><X className="h-4 w-4" /></Button>
            </div>
          )}
        </div>
      ))}
      {canEdit && !suppressed && (
        <form onSubmit={create} className="flex flex-col gap-2 border-t pt-2 md:flex-row">
          <Select aria-label="Funil da nova oportunidade" value={newPipeline} onChange={e=>setNewPipeline(e.target.value)}>{pipelines.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</Select>
          <Input value={title} onChange={(ev) => setTitle(ev.target.value)} placeholder="Nova oportunidade (ex.: Site institucional)" />
          <Input value={value} onChange={(ev) => setValue(ev.target.value)} placeholder="Valor (R$)" className="md:w-36" inputMode="decimal" />
          <Button type="submit" disabled={!title.trim()}><Plus className="h-4 w-4" /> Adicionar ao funil</Button>
        </form>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ tarefas
export function TasksSection({ leadId, opportunityId, canEdit, suppressed, userId, owners, onChanged }: {
  leadId: string; opportunityId: string | null; canEdit: boolean; suppressed: boolean; userId: string
  owners: { id: string; full_name: string | null; email: string }[]; onChanged: () => void
}) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [kind, setKind] = useState('follow_up')
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const [owner, setOwner] = useState(userId)
  const [outcome, setOutcome] = useState<Record<string, string>>({})
  const e = useErr()

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('crm_tasks').select('*').eq('lead_id', leadId)
      .order('done_at', { ascending: true, nullsFirst: true }).order('due_at', { ascending: true }).limit(50)
    if (error) e.setError(error.message)
    setTasks((data as Task[]) ?? [])
  }, [leadId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [load])

  async function create(ev: FormEvent) {
    ev.preventDefault()
    const t = title.trim() || TASK_KIND[kind]
    const { error } = await supabase.from('crm_tasks').insert({
      lead_id: leadId, opportunity_id: opportunityId, kind, title: t, due_at: due ? new Date(due).toISOString() : null,
      remind_at: due ? new Date(new Date(due).getTime() - 30 * 60000).toISOString() : null, owner_id: owner || null, created_by: userId,
    })
    if (error) return e.setError(error.message)
    setTitle(''); setDue(''); await load(); onChanged()
  }
  async function complete(t: Task) {
    const { error } = await supabase.from('crm_tasks').update({ done_at: new Date().toISOString(), outcome: outcome[t.id]?.trim() || null }).eq('id', t.id)
    if (error) return e.setError(error.message)
    await load(); onChanged()
  }
  const now = Date.now()

  return (
    <div className="space-y-2 text-sm">
      {e.view}
      {tasks.length === 0 && <p className="text-muted-foreground">Nenhuma tarefa.</p>}
      {tasks.map((t) => {
        const late = !t.done_at && t.due_at && new Date(t.due_at).getTime() < now
        return (
          <div key={t.id} className={`rounded-md border p-2 ${late ? 'border-red-300 bg-red-50' : ''} ${t.done_at ? 'opacity-60' : ''}`}>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{TASK_KIND[t.kind] ?? t.kind}</Badge>
              <span className="font-medium">{t.title}</span>
              <span className={`text-xs ${late ? 'text-red-700' : 'text-muted-foreground'}`}>
                {t.due_at ? (late ? 'Atrasada · ' : '') + formatDateTime(t.due_at) : 'sem data'}
              </span>
              {t.done_at && <span className="text-xs text-muted-foreground">concluída {formatDateTime(t.done_at)}{t.outcome ? ` — ${t.outcome}` : ''}</span>}
            </div>
            {canEdit && !t.done_at && (
              <div className="mt-2 flex gap-2">
                <Input value={outcome[t.id] ?? ''} onChange={(ev) => setOutcome({ ...outcome, [t.id]: ev.target.value })} placeholder="Resultado (opcional)" />
                <Button size="sm" variant="outline" onClick={() => complete(t)}><CheckCircle2 className="h-4 w-4" /> Concluir</Button>
              </div>
            )}
          </div>
        )
      })}
      {canEdit && !suppressed && (
        <form onSubmit={create} className="grid gap-2 border-t pt-2 md:grid-cols-[8rem_1fr_12rem]">
          <Select value={kind} onChange={(ev) => setKind(ev.target.value)} aria-label="Tipo">
            {Object.entries(TASK_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Input value={title} onChange={(ev) => setTitle(ev.target.value)} placeholder="Descrição (ex.: Ligar para apresentar portfólio)" />
          <Input type="datetime-local" value={due} onChange={(ev) => setDue(ev.target.value)} aria-label="Quando" />
          <Select value={owner} onChange={(ev) => setOwner(ev.target.value)} className="md:col-span-2" aria-label="Responsável">
            {owners.map((o) => <option key={o.id} value={o.id}>{o.full_name ?? o.email}</option>)}
          </Select>
          <Button type="submit"><Plus className="h-4 w-4" /> Agendar</Button>
        </form>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ contratos
export function ContractsSection({ leadId, opportunityId, canEdit, userId, onChanged }: {
  leadId: string; opportunityId: string | null; canEdit: boolean; userId: string; onChanged: () => void
}) {
  const [items, setItems] = useState<Contract[]>([])
  const [f, setF] = useState({ title: '', total: '', recurring: '', recurrence: 'unico', terms: '', signed: '', start: '' })
  const [show, setShow] = useState(false)
  const e = useErr()
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('contracts').select('*').eq('lead_id', leadId).order('created_at', { ascending: false })
    if (error) e.setError(error.message)
    setItems((data as Contract[]) ?? [])
  }, [leadId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [load])
  const money = (v: string) => (v.trim() ? Number(v.replace(/\./g, '').replace(',', '.')) : null)

  async function save(ev: FormEvent) {
    ev.preventDefault()
    const { error } = await supabase.from('contracts').insert({
      lead_id: leadId, opportunity_id: opportunityId, title: f.title.trim(), total_value: money(f.total), recurring_value: money(f.recurring),
      recurrence: f.recurrence, payment_terms: f.terms.trim() || null, signed_at: f.signed || null, start_date: f.start || null, created_by: userId,
    })
    if (error) return e.setError(error.message)
    setShow(false); setF({ title: '', total: '', recurring: '', recurrence: 'unico', terms: '', signed: '', start: '' })
    await load(); onChanged()
  }
  return (
    <div className="space-y-2 text-sm">
      {e.view}
      {items.length === 0 && <p className="text-muted-foreground">Nenhum contrato.</p>}
      {items.map((c) => (
        <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2">
          <div>
            <p className="font-medium">{c.title}</p>
            <p className="text-xs text-muted-foreground">
              {c.total_value != null ? brl.format(c.total_value) : 'sem valor'}
              {c.recurring_value ? ` + ${brl.format(c.recurring_value)} (${RECURRENCE[c.recurrence]?.toLowerCase()})` : ''}
              {c.signed_at && ` · assinado ${formatDate(c.signed_at)}`}{c.payment_terms && ` · ${c.payment_terms}`}
            </p>
          </div>
          {canEdit ? (
            <Select value={c.status} className="w-36" onChange={async (ev) => {
              const { error } = await supabase.from('contracts').update({ status: ev.target.value }).eq('id', c.id)
              if (error) e.setError(error.message); else { load(); onChanged() }
            }} aria-label="Situação do contrato">
              {Object.entries(CONTRACT_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          ) : <Badge>{CONTRACT_STATUS[c.status]}</Badge>}
        </div>
      ))}
      {canEdit && (show ? (
        <form onSubmit={save} className="grid gap-2 border-t pt-2 md:grid-cols-2">
          <Input required value={f.title} onChange={(ev) => setF({ ...f, title: ev.target.value })} placeholder="Título do contrato" className="md:col-span-2" />
          <Input value={f.total} onChange={(ev) => setF({ ...f, total: ev.target.value })} placeholder="Valor total (R$)" inputMode="decimal" />
          <div className="flex gap-2">
            <Input value={f.recurring} onChange={(ev) => setF({ ...f, recurring: ev.target.value })} placeholder="Valor recorrente" inputMode="decimal" />
            <Select value={f.recurrence} onChange={(ev) => setF({ ...f, recurrence: ev.target.value })} aria-label="Recorrência">
              {Object.entries(RECURRENCE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </div>
          <Input value={f.terms} onChange={(ev) => setF({ ...f, terms: ev.target.value })} placeholder="Condições de pagamento" />
          <div className="flex gap-2">
            <div className="flex-1"><Label>Assinatura</Label><Input type="date" value={f.signed} onChange={(ev) => setF({ ...f, signed: ev.target.value })} /></div>
            <div className="flex-1"><Label>Início</Label><Input type="date" value={f.start} onChange={(ev) => setF({ ...f, start: ev.target.value })} /></div>
          </div>
          <div className="flex gap-2 md:col-span-2">
            <Button type="submit">Registrar contrato</Button>
            <Button type="button" variant="ghost" onClick={() => setShow(false)}>Cancelar</Button>
          </div>
          <p className="text-xs text-muted-foreground md:col-span-2">Registrar o contrato fecha a oportunidade aberta e transforma a empresa em cliente.</p>
        </form>
      ) : <Button size="sm" variant="outline" onClick={() => setShow(true)}><Plus className="h-4 w-4" /> Novo contrato</Button>)}
    </div>
  )
}

// ------------------------------------------------------------------ canais digitais
export function ChannelsSection({ leadId, canEdit, canReset }: { leadId: string; canEdit: boolean; canReset: boolean }) {
  const [rows, setRows] = useState<DigitalChannel[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [edit, setEdit] = useState<{ platform: string; url: string } | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const e = useErr()
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('digital_channels').select('*').eq('lead_id', leadId)
    if (error) e.setError(error.message)
    setRows((data as DigitalChannel[]) ?? [])
  }, [leadId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [load])

  async function confirm(platform: string, url: string | null, status: 'verificado' | 'nao_localizado') {
    e.setError(null)
    const { error } = await supabase.rpc('confirm_digital_channel', { p_lead_id: leadId, p_platform: platform, p_url: url, p_status: status })
    if (error) return e.setError(error.message)
    setEdit(null); load()
  }
  async function requeue() {
    const { error } = await supabase.rpc('request_enrichment', { p_lead_ids: [leadId] })
    setMsg(error ? error.message : 'Nova pesquisa solicitada: o motor de inteligência digital processa na próxima rodada.')
  }

  const byPlatform = Object.fromEntries(rows.map((r) => [r.platform, r]))
  return (
    <div className="space-y-2 text-sm">
      {e.view}
      <div className="divide-y rounded-md border">
        {Object.entries(PLATFORM).map(([p, label]) => {
          const r = byPlatform[p]
          const st = CHANNEL_STATUS[r?.status ?? 'pendente']
          return (
            <div key={p} className="p-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-32 font-medium">{label}</span>
                <Badge variant={st.variant}>{st.label}</Badge>
                {r && r.status !== 'pendente' && <span className="text-xs text-muted-foreground">confiança {r.confidence}%</span>}
                {r?.manual && <Badge variant="outline"><ShieldCheck className="mr-1 h-3 w-3" />confirmado manualmente</Badge>}
                {r?.url && <a href={r.url} target="_blank" rel="noreferrer noopener" className="inline-flex max-w-[16rem] items-center gap-1 truncate text-xs text-primary underline">{r.url}<ExternalLink className="h-3 w-3" /></a>}
                <button className="ml-auto text-xs text-muted-foreground underline" onClick={() => setOpen(open === p ? null : p)}>evidências</button>
              </div>
              {open === p && (
                <div className="mt-2 space-y-1 rounded bg-muted/50 p-2 text-xs">
                  {r ? (
                    <>
                      {r.evidence?.map((ev, i) => <p key={i}>• {ev.detalhe} {ev.peso ? <span className="text-muted-foreground">({ev.peso > 0 ? '+' : ''}{ev.peso})</span> : null}</p>)}
                      {r.result?.problemas && r.result.problemas.length > 0 && (
                        <div className="pt-1">
                          <p className="font-medium">Auditoria do site (nota {r.result.nota ?? '—'}/100):</p>
                          {r.result.problemas.map((pb, i) => <p key={i}>• [{pb.gravidade}] {pb.evidencia}</p>)}
                        </div>
                      )}
                      {r.result?.checks&&<details className="mt-2"><summary className="cursor-pointer">Verificações técnicas registradas</summary><pre className="whitespace-pre-wrap break-all">{JSON.stringify(r.result.checks,null,2)}</pre></details>}
                      {r.result&&p==='site'&&<Button size="sm" variant="outline" onClick={async()=>{const {createTextPdf}=await import('@/lib/pdf');createTextPdf('Auditoria técnica observada',[{heading:'Origem',text:`${r.url??'URL não registrada'} · fonte ${r.source??'não informada'} · ${formatDateTime(r.last_checked_at)}`},{heading:'Resultado',text:`Estado ${r.status} · nota ${r.result.nota??'não aferida'}/100. Verificações passivas, não teste invasivo.`},{heading:'Problemas observados',text:(r.result.problemas??[]).map(x=>`[${x.gravidade}] ${x.evidencia}`).join('\n')},{heading:'Verificações e limites',text:JSON.stringify(r.result.checks??{},null,2)}]).save('auditoria-site.pdf')}}>Baixar relatório de auditoria PDF</Button>}
                      {r.candidates?.length > 0 && <p className="pt-1 text-muted-foreground">Candidatos avaliados: {r.candidates.map((c) => `${c.nome ?? c.titulo ?? c.url} (${c.confianca ?? 0}%)`).join('; ')}</p>}
                      <p className="text-muted-foreground">Fonte: {r.source ?? '—'} · primeira verificação {formatDateTime(r.first_checked_at)} · última {formatDateTime(r.last_checked_at)} · próxima {formatDateTime(r.next_check_at)}</p>
                    </>
                  ) : <p>Ainda não pesquisado.</p>}
                  {canEdit && (
                    edit?.platform === p ? (
                      <div className="flex gap-2 pt-1">
                        <Input value={edit.url} onChange={(ev) => setEdit({ ...edit, url: ev.target.value })} placeholder="https://..." />
                        <Button size="sm" onClick={() => confirm(p, edit.url, 'verificado')}>Salvar</Button>
                        <Button size="sm" variant="ghost" onClick={() => setEdit(null)}>Cancelar</Button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-2 pt-1">
                        {r?.url && r.status !== 'verificado' && <Button size="sm" variant="outline" onClick={() => confirm(p, r.url, 'verificado')}>Confirmar este canal</Button>}
                        <Button size="sm" variant="outline" onClick={() => setEdit({ platform: p, url: r?.url ?? '' })}>Corrigir endereço</Button>
                        <Button size="sm" variant="outline" onClick={() => confirm(p, null, 'nao_localizado')}>Confirmar que não tem</Button>
                        {canReset && r?.manual && <Button size="sm" variant="ghost" onClick={async () => {
                          const { error } = await supabase.rpc('reset_digital_channel', { p_lead_id: leadId, p_platform: p })
                          if (error) e.setError(error.message); else load()
                        }}>Desfazer confirmação</Button>}
                      </div>
                    )
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
      {canEdit && <Button size="sm" variant="outline" onClick={requeue}><Search className="h-4 w-4" /> Pesquisar novamente</Button>}
      {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
      <p className="text-xs text-muted-foreground">
        “Não localizado” só aparece quando uma pesquisa conclusiva rodou. Falha de conexão, bloqueio ou provedor sem chave ficam como inconclusivo ou pendente.
      </p>
    </div>
  )
}

// ------------------------------------------------------------------ tags
export function TagsSection({ leadId, canEdit, userId }: { leadId: string; canEdit: boolean; userId: string }) {
  const [all, setAll] = useState<{ id: string; name: string }[]>([])
  const [mine, setMine] = useState<string[]>([])
  const [name, setName] = useState('')
  const e = useErr()
  const load = useCallback(async () => {
    const [a, m] = await Promise.all([
      supabase.from('tags').select('id,name').order('name'),
      supabase.from('lead_tags').select('tag_id').eq('lead_id', leadId),
    ])
    setAll(a.data ?? []); setMine((m.data ?? []).map((x) => x.tag_id))
  }, [leadId])
  useEffect(() => { load() }, [load])
  async function add(ev: FormEvent) {
    ev.preventDefault()
    const n = name.trim()
    if (!n) return
    let tag = all.find((t) => t.name.toLowerCase() === n.toLowerCase())
    if (!tag) {
      const { data, error } = await supabase.from('tags').insert({ name: n, created_by: userId }).select('id,name').single()
      if (error) return e.setError(error.message)
      tag = data
    }
    const { error } = await supabase.from('lead_tags').insert({ lead_id: leadId, tag_id: tag!.id, created_by: userId })
    if (error && !error.message.includes('duplicate')) return e.setError(error.message)
    setName(''); load()
  }
  return (
    <div className="space-y-2 text-sm">
      {e.view}
      <div className="flex flex-wrap gap-1.5">
        {mine.length === 0 && <span className="text-muted-foreground">Sem tags.</span>}
        {mine.map((id) => (
          <Badge key={id} variant="secondary" className="gap-1">
            <TagIcon className="h-3 w-3" />{all.find((t) => t.id === id)?.name}
            {canEdit && <button aria-label="Remover tag" onClick={async () => { await supabase.from('lead_tags').delete().eq('lead_id', leadId).eq('tag_id', id); load() }}><X className="h-3 w-3" /></button>}
          </Badge>
        ))}
      </div>
      {canEdit && (
        <form onSubmit={add} className="flex gap-2">
          <Input list="tags-list" value={name} onChange={(ev) => setName(ev.target.value)} placeholder="Adicionar tag ou segmento" />
          <datalist id="tags-list">{all.map((t) => <option key={t.id} value={t.name} />)}</datalist>
          <Button type="submit" variant="outline" disabled={!name.trim()}>Adicionar</Button>
        </form>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ assistente
export interface Assistant {
  resumo?: string; proxima_acao?: string; canal_sugerido?: string; abordagem?: string; follow_up_sugerido?: string
  servico_recomendado?: { nome: string; motivo: string | null; relevancia: number; preco_de: number | null; preco_ate: number | null; recorrencia: string } | null
  sugestao_proposta?: { titulo: string; servicos: string[] | null; valor_estimado: number | null; observacao: string | null } | null
  oportunidades: { tipo: string; servico: string; oportunidade: string; evidencia: string; recomendacao: string }[]
  ressalvas: string[]
}

export function AssistantSection({ a }: { a: Assistant | null }) {
  if (!a) return <p className="text-sm text-muted-foreground">Diagnóstico indisponível.</p>
  const s = a.servico_recomendado
  return (
    <div className="space-y-3 text-sm">
      {a.resumo && <p>{a.resumo}</p>}
      {a.oportunidades.length === 0 && <p className="text-muted-foreground">Nenhuma oportunidade comprovada pelos dados disponíveis.</p>}
      {a.oportunidades.map((o, i) => (
        <div key={i} className="rounded-md border p-3">
          <p className="font-medium">{o.oportunidade}</p>
          <p className="mt-1"><span className="text-muted-foreground">Recomendação: </span>{o.recomendacao}</p>
          <p className="mt-1 text-xs text-muted-foreground">Motivo: {o.evidencia}</p>
        </div>
      ))}
      <div className="grid gap-2 md:grid-cols-2">
        {s && (
          <div className="rounded-md bg-muted/50 p-3">
            <p className="text-xs text-muted-foreground">Serviço recomendado</p>
            <p className="font-medium">{s.nome}</p>
            {s.motivo && <p className="text-xs text-muted-foreground">{s.motivo}</p>}
            <p className="text-xs">{s.preco_de != null ? `a partir de ${brl.format(s.preco_de)}` : 'preço não cadastrado'}{s.recorrencia !== 'unico' ? ` · ${RECURRENCE[s.recorrencia]?.toLowerCase()}` : ''}</p>
          </div>
        )}
        <div className="rounded-md bg-muted/50 p-3">
          <p className="text-xs text-muted-foreground">Próxima ação</p>
          <p className="font-medium">{a.proxima_acao}</p>
          <p className="text-xs text-muted-foreground">{a.abordagem}</p>
          {a.follow_up_sugerido && <p className="text-xs">Follow-up sugerido: {formatDate(a.follow_up_sugerido)}</p>}
        </div>
      </div>
      {a.sugestao_proposta && (
        <p className="text-xs text-muted-foreground">
          Sugestão de proposta: <strong>{a.sugestao_proposta.titulo}</strong>
          {a.sugestao_proposta.servicos?.length ? ` (${a.sugestao_proposta.servicos.join(', ')})` : ''}
          {a.sugestao_proposta.valor_estimado != null ? ` · estimativa ${brl.format(a.sugestao_proposta.valor_estimado)}` : ''}
          {a.sugestao_proposta.observacao ? ` · ${a.sugestao_proposta.observacao}` : ''}
        </p>
      )}
      {a.ressalvas.length > 0 && <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">{a.ressalvas.map((r, i) => <li key={i}>{r}</li>)}</ul>}
    </div>
  )
}
