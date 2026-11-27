import { useCallback,useEffect,useState,type FormEvent } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { PageHeader } from '@/components/layout/AppLayout'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { Card,CardContent,CardHeader,CardTitle } from '@/components/ui/card'
interface Segment {id:string;name:string;description:string;icp:string;cnae_prefixes:string[];service_ids:string[];active:boolean}
export default function IntelligenceSegments(){
 const {hasRole}=useAuth();const [rows,setRows]=useState<Segment[]>([]),[services,setServices]=useState<{id:string;name:string}[]>([])
 const [error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false)
 const [id,setId]=useState<string|null>(null),[name,setName]=useState(''),[description,setDescription]=useState(''),[icp,setIcp]=useState(''),[cnaes,setCnaes]=useState(''),[chosen,setChosen]=useState<string[]>([]),[active,setActive]=useState(true)
 const load=useCallback(async()=>{setBusy(true);setError(null);try{const [r,s]=await Promise.all([supabase.from('intelligence_segments').select('*').order('name').limit(100),supabase.from('service_catalog').select('id,name').eq('active',true).order('name')]);if(r.error||s.error)throw new Error((r.error??s.error)!.message);setRows(r.data??[]);setServices(s.data??[])}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}},[])
 useEffect(()=>{load()},[load])
 function reset(){setId(null);setName('');setDescription('');setIcp('');setCnaes('');setChosen([]);setActive(true)}
 async function save(e:FormEvent){e.preventDefault();setBusy(true);const r=await supabase.rpc('save_intelligence_segment',{p_name:name,p_description:description,p_icp:icp,p_cnaes:cnaes.split(/[;,\s]+/).filter(Boolean),p_services:chosen,p_id:id,p_active:active});if(r.error){setError(r.error.message);setBusy(false)}else{reset();await load()}}
 return <><PageHeader title="Segmentos de inteligência" description="Perfis de cliente e serviços configuráveis sem criar sistemas separados por vertical."/>{error&&<Alert tone="error" className="mb-4">{error}</Alert>}
 {hasRole('admin','gestor')&&<Card className="mb-4"><CardHeader><CardTitle>{id?'Editar segmento':'Novo segmento'}</CardTitle></CardHeader><CardContent><form onSubmit={save} className="space-y-3"><Input required maxLength={120} aria-label="Nome do segmento" placeholder="Nome do segmento" value={name} onChange={e=>setName(e.target.value)}/><Input aria-label="Descrição do segmento" placeholder="Descrição" value={description} onChange={e=>setDescription(e.target.value)}/><label className="text-xs">Perfil de cliente ideal<textarea className="w-full rounded border bg-background p-2" value={icp} onChange={e=>setIcp(e.target.value)}/></label><Input aria-label="CNAEs do segmento" placeholder="CNAEs/prefixos separados por vírgula (ex.: 47, 56)" value={cnaes} onChange={e=>setCnaes(e.target.value)}/><div className="flex flex-wrap gap-3">{services.map(s=><label className="text-xs flex gap-1" key={s.id}><input type="checkbox" checked={chosen.includes(s.id)} onChange={e=>setChosen(p=>e.target.checked?[...p,s.id]:p.filter(x=>x!==s.id))}/>{s.name}</label>)}</div><label className="text-sm flex gap-2"><input type="checkbox" checked={active} onChange={e=>setActive(e.target.checked)}/>Ativo</label><Button type="submit" disabled={busy||!name.trim()}>Salvar segmento</Button><Button className="ml-2" type="button" variant="outline" onClick={reset}>Limpar formulário</Button></form></CardContent></Card>}
 <div className="grid gap-3 md:grid-cols-2">{rows.map(r=><Card key={r.id}><CardHeader><CardTitle>{r.name} · {r.active?'Ativo':'Inativo'}</CardTitle></CardHeader><CardContent className="space-y-2 text-sm"><p>{r.description}</p><p>ICP: {r.icp||'Não definido'}</p><p>CNAEs: {r.cnae_prefixes.join(', ')||'Sem restrição cadastrada'}</p><p>Serviços: {r.service_ids.map(id=>services.find(s=>s.id===id)?.name??'Serviço inativo').join(', ')||'Nenhum vinculado'}</p>{hasRole('admin','gestor')&&<Button variant="outline" onClick={()=>{setId(r.id);setName(r.name);setDescription(r.description);setIcp(r.icp);setCnaes(r.cnae_prefixes.join(', '));setChosen(r.service_ids);setActive(r.active)}}>Editar</Button>}</CardContent></Card>)}</div>
 {!rows.length&&!busy&&<p className="text-sm text-muted-foreground">Nenhum segmento cadastrado. Não foram criados perfis fictícios.</p>}
 </>
}
