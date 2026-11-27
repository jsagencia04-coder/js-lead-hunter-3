import { useCallback, useEffect, useState } from 'react'
import { BookmarkPlus, ChevronLeft, ChevronRight, Download, KanbanSquare, Loader2, Search, Shuffle, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { readCache, useCachedQuery, writeCache } from '@/lib/cache'
import { DataStatus } from '@/components/DataStatus'
import { formatCnpj, nf, PORTE_LABEL, UFS } from '@/lib/utils'
import { CHANNEL_STATUS, downloadCsv, PRIORITY_VARIANT, useOpenLead } from '@/lib/crm'
import { useAuth } from '@/hooks/useAuth'
import { PageHeader } from '@/components/layout/AppLayout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Alert } from '@/components/ui/alert'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'

interface F {
  sem_site: boolean; sem_instagram: boolean; sem_facebook: boolean; sem_google: boolean; site_problemas: boolean; pendente: boolean
  dias: string; prioridade: string; cnae: string; uf: string; municipio: string; porte: string; servico: string; fora_do_funil: boolean
}
const EMPTY: F = { sem_site: false, sem_instagram: false, sem_facebook: false, sem_google: false, site_problemas: false, pendente: false,
  dias: '', prioridade: '', cnae: '', uf: '', municipio: '', porte: '', servico: '', fora_do_funil: true }
const QUICK: [keyof F, string][] = [
  ['sem_site', 'Sem site localizado'], ['sem_instagram', 'Sem Instagram localizado'], ['sem_facebook', 'Sem Facebook localizado'],
  ['site_problemas', 'Site com problemas técnicos'], ['sem_google', 'Sem Perfil no Google'], ['pendente', 'Diagnóstico pendente'],
]
const GROUPS: Record<string, string> = { servico: 'Serviço recomendado', cnae: 'CNAE (divisão)', uf: 'Estado', municipio: 'Município', porte: 'Porte',
  prioridade: 'Prioridade', site: 'Situação do site', instagram: 'Situação do Instagram', google: 'Perfil no Google' }
const PAGE = 50
const COLS = 'id,cnpj,razao_social,nome_fantasia,uf,municipio,cnae_principal,cnae_descricao,porte,score,priority,dias_abertura,site_status,site_url,site_nota,' +
  'site_problemas,instagram_status,facebook_status,google_status,servico_nome,servico_codigo,owner_name,no_funil,tags,diagnosis_confidence'

interface Row {
  id: string; cnpj: string; razao_social: string | null; nome_fantasia: string | null; uf: string | null; municipio: string | null
  cnae_principal: string | null; cnae_descricao: string | null; porte: string | null; score: number; priority: string; dias_abertura: number | null
  site_status: string | null; site_url: string | null; site_nota: number | null; site_problemas: number; instagram_status: string | null
  facebook_status: string | null; google_status: string | null; servico_nome: string | null; servico_codigo: string | null
  owner_name: string | null; no_funil: boolean; tags: string[]; diagnosis_confidence: number | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function apply(q: any, f: F) {
  q = q.eq('bloqueado', false)
  if (f.sem_site) q = q.eq('site_status', 'nao_localizado')
  if (f.sem_instagram) q = q.eq('instagram_status', 'nao_localizado')
  if (f.sem_facebook) q = q.eq('facebook_status', 'nao_localizado')
  if (f.sem_google) q = q.eq('google_status', 'nao_localizado')
  if (f.site_problemas) q = q.eq('site_status', 'verificado').gt('site_problemas', 0)
  if (f.pendente) q = q.eq('diagnostico_pendente', true)
  if (f.dias) q = q.lte('dias_abertura', Number(f.dias))
  if (f.prioridade) q = q.eq('priority', f.prioridade)
  if (f.cnae.trim()) q = q.like('cnae_principal', `${f.cnae.replace(/\D/g, '')}%`)
  if (f.uf) q = q.eq('uf', f.uf)
  if (f.municipio.trim()) q = q.ilike('municipio', `%${f.municipio.trim()}%`)
  if (f.porte) q = q.eq('porte', f.porte)
  if (f.servico) q = q.eq('servico_codigo', f.servico)
  if (f.fora_do_funil) q = q.eq('no_funil', false)
  return q
}
function toRpc(f: F) {
  const o: Record<string, unknown> = {}
  for (const k of ['sem_site', 'sem_instagram', 'sem_facebook', 'sem_google', 'site_problemas', 'pendente'] as const) if (f[k]) o[k] = true
  if (f.dias) o.dias = Number(f.dias)
  if (f.prioridade) o.prioridade = f.prioridade
  if (f.cnae.trim()) o.cnae = f.cnae.replace(/\D/g, '')
  if (f.uf) o.uf = f.uf
  if (f.porte) o.porte = f.porte
  if (f.servico) o.servico = f.servico
  return o
}

export default function Opportunities() {
  const { hasRole, profile } = useAuth()
  const openLead = useOpenLead()
  const canEdit = hasRole('admin', 'gestor', 'comercial')
  const canDistribute = hasRole('admin', 'gestor')
  // filtros, página e agrupamento ficam salvos: atualizar a página mantém a tela
  const saved0 = readCache<{ f: F; group: string; page: number }>('central:estado')?.data
  const [f, setF] = useState<F>(saved0?.f ?? EMPTY)
  const [applied, setApplied] = useState<F>(saved0?.f ?? EMPTY)
  const [group, setGroup] = useState(saved0?.group ?? 'servico')
  const [page, setPage] = useState(saved0?.page ?? 0)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [services, setServices] = useState<{ code: string; name: string }[]>([])
  const [owners, setOwners] = useState<{ id: string; full_name: string | null; email: string; role: string }[]>([])
  const [distTo, setDistTo] = useState<string[]>([])
  const [saved, setSaved] = useState<{ id: string; name: string; filters: F }[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [campaigns, setCampaigns] = useState<{id:string;name:string}[]>([])
  const [campaign, setCampaign] = useState('')

  useEffect(() => {
    supabase.from('sales_campaigns').select('id,name').neq('status','concluida').order('name').limit(100).then(({data})=>setCampaigns(data??[]))
    supabase.from('service_catalog').select('code,name').eq('active', true).order('sort_order').then(({ data }) => setServices(data ?? []))
    supabase.from('profiles').select('id,full_name,email,role').eq('active', true).order('full_name').then(({ data }) => setOwners(data ?? []))
  }, [])
  const loadSaved = useCallback(async () => {
    const { data } = await supabase.from('lead_searches').select('id,name,filters').eq('scope', 'oportunidades').order('name')
    setSaved((data as { id: string; name: string; filters: F }[]) ?? [])
  }, [])
  useEffect(() => { loadSaved() }, [loadSaved])

  useEffect(() => { writeCache('central:estado', { f: applied, group, page }) }, [applied, group, page])
  const key = JSON.stringify([applied, page, group])
  const q = useCachedQuery<{ rows: Row[]; count: number; groups: { chave: string; rotulo: string; total: number; alta: number }[] }>(
    `central:${key}`, async () => {
      const [l, g] = await Promise.all([
        apply(supabase.from('opportunity_center_v').select(COLS, { count: 'exact' }), applied)
          .order('score', { ascending: false }).order('id').range(page * PAGE, page * PAGE + PAGE - 1),
        supabase.rpc('opportunity_center_groups', { p_group: group, p_filters: toRpc(applied) }),
      ])
      const err = l.error ?? g.error
      if (err) return { data: null, error: err.message }
      return { data: { rows: (l.data as unknown as Row[]) ?? [], count: l.count ?? 0, groups: (g.data as { chave: string; rotulo: string; total: number; alta: number }[]) ?? [] }, error: null }
    }, [key])
  const rows = q.data?.rows ?? []
  const count = q.data?.count ?? 0
  const groups = q.data?.groups ?? []
  const loading = q.loading && !q.data
  const load = q.reload


  const run = (next: F) => { setApplied(next); setPage(0); setSel(new Set()) }
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  async function addToPipeline() {
    setNotice(null)
    const { data, error } = await supabase.rpc('add_leads_to_pipeline', { p_lead_ids: [...sel], p_owner: null, p_title: null, p_service_ids: [] })
    if (error) return setError(error.message)
    setNotice(`${data} oportunidade(s) criada(s) no CRM (etapa “Novo lead”). Empresas já no funil ou bloqueadas foram ignoradas.`)
    setSel(new Set()); load()
  }
  async function distribute() {
    if (!distTo.length) return setError('Escolha pelo menos um responsável.')
    const { data, error } = await supabase.rpc('distribute_leads', { p_lead_ids: [...sel], p_owner_ids: distTo, p_only_unassigned: true })
    if (error) return setError(error.message)
    setNotice(`${data} empresa(s) distribuída(s) em rodízio entre ${distTo.length} responsável(is).`)
    setSel(new Set()); load()
  }
  async function research() {
    const { data, error } = await supabase.rpc('request_enrichment', { p_lead_ids: [...sel] })
    if (error) return setError(error.message)
    setNotice(`${data} empresa(s) colocada(s) no topo da fila de inteligência digital.`)
  }
  async function saveSegment() {
    const name = window.prompt('Nome do segmento comercial')?.trim()
    if (!name) return
    const { error } = await supabase.from('lead_searches').insert({ owner_id: profile!.id, name, filters: applied, scope: 'oportunidades', is_shared: true })
    if (error) setError(error.message); else loadSaved()
  }
  function exportCsv() {
    downloadCsv('central-de-oportunidades.csv', [['Empresa', 'CNPJ', 'UF', 'Município', 'CNAE', 'Pontuação', 'Prioridade', 'Site', 'Instagram', 'Facebook', 'Google', 'Serviço recomendado'],
      ...rows.map((r) => [r.nome_fantasia || r.razao_social, r.cnpj, r.uf, r.municipio, `${r.cnae_principal} ${r.cnae_descricao ?? ''}`, r.score, r.priority,
        CHANNEL_STATUS[r.site_status ?? 'pendente']?.label, CHANNEL_STATUS[r.instagram_status ?? 'pendente']?.label,
        CHANNEL_STATUS[r.facebook_status ?? 'pendente']?.label, CHANNEL_STATUS[r.google_status ?? 'pendente']?.label, r.servico_nome])])
  }

  const st = (v: string | null) => { const c = CHANNEL_STATUS[v ?? 'pendente']; return <Badge variant={c.variant} className="whitespace-nowrap">{c.label}</Badge> }

  return (
    <>
      <PageHeader title="Central de oportunidades" description="Encontre empresas com oportunidade digital comprovada, monte segmentos e leve ao CRM." />
      {error && <Alert tone="error" className="mb-4">{error}</Alert>}
      <DataStatus loading={q.loading} error={q.error} savedAt={q.savedAt} hasData={!!q.data} />
      {notice && <Alert tone="info" className="mb-4">{notice}</Alert>}

      <Card className="mb-4">
        <CardContent className="space-y-3 pt-5">
          <div className="flex flex-wrap gap-2">
            {QUICK.map(([k, label]) => (
              <button key={k} onClick={() => { const n = { ...f, [k]: !f[k] }; setF(n); run(n) }}
                className={`rounded-full border px-3 py-1 text-xs ${f[k] ? 'border-primary bg-primary/10 font-medium text-primary' : 'hover:bg-accent'}`}>{label}</button>
            ))}
            {[['30', 'Abertas há até 30 dias'], ['90', 'Abertas há até 90 dias']].map(([d, label]) => (
              <button key={d} onClick={() => { const n = { ...f, dias: f.dias === d ? '' : d }; setF(n); run(n) }}
                className={`rounded-full border px-3 py-1 text-xs ${f.dias === d ? 'border-primary bg-primary/10 font-medium text-primary' : 'hover:bg-accent'}`}>{label}</button>
            ))}
            <button onClick={() => { const n = { ...f, prioridade: f.prioridade === 'alta' ? '' : 'alta' }; setF(n); run(n) }}
              className={`rounded-full border px-3 py-1 text-xs ${f.prioridade === 'alta' ? 'border-primary bg-primary/10 font-medium text-primary' : 'hover:bg-accent'}`}>Alta prioridade</button>
          </div>
          <form onSubmit={(e) => { e.preventDefault(); run(f) }} className="grid gap-2 md:grid-cols-7">
            <div><Label>CNAE (início)</Label><Input value={f.cnae} onChange={(e) => setF({ ...f, cnae: e.target.value })} placeholder="ex.: 56" /></div>
            <div><Label>UF</Label><Select value={f.uf} onChange={(e) => setF({ ...f, uf: e.target.value })}><option value="">Todas</option>{UFS.map((u) => <option key={u}>{u}</option>)}</Select></div>
            <div><Label>Município</Label><Input value={f.municipio} onChange={(e) => setF({ ...f, municipio: e.target.value })} /></div>
            <div><Label>Porte</Label><Select value={f.porte} onChange={(e) => setF({ ...f, porte: e.target.value })}><option value="">Todos</option>{Object.entries(PORTE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></div>
            <div><Label>Serviço recomendado</Label><Select value={f.servico} onChange={(e) => setF({ ...f, servico: e.target.value })}><option value="">Todos</option>{services.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}</Select></div>
            <div><Label>Prioridade</Label><Select value={f.prioridade} onChange={(e) => setF({ ...f, prioridade: e.target.value })}><option value="">Todas</option><option value="alta">Alta</option><option value="media">Média</option><option value="baixa">Baixa</option></Select></div>
            <div className="flex items-end gap-2"><Button type="submit" className="w-full"><Search className="h-4 w-4" /> Filtrar</Button></div>
          </form>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={f.fora_do_funil} onChange={(e) => { const n = { ...f, fora_do_funil: e.target.checked }; setF(n); run(n) }} /> só empresas fora do funil</label>
            <Button variant="ghost" size="sm" onClick={() => { setF(EMPTY); run(EMPTY) }}>Limpar</Button>
            <Button variant="outline" size="sm" onClick={saveSegment}><BookmarkPlus className="h-4 w-4" /> Salvar segmento</Button>
            {saved.length > 0 && (
              <Select className="w-56" value="" onChange={(e) => { const s = saved.find((x) => x.id === e.target.value); if (s) { setF({ ...EMPTY, ...s.filters }); run({ ...EMPTY, ...s.filters }) } }} aria-label="Segmentos salvos">
                <option value="">Segmentos salvos…</option>{saved.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            )}
            {saved.length > 0 && <span className="text-xs text-muted-foreground">({saved.length})</span>}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[22rem_1fr]">
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-2"><CardTitle>Agrupar por</CardTitle>
            <Select value={group} onChange={(e) => setGroup(e.target.value)} className="w-44" aria-label="Agrupar por">
              {Object.entries(GROUPS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select></CardHeader>
          <CardContent className="space-y-1 text-sm">
            {groups.length === 0 && <p className="text-muted-foreground">Sem resultados.</p>}
            {groups.map((g) => (
              <div key={g.chave} className="flex justify-between gap-2 border-b py-1">
                <span className="truncate" title={g.rotulo}>{group === 'porte' ? PORTE_LABEL[g.rotulo] ?? g.rotulo : CHANNEL_STATUS[g.rotulo]?.label ?? g.rotulo}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{nf.format(g.total)}{g.alta ? <span className="ml-1 text-emerald-700">({nf.format(g.alta)} alta)</span> : null}</span>
              </div>
            ))}
            <p className="pt-2 text-xs text-muted-foreground">Contagens consideram os filtros, exceto “só fora do funil” e município.</p>
          </CardContent>
        </Card>

        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2 p-4">
            <p className="text-sm text-muted-foreground">{loading ? 'Carregando…' : `${nf.format(count)} empresa(s)`}{sel.size > 0 && ` · ${sel.size} selecionada(s)`}</p>
            <div className="flex flex-wrap items-center gap-2">
              {canEdit && campaigns.length>0 && <><Select aria-label="Campanha de destino" className="w-44" value={campaign} onChange={e=>setCampaign(e.target.value)}><option value="">Escolher campanha</option>{campaigns.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</Select><Button size="sm" variant="outline" disabled={!sel.size||!campaign} onClick={async()=>{setError(null);const r=await supabase.rpc('add_campaign_members',{p_id:campaign,p_lead_ids:[...sel]});if(r.error)setError(r.error.message);else{setNotice(`${r.data} empresas adicionadas à campanha; duplicadas/bloqueadas ignoradas.`);setSel(new Set())}}}>Incluir na campanha</Button></>}
              {canEdit && <Button size="sm" disabled={!sel.size} onClick={addToPipeline}><KanbanSquare className="h-4 w-4" /> Adicionar ao CRM</Button>}
              {canEdit && <Button size="sm" variant="outline" disabled={!sel.size} onClick={research}><Search className="h-4 w-4" /> Pesquisar de novo</Button>}
              {canDistribute && (
                <>
                  <Select multiple className="h-9 w-48" value={distTo} onChange={(e) => setDistTo([...e.target.selectedOptions].map((o) => o.value))} aria-label="Distribuir para">
                    {owners.filter((o) => o.role !== 'leitura').map((o) => <option key={o.id} value={o.id}>{o.full_name ?? o.email}</option>)}
                  </Select>
                  <Button size="sm" variant="outline" disabled={!sel.size} onClick={distribute}><Shuffle className="h-4 w-4" /> Distribuir</Button>
                </>
              )}
              <Button size="sm" variant="outline" onClick={exportCsv}><Download className="h-4 w-4" /> Excel (página)</Button>
              {sel.size > 0 && <Button size="sm" variant="ghost" onClick={() => setSel(new Set())}><Trash2 className="h-4 w-4" /></Button>}
            </div>
          </div>
          <Table>
            <THead><tr>
              <TH><input type="checkbox" aria-label="Selecionar página" checked={rows.length > 0 && rows.every((r) => sel.has(r.id))}
                onChange={(e) => setSel((s) => { const n = new Set(s); rows.forEach((r) => (e.target.checked ? n.add(r.id) : n.delete(r.id))); return n })} /></TH>
              <TH>Empresa</TH><TH>Pontos</TH><TH>Site</TH><TH>Instagram</TH><TH>Google</TH><TH>Serviço recomendado</TH><TH>Responsável</TH>
            </tr></THead>
            <TBody>
              {!loading && rows.length === 0 && <tr><TD colSpan={8} className="py-8 text-center text-muted-foreground">Nenhuma empresa com esses filtros.</TD></tr>}
              {loading && <tr><TD colSpan={8} className="py-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></TD></tr>}
              {!loading && rows.map((r) => (
                <TR key={r.id}>
                  <TD><input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} aria-label="Selecionar" /></TD>
                  <TD className="min-w-[14rem] cursor-pointer" onClick={() => openLead(r.id)}>
                    <p className="font-medium hover:underline">{r.nome_fantasia || r.razao_social}</p>
                    <p className="text-xs text-muted-foreground">{formatCnpj(r.cnpj)} · {r.municipio}/{r.uf} · {r.dias_abertura ?? '?'} dias</p>
                    <p className="line-clamp-1 text-xs text-muted-foreground">{r.cnae_descricao}</p>
                    {r.tags?.length > 0 && <p className="text-xs">{r.tags.map((t) => <Badge key={t} variant="outline" className="mr-1">{t}</Badge>)}</p>}
                  </TD>
                  <TD><Badge variant={PRIORITY_VARIANT(r.priority)}>{r.score}</Badge>{r.diagnosis_confidence != null && <p className="text-[11px] text-muted-foreground">conf. {r.diagnosis_confidence}%</p>}</TD>
                  <TD>{st(r.site_status)}{r.site_status === 'verificado' && r.site_problemas > 0 && <p className="text-[11px] text-red-700">{r.site_problemas} problema(s) · nota {r.site_nota}</p>}</TD>
                  <TD>{st(r.instagram_status)}</TD>
                  <TD>{st(r.google_status)}</TD>
                  <TD className="text-xs">{r.servico_nome ?? '—'}</TD>
                  <TD className="text-xs">{r.owner_name ?? '—'}{r.no_funil && <p><Badge variant="secondary">no funil</Badge></p>}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <div className="flex items-center justify-end gap-2 p-3">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}><ChevronLeft className="h-4 w-4" /></Button>
            <span className="text-xs text-muted-foreground">página {page + 1} de {Math.max(1, Math.ceil(count / PAGE))}</span>
            <Button variant="outline" size="sm" disabled={(page + 1) * PAGE >= count} onClick={() => setPage(page + 1)}><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </Card>
      </div>
    </>
  )
}
