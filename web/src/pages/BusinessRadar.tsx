import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCachedQuery } from '@/lib/cache'
import { useOpenLead } from '@/lib/crm'
import { formatDateTime } from '@/lib/utils'
import { PageHeader } from '@/components/layout/AppLayout'
import { DataStatus } from '@/components/DataStatus'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { RowsSkeleton } from '@/components/ui/skeleton'
interface Event { event_id: string; lead_id: string; empresa: string; category: string; change_type: string; detected_at: string; description: string; source: string | null; evidence: unknown; previous: unknown; current_data: unknown; confidence: number | null }
const PAGE=30
export default function BusinessRadar() {
 const openLead=useOpenLead()
 const [category,setCategory]=useState('')
 const [page,setPage]=useState(0)
 const [watched,setWatched]=useState(false)
 const [ids,setIds]=useState<string[]>([])
 const [watchError,setWatchError]=useState<string|null>(null)
 useEffect(()=>{ supabase.from('company_watchlist').select('lead_id').then(({data,error})=>{ setIds((data??[]).map(x=>x.lead_id)); setWatchError(error?.message??null) }) },[])
 const key=JSON.stringify([category,page,watched,ids])
 const q=useCachedQuery<{items:Event[];count:number}>(`radar:${key}`,async()=>{
  let query=supabase.from('business_radar_v').select('*',{count:'exact'})
  if(category) query=query.eq('category',category)
  if(watched) query=query.in('lead_id',ids.length?ids:['00000000-0000-0000-0000-000000000000'])
  const {data,error,count}=await query.order('detected_at',{ascending:false}).order('event_id').range(page*PAGE,(page+1)*PAGE-1)
  return {data:error?null:{items:(data??[]) as Event[],count:count??0},error:error?.message??null}
 },[key])
 return <>
  <PageHeader title="Radar empresarial" description="Mudanças registradas por importação e pesquisa digital. Eventos não comprovam intenção de compra."
   actions={<Button variant="outline" onClick={q.reload} disabled={q.loading}>Atualizar</Button>} />
  <div className="flex flex-wrap items-center gap-3 mb-4"><Select aria-label="Tipo de mudança" className="w-52" value={category} onChange={e=>{setCategory(e.target.value);setPage(0)}}><option value="">Todas as mudanças</option><option value="digital">Canais digitais</option><option value="cadastral">Cadastro empresarial</option></Select>
   <label className="text-sm flex gap-2"><input type="checkbox" checked={watched} onChange={e=>{setWatched(e.target.checked);setPage(0)}} />Somente watchlist visível</label>
  </div>
  <DataStatus loading={q.loading} error={q.error??(watched?watchError:null)} savedAt={q.savedAt} hasData={!!q.data} />
  <p className="mb-4 text-xs text-muted-foreground">O histórico digital começa com a ativação do rastreamento; não há eventos retroativos inventados. Alteração no estado da pesquisa não significa mudança real do site. Cadastros usam a competência informada pela fonte.</p>
  {q.loading&&!q.data?<RowsSkeleton rows={5}/>:q.data&&<div className="space-y-3">{!q.data.items.length&&<p className="text-sm text-muted-foreground">Nenhuma mudança registrada com estes filtros.</p>}{q.data.items.map(e=><Card key={e.event_id}><CardContent className="pt-4 space-y-2"><div className="flex flex-wrap gap-2 items-center"><button className="font-semibold text-sm hover:underline" onClick={()=>openLead(e.lead_id)}>{e.empresa}</button><Badge variant="outline">{e.category} · {e.change_type}</Badge><span className="text-xs text-muted-foreground">{formatDateTime(e.detected_at)}</span></div><p className="text-sm">{e.description}</p><p className="text-xs text-muted-foreground">Fonte: {e.source??'não informada'} · confiança {e.confidence??'não aferida'}</p><details className="text-xs"><summary className="cursor-pointer">Evidências e comparação</summary><pre className="mt-2 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-3">{JSON.stringify({anterior:e.previous,atual:e.current_data,evidencia:e.evidence},null,2)}</pre></details></CardContent></Card>)}</div>}
  <div className="flex justify-end items-center gap-3 mt-4"><Button variant="outline" disabled={page===0||q.loading} onClick={()=>setPage(page-1)}>Anterior</Button><span className="text-xs">Página {page+1} · {q.data?.count??'—'} eventos</span><Button variant="outline" disabled={q.loading||!q.data||(page+1)*PAGE>=q.data.count} onClick={()=>setPage(page+1)}>Próxima</Button></div>
 </>
}
