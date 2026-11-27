import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { useOpenLead } from '@/lib/crm'
import { formatDateTime } from '@/lib/utils'
import { PageHeader } from '@/components/layout/AppLayout'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { RowsSkeleton } from '@/components/ui/skeleton'
interface Rule { code:string;label:string;enabled:boolean;days:number }
interface Run { id:string;started_at:string;finished_at:string|null;status:string;created:number;errors:number }
interface Notice { id:string;lead_id:string;owner_id:string;title:string;reason:string;read_at:string|null;created_at:string }
export default function SalesAutomations(){
 const {hasRole,profile}=useAuth(); const openLead=useOpenLead(); const manage=hasRole('admin','gestor')
 const [rules,setRules]=useState<Rule[]>([]),[runs,setRuns]=useState<Run[]>([]),[alerts,setAlerts]=useState<Notice[]>([])
 const [failures,setFailures]=useState<{rule_code:string;source_id:string;source_date:string;attempts:number;next_attempt_at:string;sqlstate:string}[]>([])
 const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[notice,setNotice]=useState('')
 const load=useCallback(async()=>{
  setBusy(true);setError(null)
  try{
   const [r,n]=await Promise.all([supabase.from('sales_automation_rules').select('*').order('code'),supabase.from('operation_alerts').select('id,lead_id,owner_id,title,reason,read_at,created_at').order('created_at',{ascending:false}).limit(50)])
   if(r.error||n.error)throw new Error((r.error??n.error)!.message)
   setRules(r.data??[]);setAlerts(n.data??[])
   if(manage){ const x=await supabase.from('sales_automation_runs').select('id,started_at,finished_at,status,created,errors').order('started_at',{ascending:false}).limit(20);if(x.error)throw new Error(x.error.message);setRuns(x.data??[])
    const f=await supabase.from('sales_automation_errors').select('rule_code,source_id,source_date,attempts,next_attempt_at,sqlstate').order('last_failed_at',{ascending:false}).limit(20);if(f.error)throw new Error(f.error.message);setFailures(f.data??[])
   }
  }catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}
 },[manage])
 useEffect(()=>{load()},[load])
 async function configure(r:Rule){
  if(!window.confirm(`${r.enabled?'Ativar':'Pausar'} esta regra com limite de ${r.days} dias? Só serão criadas atividades internas.`))return
  setBusy(true);setError(null)
  const x=await supabase.rpc('configure_sales_automation',{p_code:r.code,p_enabled:r.enabled,p_days:r.days})
  if(x.error){setError(x.error.message);setBusy(false)}else{setNotice('Configuração salva e auditada.');await load()}
 }
 async function execute(){
  setBusy(true);setError(null);setNotice('')
  try{
   const [w,r]=await Promise.all([supabase.rpc('schedule_company_watches',{p_limit:100}),supabase.rpc('run_sales_automations',{p_limit:100})])
   if(w.error||r.error)throw new Error((w.error??r.error)!.message)
   setNotice(`Rodada ${r.data.status}: ${r.data.created} ações internas, ${r.data.errors??0} erros; ${w.data} pesquisas agendadas.`)
   await load()
  }catch(e){setError(e instanceof Error?e.message:String(e));setBusy(false)}
 }
 async function read(n:Notice){ const r=await supabase.rpc('mark_operation_alert_read',{p_id:n.id});if(r.error)setError(r.error.message);else load() }
 return <>
  <PageHeader title="Automações e alertas" description="Regras internas, auditadas e idempotentes. Nenhuma mensagem externa é enviada automaticamente."
   actions={<><Button variant="outline" disabled={busy} onClick={load}>Atualizar</Button>{manage&&<Button disabled={busy} onClick={execute}>Executar rodada</Button>}</>} />
  {error&&<Alert tone="error" className="mb-4">{error}</Alert>}{notice&&<Alert className="mb-4">{notice}</Alert>}
  <p className="mb-4 text-xs text-muted-foreground">Regras começam pausadas. O worker verifica a cada 5 minutos; habilite somente o que sua operação precisa. Sem responsável ativo ou com oposição ao contato, nenhuma tarefa automática é criada. Cada rodada processa até 100 fontes.</p>
  {busy&&!rules.length?<RowsSkeleton rows={4}/>:<div className="grid gap-4 lg:grid-cols-2">{rules.map(r=><Card key={r.code}><CardHeader><CardTitle>{r.label}</CardTitle></CardHeader><CardContent className="space-y-3"><p className="text-sm">{r.enabled?'Ativa':'Pausada'}</p>{hasRole('admin')&&<><label className="text-sm flex gap-2"><input type="checkbox" checked={r.enabled} onChange={e=>setRules(a=>a.map(x=>x.code===r.code?{...x,enabled:e.target.checked}:x))}/>Habilitar regra</label><label className="text-xs">Dias<Input aria-label={`Dias: ${r.label}`} type="number" min={1} max={365} value={r.days} onChange={e=>setRules(a=>a.map(x=>x.code===r.code?{...x,days:Number(e.target.value)}:x))}/></label><Button disabled={busy||r.days<1||r.days>365} onClick={()=>configure(r)}>Salvar regra</Button></>}</CardContent></Card>)}</div>}
  <Card className="mt-4"><CardHeader><CardTitle>Alertas visíveis (últimos 50)</CardTitle></CardHeader><CardContent className="space-y-3">{!alerts.length&&<p className="text-sm text-muted-foreground">Nenhum alerta registrado.</p>}{alerts.map(n=><article className="rounded border p-3 text-sm" key={n.id}><button className="font-medium hover:underline" onClick={()=>openLead(n.lead_id)}>{n.title}</button><p className="text-xs text-muted-foreground">{n.reason} · {formatDateTime(n.created_at)}</p>{!n.read_at&&n.owner_id===profile?.id&&<Button size="sm" variant="outline" onClick={()=>read(n)}>Marcar como lido</Button>}</article>)}</CardContent></Card>
  {manage&&failures.length>0&&<Card className="mt-4"><CardHeader><CardTitle>Falhas e retentativas (até 6)</CardTitle></CardHeader><CardContent className="space-y-2">{failures.map(f=><div className="rounded border p-2 text-xs" key={`${f.rule_code}:${f.source_id}:${f.source_date}`}>{f.rule_code} · {f.attempts} tentativas · código {f.sqlstate} · {f.attempts>=6?'Aguardando revisão':`próxima ${formatDateTime(f.next_attempt_at)}`}<Button className="ml-2" size="sm" variant="outline" disabled={busy} onClick={async()=>{const r=await supabase.rpc('retry_sales_automation',{p_rule:f.rule_code,p_source:f.source_id,p_date:f.source_date});if(r.error)setError(r.error.message);else load()}}>Reavaliar</Button></div>)}</CardContent></Card>}
  {manage&&<Card className="mt-4"><CardHeader><CardTitle>Últimas 20 execuções reais</CardTitle></CardHeader><CardContent className="space-y-2">{!runs.length&&<p className="text-sm text-muted-foreground">Nenhuma execução registrada.</p>}{runs.map(r=><p className="text-xs" key={r.id}>{formatDateTime(r.started_at)} · {r.status} · {r.created} ações · {r.errors} erros</p>)}</CardContent></Card>}
 </>
}
