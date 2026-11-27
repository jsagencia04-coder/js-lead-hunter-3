import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useCachedQuery } from '@/lib/cache'
import { UFS } from '@/lib/utils'
import { PageHeader } from '@/components/layout/AppLayout'
import { DataStatus } from '@/components/DataStatus'
import { Select } from '@/components/ui/select'
import { Card, CardContent } from '@/components/ui/card'
import { Table,THead,TBody,TH,TD,TR } from '@/components/ui/table'
interface Region {uf:string;municipio_code:string;municipio:string;companies:number;establishments:number;leads:number;researched:number;confirmed_site_gaps:number;contacted:number;customers:number;research_coverage_percent:number}
export default function MarketIntelligence(){
 const [uf,setUf]=useState('')
 const q=useCachedQuery<{regions:Region[];methodology:string;updated_at:string}>(`market:${uf}`,async()=>{const r=await supabase.rpc('market_coverage',{p_uf:uf||null});return{data:r.data,error:r.error?.message??null}},[uf])
 return <><PageHeader title="Inteligência territorial" description="Cobertura empresarial, pesquisa digital e lacunas observadas por município." actions={<Select aria-label="UF da inteligência territorial" className="w-36" value={uf} onChange={e=>setUf(e.target.value)}><option value="">Brasil</option>{UFS.map(u=><option key={u}>{u}</option>)}</Select>}/>
 <DataStatus loading={q.loading} error={q.error} savedAt={q.savedAt} hasData={!!q.data}/>
 {q.data&&<><p className="mb-4 text-xs text-muted-foreground">{q.data.methodology}</p><Card><CardContent className="pt-4"><Table><THead><tr><TH>Região</TH><TH>Empresas</TH><TH>Leads</TH><TH>Pesquisadas</TH><TH>Cobertura</TH><TH>Lacunas de site</TH><TH>Contatadas</TH><TH>Clientes</TH></tr></THead><TBody>{q.data.regions.map(r=><TR key={`${r.uf}:${r.municipio_code}`}><TD>{r.municipio??'Não informado'}/{r.uf}</TD><TD>{r.companies}</TD><TD>{r.leads}</TD><TD>{r.researched}</TD><TD><span>{r.research_coverage_percent}%</span><div className="h-1 bg-muted rounded"><div className="h-1 bg-primary rounded" style={{width:`${r.research_coverage_percent}%`}}/></div></TD><TD>{r.confirmed_site_gaps}</TD><TD>{r.contacted}</TD><TD>{r.customers}</TD></TR>)}</TBody></Table>{!q.data.regions.length&&<p className="text-sm text-muted-foreground">Sem dados para esta região.</p>}</CardContent></Card></>}
 <p className="mt-4 text-sm"><Link to="/oportunidades" className="text-primary underline">Montar carteira na Central de Oportunidades</Link> usando filtros de UF e município.</p>
 </>
}
