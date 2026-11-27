import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { formatDateTime } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { RowsSkeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface Evidence { detalhe?: string; tipo?: string }
interface Dimension {
  id: string; label: string; score: number | null; methodology: string; status: string
  source: string | null; checked_at: string | null; confidence: number | null; evidence: Evidence[] | null; url: string | null
}
interface Channel {
  platform: string; status: string; weight: number; confidence: number; checked_at: string | null
  usable: boolean; opportunity: number | null; evidence: Evidence[]; source: string | null
}
export interface Twin {
  version: { id: number; name: string; max_age_days: number; weights: Record<string, number> }
  scores: { digital_opportunity: number | null; commercial_fit: number | null; data_confidence: number; coverage_percent: number }
  dimensions: Dimension[]; channels: Channel[]
  recommendations: { service_id: string; name: string; relevance: number; reason: string | null }[]
  methodology: Record<string, string>; blocked_for_contact: boolean; calculated_at: string
}
interface Snapshot { id: number; created_at: string; version_id: number; payload: Twin }
const CHANNEL_LABEL: Record<string, string> = { site: 'Site', instagram: 'Instagram', facebook: 'Facebook', google_business: 'Perfil Google', linkedin: 'LinkedIn', whatsapp: 'WhatsApp' }

export function TwinView({ data }: { data: Twin }) {
  const metrics = [
    ['Digital Opportunity Score', data.scores.digital_opportunity],
    ['Commercial Fit Score', data.scores.commercial_fit],
    ['Data Confidence Score', data.scores.data_confidence],
  ] as const
  return <div className="space-y-4">
    {data.blocked_for_contact && <Alert tone="warning">Empresa com oposição ao contato. Os indicadores não autorizam abordagem.</Alert>}
    <div className="grid gap-3 sm:grid-cols-3">
      {metrics.map(([label, value]) => <div key={label} className="rounded-lg border p-3">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold tabular-nums">{value == null ? 'Não aferido' : `${value}/100`}</p>
      </div>)}
    </div>
    <p className="text-xs text-muted-foreground">Cobertura do DOS: {data.scores.coverage_percent}% dos pesos.
      Dados pendentes, inconclusivos ou vencidos não comprovam ausência digital. Nenhum score é probabilidade de compra.</p>
    <p className="text-xs text-muted-foreground">Versão {data.version.id}: {data.version.name} · validade das evidências: {data.version.max_age_days} dias · cálculo {formatDateTime(data.calculated_at)}.</p>
    <div className="grid gap-3 sm:grid-cols-2">
      {data.dimensions.map((d) => <article key={d.id} className="rounded-lg border bg-card p-3">
        <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-medium">{d.label}</h3>
          <Badge variant={d.score == null ? 'outline' : 'secondary'}>{d.score == null ? 'Não aferido' : `${d.score}/100`}</Badge></div>
        {d.score != null && <div role="meter" aria-label={d.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={d.score} className="mt-2 h-1.5 rounded bg-muted"><div className="h-full rounded bg-primary" style={{ width: `${d.score}%` }} /></div>}
        <p className="mt-2 text-xs text-muted-foreground">{d.methodology}</p>
        {d.score != null && <p className="mt-2 text-xs">Fonte: {d.source ?? 'canais abaixo'} · {formatDateTime(d.checked_at)} · confiança {d.confidence ?? '—'}</p>}
        {d.score != null && d.evidence?.map((e, i) => <p key={i} className="mt-1 text-xs">{e.detalhe ?? e.tipo}</p>)}
      </article>)}
    </div>
    <details className="rounded-lg border p-3 text-sm"><summary className="cursor-pointer font-medium">Evidências e cobertura por canal</summary>
      <div className="mt-2 divide-y">{data.channels.map((c) => <div key={c.platform} className="py-2">
        <p>{CHANNEL_LABEL[c.platform] ?? c.platform} · {c.status} · peso {c.weight}%</p>
        <p className="text-xs text-muted-foreground">{c.usable ? 'Evidência conclusiva recente' : 'Não utilizável para conclusão atual'} · {c.source ?? 'sem fonte'} · {formatDateTime(c.checked_at)}</p>
        {c.evidence.map((e, i) => <p key={i} className="text-xs">{e.detalhe ?? e.tipo}</p>)}
      </div>)}</div>
    </details>
    <details className="rounded-lg border p-3 text-sm"><summary className="cursor-pointer font-medium">Metodologia dos três scores</summary>
      {Object.entries(data.methodology).map(([key, text]) => <p className="mt-2 text-xs" key={key}>{text}</p>)}
    </details>
    <section className="rounded-lg border p-3"><h3 className="text-sm font-medium">Serviços existentes recomendados</h3>
      {!data.recommendations.length && <p className="mt-2 text-xs text-muted-foreground">Nenhuma recomendação cadastrada para esta empresa.</p>}
      {data.recommendations.map((r) => <div key={r.service_id} className="mt-2 text-sm"><strong>{r.name}</strong><p className="text-xs text-muted-foreground">Relevância {r.relevance} · {r.reason ?? 'Justificativa não cadastrada'}</p></div>)}
    </section>
  </div>
}

export function BusinessDigitalTwin({ leadId }: { leadId: string }) {
  const { hasRole } = useAuth()
  const [data, setData] = useState<Twin | null>(null)
  const [history, setHistory] = useState<Snapshot[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [name, setName] = useState('')
  const [weights, setWeights] = useState<Record<string, number>>({})
  const [maxAge, setMaxAge] = useState(90)
  const sequence = useRef(0)
  const load = useCallback(async () => {
    const request = ++sequence.current
    setBusy(true); setError(null)
    try {
      const [r, h] = await Promise.all([
        supabase.rpc('company_digital_twin', { p_lead_id: leadId }),
        supabase.from('company_twin_snapshots').select('id,created_at,version_id,payload').eq('lead_id', leadId).order('created_at', { ascending: false }).limit(10),
      ])
      if (request !== sequence.current) return
      if (r.error || h.error) throw new Error((r.error ?? h.error)!.message)
      const twin = r.data as Twin
      setData(twin); setHistory((h.data ?? []) as Snapshot[])
      setWeights(twin.version.weights); setMaxAge(twin.version.max_age_days)
    } catch (e) { if (request === sequence.current) setError(e instanceof Error ? e.message : String(e)) }
    finally { if (request === sequence.current) setBusy(false) }
  }, [leadId])
  useEffect(() => {
    setData(null); setHistory([]); setNotice(''); load()
    return () => { sequence.current++ }
  }, [load])
  async function capture() {
    setBusy(true); setNotice(''); setError(null)
    try {
      const r = await supabase.rpc('capture_company_twin', { p_lead_id: leadId })
      if (r.error) throw new Error(r.error.message)
      setNotice(`Retrato ${r.data} registrado. Dados iguais não duplicam o histórico.`)
      await load()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  async function version(e: React.FormEvent) {
    e.preventDefault()
    if (!window.confirm('Criar nova versão global dos pesos do Twin? Não altera o score legado.')) return
    setBusy(true); setError(null)
    try {
      const r = await supabase.rpc('create_twin_score_version', { p_name: name, p_weights: weights, p_max_age_days: maxAge })
      if (r.error) throw new Error(r.error.message)
      setName(''); setNotice(`Versão ${r.data} criada; retratos anteriores preservados.`); await load()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  return <div className="space-y-4">
    <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={load}>Atualizar evidências</Button>
      {hasRole('admin', 'gestor', 'comercial') && <Button disabled={busy || !data} onClick={capture}>Registrar retrato atual</Button>}</div>
    {error && <Alert tone="error">{error}</Alert>}
    {notice && <Alert>{notice}</Alert>}
    {busy && !data ? <RowsSkeleton rows={5} /> : data && <TwinView data={data} />}
    {data && <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">Histórico de retratos (últimos 10)</summary>
      {!history.length && <p className="mt-2 text-xs text-muted-foreground">Nenhum retrato registrado. A consulta ao Twin não grava automaticamente.</p>}
      {history.map((h) => <p className="mt-2 text-xs" key={h.id}>{formatDateTime(h.created_at)} · versão {h.version_id} · DOS {h.payload.scores.digital_opportunity ?? 'não aferido'} · Fit {h.payload.scores.commercial_fit ?? 'não aferido'} · Confiança {h.payload.scores.data_confidence}</p>)}
    </details>}
    {data && hasRole('admin') && <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">Configurar nova versão de pontuação</summary>
      <form onSubmit={version} className="mt-3 space-y-3"><Label>Nome da versão<Input required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} /></Label>
        <div className="grid grid-cols-2 gap-2">{Object.entries(weights).map(([channel, value]) => <Label key={channel}>{CHANNEL_LABEL[channel] ?? channel}<Input required type="number" min={0} max={100} value={value} onChange={(e) => setWeights({ ...weights, [channel]: Number(e.target.value) })} /></Label>)}</div>
        <Label>Validade da evidência em dias<Input required type="number" min={1} max={365} value={maxAge} onChange={(e) => setMaxAge(Number(e.target.value))} /></Label>
        <p className="text-xs text-muted-foreground">Pesos devem somar 100. Alteração global, versionada, com confirmação humana.</p>
        <Button disabled={busy || Object.values(weights).reduce((a,b) => a+b,0)!==100} type="submit">Criar versão</Button>
      </form>
    </details>}
  </div>
}
