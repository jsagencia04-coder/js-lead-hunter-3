import {useEffect,useState,type FormEvent} from 'react'
import {supabase} from '@/lib/supabase'
import {formatDate,formatDateTime} from '@/lib/utils'
import {useAuth} from '@/hooks/useAuth'
import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {Alert} from '@/components/ui/alert'
import {Select} from '@/components/ui/select'
export function CustomerSuccess({contractId}:{contractId:string}){
 const {hasRole}=useAuth();const [rows,setRows]=useState<{id:string;satisfaction:number|null;notes:string;next_contact_on:string|null;created_at:string}[]>([])
 const [score,setScore]=useState(''),[notes,setNotes]=useState(''),[next,setNext]=useState(''),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false),[refresh,setRefresh]=useState(0)
 useEffect(()=>{let valid=true;supabase.from('customer_reviews').select('id,satisfaction,notes,next_contact_on,created_at').eq('contract_id',contractId).order('created_at',{ascending:false}).limit(20).then(r=>{if(!valid)return;if(r.error)setError(r.error.message);else setRows(r.data??[])});return()=>{valid=false}},[contractId,refresh])
 async function save(e:FormEvent){e.preventDefault();setBusy(true);setError(null);const r=await supabase.rpc('record_customer_review',{p_contract:contractId,p_satisfaction:score?Number(score):null,p_notes:notes,p_next:next||null});setBusy(false);if(r.error)setError(r.error.message);else{setNotes('');setScore('');setNext('');setRefresh(x=>x+1)}}
 return <section className="space-y-3 rounded border p-3"><h3 className="text-sm font-semibold">Relacionamento e satisfação registrada</h3>{error&&<Alert tone="error">{error}</Alert>}
 {rows.map(r=><div key={r.id} className="border-b pb-2 text-xs"><p>{r.notes}</p><p className="text-muted-foreground">{formatDateTime(r.created_at)} · satisfação {r.satisfaction??'não aferida'}/5 · próximo acompanhamento {formatDate(r.next_contact_on)}</p></div>)}{!rows.length&&<p className="text-xs text-muted-foreground">Nenhum acompanhamento registrado; satisfação não é presumida.</p>}
 {hasRole('admin','gestor','comercial')&&<form onSubmit={save} className="space-y-2"><Select aria-label="Satisfação registrada" value={score} onChange={e=>setScore(e.target.value)}><option value="">Satisfação não aferida</option>{[1,2,3,4,5].map(x=><option key={x}>{x}</option>)}</Select><Input required aria-label="Registro de relacionamento" placeholder="Relato do acompanhamento" value={notes} onChange={e=>setNotes(e.target.value)}/><label className="text-xs">Próxima data sugerida<Input type="date" value={next} onChange={e=>setNext(e.target.value)}/></label><Button disabled={busy||!notes.trim()} type="submit" size="sm">Registrar acompanhamento</Button></form>}
 </section>
}
