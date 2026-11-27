import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { brl, formatCnpj, formatDate, formatDateTime } from '@/lib/utils'
import { PageHeader } from '@/components/layout/AppLayout'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { RowsSkeleton } from '@/components/ui/skeleton'
import { ProposalEditor, type ProposalLine } from '@/components/ProposalEditor'
import { createTextPdf } from '@/lib/pdf'
interface Document {
 issuer:string;generated_at:string;revision:number|null
 company:{cnpj:string;name:string;legal_name:string}
 proposal:{id:string;title:string;amount:number|null;scope:string|null;payment_terms:string|null;delivery_terms:string|null;valid_until:string|null;notes:string|null;status:string;line_items?:ProposalLine[];approved_at?:string|null;document_template?:string}
 services:{name:string;description:string|null;deliverables:string|null}[]
}
export default function ProposalDocument(){
 const {id}=useParams();const [refresh,setRefresh]=useState(0);const [data,setData]=useState<Document|null>(null),[error,setError]=useState<string|null>(null)
 const [versions,setVersions]=useState<{id:number;revision:number;created_at:string;payload:Document['proposal']}[]>([])
 useEffect(()=>{let valid=true;setData(null);setError(null);Promise.all([supabase.rpc('proposal_document',{p_id:id}),supabase.from('proposal_versions').select('id,revision,created_at,payload').eq('proposal_id',id).order('revision',{ascending:false}).limit(20)]).then(([r,h])=>{if(!valid)return;if(r.error||h.error)setError((r.error??h.error)!.message);else{setData(r.data as Document);setVersions(h.data??[])}});return()=>{valid=false}},[id,refresh])
 return <><PageHeader title="Documento da proposta" description="Dados registrados, prontos para impressão ou PDF no navegador. A exportação não registra envio nem aceite."
 actions={<><Button disabled={!data} onClick={()=>window.print()}>Imprimir / Salvar PDF</Button><Button disabled={!data} variant="outline" onClick={()=>{if(!data)return;const p=data.proposal;createTextPdf(p.title,[{heading:data.issuer,text:`${data.company.name} · CNPJ ${formatCnpj(data.company.cnpj)} · Revisão ${data.revision??'legada'}`},{heading:'Escopo',text:p.scope??'Não registrado'},{heading:'Itens',text:(p.line_items??[]).map(x=>`${x.description} · ${x.quantity} × ${brl.format(x.unit_price)} · desconto ${x.discount_percent}%`).join('\n')},{heading:'Valor',text:p.amount==null?'Não registrado':brl.format(p.amount)},{heading:'Pagamento e prazo',text:[p.payment_terms,p.delivery_terms].filter(Boolean).join('\n')},{heading:'Validade',text:formatDate(p.valid_until)},{heading:'Observações',text:p.notes??'Sem observações'}]).save(`proposta-${id}.pdf`)}}>Baixar PDF direto</Button></>}/>
 {error&&<Alert tone="error">{error}</Alert>}
 {!data&&!error&&<RowsSkeleton rows={6}/>}
 {data&&<><div className="mb-4"><ProposalEditor key={`${id}:${refresh}`} id={id!} proposal={data.proposal} onSaved={()=>setRefresh(x=>x+1)}/></div><style>{`@media print { body * { visibility: hidden; } .proposal-print, .proposal-print * { visibility: visible; } .proposal-print { position:absolute; left:0; top:0; width:100%; background:white; color:black; padding:12mm; box-shadow:none; border:0; } .proposal-print section { break-inside:avoid; } @page { size:A4; margin:12mm; } }`}</style>
 <article className="proposal-print mx-auto max-w-3xl rounded-lg border bg-card p-8 space-y-6">
 <div className="border-b pb-4"><p className="text-xl font-semibold">{data.issuer}</p><p className="text-xs text-muted-foreground">Proposta comercial · revisão {data.revision??'anterior ao versionamento'} · gerado {formatDateTime(data.generated_at)}</p></div>
 <section><h1 className="text-2xl font-semibold">{data.proposal.title}</h1><p className="mt-3 font-medium">{data.company.name}</p><p className="text-sm">{data.company.legal_name} · CNPJ {formatCnpj(data.company.cnpj)}</p><p className="text-sm">Situação registrada: {data.proposal.status} · Validade: {formatDate(data.proposal.valid_until)}</p></section>
 <section><h2 className="font-semibold">Escopo</h2><p className="mt-2 whitespace-pre-wrap text-sm">{data.proposal.scope||'Escopo detalhado não registrado. Definir antes do envio.'}</p></section>
 {!!data.services.length&&<section><h2 className="font-semibold">Serviços selecionados</h2>{data.services.map((s,i)=><div className="mt-2 text-sm" key={i}><strong>{s.name}</strong><p>{s.description}</p>{s.deliverables&&<p>{s.deliverables}</p>}</div>)}</section>}
 {!!data.proposal.line_items?.length&&<section><h2 className="font-semibold">Itens e descontos</h2>{data.proposal.line_items.map((x,i)=><p className="text-sm mt-2" key={i}>{x.description} · {x.quantity} × {brl.format(x.unit_price)} · desconto {x.discount_percent}%</p>)}</section>}
 <section className="grid gap-4 sm:grid-cols-2"><div><h2 className="font-semibold">Investimento</h2><p className="text-xl mt-2">{data.proposal.amount==null?'Valor não registrado':brl.format(data.proposal.amount)}</p></div><div><h2 className="font-semibold">Condições de pagamento</h2><p className="mt-2 whitespace-pre-wrap text-sm">{data.proposal.payment_terms||'Não registradas'}</p></div></section>
 <section><h2 className="font-semibold">Prazo e condições de entrega</h2><p className="mt-2 whitespace-pre-wrap text-sm">{data.proposal.delivery_terms||'Não registrados'}</p></section>
 {data.proposal.notes&&<section><h2 className="font-semibold">Observações</h2><p className="mt-2 whitespace-pre-wrap text-sm">{data.proposal.notes}</p></section>}
 <footer className="border-t pt-3 text-xs text-muted-foreground">Documento gerado a partir dos registros comerciais. Não representa assinatura eletrônica nem comprovação de envio/aceite.</footer>
 </article>
 <details className="mt-4 rounded border p-4 text-sm"><summary className="cursor-pointer">Histórico de revisões (últimas 20)</summary>{!versions.length&&<p className="mt-2 text-muted-foreground">Sem revisões desde a ativação do versionamento.</p>}{versions.map(v=><details className="mt-2" key={v.id}><summary className="cursor-pointer">Revisão {v.revision} · {formatDateTime(v.created_at)}</summary><pre className="whitespace-pre-wrap break-all text-xs p-3 bg-muted">{JSON.stringify(v.payload,null,2)}</pre></details>)}</details>
 </>}
 </>
}
