import { useCallback, useEffect, useState, type DragEvent } from 'react'
import { Columns3, Download, List, Loader2, Phone, RefreshCw } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { Profile } from '@/lib/types'
import { brl, formatDate, formatDateTime, nf, UFS } from '@/lib/utils'
import {
  downloadCsv, PRIORITY_VARIANT, STAGE_COLOR, useOpenLead, type LossReason, type OpportunityRow, type PipelineStage,
} from '@/lib/crm'
import { useAuth } from '@/hooks/useAuth'
import { PageHeader } from '@/components/layout/AppLayout'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Alert } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { ActivityCalendar } from '@/components/ActivityCalendar'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'

const PER_COLUMN = 30
const COLS = 'id,lead_id,title,stage_code,stage_label,stage_order,status,owner_id,owner_name,value,recurring_value,expected_close,' +
  'stage_changed_at,created_at,cnpj,score,priority,razao_social,nome_fantasia,uf,municipio,has_phone,has_email,next_follow_up_at,tarefas_abertas,lost_reason,' +
  'pipeline_id,pipeline_name,team_id,team_name,probability,weighted_value,priority_level'

export default function Crm() {
  const { profile, hasRole } = useAuth()
  const openLead = useOpenLead()
  const canEdit = hasRole('admin', 'gestor', 'comercial')
  const [view, setView] = useState<'kanban' | 'lista' | 'calendario'>('kanban')
  const [stages, setStages] = useState<PipelineStage[]>([])
  const [pipelines,setPipelines]=useState<{id:string;name:string;active:boolean}[]>([])
  const [pipeline,setPipeline]=useState('00000000-0000-4000-8000-000000000001')
  const [teams,setTeams]=useState<{id:string;name:string}[]>([])
  const [team,setTeam]=useState('')
  const [members,setMembers]=useState<{pipeline_id:string;stage_code:string;sort_order:number}[]>([])
  const [reasons, setReasons] = useState<LossReason[]>([])
  const [owner, setOwner] = useState('todos')
  const [uf, setUf] = useState('')
  const [onlyOpen, setOnlyOpen] = useState(true)
  const [columns, setColumns] = useState<Record<string, OpportunityRow[]>>({})
  const [list, setList] = useState<OpportunityRow[]>([])
  const [limits, setLimits] = useState<Record<string, number>>({})
  const [counts, setCounts] = useState<Record<string, { total: number; valor: number }>>({})
  const [owners, setOwners] = useState<Pick<Profile, 'id' | 'full_name' | 'email'>[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)
  const [losing, setLosing] = useState<{ id: string; from: string; reason: string; text: string } | null>(null)

  useEffect(() => {
    supabase.from('sales_pipelines').select('id,name,active').order('name').then(({data})=>setPipelines(data??[]))
    supabase.from('sales_teams').select('id,name').eq('active',true).order('name').then(({data})=>setTeams(data??[]))
    supabase.from('pipeline_stage_members').select('*').then(({data})=>setMembers(data??[]))
    supabase.from('profiles').select('id,full_name,email').eq('active', true).order('full_name').then(({ data }) => setOwners(data ?? []))
    supabase.from('pipeline_stages').select('*').eq('active', true).order('sort_order').then(({ data }) => setStages((data as PipelineStage[]) ?? []))
    supabase.from('loss_reasons').select('*').eq('active', true).order('sort_order').then(({ data }) => setReasons((data as LossReason[]) ?? []))
  }, [])

  const pipelineStages = stages.filter(s=>!pipeline||members.some(m=>m.pipeline_id===pipeline&&m.stage_code===s.code))
  const visible = pipelineStages.filter((s) => !onlyOpen || s.kind !== 'perdida')

  const load = useCallback(async () => {
    if (!stages.length) return
    setLoading(true)
    setError(null)
    const ownerId = owner === 'meus' ? profile?.id : owner !== 'todos' && owner !== 'sem' ? owner : null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filt = (q: any) => {
      if (ownerId) q = q.eq('owner_id', ownerId)
      if (owner === 'sem') q = q.is('owner_id', null)
      if (uf) q = q.eq('uf', uf)
      if (pipeline) q=q.eq('pipeline_id',pipeline)
      if (team) q=q.eq('team_id',team)
      return q
    }
    const c = await supabase.rpc('pipeline_counts_v4', { p_pipeline:pipeline||null,p_team:team||null,p_owner: ownerId, p_unassigned: owner === 'sem', p_uf: uf || null })
    if (c.error) setError(c.error.message)
    setCounts(Object.fromEntries(((c.data as { stage_code: string; total: number; valor: number }[]) ?? []).map((r) => [r.stage_code, { total: r.total, valor: r.valor }])))
    if (view === 'kanban') {
      const reqs = visible.map((s) => filt(supabase.from('opportunity_list_v').select(COLS).eq('stage_code', s.code))
        .order('score', { ascending: false }).order('id').limit(limits[s.code] ?? PER_COLUMN))
      const res = await Promise.all(reqs)
      const err = res.find((x) => x.error)?.error
      if (err) setError(err.message)
      setColumns(Object.fromEntries(visible.map((s, i) => [s.code, (res[i].data as unknown as OpportunityRow[]) ?? []])))
    } else {
      let q = filt(supabase.from('opportunity_list_v').select(COLS))
      if (onlyOpen) q = q.eq('status', 'aberta')
      const { data, error } = await q.order('stage_order').order('score', { ascending: false }).limit(500)
      if (error) setError(error.message)
      setList((data as unknown as OpportunityRow[]) ?? [])
    }
    setLoading(false)
  }, [owner, uf, pipeline,team,members,limits, profile, stages, view, onlyOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

  async function move(id: string, from: string, to: string, lost?: { reason: string; text: string }) {
    if (from === to) return
    const target = stages.find((s) => s.code === to)
    if (target?.kind === 'perdida' && !lost) {
      setLosing({ id, from, reason: reasons[0]?.id ?? '', text: '' })
      return
    }
    setColumns((cols) => {
      const card = cols[from]?.find((c) => c.id === id)
      if (!card) return cols
      return { ...cols, [from]: cols[from].filter((c) => c.id !== id), [to]: [{ ...card, stage_code: to }, ...(cols[to] ?? [])] }
    })
    const patch: Record<string, unknown> = { stage_code: to }
    if (lost) { patch.lost_reason_id = lost.reason || null; patch.lost_reason = lost.text.trim() || reasons.find((r) => r.id === lost.reason)?.label }
    const { error } = await supabase.from('opportunities').update(patch).eq('id', id)
    if (error) setError(error.message)
    setLosing(null)
    load()
  }

  function onDrop(e: DragEvent, to: string) {
    e.preventDefault()
    setDragOver(null)
    const [id, from] = e.dataTransfer.getData('text/plain').split('|')
    if (id && from) move(id, from, to)
  }

  function exportCsv() {
    downloadCsv(`js-lead-hunter-oportunidades-${new Date().toISOString().slice(0, 10)}.csv`, [
      ['Empresa', 'CNPJ', 'Oportunidade', 'Etapa', 'Responsável', 'Valor', 'Recorrente', 'Previsão', 'UF', 'Município', 'Pontuação'],
      ...list.map((o) => [o.nome_fantasia || o.razao_social, o.cnpj, o.title, o.stage_label, o.owner_name, o.value, o.recurring_value,
        o.expected_close, o.uf, o.municipio, o.score]),
    ])
  }

  const now = Date.now()
  const card = (c: OpportunityRow) => (
    <div key={c.id} draggable={canEdit} onDragStart={(e) => e.dataTransfer.setData('text/plain', `${c.id}|${c.stage_code}`)}
      onClick={() => openLead(c.lead_id)} className="cursor-pointer rounded-md border bg-card p-2.5 text-xs shadow-sm hover:border-primary">
      <div className="flex items-start justify-between gap-2">
        <p className="line-clamp-2 text-sm font-medium">{c.nome_fantasia || c.razao_social || '—'}</p>
        <Badge variant={PRIORITY_VARIANT(c.priority)}>{c.score}</Badge>
      </div>
      <p className="mt-0.5 line-clamp-1 text-muted-foreground">{c.title}</p>
      <p className="mt-1 text-muted-foreground">{c.municipio ?? '—'} / {c.uf ?? '—'}</p>
      <div className="mt-1 flex items-center gap-2 text-muted-foreground">
        {c.has_phone && <Phone className="h-3 w-3" />}{c.has_email && <span>@</span>}
        {c.value != null && <span className="font-medium text-foreground">{brl.format(c.value)}</span>}
        <span className="ml-auto truncate">{c.owner_name ?? 'sem responsável'}</span>
      </div>
      {c.next_follow_up_at && (
        <p className={`mt-1 ${new Date(c.next_follow_up_at).getTime() < now ? 'text-red-600' : 'text-muted-foreground'}`}>
          Próxima tarefa {formatDateTime(c.next_follow_up_at)}
        </p>
      )}
    </div>
  )

  return (
    <>
      <PageHeader
        title="CRM comercial"
        description={canEdit ? 'Oportunidades por etapa. Arraste os cartões; clique para abrir a ficha da empresa.' : 'Funil comercial.'}
        actions={
          <>
            <div className="flex rounded-md border">
              <Button variant={view === 'kanban' ? 'default' : 'ghost'} size="sm" onClick={() => setView('kanban')}><Columns3 className="h-4 w-4" /> Kanban</Button>
              <Button variant={view === 'lista' ? 'default' : 'ghost'} size="sm" onClick={() => setView('lista')}><List className="h-4 w-4" /> Tabela</Button>
              <Button variant={view==='calendario'?'default':'ghost'} size="sm" onClick={()=>setView('calendario')}>Calendário</Button>
            </div>
            <Select aria-label="Funil comercial" className="w-48" value={pipeline} onChange={e=>setPipeline(e.target.value)}>{pipelines.map(p=><option key={p.id} value={p.id}>{p.name}{!p.active?' (inativo)':''}</option>)}</Select>
            <Select aria-label="Equipe comercial" className="w-44" value={team} onChange={e=>setTeam(e.target.value)}><option value="">Todas as equipes</option>{teams.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</Select>
            <Select value={owner} onChange={(e) => setOwner(e.target.value)} className="w-48" aria-label="Responsável">
              <option value="todos">Todos os responsáveis</option>
              <option value="meus">Minhas oportunidades</option>
              <option value="sem">Sem responsável</option>
              {owners.map((o) => <option key={o.id} value={o.id}>{o.full_name ?? o.email}</option>)}
            </Select>
            <Select value={uf} onChange={(e) => setUf(e.target.value)} className="w-28" aria-label="UF">
              <option value="">Brasil</option>
              {UFS.map((u) => <option key={u}>{u}</option>)}
            </Select>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!onlyOpen} onChange={(e) => setOnlyOpen(!e.target.checked)} /> mostrar perdidas</label>
            {view === 'lista' && <Button variant="outline" onClick={exportCsv}><Download className="h-4 w-4" /> Excel</Button>}
            <Button variant="outline" onClick={load} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
          </>
        }
      />
      {error && <Alert tone="warning" className="mb-4">{error}</Alert>}
      {losing && (
        <Alert tone="warning" title="Motivo da perda" className="mb-4">
          <div className="mt-2 flex flex-col gap-2 md:flex-row">
            <Select value={losing.reason} onChange={(e) => setLosing({ ...losing, reason: e.target.value })} aria-label="Motivo">
              {reasons.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </Select>
            <Input value={losing.text} onChange={(e) => setLosing({ ...losing, text: e.target.value })} placeholder="Detalhe (opcional)" />
            <Button variant="destructive" onClick={() => move(losing.id, losing.from, 'perdido', losing)}>Confirmar perda</Button>
            <Button variant="ghost" onClick={() => setLosing(null)}>Cancelar</Button>
          </div>
        </Alert>
      )}
      {!loading && Object.keys(counts).length === 0 && (
        <Alert tone="info" className="mb-4">
          Nenhuma oportunidade no funil ainda. Adicione empresas pela <strong>Central de oportunidades</strong> ou pela ficha da empresa (“Adicionar ao funil”).
        </Alert>
      )}

      {view==='calendario'?<ActivityCalendar activities={list.map(o=>({id:o.id,title:o.title,company:o.nome_fantasia||o.razao_social,when:o.expected_close?o.expected_close+'T12:00:00':null,onOpen:()=>openLead(o.lead_id)}))}/>:view === 'kanban' ? (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {visible.map((s) => {
            const cards = columns[s.code] ?? []
            const ct = counts[s.code] ?? { total: 0, valor: 0 }
            return (
              <div key={s.code}
                onDragOver={(e) => { if (canEdit) { e.preventDefault(); setDragOver(s.code) } }}
                onDragLeave={() => setDragOver(null)}
                onDrop={(e) => canEdit && onDrop(e, s.code)}
                className={`flex w-72 shrink-0 flex-col rounded-lg border bg-muted/40 ${dragOver === s.code ? 'ring-2 ring-primary' : ''}`}>
                <div className="border-b px-3 py-2">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-sm font-medium"><span className={`h-2 w-2 rounded-full ${STAGE_COLOR[s.color] ?? 'bg-slate-400'}`} />{s.label}</span>
                    <Badge variant="secondary">{nf.format(ct.total)}</Badge>
                  </div>
                  {Number(ct.valor) > 0 && <p className="text-xs text-muted-foreground">{brl.format(Number(ct.valor))}</p>}
                </div>
                <div className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto p-2">
                  {cards.map(card)}
                  {!loading && cards.length === 0 && <p className="p-3 text-center text-xs text-muted-foreground">Vazio</p>}
                  {cards.length < ct.total && (
                    <Button variant="ghost" size="sm" onClick={() => setLimits((l) => ({ ...l, [s.code]: (l[s.code] ?? PER_COLUMN) + PER_COLUMN }))}>
                      Carregar mais ({nf.format(ct.total - cards.length)})
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <Card>
          <Table>
            <THead><tr><TH>Empresa</TH><TH>Oportunidade</TH><TH>Etapa</TH><TH>Responsável</TH><TH>Valor</TH><TH>Previsão</TH><TH>Na etapa desde</TH><TH>Pontos</TH></tr></THead>
            <TBody>
              {list.length === 0 && <tr><TD colSpan={8} className="py-8 text-center text-muted-foreground">Nenhuma oportunidade.</TD></tr>}
              {list.map((o) => (
                <TR key={o.id} className="cursor-pointer" onClick={() => openLead(o.lead_id)}>
                  <TD><p className="font-medium">{o.nome_fantasia || o.razao_social}</p><p className="text-xs text-muted-foreground">{o.municipio}/{o.uf}</p></TD>
                  <TD>{o.title}</TD>
                  <TD>
                    {canEdit && o.status === 'aberta' ? (
                      <Select value={o.stage_code} onClick={(e) => e.stopPropagation()} onChange={(e) => move(o.id, o.stage_code, e.target.value)} aria-label="Etapa">
                        {pipelineStages.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
                      </Select>
                    ) : <Badge variant={o.status === 'perdida' ? 'danger' : 'success'}>{o.stage_label}</Badge>}
                  </TD>
                  <TD>{o.owner_name ?? '—'}</TD>
                  <TD className="tabular-nums">{o.value != null ? brl.format(o.value) : '—'}<p className="text-xs text-muted-foreground">{o.probability}% configurado · ponderado {brl.format(o.weighted_value)}</p></TD>
                  <TD>{formatDate(o.expected_close)}</TD>
                  <TD className="text-xs">{formatDate(o.stage_changed_at)}</TD>
                  <TD><Badge variant={PRIORITY_VARIANT(o.priority)}>{o.score}</Badge></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
    </>
  )
}
