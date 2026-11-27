import React from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
const mocks = vi.hoisted(() => ({ query: {} as Record<string, unknown>, open: vi.fn() }))
vi.mock('@/lib/cache', () => ({ useCachedQuery: () => mocks.query, friendlyError: (s: string) => s }))
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn() } }))
vi.mock('@/components/layout/AppLayout', () => ({ PageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }))
vi.mock('@/lib/crm', () => ({ useOpenLead: () => mocks.open, PRIORITY_VARIANT: () => 'success' }))
import MyOperation from '../src/pages/MyOperation'
const empty = { empresas_recomendadas: [], follow_ups_atrasados: [], reunioes_hoje: [], propostas_pendentes: [],
  oportunidades_prioritarias: [], total_oportunidades_abertas: 0, total_tarefas_atrasadas: 0,
  total_reunioes_hoje: 0, total_propostas_pendentes: 0, atualizado_em: '2026-11-27T12:00:00Z', fuso_horario: 'America/Sao_Paulo' }
beforeEach(() => { mocks.open.mockClear(); mocks.query = { data: empty, loading: false, error: null, savedAt: null, reload: vi.fn() } })
it('não transforma erro de consulta em ausência de tarefas', () => {
  mocks.query = { ...mocks.query, data: null, error: 'Servidor indisponível' }
  render(<MyOperation />)
  expect(screen.getByText('Servidor indisponível')).toBeTruthy()
  expect(screen.queryByText('Nenhum follow-up atrasado')).toBeNull()
  expect(screen.queryByText(/Nenhuma reunião marcada/)).toBeNull()
})
it('exibe os totais completos e abre o registro selecionado', async () => {
  mocks.query = { ...mocks.query, data: { ...empty, total_tarefas_atrasadas: 25, follow_ups_atrasados: [
    { id: 't1', title: 'Ligar', empresa: 'Empresa de teste', due_at: '2026-11-26T12:00:00Z', lead_id: 'lead1' }] } }
  render(<MyOperation />)
  expect(screen.getByText('Tarefas e follow-ups atrasados (25)')).toBeTruthy()
  await userEvent.setup().click(screen.getByRole('button', { name: /Ligar/ }))
  expect(mocks.open).toHaveBeenCalledWith('lead1')
})
it('informa metodologia e estado vazio somente após consulta bem-sucedida', () => {
  render(<MyOperation />)
  expect(screen.getByText(/Dia comercial: America\/Sao_Paulo/)).toBeTruthy()
  expect(screen.getByText('Nenhuma oportunidade aberta sob sua responsabilidade')).toBeTruthy()
})
