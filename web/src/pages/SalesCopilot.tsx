import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { useOpenLead } from '@/lib/crm'
import { PageHeader } from '@/components/layout/AppLayout'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { Card,CardContent } from '@/components/ui/card'
const QUERIES=[['priorities','Quais empresas devo priorizar?'],['followups','Quais atividades estão pendentes?'],['site_gaps','Quais empresas têm site não localizado em pesquisa?'],['changes','Quais empresas mudaram recentemente?'],['proposals','Quais propostas estão em aberto?'],['unassigned','Quais oportunidades estão sem responsável?']] as const
interface Result {intent:string;data:{records?:Record<string,unknown>[];methodology?:string;[key:string]:unknown};updated_at:string;mode:string;note:string}
export default function SalesCopilot(){
 const {hasRole}=useAuth();const openLead=useOpenLead();const [data,setData]=useState<Result|null>(null),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false)
 async function ask(intent:string){setBusy(true);setError(null);setData(null);try{const r=await supabase.rpc('sales_copilot_query',{p_intent:intent});if(r.error)throw new Error(r.error.message);setData(r.data)}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}}
 return <><PageHeader title="Assistente comercial" description="Consultas guiadas por ferramentas autorizadas. Modo determinístico, sem modelo externo ou SQL gerado."/>
 <div className="flex flex-wrap gap-2 mb-4">{QUERIES.filter(([key])=>key!=='unassigned'||hasRole('admin','gestor')).map(([key,label])=><Button key={key} variant="outline" disabled={busy} onClick={()=>ask(key)}>{label}</Button>)}</div>
 {error&&<Alert tone="error">{error}</Alert>}{busy&&<p role="status" className="text-sm text-muted-foreground">Consultando registros autorizados…</p>}
 {data&&<Card><CardContent className="pt-4 space-y-3"><p className="text-xs text-muted-foreground">{data.note}</p>{data.data.methodology&&<p className="text-sm">{data.data.methodology}</p>}
 {data.data.records?data.data.records.length?data.data.records.map((r,i)=><article className="rounded border p-3 text-sm" key={String(r.lead_id??i)}>{typeof r.lead_id==='string'&&<Button size="sm" variant="outline" onClick={()=>openLead(r.lead_id as string)}>Abrir empresa</Button>}<pre className="mt-2 whitespace-pre-wrap break-all text-xs">{JSON.stringify(r,null,2)}</pre></article>):<p className="text-sm text-muted-foreground">Nenhum registro atende esta consulta na cobertura atual.</p>:<pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify(data.data,null,2)}</pre>}
 </CardContent></Card>}
 </>
}
