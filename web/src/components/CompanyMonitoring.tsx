import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { useOpenLead, CHANNEL_STATUS } from '@/lib/crm'
import { formatDateTime } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { RowsSkeleton } from '@/components/ui/skeleton'

interface Comparable { id: string; empresa: string; cnpj: string; site_status: string | null; website_score: number | null; confidence: number | null; last_checked_at: string | null; reason: string }
interface Watch { id: string; interval_days: number; paused: boolean; last_requested_at: string | null }
export function CompanyMonitoring({ leadId }: { leadId: string }) {
  const { profile, hasRole } = useAuth()
  const openLead = useOpenLead()
  const [watch, setWatch] = useState<Watch | null>(null)
  const [days, setDays] = useState(30)
  const [comparables, setComparables] = useState<Comparable[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [methodology, setMethodology] = useState('')
  const load = useCallback(async () => {
    setBusy(true); setError(null)
    try {
      const [w,c] = await Promise.all([
        supabase.from('company_watchlist').select('id,interval_days,paused,last_requested_at').eq('lead_id', leadId).eq('owner_id', profile!.id).maybeSingle(),
        supabase.rpc('company_comparables', { p_lead_id: leadId }),
      ])
      if (w.error || c.error) throw new Error((w.error ?? c.error)!.message)
      const row = w.data as Watch | null; setWatch(row); setDays(row?.interval_days ?? 30)
      setComparables(c.data?.items ?? []); setMethodology(c.data?.methodology ?? '')
    } catch(e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }, [leadId,profile?.id])
  useEffect(() => { load() },[load])
  async function change(enabled: boolean,paused=false) {
    setBusy(true); setError(null)
    try {
      const { error } = await supabase.rpc('set_company_watch', { p_lead_id: leadId, p_enabled: enabled, p_interval_days: days, p_paused: paused })
      if (error) throw new Error(error.message)
      await load()
    } catch(e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  return <div className="space-y-4">
    {error && <Alert tone="error">{error}</Alert>}
    <section className="rounded-lg border p-4 space-y-3"><h3 className="font-semibold text-sm">Monitoramento desta empresa</h3>
      <p className="text-xs text-muted-foreground">A watchlist agenda a fila real de pesquisa. Chaves ausentes não são substituídas por resultados fictícios. Oposição ao contato e pausa global são respeitadas.</p>
      <p className="text-sm">{watch ? watch.paused ? 'Monitoramento pausado' : 'Monitoramento ativo' : 'Você ainda não acompanha esta empresa'} · última solicitação {formatDateTime(watch?.last_requested_at)}</p>
      {hasRole('admin','gestor','comercial') && <div className="flex flex-wrap gap-2 items-center"><label className="text-xs">Intervalo em dias<Input aria-label="Intervalo de monitoramento" className="w-24" type="number" min={1} max={365} value={days} onChange={(e)=>setDays(Number(e.target.value))} /></label>
        <Button disabled={busy || days<1 || days>365} onClick={()=>change(true)}>Salvar monitoramento</Button>
        {watch && <><Button disabled={busy} variant="outline" onClick={()=>change(true,!watch.paused)}>{watch.paused ? 'Retomar' : 'Pausar'}</Button><Button disabled={busy} variant="ghost" onClick={()=>change(false)}>Deixar de acompanhar</Button></>}
      </div>}
    </section>
    <section className="rounded-lg border p-4 space-y-3"><h3 className="font-semibold text-sm">Empresas comparáveis (até 20)</h3>
      <p className="text-xs text-muted-foreground">{methodology}</p>
      {busy ? <RowsSkeleton rows={3} /> : !comparables.length ? <p className="text-sm text-muted-foreground">Nenhuma empresa comparável localizada na cobertura atual da base.</p> : comparables.map(c=><button key={c.id} onClick={()=>openLead(c.id)} className="w-full rounded border p-3 text-left text-sm hover:bg-accent">
        <strong>{c.empresa}</strong><div className="flex gap-2 mt-1"><Badge variant="outline">{CHANNEL_STATUS[c.site_status ?? 'pendente']?.label ?? c.site_status}</Badge><span>Nota técnica: {c.website_score ?? 'não aferida'}</span></div>
        <p className="text-xs text-muted-foreground">{c.reason} · pesquisa {formatDateTime(c.last_checked_at)} · confiança {c.confidence ?? 'não aferida'}</p>
      </button>)}
    </section>
  </div>
}
