// Diagnóstico comercial, propostas e abordagem sugerida de um lead.
// Toda mensagem é enviada manualmente pelo usuário, uma a uma (sem disparo em massa).
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Copy, FileText, Lightbulb, Mail, MessageCircle, Send } from 'lucide-react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { brl, formatDate, formatDateTime } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Alert } from '@/components/ui/alert'

export interface Diagnosis {
  empresa: string | null
  atividade: string | null
  local: string | null
  pontuacao: number
  prioridade: string
  oportunidades: { tipo: string; servico: string; oportunidade: string; evidencia: string; recomendacao: string; relevancia?: number }[]
  ressalvas: string[]
  data_referencia: string
}

export function DiagnosisSection({ diagnosis }: { diagnosis: Diagnosis | null }) {
  if (!diagnosis) return <p className="text-sm text-muted-foreground">Diagnóstico indisponível.</p>
  return (
    <div className="space-y-3 text-sm">
      {diagnosis.oportunidades.length === 0 && (
        <p className="text-muted-foreground">Nenhuma oportunidade comprovada pelos dados disponíveis.</p>
      )}
      {diagnosis.oportunidades.map((o, i) => (
        <div key={i} className="rounded-md border p-3">
          <p className="font-medium"><Lightbulb className="mr-1 inline h-4 w-4 text-primary" />{o.oportunidade}</p>
          <p className="mt-1"><span className="text-muted-foreground">Recomendação: </span>{o.recomendacao}</p>
          <p className="mt-1 text-xs text-muted-foreground">Motivo: {o.evidencia}</p>
        </div>
      ))}
      {diagnosis.ressalvas.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          {diagnosis.ressalvas.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ propostas
interface Proposal {
  id: string
  title: string
  amount: number | null
  status: string
  sent_at: string | null
  valid_until: string | null
  decided_at: string | null
  notes: string | null
  created_at: string
}
const PROPOSAL_STATUS: Record<string, string> = {
  rascunho: 'Rascunho', enviada: 'Enviada', em_negociacao: 'Em negociação',
  aceita: 'Aceita', recusada: 'Recusada', expirada: 'Expirada',
}

export function ProposalsSection({ leadId, opportunityId, canEdit, userId, onChanged }: {
  leadId: string; opportunityId?: string | null; canEdit: boolean; userId: string; onChanged: () => void
}) {
  const [items, setItems] = useState<Proposal[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')
  const [status, setStatus] = useState('rascunho')
  const [validUntil, setValidUntil] = useState('')
  const [notes, setNotes] = useState('')
  const [scope, setScope] = useState('')
  const [paymentTerms, setPaymentTerms] = useState('')
  const [deliveryTerms, setDeliveryTerms] = useState('')

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('lead_proposals').select('*').eq('lead_id', leadId).order('created_at', { ascending: false })
    if (error) setError(error.message)
    setItems((data as Proposal[]) ?? [])
  }, [leadId])
  useEffect(() => { load() }, [load])

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    const value = amount.trim() ? Number(amount.replace(/\./g, '').replace(',', '.')) : null
    if (value !== null && (Number.isNaN(value) || value < 0)) { setError('Valor inválido.'); return }
    setBusy(true); setError(null)
    const { error } = await supabase.from('lead_proposals').insert({
      lead_id: leadId, opportunity_id: opportunityId ?? null, title: title.trim(), amount: value, status, valid_until: validUntil || null,
      notes: notes.trim() || null, scope: scope.trim() || null,
      payment_terms: paymentTerms.trim() || null, delivery_terms: deliveryTerms.trim() || null, created_by: userId,
    })
    setBusy(false)
    if (error) { setError(error.message); return }
    setTitle(''); setAmount(''); setNotes(''); setValidUntil(''); setScope(''); setPaymentTerms(''); setDeliveryTerms('')
    await load(); onChanged()
  }

  async function changeStatus(id: string, next: string) {
    setBusy(true); setError(null)
    const { error } = await supabase.from('lead_proposals').update({ status: next }).eq('id', id)
    setBusy(false)
    if (error) { setError(error.message); return }
    await load(); onChanged()
  }

  return (
    <div className="space-y-3 text-sm">
      {error && <Alert tone="error">{error}</Alert>}
      {items.length === 0 && <p className="text-muted-foreground">Nenhuma proposta registrada.</p>}
      {items.map((p) => (
        <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
          <div className="min-w-0">
            <p className="font-medium"><FileText className="mr-1 inline h-4 w-4" />{p.title}</p>
            <p className="text-xs text-muted-foreground">
              {p.amount != null ? brl.format(p.amount) : 'sem valor'}
              {p.sent_at && ` · enviada em ${formatDateTime(p.sent_at)}`}
              {p.valid_until && ` · válida até ${formatDate(p.valid_until)}`}
              {p.decided_at && ` · decidida em ${formatDateTime(p.decided_at)}`}
            </p>
            {p.notes && <p className="mt-1 whitespace-pre-wrap text-xs">{p.notes}</p>}
            <Link className="mt-2 inline-block text-xs text-primary underline" to={`/propostas/${p.id}/documento`} target="_blank" rel="noopener">Abrir documento / PDF</Link>
          </div>
          {canEdit ? (
            <Select value={p.status} disabled={busy} onChange={(e) => changeStatus(p.id, e.target.value)} className="w-40" aria-label="Situação da proposta">
              {Object.entries(PROPOSAL_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          ) : <Badge variant="secondary">{PROPOSAL_STATUS[p.status] ?? p.status}</Badge>}
        </div>
      ))}
      {canEdit && (
        <form onSubmit={save} className="grid gap-2 border-t pt-3 md:grid-cols-2">
          <div className="space-y-1 md:col-span-2"><Label>Nova proposta</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Site institucional + identidade visual" /></div>
          <div className="space-y-1"><Label>Valor (R$)</Label>
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="2.500,00" /></div>
          <div className="space-y-1"><Label>Situação</Label>
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              {Object.entries(PROPOSAL_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select></div>
          <div className="space-y-1"><Label>Válida até</Label>
            <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></div>
          <div className="space-y-1"><Label>Observações</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          <label className="md:col-span-2 text-xs text-muted-foreground">Escopo<textarea className="mt-1 w-full rounded border bg-background p-2 text-sm" value={scope} onChange={e=>setScope(e.target.value)} rows={3}/></label>
          <label className="text-xs text-muted-foreground">Condições de pagamento<Input value={paymentTerms} onChange={e=>setPaymentTerms(e.target.value)}/></label>
          <label className="text-xs text-muted-foreground">Prazo de entrega<Input value={deliveryTerms} onChange={e=>setDeliveryTerms(e.target.value)}/></label>
          <div className="md:col-span-2">
            <Button type="submit" disabled={busy || !title.trim()}><FileText className="h-4 w-4" /> Registrar proposta</Button>
          </div>
        </form>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ abordagem
interface Template {
  id: string; name: string; channel: 'whatsapp' | 'email'; body: string
  service_code: string | null; cnae_prefix: string | null; purpose: string
}

export interface ApproachLead {
  nome_fantasia: string | null; razao_social: string | null; municipio: string | null
  cnae_principal: string | null; cnae_descricao: string | null; email: string | null
  ddd1: string | null; telefone1: string | null
}

const titleCase = (s: string) => s.toLowerCase().replace(/(^|\s|\/)(\p{L})/gu, (_, a, b) => a + b.toUpperCase())

export function fillTemplate(body: string, vars: Record<string, string | null | undefined>) {
  const missing: string[] = []
  const text = body.replace(/\{\{(\w+)\}\}/g, (_, k: string) => {
    const v = vars[k]
    if (!v) { missing.push(k); return `{{${k}}}` }
    return v
  })
  return { text, missing }
}

export function ApproachSection({ lead, diagnosis, dominio, suppressed, canEdit, userName, userId, leadId, onChanged }: {
  lead: ApproachLead; diagnosis: Diagnosis | null; dominio: string | null; suppressed: boolean; canEdit: boolean
  userName: string | null; userId: string; leadId: string; onChanged: () => void
}) {
  const [templates, setTemplates] = useState<Template[]>([])
  const [selected, setSelected] = useState('')
  const [text, setText] = useState('')
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    supabase.from('message_templates').select('id,name,channel,body,service_code,cnae_prefix,purpose')
      .eq('active', true).in('purpose', ['abordagem', 'follow_up']).order('name')
      .then(({ data }) => setTemplates((data as Template[]) ?? []))
  }, [])

  // Só oferece o que o diagnóstico sustenta: o modelo de "site" exige ausência VERIFICADA
  const options = useMemo(() => {
    const services = new Set((diagnosis?.oportunidades ?? []).map((o) => o.servico))
    const hasSite = (diagnosis?.oportunidades ?? []).some((o) => o.tipo === 'site')
    const cnae = lead.cnae_principal ?? ''
    return templates
      .filter((t) => (t.service_code === 'site_institucional' ? hasSite : !t.service_code || services.has(t.service_code)))
      .filter((t) => !t.cnae_prefix || cnae.startsWith(t.cnae_prefix))
      .filter((t) => t.channel === 'email' ? !!lead.email : !!lead.telefone1)
      .sort((a, b) => Number(!!b.cnae_prefix) - Number(!!a.cnae_prefix) || Number(b.service_code === 'site_institucional') - Number(a.service_code === 'site_institucional'))
  }, [templates, diagnosis, lead])

  const vars = useMemo(() => ({
    responsavel: userName,
    empresa: titleCase(lead.nome_fantasia || lead.razao_social || ''),
    cidade: lead.municipio ? titleCase(lead.municipio) : null,
    dominio,
    atividade: lead.cnae_descricao?.toLowerCase() ?? null,
    atividade_curta: lead.cnae_descricao ? 'empresas de ' + lead.cnae_descricao.split(/[,(;-]/)[0].trim().toLowerCase() : null,
    oportunidade: diagnosis?.oportunidades[0]?.recomendacao ?? null,
  }), [lead, dominio, diagnosis, userName])

  const tpl = options.find((t) => t.id === selected) ?? options[0]
  useEffect(() => {
    if (tpl) { setSelected(tpl.id); setText(fillTemplate(tpl.body, vars).text) }
  }, [tpl?.id, vars]) // eslint-disable-line react-hooks/exhaustive-deps

  if (suppressed) return <p className="text-sm text-muted-foreground">Empresa bloqueada para contato: nenhuma abordagem é sugerida.</p>
  if (!options.length) return <p className="text-sm text-muted-foreground">Sem modelo compatível com os dados de contato e o diagnóstico deste lead.</p>

  const missing = [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1])
  const phone = lead.telefone1 ? `55${lead.ddd1 ?? ''}${lead.telefone1}`.replace(/\D/g, '') : null

  async function registerSent() {
    const { error } = await supabase.from('lead_events').insert({
      lead_id: leadId, event_type: 'contato', channel: tpl!.channel, actor_id: userId,
      content: `Abordagem enviada (${tpl!.name}):\n${text}`,
    })
    setMsg(error ? error.message : 'Contato registrado no histórico.')
    if (!error) onChanged()
  }

  return (
    <div className="space-y-2 text-sm">
      <Select value={tpl?.id} onChange={(e) => setSelected(e.target.value)} aria-label="Modelo de abordagem">
        {options.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </Select>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={7}
        className="w-full rounded-md border bg-background p-2 text-sm" aria-label="Mensagem" />
      {missing.length > 0 && (
        <Alert tone="warning">Complete antes de enviar: {missing.join(', ')}{missing.includes('responsavel') && ' (preencha seu nome no perfil)'}.</Alert>
      )}
      <p className="text-xs text-muted-foreground">
        Revise o texto e envie você mesmo, uma mensagem por vez. Se a empresa pedir para não ser contatada, use “Bloquear”.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(text).then(() => setMsg('Mensagem copiada.'))}>
          <Copy className="h-4 w-4" /> Copiar
        </Button>
        {tpl?.channel === 'whatsapp' && phone && (
          <a href={missing.length ? undefined : `https://wa.me/${phone}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">
            <Button variant="outline" size="sm" disabled={missing.length > 0}><MessageCircle className="h-4 w-4" /> Abrir no WhatsApp</Button>
          </a>
        )}
        {tpl?.channel === 'email' && lead.email && (
          <a href={missing.length ? undefined : `mailto:${lead.email}?subject=${encodeURIComponent('JS Designer — ' + (vars.empresa || ''))}&body=${encodeURIComponent(text)}`}>
            <Button variant="outline" size="sm" disabled={missing.length > 0}><Mail className="h-4 w-4" /> Abrir no e-mail</Button>
          </a>
        )}
        {canEdit && (
          <Button size="sm" disabled={missing.length > 0} onClick={registerSent}><Send className="h-4 w-4" /> Registrar como enviada</Button>
        )}
      </div>
      {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
    </div>
  )
}
