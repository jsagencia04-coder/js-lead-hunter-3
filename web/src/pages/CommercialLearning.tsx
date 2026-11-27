import {useState} from 'react'
import {supabase} from '@/lib/supabase'
import {useCachedQuery} from '@/lib/cache'
import {PageHeader} from '@/components/layout/AppLayout'
import {DataStatus} from '@/components/DataStatus'
import {Input} from '@/components/ui/input'
import {Card,CardContent} from '@/components/ui/card'
import {Table,THead,TBody,TH,TD,TR} from '@/components/ui/table'
import {brl} from '@/lib/utils'
interface Segment {cnae_principal:string;sample:number;decided:number;won:number;lost:number;avg_ticket:number|null;avg_days_to_win:number|null;conversion:number|null;limitation:string}
export default function CommercialLearning(){
 const [from,setFrom]=useState(`${new Date().getFullYear()}-01-01`),[to,setTo]=useState(new Date().toISOString().slice(0,10))
 const q=useCachedQuery<{segments:Segment[];loss_reasons:{reason:string;total:number}[];methodology:string}>(`learning:${from}:${to}`,async()=>{const r=await supabase.rpc('commercial_learning',{p_from:from,p_to:to});return{data:r.data,error:r.error?.message??null}},[from,to])
 return <><PageHeader title="Aprendizado comercial" description="Resultados observados, tamanho da amostra e limitações. Sem alterar pesos automaticamente."/><div className="mb-4 flex gap-3"><label className="text-xs">De<Input type="date" aria-label="Início da amostra" value={from} onChange={e=>setFrom(e.target.value)}/></label><label className="text-xs">Até<Input type="date" aria-label="Fim da amostra" value={to} onChange={e=>setTo(e.target.value)}/></label></div><DataStatus loading={q.loading} error={q.error} savedAt={q.savedAt} hasData={!!q.data}/>{q.data&&<><p className="mb-4 text-xs text-muted-foreground">{q.data.methodology}</p><Card><CardContent className="pt-4"><Table><THead><tr><TH>CNAE</TH><TH>Amostra</TH><TH>Decididas</TH><TH>Ganhas</TH><TH>Perdidas</TH><TH>Conversão</TH><TH>Ticket</TH><TH>Prazo médio</TH><TH>Limitação</TH></tr></THead><TBody>{q.data.segments.map(s=><TR key={s.cnae_principal??'none'}><TD>{s.cnae_principal??'Não informado'}</TD><TD>{s.sample}</TD><TD>{s.decided}</TD><TD>{s.won}</TD><TD>{s.lost}</TD><TD>{s.conversion==null?'Não calculável':`${s.conversion}%`}</TD><TD>{s.avg_ticket==null?'—':brl.format(s.avg_ticket)}</TD><TD>{s.avg_days_to_win??'—'} dias</TD><TD className="text-xs">{s.limitation}</TD></TR>)}</TBody></Table>{!q.data.segments.length&&<p className="text-sm text-muted-foreground">Sem oportunidades no período. Nenhuma recomendação estatística foi inventada.</p>}</CardContent></Card><Card className="mt-4"><CardContent className="pt-4 space-y-2"><h2 className="font-medium">Motivos de perda registrados</h2>{q.data.loss_reasons.map(x=><p key={x.reason} className="text-sm">{x.reason}: {x.total}</p>)}</CardContent></Card></>}</>
}
