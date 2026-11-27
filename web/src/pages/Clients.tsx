import { useCallback, useEffect, useState } from 'react'
import { Download, Loader2, RefreshCw } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { brl, formatDate, nf } from '@/lib/utils'
import { CONTRACT_STATUS, downloadCsv, RECURRENCE, useOpenLead } from '@/lib/crm'
import { PageHeader } from '@/components/layout/AppLayout'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Alert } from '@/components/ui/alert'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { CustomerSuccess } from '@/components/CustomerSuccess'

interface Row {
  id: string; lead_id: string; title: string; total_value: number | null; recurring_value: number | null; recurrence: string
  status: string; signed_at: string | null; start_date: string | null; end_date: string | null; payment_terms: string | null
  leads: { cnpj: string; establishments: { nome_fantasia: string | null; uf: string | null }; companies: { razao_social: string | null } }
}
const monthly = (r: Row) => {
  const v = Number(r.recurring_value ?? 0)
  return ({ mensal: v, trimestral: v / 3, semestral: v / 6, anual: v / 12 } as Record<string, number>)[r.recurrence] ?? 0
}

export default function Clients() {
  const openLead = useOpenLead()
  const [status, setStatus] = useState('ativo')
  const [selectedContract,setSelectedContract]=useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    let q = supabase.from('contracts')
      .select('id,lead_id,title,total_value,recurring_value,recurrence,status,signed_at,start_date,end_date,payment_terms, leads!inner(cnpj, establishments!inner(nome_fantasia,uf), companies!inner(razao_social))')
    if (status) q = q.eq('status', status)
    const { data, error } = await q.order('signed_at', { ascending: false, nullsFirst: false }).limit(500)
    if (error) setError(error.message)
    setRows((data as unknown as Row[]) ?? [])
    setLoading(false)
  }, [status])
  useEffect(() => { load() }, [load])

  const clientes = new Set(rows.map((r) => r.lead_id)).size
  const total = rows.reduce((a, r) => a + Number(r.total_value ?? 0), 0)
  const mrr = rows.filter((r) => r.status === 'ativo').reduce((a, r) => a + monthly(r), 0)

  return (
    <>
      <PageHeader title="Clientes" description="Empresas com contrato: receita contratada, recorrência e pós-venda."
        actions={<>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-40" aria-label="Situação">
            <option value="">Todos os contratos</option>
            {Object.entries(CONTRACT_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Button variant="outline" onClick={() => downloadCsv('clientes.csv', [['Cliente', 'CNPJ', 'Contrato', 'Valor', 'Recorrente', 'Recorrência', 'Situação', 'Assinatura', 'Início', 'Fim'],
            ...rows.map((r) => [r.leads.establishments.nome_fantasia || r.leads.companies.razao_social, r.leads.cnpj, r.title, r.total_value, r.recurring_value,
              RECURRENCE[r.recurrence], CONTRACT_STATUS[r.status], r.signed_at, r.start_date, r.end_date])])}><Download className="h-4 w-4" /> Excel</Button>
          <Button variant="outline" onClick={load} disabled={loading}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}</Button>
        </>} />
      {error && <Alert tone="error" className="mb-4">{error}</Alert>}
      <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4">
        {[['Clientes', nf.format(clientes)], ['Contratos', nf.format(rows.length)], ['Receita contratada', brl.format(total)], ['Receita recorrente mensal (ativos)', brl.format(mrr)]].map(([k, v]) => (
          <Card key={k}><CardHeader><CardDescription>{k}</CardDescription><CardTitle className="text-xl">{v}</CardTitle></CardHeader></Card>
        ))}
      </div>
      <div className="mb-4 space-y-3"><Select aria-label="Contrato para pós-venda" value={selectedContract} onChange={e=>setSelectedContract(e.target.value)}><option value="">Selecionar contrato para acompanhamento</option>{rows.map(r=><option key={r.id} value={r.id}>{r.leads.establishments.nome_fantasia||r.leads.companies.razao_social} · {r.title}</option>)}</Select>{selectedContract&&<CustomerSuccess key={selectedContract} contractId={selectedContract}/>}</div>
      <p className="mb-3 text-xs text-muted-foreground">Indicadores desta lista consideram até 500 contratos carregados com os filtros atuais.</p>
      <Card>
        <Table>
          <THead><tr><TH>Cliente</TH><TH>Contrato</TH><TH>Valor</TH><TH>Recorrente</TH><TH>Situação</TH><TH>Assinatura</TH><TH>Vigência</TH></tr></THead>
          <TBody>
            {rows.length === 0 && <tr><TD colSpan={7} className="py-8 text-center text-muted-foreground">Nenhum contrato.</TD></tr>}
            {rows.map((r) => (
              <TR key={r.id} className="cursor-pointer" onClick={() => openLead(r.lead_id)}>
                <TD className="font-medium">{r.leads.establishments.nome_fantasia || r.leads.companies.razao_social}</TD>
                <TD>{r.title}{r.payment_terms && <p className="text-xs text-muted-foreground">{r.payment_terms}</p>}</TD>
                <TD className="tabular-nums">{r.total_value != null ? brl.format(r.total_value) : '—'}</TD>
                <TD className="tabular-nums">{r.recurring_value ? `${brl.format(r.recurring_value)} · ${RECURRENCE[r.recurrence]}` : '—'}</TD>
                <TD><Badge variant={r.status === 'ativo' ? 'success' : r.status === 'cancelado' ? 'danger' : 'secondary'}>{CONTRACT_STATUS[r.status]}</Badge></TD>
                <TD className="text-xs">{formatDate(r.signed_at)}</TD>
                <TD className="text-xs">{formatDate(r.start_date)} – {formatDate(r.end_date)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
    </>
  )
}
