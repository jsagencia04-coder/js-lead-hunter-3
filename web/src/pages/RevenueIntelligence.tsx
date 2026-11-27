import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { brl,formatDate } from '@/lib/utils'
import { PageHeader } from '@/components/layout/AppLayout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Alert } from '@/components/ui/alert'
import { Card,CardContent,CardHeader,CardTitle } from '@/components/ui/card'
interface Receipt {id:string;contract_id:string;amount:number;received_on:string;reference:string;voided_at:string|null}
export default function RevenueIntelligence(){
 const {hasRole}=useAuth();const manage=hasRole('admin','gestor')
 const [from,setFrom]=useState(`${new Date().getFullYear()}-01-01`),[to,setTo]=useState(new Date().toISOString().slice(0,10))
 const [data,setData]=useState<{potential_open:number;contracted_period:number;received_period:number;receipt_count:number;methodology:string}|null>(null)
 const [contracts,setContracts]=useState<{id:string;title:string}[]>([]),[receipts,setReceipts]=useState<Receipt[]>([])
 const [error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false)
 const [contract,setContract]=useState(''),[amount,setAmount]=useState(''),[date,setDate]=useState(new Date().toISOString().slice(0,10)),[reference,setReference]=useState('')
 const load=useCallback(async()=>{setBusy(true);setError(null);try{
  const [m,c,r]=await Promise.all([supabase.rpc('revenue_summary',{p_from:from,p_to:to}),supabase.from('contracts').select('id,title').order('created_at',{ascending:false}).limit(200),supabase.from('contract_receipts').select('id,contract_id,amount,received_on,reference,voided_at').gte('received_on',from).lte('received_on',to).order('received_on',{ascending:false}).limit(100)])
  if(m.error||c.error||r.error)throw new Error((m.error??c.error??r.error)!.message);setData(m.data);setContracts(c.data??[]);setReceipts(r.data??[])
 }catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}},[from,to])
 useEffect(()=>{load()},[load])
 async function save(e:FormEvent){e.preventDefault();if(!window.confirm('Registrar este valor como efetivamente recebido?'))return;setBusy(true);const r=await supabase.rpc('record_contract_receipt',{p_contract:contract,p_amount:Number(amount),p_date:date,p_reference:reference});if(r.error){setError(r.error.message);setBusy(false)}else{setAmount('');setReference('');await load()}}
 return <><PageHeader title="Inteligência de receita" description="Valores potenciais, contratados e recebidos são indicadores separados." actions={<Button disabled={busy} variant="outline" onClick={load}>Atualizar</Button>}/><div className="mb-4 flex gap-3"><label className="text-xs">De<Input aria-label="Início do período" type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label className="text-xs">Até<Input aria-label="Fim do período" type="date" value={to} onChange={e=>setTo(e.target.value)}/></label></div>
 {error&&<Alert tone="error" className="mb-4">{error}</Alert>}{data&&<><div className="grid gap-4 md:grid-cols-3">{[['Potencial aberto (atual)',data.potential_open],['Contratado no período',data.contracted_period],['Recebido no período',data.received_period]].map(([label,value])=><Card key={label}><CardHeader><CardTitle>{label}</CardTitle></CardHeader><CardContent className="text-2xl font-semibold">{brl.format(Number(value))}</CardContent></Card>)}</div><p className="my-4 text-xs text-muted-foreground">{data.methodology}</p></>}
 {manage&&<Card className="my-4"><CardHeader><CardTitle>Registrar recebimento</CardTitle></CardHeader><CardContent><form onSubmit={save} className="grid gap-3 md:grid-cols-2"><Select aria-label="Contrato do recebimento" required value={contract} onChange={e=>setContract(e.target.value)}><option value="">Selecione contrato (últimos 200)</option>{contracts.map(c=><option key={c.id} value={c.id}>{c.title}</option>)}</Select><Input aria-label="Valor recebido" required type="number" min="0.01" step="0.01" placeholder="Valor efetivamente recebido" value={amount} onChange={e=>setAmount(e.target.value)}/><Input aria-label="Data do recebimento" required type="date" value={date} onChange={e=>setDate(e.target.value)}/><Input aria-label="Referência única do recebimento" required maxLength={240} placeholder="Referência única por contrato (parcela/documento)" value={reference} onChange={e=>setReference(e.target.value)}/><Button disabled={busy||!contract} type="submit">Registrar valor recebido</Button></form></CardContent></Card>}
 <Card><CardHeader><CardTitle>Últimos 100 lançamentos no período</CardTitle></CardHeader><CardContent className="space-y-2">{!receipts.length&&!busy&&<p className="text-sm text-muted-foreground">Nenhum recebimento registrado. Não se presume pagamento a partir de contrato.</p>}{receipts.map(r=><div key={r.id} className="rounded border p-3 text-sm"><strong>{brl.format(r.amount)}</strong> · {formatDate(r.received_on)} · {r.reference} · {r.voided_at?'Estornado':'Recebido'}{manage&&!r.voided_at&&<Button variant="outline" className="ml-2" size="sm" onClick={async()=>{const reason=window.prompt('Justificativa do estorno (histórico será preservado)')?.trim();if(!reason)return;const x=await supabase.rpc('void_contract_receipt',{p_id:r.id,p_reason:reason});if(x.error)setError(x.error.message);else load()}}>Estornar</Button>}</div>)}</CardContent></Card>
 </>
}
