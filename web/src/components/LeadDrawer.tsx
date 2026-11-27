import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import {
  Ban, Building2, History, KanbanSquare, Loader2, MessageSquarePlus, PhoneCall, Radar, FileText, X,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { STAGE_LABEL, type LeadRow, type LeadStage, type Profile } from '@/lib/types'
import { brl, formatCnpj, formatDate, formatDateTime, PORTE_LABEL } from '@/lib/utils'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Alert } from '@/components/ui/alert'
import { TabList, TabPanel, type TabDef } from '@/components/ui/tabs'
import { BusinessDigitalTwin } from '@/components/BusinessDigitalTwin'
import { CompanyMonitoring } from '@/components/CompanyMonitoring'
import { ApproachSection, ProposalsSection, type Diagnosis } from '@/components/LeadCommercial'
import { AssistantSection, ChannelsSection, ContractsSection, OpportunitiesSection, TagsSection, TasksSection, type Assistant } from '@/components/LeadCrm'

interface LeadDetail extends LeadRow {
  owner_id: string | null
  next_follow_up_at: string | null
  website: string | null
  situacao_cadastral: string
  cnaes_secundarios: string[]
}
interface LeadExtra {
  score_breakdown: Record<string, number>
  digital_presence: { status?: string; dominio?: string; checked_at?: string; url?: string } | null
  lost_reason: string | null
  converted_at: string | null
}
interface Recommendation { relevance: number; reason: string | null; service_catalog: { name: string } | null }
interface LeadEvent {
  id: number
  event_type: string
  from_stage: LeadStage | null
  to_stage: LeadStage | null
  channel: string | null
  content: string | null
  scheduled_for: string | null
  actor_id: string | null
  created_at: string
}

const EVENT_LABEL: Record<string, string> = {
  criado: 'Lead criado', mudanca_etapa: 'Mudança de etapa', anotacao: 'Anotação', contato: 'Contato registrado',
  resposta_recebida: 'Resposta recebida', proposta: 'Proposta',
  follow_up_agendado: 'Follow-up agendado', follow_up_concluido: 'Follow-up concluído',
  responsavel_alterado: 'Responsável alterado', pontuacao_alterada: 'Pontuação alterada', bloqueado: 'Bloqueado para contato',
}
const SCORE_LABEL: Record<string, string> = {
  recencia: 'Recência', telefone: 'Telefone', email: 'E-mail', cnae_compativel: 'CNAE compatível',
  porte: 'Porte', oportunidade_digital: 'Oportunidade digital',
}
const DIGITAL: Record<string, string> = {
  sem_site: 'Domínio próprio sem site no ar (oportunidade)',
  site_fraco: 'Site vazio ou estacionado (oportunidade)',
  site_ok: 'Site no ar',
  sem_dominio_proprio: 'Usa e-mail genérico (sem domínio próprio)',
  dominio_compartilhado: 'E-mail de terceiro (ex.: contador)',
  inconclusivo: 'Verificação inconclusiva (o site não respondeu ou bloqueou a consulta)',
}
const SITUACAO: Record<string, string> = { '01': 'Nula', '02': 'Ativa', '03': 'Suspensa', '04': 'Inapta', '08': 'Baixada' }

// Ficha 360° (upgrade v3): as seções que já existiam continuam as mesmas, só organizadas em
// abas em vez de uma lista vertical longa.
const TABS: TabDef[] = [
  { id: 'visao', label: 'Visão geral', icon: Building2 },
  { id: 'twin', label: 'Digital Twin', icon: Building2 },
  { id: 'monitoramento', label: 'Radar e comparáveis', icon: Radar },
  { id: 'digital', label: 'DNA Digital', icon: Radar },
  { id: 'crm', label: 'CRM e tarefas', icon: KanbanSquare },
  { id: 'propostas', label: 'Propostas', icon: FileText },
  { id: 'historico', label: 'Histórico', icon: History },
]

