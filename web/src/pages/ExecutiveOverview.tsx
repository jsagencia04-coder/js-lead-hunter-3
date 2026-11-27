import {useEffect,useState} from 'react'
import {supabase} from '@/lib/supabase'
import {useCachedQuery} from '@/lib/cache'
import {brl,UFS} from '@/lib/utils'
import {PageHeader} from '@/components/layout/AppLayout'
import {DataStatus} from '@/components/DataStatus'
import {Input} from '@/components/ui/input'
import {Select} from '@/components/ui/select'
import {Button} from '@/components/ui/button'
import {Card,CardContent,CardHeader,CardTitle} from '@/components/ui/card'
import {downloadCsv} from '@/lib/crm'
interface Data {metrics:Record<string,number|null>;pipeline:{label:string;total:number;value:number|null}[];monthly:{month:string;total:number;won:number}[];methodology:string;updated_at:string}
const labels:Record<string,string>={opportunities:'Oportunidades',open_value:'Valor aberto',weighted_forecast:'Previsão ponderada',won:'Ganhas',lost:'Perdidas',conversion:'Conversão',contracted:'Contratado',received:'Recebido',average_ticket:'Ticket médio'}
export default function ExecutiveOverview(){
 const [from,setFrom]=useState(`${new Date().getFullYear()}-01-01`),[to,setTo]=useState(new Date().toISOString().slice(0,10)),[owner,setOwner]=useState(''),[uf,setUf]=useState(''),[cnae,setCnae]=useState('')
 const [people,setPeople]=useState<{id:string;full_name:string|null;email:string}[]>([]),[hidden,setHidden]=useState<string[]>(()=>{try{return JSON.parse(localStorage.getItem('jslh:exec:hidden')??'[]')}catch{return[]}})
 useEffect(()=>{supabase.from('profiles').select('id,full_name,email').eq('active',true).then(({data})=>setPeople(data??[]))},[])
 const key=JSON.stringify([from,to,owner,uf,cnae]);const q=useCachedQuery<Data>(`exec-v4:${key}`,async()=>{const r=await supabase.rpc('executive_overview_v4',{p_from:from,p_to:to,p_owner:owner||null,p_uf:uf||null,p_cnae:cnae||null});return{data:r.data,error:r.error?.message??null}},[key])
 function toggle(k:string){setHidden(p=>{const n=p.includes(k)?p.filter(x=>x!==k):[...p,k];try{localStorage.setItem('jslh:exec:hidden',JSON.stringify(n))}catch{/* local indisponivel */}return n})}
 return <><PageHeader title="Painel executivo V4" description="Filtros compartilhados, métricas configuráveis e denominadores explícitos." actions={<Button variant="outline" disabled={!q.data} onClick={()=>downloadCsv('painel-executivo.csv',[['Indicador','Valor'],...Object.entries(q.data!.metrics).map(([k,v])=>[labels[k]??k,v])])}>Exportar CSV</Button>}/>
 <div className="mb-4 grid gap-2 md:grid-cols-5"><Input aria-label="Período inicial executivo" type="date" value={from} onChange={e=>setFrom(e.target.value)}/><Input aria-label="Período final executivo" type="date" value={to} onChange={e=>setTo(e.target.value)}/><Select aria-label="Responsável executivo" value={owner} onChange={e=>setOwner(e.target.value)}><option value="">Todos os responsáveis</option>{people.map(p=><option key={p.id} value={p.id}>{p.full_name??p.email}</option>)}</Select><Select aria-label="UF executiva" value={uf} onChange={e=>setUf(e.target.value)}><option value="">Todas as UFs</option>{UFS.map(u=><option key={u}>{u}</option>)}</Select><Input aria-label="CNAE executivo" placeholder="CNAE/prefixo" value={cnae} onChange={e=>setCnae(e.target.value.replace(/\D/g,''))}/></div>
 <DataStatus loading={q.loading} error={q.error} savedAt={q.savedAt} hasData={!!q.data}/>
 <details className="mb-4 text-xs"><summary className="cursor-pointer">Personalizar cartões</summary><div className="flex flex-wrap gap-3 mt-2">{Object.entries(labels).map(([k,label])=><label className="flex gap-1" key={k}><input type="checkbox" checked={!hidden.includes(k)} onChange={()=>toggle(k)}/>{label}</label>)}</div></details>
 {q.data&&<><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Object.entries(q.data.metrics).filter(([k])=>!hidden.includes(k)).map(([k,v])=><Card key={k}><CardHeader><CardTitle>{labels[k]??k}</CardTitle></CardHeader><CardContent className="text-2xl font-semibold">{v==null?'Não calculável':['open_value','weighted_forecast','contracted','received','average_ticket'].includes(k)?brl.format(v):`${v}${k==='conversion'?'%':''}`}</CardContent></Card>)}</div><p className="my-4 text-xs text-muted-foreground">{q.data.methodology}</p><div className="grid gap-4 lg:grid-cols-2"><Card><CardHeader><CardTitle>Distribuição no funil</CardTitle></CardHeader><CardContent className="space-y-2">{q.data.pipeline.map(p=><div key={p.label}><div className="flex justify-between text-xs"><span>{p.label}</span><span>{p.total}</span></div><div className="h-3 rounded bg-muted"><div className="h-3 rounded bg-primary" style={{width:`${100*p.total/Math.max(1,...q.data!.pipeline.map(x=>x.total))}%`}}/></div></div>)}</CardContent></Card><Card><CardHeader><CardTitle>Evolução por mês de criação</CardTitle></CardHeader><CardContent className="space-y-2">{q.data.monthly.map(m=><div className="rounded border p-2 text-sm" key={m.month}>{m.month} · {m.total} oportunidades · {m.won} ganhas</div>)}</CardContent></Card></div></>}
 </>
}
