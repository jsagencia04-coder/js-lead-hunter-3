import { useState } from 'react'
import { useCachedQuery } from '@/lib/cache'
import { DataStatus } from '@/components/DataStatus'
import { Link } from 'react-router-dom'
import { BarChart3, Loader2, RefreshCw } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { ChartItem, CommercialMetrics, DashboardMetrics } from '@/lib/types'
import { PerfTable, type Executive } from '@/pages/Reports'
import { brl, formatDate, formatDateTime, nf, UFS } from '@/lib/utils'
import { PageHeader } from '@/components/layout/AppLayout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { KpiGridSkeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { useAuth } from '@/hooks/useAuth'

const JOB_STATUS: Record<string, string> = {
  pendente: 'Aguardando o worker', baixando: 'Baixando arquivos', processando: 'Processando',
  validando: 'Validando', concluido: 'Concluída', falhou: 'Falhou', cancelado: 'Cancelada',
}

const n = (v: unknown) => (v === null || v === undefined ? undefined : Number(v))

export default function Dashboard() {
  const { hasRole } = useAuth()
  const [uf, setUf] = useState('')
  const rpc = <T,>(fn: string) => async () => {
    const r = await supabase.rpc(fn, { p_uf: uf || null })
    return { data: (r.data as T) ?? null, error: r.error?.message ?? null }
  }
  const qd = useCachedQuery<DashboardMetrics>(`dash:base:${uf}`, rpc<DashboardMetrics>('dashboard_metrics'), [uf])
  const qc = useCachedQuery<CommercialMetrics>(`dash:com:${uf}`, rpc<CommercialMetrics>('commercial_metrics'), [uf])
  const qx = useCachedQuery<Executive>(`dash:exec:${uf}`, rpc<Executive>('executive_metrics'), [uf])
  const data = qd.data, com = qc.data, ex = qx.data
  const loading = qd.loading || qc.loading || qx.loading
  const load = () => { qd.reload(); qc.reload(); qx.reload() }
  const failed = [qd, qc, qx].find((q) => q.error)

  const cur = data?.competencia_vigente
  const semDados = data && data.total === 0
  const primeiraCarga = loading && !data && !com && !ex

  return (
    <>
      <PageHeader
        title="Visão geral"
        description="Indicadores reais do banco: comerciais (CRM) separados dos cadastrais (Receita Federal) e da inteligência digital."
        actions={
          <>
            <Select value={uf} onChange={(e) => setUf(e.target.value)} className="w-36" aria-label="Filtrar por UF">
              <option value="">Brasil</option>
              {UFS.map((u) => <option key={u} value={u}>{u}</option>)}
            </Select>
            <Button variant="outline" onClick={load} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Atualizar
            </Button>
          </>
        }
      />

      <DataStatus loading={loading} error={failed?.error ?? null} savedAt={failed?.savedAt ?? qd.savedAt}
        hasData={!!(data || com || ex)} className="mb-6" />

      <Card className="mb-6">
        <CardContent className="flex flex-col gap-2 pt-5 text-sm md:flex-row md:items-center md:gap-8">
          <div>
            <span className="text-muted-foreground">Competência vigente: </span>
            <strong>{cur ? cur.competence : 'nenhuma importação concluída'}</strong>
          </div>
          {cur && (
            <div>
              <span className="text-muted-foreground">Data de referência: </span>
              <strong>{formatDate(cur.reference_date)}</strong>
            </div>
          )}
          <div>
            <span className="text-muted-foreground">Última coleta: </span>
            <strong>
              {data?.ultimo_job
                ? `${JOB_STATUS[data.ultimo_job.status] ?? data.ultimo_job.status} · ${formatDateTime(data.ultimo_job.created_at)}`
                : 'nunca executada'}
            </strong>
          </div>
        </CardContent>
      </Card>

      {semDados && (
        <Alert tone="info" title="Ainda não há dados importados" className="mb-6">
          A base pública do CNPJ é atualizada por competência (não em tempo real). Os indicadores serão
          preenchidos quando o worker concluir a primeira importação oficial.{' '}
          {hasRole('admin', 'gestor') && <Link to="/importacao" className="font-medium underline">Ver central de importação</Link>}
        </Alert>
      )}

      <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Indicadores comerciais · {formatDate(ex?.periodo?.de)} a {formatDate(ex?.periodo?.ate)} (receita do período)</h2>
      {primeiraCarga ? <KpiGridSkeleton count={12} /> : (
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Leads qualificados" value={n(ex?.comerciais.leads_qualificados)} />
        <Kpi label="Leads contatados" value={n(ex?.comerciais.leads_contatados)} />
        <Kpi label="Respostas recebidas" value={n(ex?.comerciais.respostas_recebidas)} />
        <Kpi label="Reuniões agendadas" value={n(ex?.comerciais.reunioes_agendadas)} />
        <Kpi label="Propostas enviadas" value={n(ex?.comerciais.propostas_enviadas)} />
        <Kpi label="Valor em negociação" value={n(ex?.comerciais.valor_em_negociacao)} money />
        <Kpi label="Receita contratada (período)" value={n(ex?.comerciais.receita_contratada_periodo)} money accent />
        <Kpi label="Receita recorrente mensal" value={n(ex?.comerciais.receita_recorrente_mensal)} money accent />
        <Kpi label="Ticket médio" value={n(ex?.comerciais.ticket_medio)} money />
        <Kpi label="Tempo médio de fechamento (dias)" value={n(ex?.comerciais.tempo_medio_fechamento_dias)} />
        <Kpi label="Conversão (oportunidades)" value={n(ex?.comerciais.taxa_conversao_oportunidades)} suffix="%" />
        <Kpi label="Follow-ups atrasados" value={n(ex?.comerciais.follow_ups_atrasados)} />
      </div>
      )}
      {ex && (
        <details className="mt-2 text-xs text-muted-foreground">
          <summary className="cursor-pointer">Como cada taxa é calculada</summary>
          <ul className="mt-1 list-disc pl-5">
            {Object.entries(ex.denominadores).map(([k, v]) => <li key={k}><strong>{k.replace(/_/g, ' ')}</strong>: {v}</li>)}
            <li><strong>conversão de contatados</strong>: {ex.comerciais.taxa_conversao_contatados ?? '—'}%</li>
          </ul>
        </details>
      )}

      <h2 className="mb-3 mt-8 text-sm font-semibold text-muted-foreground">Inteligência e base histórica</h2>
      {primeiraCarga ? <KpiGridSkeleton count={12} /> : (
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Total histórico de empresas" value={n(ex?.cadastrais.total_historico)} />
        <Kpi label="Empresas pesquisadas" value={n(ex?.cadastrais.pesquisadas)} />
        <Kpi label="Pendentes de pesquisa" value={n(ex?.cadastrais.pendentes_pesquisa)} />
        <Kpi label="Sites localizados" value={n(ex?.cadastrais.sites_localizados)} />
        <Kpi label="Instagram localizado" value={n(ex?.cadastrais.instagram_localizado)} />
        <Kpi label="Facebook localizado" value={n(ex?.cadastrais.facebook_localizado)} />
        <Kpi label="Perfil no Google localizado" value={n(ex?.cadastrais.google_localizado)} />
        <Kpi label="Oportunidades digitais identificadas" value={n(ex?.cadastrais.oportunidades_identificadas)} accent />
        <Kpi label="Leads novos na competência" value={com?.leads_novos_competencia} />
        <Kpi label="Leads alta prioridade" value={com?.leads_alta} accent />
        <Kpi label="Clientes convertidos" value={com?.clientes_convertidos} />
        <Kpi label="Leads na base" value={com?.leads_total} />
      </div>
      )}
      {ex && Array.isArray(ex.cadastrais.novas_por_competencia) && (
        <p className="mt-2 text-xs text-muted-foreground">Novas empresas por competência: {(ex.cadastrais.novas_por_competencia as { competencia: string; total: number }[])
          .map((x) => `${x.competencia}: ${nf.format(x.total)}`).join(' · ') || '—'}</p>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <PerfTable title="Desempenho por responsável" rows={ex?.por_responsavel ?? []} />
        <PerfTable title="Desempenho por serviço" rows={ex?.por_servico ?? []} />
        <PerfTable title="Desempenho por segmento" rows={ex?.por_segmento ?? []} />
        <PerfTable title="Desempenho por região" rows={ex?.por_regiao ?? []} />
      </div>

      <h2 className="mb-3 mt-8 text-sm font-semibold text-muted-foreground">Base de empresas (Receita Federal)</h2>
      {primeiraCarga ? <KpiGridSkeleton count={8} /> : (
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
        <Kpi label="Empresas encontradas" value={data?.total} />
        <Kpi label="Empresas ativas" value={data?.ativas} />
        <Kpi label="Abertas · 7 dias" value={data?.ultimos_7} />
        <Kpi label="Abertas · 15 dias" value={data?.ultimos_15} />
        <Kpi label="Abertas · 30 dias" value={data?.ultimos_30} />
        <Kpi label="Abertas · 90 dias" value={data?.ultimos_90} />
        <Kpi label="Com telefone" value={data?.com_telefone} />
        <Kpi label="Com e-mail" value={data?.com_email} />
      </div>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        Períodos contados a partir da data de referência da base ({formatDate(data?.data_referencia)}), pela data de início de atividade.
        A base pública da Receita é publicada por competência, com defasagem. Situação cadastral ativa não comprova regularidade fiscal.
      </p>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <BarList title="Distribuição geográfica: empresas ativas por estado" items={data?.por_uf} />
        <BarList title="Top 10 municípios" items={data?.por_municipio} />
        <BarList title="Top 10 CNAEs principais" items={data?.por_cnae} />
        <BarList title="Por porte" items={data?.por_porte} />
        <BarList title="Abertura por mês (últimos 12 meses)" items={data?.por_mes_abertura} keepOrder />
      </div>
    </>
  )
}

function Kpi({ label, value, accent, suffix, money }: { label: string; value: number | undefined; accent?: boolean; suffix?: string; money?: boolean }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`mt-1 text-2xl font-semibold tabular-nums ${accent ? 'text-primary' : ''}`}>
          {value === undefined || value === null ? '—' : money ? brl.format(value) : nf.format(value) + (suffix ?? '')}
        </p>
      </CardContent>
    </Card>
  )
}

function BarList({ title, items, keepOrder }: { title: string; items: ChartItem[] | undefined; keepOrder?: boolean }) {
  const list = (items ?? []).slice(0, keepOrder ? 12 : 27)
  const max = Math.max(1, ...list.map((i) => i.total))
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      {list.length > 0 ? (
        <CardContent className="space-y-1.5">
          {list.map((i) => (
            <div key={i.label ?? 'nd'} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 text-xs">
              <span className="truncate" title={i.label ?? ''}>{i.label ?? 'Não informado'}</span>
              <div className="h-2.5 rounded-full bg-muted">
                <div className="h-2.5 rounded-full bg-primary" style={{ width: `${(i.total / max) * 100}%` }} />
              </div>
              <span className="w-14 text-right tabular-nums text-muted-foreground">{nf.format(i.total)}</span>
            </div>
          ))}
        </CardContent>
      ) : (
        <CardContent className="pt-0">
          <EmptyState icon={BarChart3} title="Sem dados na competência atual" />
        </CardContent>
      )}
    </Card>
  )
}
