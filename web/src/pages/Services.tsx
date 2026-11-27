import { useCallback, useEffect, useState } from 'react'
import { Save } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { brl } from '@/lib/utils'
import { RECURRENCE, type Service } from '@/lib/crm'
import { useAuth } from '@/hooks/useAuth'
import { PageHeader } from '@/components/layout/AppLayout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Alert } from '@/components/ui/alert'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'

interface DigitalRule { id: string; condition: string; service_id: string; relevance: number; reason: string; active: boolean }
const CONDITION: Record<string, string> = {
  site_nao_localizado: 'Site não localizado', site_estacionado: 'Site estacionado ou vazio', site_problemas_tecnicos: 'Site com problemas graves',
  site_sem_seo: 'Site sem SEO básico', instagram_nao_localizado: 'Instagram não localizado', google_nao_localizado: 'Sem Perfil no Google',
  sem_presenca_digital: 'Sem site, Instagram e Google', whatsapp_nao_divulgado: 'Site não divulga WhatsApp',
}

export default function Services() {
  const { hasRole } = useAuth()
  const isAdmin = hasRole('admin')
  const [items, setItems] = useState<Service[]>([])
  const [rules, setRules] = useState<DigitalRule[]>([])
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [newCode,setNewCode]=useState(''),[newName,setNewName]=useState(''),[newType,setNewType]=useState('servico')

  const load = useCallback(async () => {
    const [s, r] = await Promise.all([
      supabase.from('service_catalog').select('*').order('sort_order'),
      supabase.from('digital_service_rules').select('*').order('condition'),
    ])
    if (s.error || r.error) setError((s.error ?? r.error)!.message)
    setItems((s.data as Service[]) ?? [])
    setRules((r.data as DigitalRule[]) ?? [])
  }, [])
  useEffect(() => { load() }, [load])

  const set = (id: string, patch: Partial<Service>) => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)))
  const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(/\./g, '').replace(',', '.')))

  async function save() {
    setError(null); setOk(null)
    for (const s of items) {
      const { error } = await supabase.from('service_catalog').update({
        name: s.name, description: s.description, active: s.active, price_from: s.price_from, price_to: s.price_to,
        package: s.package, recurrence: s.recurrence, payment_terms: s.payment_terms, deliverables: s.deliverables,
        item_type:s.item_type,category:s.category,unit_cost:s.unit_cost,delivery_days:s.delivery_days,
      }).eq('id', s.id)
      if (error) return setError(error.message)
    }
    for (const r of rules) {
      const { error } = await supabase.from('digital_service_rules').update({ relevance: r.relevance, active: r.active, reason: r.reason }).eq('id', r.id)
      if (error) return setError(error.message)
    }
    setOk('Catálogo salvo. Use “Recalcular” em Administração → Serviços e pontuação para aplicar as regras aos leads existentes.')
  }

  return (
    <>
      <PageHeader title="Serviços da JS Designer" description="Catálogo comercial: preços, pacotes, recorrência, condições e regras de recomendação."
        actions={isAdmin ? <Button onClick={save}><Save className="h-4 w-4" /> Salvar</Button> : undefined} />
      {error && <Alert tone="error" className="mb-4">{error}</Alert>}
      {ok && <Alert tone="info" className="mb-4">{ok}</Alert>}
      {isAdmin&&<form className="mb-4 flex flex-wrap gap-2" onSubmit={async e=>{e.preventDefault();setError(null);const r=await supabase.rpc('create_catalog_item',{p_code:newCode,p_name:newName,p_type:newType,p_description:'',p_price:null,p_cost:null,p_category:null,p_days:null});if(r.error)setError(r.error.message);else{setNewCode('');setNewName('');load()}}}><Input required aria-label="Código do novo item" placeholder="codigo_unico" value={newCode} onChange={e=>setNewCode(e.target.value)} className="w-44"/><Input required aria-label="Nome do novo item" placeholder="Novo produto/serviço" value={newName} onChange={e=>setNewName(e.target.value)} className="w-64"/><Select aria-label="Tipo do novo item" className="w-36" value={newType} onChange={e=>setNewType(e.target.value)}>{['servico','produto','pacote'].map(x=><option key={x}>{x}</option>)}</Select><Button type="submit">Cadastrar item</Button></form>}
      <Card className="mb-6">
        <Table>
          <THead><tr><TH>Serviço</TH><TH>Preço de</TH><TH>Preço até</TH><TH>Recorrência</TH><TH>Pacote / entregáveis</TH><TH>Pagamento</TH><TH>Ativo</TH></tr></THead>
          <TBody>
            {items.map((s) => (
              <TR key={s.id}>
                <TD className="min-w-[14rem]">
                  {isAdmin ? <Input value={s.name} onChange={(e) => set(s.id, { name: e.target.value })} /> : <p className="font-medium">{s.name}</p>}
                  <p className="mt-1 text-xs text-muted-foreground">{s.description}</p>
                  {isAdmin&&<div className="mt-2 space-y-1"><Input aria-label={`Categoria ${s.name}`} value={s.category??''} placeholder="Categoria" onChange={e=>set(s.id,{category:e.target.value||null})}/><label className="text-xs">Custo unitário<Input type="number" min={0} step="0.01" value={s.unit_cost??''} onChange={e=>set(s.id,{unit_cost:e.target.value===''?null:Number(e.target.value)})}/></label><label className="text-xs">Prazo em dias<Input type="number" min={0} value={s.delivery_days??''} onChange={e=>set(s.id,{delivery_days:e.target.value===''?null:Number(e.target.value)})}/></label></div>}
                  {s.unit_cost!=null&&s.price_from!=null&&s.price_from>0&&<p className="text-xs text-muted-foreground">Margem bruta de referência: {(((s.price_from-s.unit_cost)/s.price_from)*100).toFixed(1)}% (sem impostos/despesas adicionais)</p>}
                </TD>
                <TD>{isAdmin ? <Input className="w-28" inputMode="decimal" defaultValue={s.price_from ?? ''} onBlur={(e) => set(s.id, { price_from: num(e.target.value) })} />
                  : s.price_from != null ? brl.format(s.price_from) : '—'}</TD>
                <TD>{isAdmin ? <Input className="w-28" inputMode="decimal" defaultValue={s.price_to ?? ''} onBlur={(e) => set(s.id, { price_to: num(e.target.value) })} />
                  : s.price_to != null ? brl.format(s.price_to) : '—'}</TD>
                <TD>{isAdmin ? (
                  <Select value={s.recurrence} onChange={(e) => set(s.id, { recurrence: e.target.value })} aria-label="Recorrência">
                    {Object.entries(RECURRENCE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </Select>) : RECURRENCE[s.recurrence]}</TD>
                <TD className="min-w-[14rem]">{isAdmin ? (
                  <div className="space-y-1">
                    <Input value={s.package ?? ''} placeholder="Pacote (ex.: Básico, até 5 páginas)" onChange={(e) => set(s.id, { package: e.target.value || null })} />
                    <Input value={s.deliverables ?? ''} placeholder="Entregáveis" onChange={(e) => set(s.id, { deliverables: e.target.value || null })} />
                  </div>) : <p className="text-xs">{[s.package, s.deliverables].filter(Boolean).join(' · ') || '—'}</p>}</TD>
                <TD>{isAdmin ? <Input value={s.payment_terms ?? ''} placeholder="Ex.: 50% + 50%" onChange={(e) => set(s.id, { payment_terms: e.target.value || null })} /> : s.payment_terms ?? '—'}</TD>
                <TD>{isAdmin ? <input type="checkbox" className="h-4 w-4 accent-primary" checked={s.active} onChange={(e) => set(s.id, { active: e.target.checked })} />
                  : <Badge variant={s.active ? 'success' : 'outline'}>{s.active ? 'sim' : 'não'}</Badge>}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Recomendação por evidência digital</CardTitle>
          <CardDescription>Quando o motor de inteligência digital comprova a condição, o serviço é recomendado com o motivo. As regras por CNAE ficam em Administração.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <THead><tr><TH>Condição verificada</TH><TH>Serviço</TH><TH>Relevância</TH><TH>Motivo</TH><TH>Ativa</TH></tr></THead>
            <TBody>
              {rules.map((r) => (
                <TR key={r.id}>
                  <TD>{CONDITION[r.condition] ?? r.condition}</TD>
                  <TD>{items.find((s) => s.id === r.service_id)?.name}</TD>
                  <TD>{isAdmin ? <Input type="number" min={0} max={100} className="w-20" value={r.relevance}
                    onChange={(e) => setRules(rules.map((x) => x.id === r.id ? { ...x, relevance: Number(e.target.value) } : x))} /> : r.relevance}</TD>
                  <TD>{isAdmin ? <Input value={r.reason} onChange={(e) => setRules(rules.map((x) => x.id === r.id ? { ...x, reason: e.target.value } : x))} /> : r.reason}</TD>
                  <TD>{isAdmin ? <input type="checkbox" className="h-4 w-4 accent-primary" checked={r.active}
                    onChange={(e) => setRules(rules.map((x) => x.id === r.id ? { ...x, active: e.target.checked } : x))} /> : r.active ? 'sim' : 'não'}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </>
  )
}
