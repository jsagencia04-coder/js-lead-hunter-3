import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { useOpenLead } from '@/lib/crm'
import { brl, formatDate } from '@/lib/utils'
import { PageHeader } from '@/components/layout/AppLayout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Alert } from '@/components/ui/alert'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
interface Campaign { id:string;name:string;objective:string;status:string;starts_on:string|null;ends_on:string|null;owner_id:string }
export default function Campaigns(){
 const {profile,hasRole}=useAuth();const openLead=useOpenLead()
 const [rows,setRows]=useState<Campaign[]>([]),[selected,setSelected]=useState(''),[members,setMembers]=useState<{lead_id:string}[]>([])
 const [metrics,setMetrics]=useState<Record<string,number|string>|null>(null),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false)
 const [name,setName]=useState(''),[objective,setObjective]=useState('')
 const load=useCallback(async()=>{setBusy(true);setError(null);try{const r=await supabase.from('sales_campaigns').select('*').order('created_at',{ascending:false}).limit(100);if(r.error)throw new Error(r.error.message);setRows(r.data??[])}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}},[])
 useEffect(()=>{load()},[load])
 useEffect(()=>{let valid=true;setMembers([]);setMetrics(null);if(!selected)return
  Promise.all([supabase.rpc('sales_campaign_metrics',{p_id:selected}),supabase.from('sales_campaign_members').select('lead_id').eq('campaign_id',selected).order('added_at',{ascending:false}).limit(50)]).then(([m,l])=>{if(!valid)return;if(m.error||l.error)setError((m.error??l.error)!.message);else{setMetrics(m.data);setMembers(l.data??[])}});return()=>{valid=false}
 },[selected,rows])
 async function create(e:FormEvent){e.preventDefault();setBusy(true);const r=await supabase.rpc('save_sales_campaign',{p_name:name,p_objective:objective});if(r.error){setError(r.error.message);setBusy(false)}else{setName('');setObjective('');await load();setSelected(r.data)}}
 async function status(c:Campaign,next:string){setBusy(true);const r=await supabase.rpc('set_sales_campaign_status',{p_id:c.id,p_status:next});if(r.error){setError(r.error.message);setBusy(false)}else await load()}
 const active=rows.find(r=>r.id===selected)
 return <><PageHeader title="Campanhas" description="Carteiras comerciais e resultados observados. Sem envio automático ou atribuição causal de receita." actions={<Button variant="outline" onClick={load} disabled={busy}>Atualizar</Button>}/>
 {error&&<Alert tone="error" className="mb-4">{error}</Alert>}
 {hasRole('admin','gestor','comercial')&&<form onSubmit={create} className="mb-4 grid gap-2 md:grid-cols-[1fr_2fr_auto]"><Input aria-label="Nome da campanha" required maxLength={160} placeholder="Nome da campanha" value={name} onChange={e=>setName(e.target.value)}/><Input aria-label="Objetivo da campanha" placeholder="Objetivo comercial" value={objective} onChange={e=>setObjective(e.target.value)}/><Button disabled={busy||!name.trim()} type="submit">Criar campanha</Button></form>}
 <div className="grid gap-4 lg:grid-cols-[20rem_1fr]"><Card><CardHeader><CardTitle>Últimas 100 campanhas</CardTitle></CardHeader><CardContent className="space-y-2">{!rows.length&&!busy&&<p className="text-sm text-muted-foreground">Nenhuma campanha cadastrada.</p>}{rows.map(c=><button key={c.id} onClick={()=>setSelected(c.id)} className={`w-full rounded border p-3 text-left text-sm ${selected===c.id?'border-primary':'hover:bg-accent'}`}><strong>{c.name}</strong><p className="text-xs text-muted-foreground">{c.status} · {formatDate(c.starts_on)} — {formatDate(c.ends_on)}</p></button>)}</CardContent></Card>
 {active&&<Card><CardHeader><CardTitle>{active.name}</CardTitle></CardHeader><CardContent className="space-y-4"><p className="text-sm">{active.objective}</p>{(active.owner_id===profile?.id||hasRole('admin','gestor'))&&hasRole('admin','gestor','comercial')&&<Select aria-label="Estado da campanha" value={active.status} disabled={busy} onChange={e=>status(active,e.target.value)}>{['rascunho','ativa','pausada','concluida'].map(x=><option key={x} value={x}>{x}</option>)}</Select>}
 {metrics&&<><div className="grid grid-cols-2 gap-3">{Object.entries(metrics).filter(([key])=>key!=='methodology').map(([key,value])=><div key={key} className="rounded border p-3 text-sm"><p className="text-muted-foreground">{key.replace(/_/g,' ')}</p><strong>{key==='receita_contratada'?brl.format(Number(value)):value}</strong></div>)}</div><p className="text-xs text-muted-foreground">{metrics.methodology}</p></>}
 <p className="text-xs text-muted-foreground">Para incluir empresas, selecione a campanha e as empresas na Central de Oportunidades. Últimas 50 inclusões:</p><div className="space-y-1">{members.map((m,i)=><Button key={m.lead_id} variant="outline" size="sm" onClick={()=>openLead(m.lead_id)}>Abrir empresa {i+1}</Button>)}</div>
 </CardContent></Card>}
 </div></>
}
