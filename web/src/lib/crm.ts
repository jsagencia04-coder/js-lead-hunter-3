// Tipos e rótulos do CRM 2.0 (oportunidades, tarefas, contratos, canais digitais)
import { createContext, useContext } from 'react'

export interface PipelineStage {
  code: string; label: string; sort_order: number; kind: 'aberta' | 'ganha' | 'pos_venda' | 'perdida'
  legacy_stage: string; probability: number; color: string; active: boolean
}
export interface LossReason { id: string; label: string; active: boolean; sort_order: number }

export interface OpportunityRow {
  id: string; lead_id: string; title: string; stage_code: string; stage_label: string; stage_order: number
  status: 'aberta' | 'ganha' | 'pos_venda' | 'perdida'; owner_id: string | null; owner_name: string | null
  value: number | null; recurring_value: number | null; expected_close: string | null; service_ids: string[]
  lost_reason: string | null; lost_reason_label: string | null; won_at: string | null; lost_at: string | null
  stage_changed_at: string; source: string; created_at: string; cnpj: string; cnpj_basico: string; score: number
  priority: 'alta' | 'media' | 'baixa'; razao_social: string | null; nome_fantasia: string | null; uf: string | null
  municipio: string | null; has_phone: boolean; has_email: boolean; next_follow_up_at: string | null; tarefas_abertas: number
  pipeline_id: string; pipeline_name: string; team_id: string | null; team_name: string | null
  probability: number; weighted_value: number; priority_level: string
}

export interface Task {
  id: string; lead_id: string; opportunity_id: string | null; kind: string; title: string; notes: string | null
  due_at: string | null; remind_at: string | null; done_at: string | null; outcome: string | null
  owner_id: string | null; created_at: string
}

export interface Contract {
  id: string; lead_id: string; opportunity_id: string | null; title: string; total_value: number | null
  recurring_value: number | null; recurrence: string; payment_terms: string | null; start_date: string | null
  end_date: string | null; signed_at: string | null; status: string; notes: string | null; created_at: string
}

export interface DigitalChannel {
  id: string; cnpj_basico: string; platform: string; url: string | null; status: string; source: string | null
  evidence: { tipo: string; detalhe: string; peso: number }[]; confidence: number
  result: { nota?: number; problemas?: { codigo: string; gravidade: string; evidencia: string }[]; checks?: Record<string, unknown> }
  candidates: { url?: string; nome?: string; titulo?: string; confianca?: number }[]
  first_checked_at: string | null; last_checked_at: string | null; next_check_at: string | null
  manual: boolean; confirmed_at: string | null
}

export interface Service {
  id: string; code: string; name: string; description: string | null; active: boolean; sort_order: number
  price_from: number | null; price_to: number | null; package: string | null; recurrence: string
  payment_terms: string | null; deliverables: string | null
  item_type: string; category: string | null; unit_cost: number | null; delivery_days: number | null
}

export const TASK_KIND: Record<string, string> = {
  ligacao: 'Ligação', reuniao: 'Reunião', email: 'E-mail', whatsapp: 'WhatsApp', visita: 'Visita',
  tarefa: 'Tarefa', follow_up: 'Follow-up', pos_venda: 'Pós-venda',
}
export const RECURRENCE: Record<string, string> = {
  unico: 'Pagamento único', mensal: 'Mensal', trimestral: 'Trimestral', semestral: 'Semestral', anual: 'Anual',
}
export const CONTRACT_STATUS: Record<string, string> = { ativo: 'Ativo', concluido: 'Concluído', cancelado: 'Cancelado', suspenso: 'Suspenso' }
export const PLATFORM: Record<string, string> = {
  site: 'Site', instagram: 'Instagram', facebook: 'Facebook', google_business: 'Perfil no Google',
  linkedin: 'LinkedIn', whatsapp: 'WhatsApp',
}
export const CHANNEL_STATUS: Record<string, { label: string; variant: 'success' | 'warning' | 'danger' | 'outline' | 'secondary' }> = {
  pendente: { label: 'Pendente', variant: 'outline' },
  em_processamento: { label: 'Em processamento', variant: 'secondary' },
  verificado: { label: 'Encontrado e verificado', variant: 'success' },
  possivel: { label: 'Possível correspondência', variant: 'warning' },
  nao_localizado: { label: 'Não localizado', variant: 'danger' },
  inconclusivo: { label: 'Inconclusivo', variant: 'secondary' },
  erro_temporario: { label: 'Erro temporário', variant: 'secondary' },
}
export const STAGE_COLOR: Record<string, string> = {
  slate: 'bg-slate-400', sky: 'bg-sky-500', amber: 'bg-amber-500', violet: 'bg-violet-500', orange: 'bg-orange-500',
  emerald: 'bg-emerald-500', teal: 'bg-teal-500', red: 'bg-red-500',
}
export const PRIORITY_VARIANT = (p: string | null | undefined) =>
  (p === 'alta' ? 'success' : p === 'media' ? 'warning' : 'outline') as 'success' | 'warning' | 'outline'

export function toCsv(rows: (string | number | null | undefined)[][]) {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  return '﻿' + rows.map((r) => r.map(esc).join(';')).join('\r\n')
}
export function downloadCsv(name: string, rows: (string | number | null | undefined)[][]) {
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}

// Abre a ficha do lead de qualquer tela (pesquisa global, agenda, propostas...)
export const LeadDrawerContext = createContext<(id: string) => void>(() => {})
export const useOpenLead = () => useContext(LeadDrawerContext)