export function LeadDrawer({ leadId, onClose, onChanged }: { leadId: string | null; onClose: () => void; onChanged?: () => void }) {
  const { profile, hasRole } = useAuth()
  const canEdit = hasRole('admin', 'gestor', 'comercial')
  const [tab, setTab] = useState('visao')
  const [lead, setLead] = useState<LeadDetail | null>(null)
  const [extra, setExtra] = useState<LeadExtra | null>(null)
  const [recs, setRecs] = useState<Recommendation[]>([])
  const [events, setEvents] = useState<LeadEvent[]>([])
  const [people, setPeople] = useState<Record<string, string>>({})
  const [owners, setOwners] = useState<Pick<Profile, 'id' | 'full_name' | 'email'>[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [suppressed, setSuppressed] = useState(false)
  const [diagnosis, setDiagnosis] = useState<Assistant | null>(null)
  const [openOpp, setOpenOpp] = useState<string | null>(null)
  const [contactKind, setContactKind] = useState<'contato' | 'resposta_recebida'>('contato')

  const [note, setNote] = useState('')
  const [channel, setChannel] = useState('telefone')
  const [contact, setContact] = useState('')
  const [website, setWebsite] = useState('')
  const [blockReason, setBlockReason] = useState('')

  const load = useCallback(async () => {
    if (!leadId) return
    setError(null)
    const [l, x, r, e, p, d] = await Promise.all([
      supabase.from('lead_list_v').select('*').eq('id', leadId).single(),
      supabase.from('leads').select('score_breakdown,digital_presence,lost_reason,converted_at').eq('id', leadId).single(),
      supabase.from('lead_recommendations').select('relevance,reason,service_catalog(name)').eq('lead_id', leadId).order('relevance', { ascending: false }),
      supabase.from('lead_events').select('*').eq('lead_id', leadId).order('created_at', { ascending: false }).limit(200),
      supabase.from('profiles').select('id,full_name,email').eq('active', true).order('full_name'),
      supabase.rpc('sales_assistant', { p_lead_id: leadId }),
    ])
    const err = l.error ?? x.error ?? r.error ?? e.error
    if (err) setError(err.message)
    const detail = l.data as LeadDetail | null
    setLead(detail)
    setExtra(x.data as LeadExtra | null)
    setDiagnosis((d.data as Assistant | null) ?? null)
    setRecs((r.data as unknown as Recommendation[]) ?? [])
    setEvents((e.data as LeadEvent[]) ?? [])
    setOwners(p.data ?? [])
    setPeople(Object.fromEntries((p.data ?? []).map((u) => [u.id, u.full_name ?? u.email])))
    setWebsite(detail?.website ?? '')
    if (detail) {
      const s = await supabase.from('contact_suppressions').select('id').eq('cnpj_basico', detail.cnpj_basico).maybeSingle()
      // Falha ao verificar oposição não pode liberar ações externas por engano.
      setSuppressed(!!s.data || !!s.error)
      if (s.error) setError(s.error.message)
    }
  }, [leadId])

  useEffect(() => {
    setLead(null); setTab('visao'); setOpenOpp(null)
    setNote(''); setContact(''); setBlockReason(''); setSuppressed(true)
    load()
  }, [load])

  if (!leadId) return null

  async function run(fn: () => PromiseLike<{ error: { message: string } | null }>) {
    setBusy(true)
    setError(null)
    const { error } = await fn()
    setBusy(false)
    if (error) { setError(error.message); return false }
    await load()
    onChanged?.()
    return true
  }

  const updateLead = (patch: Record<string, unknown>) => run(() => supabase.from('leads').update(patch).eq('id', leadId))

  async function addEvent(e: FormEvent, type: 'anotacao' | 'contato' | 'resposta_recebida') {
    e.preventDefault()
    const content = type === 'anotacao' ? note.trim() : contact.trim()
    if (!content) return
    const ok = await run(() => supabase.from('lead_events').insert({
      lead_id: leadId, event_type: type, content, channel: type === 'anotacao' ? null : channel, actor_id: profile!.id,
    }))
    if (ok) { setNote(''); setContact('') }
  }

  async function block(e: FormEvent) {
    e.preventDefault()
    if (!lead || !blockReason.trim()) return
    const ok = await run(() => supabase.from('contact_suppressions').insert({
      cnpj_basico: lead.cnpj_basico, reason: blockReason.trim(), origin: 'pedido_titular', created_by: profile!.id,
    }))
    if (ok) setBlockReason('')
  }

  const phone = lead?.telefone1 ? `(${lead.ddd1 ?? ''}) ${lead.telefone1}` : null
  const waNumber = lead?.telefone1 ? `55${lead.ddd1 ?? ''}${lead.telefone1}`.replace(/\D/g, '') : null

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-2xl flex-col overflow-y-auto bg-background shadow-2xl">
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b bg-card p-5">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold">{lead ? lead.nome_fantasia || lead.razao_social || '—' : 'Carregando…'}</h2>
            {lead && (
              <p className="text-sm text-muted-foreground">
                {formatCnpj(lead.cnpj)} · {lead.razao_social}
              </p>
            )}
            {lead && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Badge variant={lead.priority === 'alta' ? 'success' : lead.priority === 'media' ? 'warning' : 'outline'}>
                  {lead.score} pts · prioridade {lead.priority === 'media' ? 'média' : lead.priority}
                </Badge>
                <Badge variant="secondary">{STAGE_LABEL[lead.stage]}</Badge>
                <Badge variant={lead.situacao_cadastral === '02' ? 'success' : 'danger'}>
                  Situação: {SITUACAO[lead.situacao_cadastral] ?? lead.situacao_cadastral}
                </Badge>
                {suppressed && <Badge variant="danger">Bloqueado para contato</Badge>}
              </div>
            )}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fechar"><X className="h-5 w-5" /></Button>
        </header>

        {!lead ? (
          error ? <div className="p-5"><Alert tone="error">{error}</Alert><Button variant="outline" className="mt-3" onClick={load}>Tentar novamente</Button></div>
            : <div role="status" aria-label="Carregando empresa" className="flex flex-1 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : (
          <>
            <TabList tabs={TABS} active={tab} onChange={setTab} />
            <div className="space-y-6 p-5">
              {error && <Alert tone="error">{error}</Alert>}

              <TabPanel active={tab} id="visao">
                <div className="space-y-6">
                  <Section title="Dados cadastrais">
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                      <Item k="Abertura" v={formatDate(lead.data_inicio_atividade)} />
                      <Item k="Local" v={`${lead.municipio ?? '—'} / ${lead.uf ?? '—'}`} />
                      <Item k="CNAE principal" v={`${lead.cnae_principal ?? ''} ${lead.cnae_descricao ?? ''}`} wide />
                      <Item k="Porte" v={PORTE_LABEL[lead.porte ?? ''] ?? '—'} />
                      <Item k="Capital social" v={lead.capital_social != null ? brl.format(lead.capital_social) : '—'} />
                      <Item k="Simples / MEI" v={`${lead.opcao_simples ? 'Simples' : 'Não optante'}${lead.opcao_mei ? ' · MEI' : ''}`} />
                      <Item k="CNAEs secundários" v={lead.cnaes_secundarios?.length ? lead.cnaes_secundarios.join(', ') : '—'} />
                      <Item k="Telefone" v={phone ?? 'não informado'} />
                      <Item k="E-mail" v={lead.email ?? 'não informado'} />
                      <Item k="Presença digital" v={DIGITAL[extra?.digital_presence?.status ?? ''] ?? 'ainda não verificada'} />
                      <Item k="Site" v={lead.website ?? '—'} />
                    </dl>
                    <p className="mt-3 text-xs text-muted-foreground">
                      Situação cadastral ativa não comprova regularidade fiscal. Dados da base pública do CNPJ (Receita Federal).
                    </p>
                    {!suppressed && (phone || lead.email) && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {phone && <a href={`tel:+${waNumber}`}><Button variant="outline" size="sm"><PhoneCall className="h-4 w-4" /> Ligar</Button></a>}
                        {waNumber && <a href={`https://wa.me/${waNumber}`} target="_blank" rel="noreferrer"><Button variant="outline" size="sm">Abrir WhatsApp</Button></a>}
                        {lead.email && <a href={`mailto:${lead.email}`}><Button variant="outline" size="sm">Enviar e-mail</Button></a>}
                      </div>
                    )}
                  </Section>

                  <Section title="Pontuação e recomendações">
                    <div className="grid gap-4 md:grid-cols-2">
                      <ul className="space-y-1 text-sm">
                        {Object.entries(extra?.score_breakdown ?? {}).map(([k, v]) => (
                          <li key={k} className="flex justify-between"><span className="text-muted-foreground">{SCORE_LABEL[k] ?? k}</span><span className="tabular-nums">{v}</span></li>
                        ))}
                        {!Object.keys(extra?.score_breakdown ?? {}).length && <li className="text-muted-foreground">Pontuação ainda não calculada.</li>}
                      </ul>
                      <ul className="space-y-2 text-sm">
                        {recs.map((r, i) => (
                          <li key={i}>
                            <span className="font-medium">{r.service_catalog?.name}</span>
                            <span className="ml-1 text-xs text-muted-foreground">({r.relevance})</span>
                            {r.reason && <p className="text-xs text-muted-foreground">{r.reason}</p>}
                          </li>
                        ))}
                        {!recs.length && <li className="text-muted-foreground">Nenhuma recomendação para este perfil.</li>}
                      </ul>
                    </div>
                  </Section>

                  <Section title="Assistente comercial: diagnóstico e próxima ação">
                    <AssistantSection a={diagnosis} />
                  </Section>
                </div>
              </TabPanel>

              <TabPanel active={tab} id="twin">
                <BusinessDigitalTwin leadId={leadId} />
              </TabPanel>

              <TabPanel active={tab} id="monitoramento">{tab==='monitoramento'&&<CompanyMonitoring key={leadId} leadId={leadId} />}</TabPanel>

              <TabPanel active={tab} id="digital">
                <Section title="Presença digital">
                  <ChannelsSection leadId={leadId} canEdit={canEdit} canReset={hasRole('admin', 'gestor')} />
                </Section>
              </TabPanel>

              <TabPanel active={tab} id="crm">
                <div className="space-y-6">
                  <Section title="Oportunidades (funil)">
                    <OpportunitiesSection leadId={leadId} canEdit={canEdit} suppressed={suppressed} userId={profile!.id} owners={owners}
                      onChanged={() => { load(); onChanged?.() }} onOpenOpp={setOpenOpp} />
                  </Section>

                  <Section title="Agenda e tarefas">
                    <TasksSection leadId={leadId} opportunityId={openOpp} canEdit={canEdit} suppressed={suppressed} userId={profile!.id}
                      owners={owners} onChanged={() => { load(); onChanged?.() }} />
                  </Section>

                  <Section title="Tags e segmentos">
                    <TagsSection leadId={leadId} canEdit={canEdit} userId={profile!.id} />
                  </Section>

                  {canEdit && (
                    <Section title="Gestão comercial">
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="space-y-1">
                          <Label>Responsável pela empresa</Label>
                          <Select value={lead.owner_id ?? ''} disabled={busy} onChange={(e) => updateLead({ owner_id: e.target.value || null })}>
                            <option value="">Sem responsável</option>
                            {owners.map((o) => <option key={o.id} value={o.id}>{o.full_name ?? o.email}</option>)}
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label>Site da empresa</Label>
                          <div className="flex gap-2">
                            <Input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" />
                            <Button variant="outline" disabled={busy} onClick={() => updateLead({ website: website.trim() || null })}>Salvar</Button>
                          </div>
                        </div>
                      </div>

                      <form onSubmit={(e) => addEvent(e, contactKind)} className="mt-4 grid gap-2 md:grid-cols-[11rem_9rem_1fr_auto]">
                        <Select value={contactKind} onChange={(e) => setContactKind(e.target.value as 'contato' | 'resposta_recebida')} aria-label="Tipo">
                          <option value="contato">Contato feito</option>
                          <option value="resposta_recebida">Resposta recebida</option>
                        </Select>
                        <Select value={channel} onChange={(e) => setChannel(e.target.value)} aria-label="Canal">
                          <option value="telefone">Telefone</option>
                          <option value="whatsapp">WhatsApp</option>
                          <option value="email">E-mail</option>
                          <option value="presencial">Presencial</option>
                          <option value="outro">Outro</option>
                        </Select>
                        <Input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Resumo do contato" />
                        <Button type="submit" disabled={busy || suppressed || !contact.trim()}><PhoneCall className="h-4 w-4" /> Registrar</Button>
                      </form>
                      <form onSubmit={(e) => addEvent(e, 'anotacao')} className="mt-2 flex gap-2">
                        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Nova anotação" />
                        <Button type="submit" variant="outline" disabled={busy || !note.trim()}><MessageSquarePlus className="h-4 w-4" /> Anotar</Button>
                      </form>

                      {!suppressed && (
                        <form onSubmit={block} className="mt-4 flex gap-2 border-t pt-4">
                          <Input value={blockReason} onChange={(e) => setBlockReason(e.target.value)} placeholder="Motivo do bloqueio (ex.: pediu para não ser contatado)" />
                          <Button type="submit" variant="destructive" disabled={busy || !blockReason.trim()}><Ban className="h-4 w-4" /> Bloquear</Button>
                        </form>
                      )}
                    </Section>
                  )}
                </div>
              </TabPanel>

              <TabPanel active={tab} id="propostas">
                <div className="space-y-6">
                  <Section title="Abordagem sugerida">
                    <ApproachSection lead={lead} diagnosis={diagnosis as unknown as Diagnosis} dominio={extra?.digital_presence?.dominio ?? null}
                      suppressed={suppressed} canEdit={canEdit} userName={profile?.full_name ?? null} userId={profile!.id}
                      leadId={leadId} onChanged={() => { load(); onChanged?.() }} />
                  </Section>

                  <Section title="Propostas e negociação">
                    <ProposalsSection leadId={leadId} opportunityId={openOpp} canEdit={canEdit} userId={profile!.id} onChanged={() => { load(); onChanged?.() }} />
                  </Section>

                  <Section title="Contratos e pós-venda">
                    <ContractsSection leadId={leadId} opportunityId={openOpp} canEdit={canEdit} userId={profile!.id} onChanged={() => { load(); onChanged?.() }} />
                  </Section>
                </div>
              </TabPanel>

              <TabPanel active={tab} id="historico">
                <Section title="Histórico">
                  <ol className="space-y-3 border-l pl-4">
                    {events.map((ev) => (
                      <li key={ev.id} className="relative text-sm">
                        <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-primary" />
                        <p>
                          <span className="font-medium">{EVENT_LABEL[ev.event_type] ?? ev.event_type}</span>
                          {ev.event_type === 'mudanca_etapa' && ev.from_stage && ev.to_stage && (
                            <span className="text-muted-foreground"> · {STAGE_LABEL[ev.from_stage]} → {STAGE_LABEL[ev.to_stage]}</span>
                          )}
                          {ev.channel && <span className="text-muted-foreground"> · {ev.channel}</span>}
                          {ev.scheduled_for && <span className="text-muted-foreground"> · {formatDateTime(ev.scheduled_for)}</span>}
                        </p>
                        {ev.content && <p className="whitespace-pre-wrap">{ev.content}</p>}
                        <p className="text-xs text-muted-foreground">
                          {formatDateTime(ev.created_at)} · {ev.actor_id ? people[ev.actor_id] ?? 'usuário' : 'sistema'}
                        </p>
                      </li>
                    ))}
                    {!events.length && <li className="text-sm text-muted-foreground">Sem eventos registrados ainda.</li>}
                  </ol>
                </Section>
              </TabPanel>
            </div>
          </>
        )}
      </aside>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      {children}
    </section>
  )
}

function Item({ k, v, wide }: { k: string; v: string; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-2' : ''}>
      <dt className="text-xs text-muted-foreground">{k}</dt>
      <dd className="break-words">{v}</dd>
    </div>
  )
}
