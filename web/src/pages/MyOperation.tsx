// "Minha Operação" (upgrade v3, item 17): central diária do responsável comercial —
// empresas recomendadas, follow-ups atrasados, reuniões de hoje, propostas pendentes
// e oportunidades prioritárias, consumindo a função my_operation_summary (dados reais).
import { CalendarClock, FileText, KanbanSquare, Loader2, RefreshCw, Target, Users } from 'lucide-react'
import { useCachedQuery } from '@/lib/cache'
import { DataStatus } from '@/components/DataStatus'
import { supabase } from '@/lib/supabase'
import { brl, formatDate, formatDateTime, nf } from '@/lib/utils'
import { PRIORITY_VARIANT, useOpenLead } from '@/lib/crm'
import { PageHeader } from '@/components/layout/AppLayout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { RowsSkeleton } from '@/components/ui/skeleton'

interface Recomendada { id: string; cnpj: string; empresa: string | null; score: number; priority: string; servico_nome: string | null; municipio: string | null; uf: string | null }
interface FollowUp { id: string; title: string; due_at: string; kind: string; empresa: string | null; lead_id: string }
interface Proposta { id: string; title: string; status: string; valid_until: string | null; amount: number | null; lead_id: string; empresa: string | null }
interface OportunidadePrioritaria { id: string; title: string; value: number | null; stage_code: string; stage_label: string; expected_close: string | null; empresa: string | null; lead_id: string }
interface Summary {
  empresas_recomendadas: Recomendada[]
  follow_ups_atrasados: FollowUp[]
  reunioes_hoje: FollowUp[]
  propostas_pendentes: Proposta[]
  oportunidades_prioritarias: OportunidadePrioritaria[]
  total_oportunidades_abertas: number
  total_tarefas_atrasadas: number
  total_reunioes_hoje: number
  total_propostas_pendentes: number
  fuso_horario: string
  atualizado_em: string
}

export default function MyOperation() {
  const openLead = useOpenLead()
  const q = useCachedQuery<Summary>('minha-operacao', async () => {
    const r = await supabase.rpc('my_operation_summary')
    return { data: (r.data as Summary) ?? null, error: r.error?.message ?? null }
  }, [])
  const s = q.data

  return (
    <>
      <PageHeader title="Minha operação" description="O que fazer hoje: empresas recomendadas, follow-ups, reuniões e propostas pendentes."
        actions={<Button variant="outline" onClick={q.reload} disabled={q.loading}>
          {q.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Atualizar
        </Button>} />
      <DataStatus loading={q.loading} error={q.error} savedAt={q.savedAt} hasData={!!s} className="mb-6" />

      {s && <p className="mb-4 text-xs text-muted-foreground">
        Atualizado em {formatDateTime(s.atualizado_em)} · Dia comercial: {s.fuso_horario}.
        Recomendações: até 10 empresas atribuídas a você, fora do funil e não bloqueadas, por pontuação.
        Listas exibem até 20 tarefas/reuniões, 15 propostas e 10 oportunidades (por valor potencial, não receita garantida).
      </p>}
      {q.loading && !s ? <RowsSkeleton rows={6} /> : s ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><CalendarClock className="h-4 w-4 text-red-600" /> Tarefas e follow-ups atrasados ({nf.format(s.total_tarefas_atrasadas)})</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {!s?.follow_ups_atrasados.length ? <EmptyState title="Nenhum follow-up atrasado" /> : s.follow_ups_atrasados.map((t) => (
                <button key={t.id} onClick={() => openLead(t.lead_id)} className="flex w-full items-center justify-between gap-2 rounded-md border border-red-200 bg-red-50 p-2 text-left text-sm hover:bg-red-100">
                  <span className="truncate">{t.title} · <strong>{t.empresa}</strong></span>
                  <span className="shrink-0 text-xs text-red-700">{formatDateTime(t.due_at)}</span>
                </button>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Users className="h-4 w-4" /> Reuniões de hoje ({nf.format(s.total_reunioes_hoje)})</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {!s?.reunioes_hoje.length ? <EmptyState title="Nenhuma reunião marcada para hoje" /> : s.reunioes_hoje.map((t) => (
                <button key={t.id} onClick={() => openLead(t.lead_id)} className="flex w-full items-center justify-between gap-2 rounded-md border p-2 text-left text-sm hover:bg-accent">
                  <span className="truncate">{t.title} · <strong>{t.empresa}</strong></span>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(t.due_at)}</span>
                </button>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Target className="h-4 w-4 text-primary" /> Empresas recomendadas ({s?.empresas_recomendadas.length ?? 0})</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {!s?.empresas_recomendadas.length ? <EmptyState title="Nenhuma recomendação pendente" description="Empresas sob sua responsabilidade, fora do funil, aparecem aqui por pontuação." /> : s.empresas_recomendadas.map((r) => (
                <button key={r.id} onClick={() => openLead(r.id)} className="flex w-full items-center justify-between gap-2 rounded-md border p-2 text-left text-sm hover:bg-accent">
                  <span className="min-w-0 truncate">
                    <strong>{r.empresa}</strong>
                    <span className="block text-xs text-muted-foreground">{r.servico_nome ?? 'Sem recomendação específica'} · {r.municipio}/{r.uf}</span>
                  </span>
                  <Badge variant={PRIORITY_VARIANT(r.priority)} className="shrink-0">{r.score}</Badge>
                </button>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><FileText className="h-4 w-4" /> Propostas pendentes ({nf.format(s.total_propostas_pendentes)})</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {!s?.propostas_pendentes.length ? <EmptyState title="Nenhuma proposta pendente" /> : s.propostas_pendentes.map((p) => (
                <button key={p.id} onClick={() => openLead(p.lead_id)} className="flex w-full items-center justify-between gap-2 rounded-md border p-2 text-left text-sm hover:bg-accent">
                  <span className="min-w-0 truncate">
                    <strong>{p.empresa}</strong>
                    <span className="block text-xs text-muted-foreground">{p.title} · {p.status === 'em_negociacao' ? 'em negociação' : p.status}</span>
                  </span>
                  <span className="shrink-0 text-right text-xs text-muted-foreground">
                    {p.amount != null && <span className="block">{brl.format(p.amount)}</span>}
                    {p.valid_until && <span>válida até {formatDate(p.valid_until)}</span>}
                  </span>
                </button>
              ))}
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader><CardTitle className="flex items-center gap-2"><KanbanSquare className="h-4 w-4" /> Oportunidades prioritárias ({nf.format(s?.total_oportunidades_abertas ?? 0)} abertas no total)</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {!s?.oportunidades_prioritarias.length ? <EmptyState title="Nenhuma oportunidade aberta sob sua responsabilidade" /> : s.oportunidades_prioritarias.map((o) => (
                <button key={o.id} onClick={() => openLead(o.lead_id)} className="flex w-full items-center justify-between gap-2 rounded-md border p-2 text-left text-sm hover:bg-accent">
                  <span className="min-w-0 truncate">
                    <strong>{o.empresa}</strong>
                    <span className="block text-xs text-muted-foreground">{o.title} · {o.stage_label}</span>
                  </span>
                  <span className="shrink-0 text-right text-xs text-muted-foreground">
                    {o.value != null && <span className="block font-medium text-foreground">{brl.format(o.value)}</span>}
                    {o.expected_close && <span>previsto {formatDate(o.expected_close)}</span>}
                  </span>
                </button>
              ))}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </>
  )
}
