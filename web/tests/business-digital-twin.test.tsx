import React from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
const state = vi.hoisted(() => ({ role: 'leitura', rpc: vi.fn(), history: [] as unknown[] }))
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ hasRole: (...roles: string[]) => roles.includes(state.role) }) }))
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: state.rpc, from: () => ({ select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: state.history, error: null }) }) }) }) }) } }))
import { BusinessDigitalTwin, TwinView, type Twin } from '../src/components/BusinessDigitalTwin'
const twin: Twin = {
 version: { id: 1, name: 'Regras reais', max_age_days: 90, weights: { site: 40, instagram: 15, facebook: 10, google_business: 15, linkedin: 10, whatsapp: 10 } },
 scores: { digital_opportunity: null, commercial_fit: 70, data_confidence: 0, coverage_percent: 0 },
 dimensions: [{ id: 'mobile', label: 'Experiência mobile', score: null, methodology: 'Sem teste disponível', status: 'nao_aferido', source: null, checked_at: null, confidence: null, evidence: null, url: null }],
 channels: [{ platform: 'site', status: 'inconclusivo', weight: 40, confidence: 0, checked_at: null, usable: false, opportunity: null, evidence: [{ detalhe: 'Timeout observado' }], source: 'dominio_email' }],
 recommendations: [], methodology: { digital_opportunity: 'Somente evidência recente' }, blocked_for_contact: false, calculated_at: '2026-11-27T10:00:00Z',
}
beforeEach(() => { state.role = 'leitura'; state.rpc.mockReset(); state.history = [] })
it('não inventa nota quando não houve evidência conclusiva', () => {
 render(<TwinView data={twin} />)
 expect(screen.getAllByText('Não aferido').length).toBe(2)
 expect(screen.getByText(/Cobertura do DOS: 0%/)).toBeTruthy()
 expect(screen.queryByRole('meter')).toBeNull()
})
it('mostra evidencia e restrição ao contato, sem apresentá-las como autorização de abordagem', async () => {
 render(<TwinView data={{ ...twin, blocked_for_contact: true }} />)
 expect(screen.getByText(/oposição ao contato/)).toBeTruthy()
 await userEvent.setup().click(screen.getByText('Evidências e cobertura por canal'))
 expect(screen.getByText('Timeout observado')).toBeTruthy()
 expect(screen.getByText(/Nenhum score é probabilidade de compra/)).toBeTruthy()
})
it('leitura pode consultar mas não capturar ou alterar pesos', async () => {
 state.rpc.mockResolvedValue({ data: twin, error: null })
 render(<BusinessDigitalTwin leadId="lead-1" />)
 await screen.findByText(/Regras reais/)
 expect(state.rpc).toHaveBeenCalledWith('company_digital_twin', { p_lead_id: 'lead-1' })
 expect(screen.queryByRole('button', { name: 'Registrar retrato atual' })).toBeNull()
 expect(screen.queryByText('Configurar nova versão de pontuação')).toBeNull()
})
it('captura usa ferramenta autorizada e atualiza histórico sem SQL arbitrário', async () => {
 state.role = 'comercial'
 state.rpc.mockImplementation(async (method: string) => ({ data: method === 'capture_company_twin' ? 12 : twin, error: null }))
 render(<BusinessDigitalTwin leadId="lead-1" />)
 await screen.findByText(/Regras reais/)
 await userEvent.setup().click(screen.getByRole('button', { name: 'Registrar retrato atual' }))
 await waitFor(() => expect(state.rpc).toHaveBeenCalledWith('capture_company_twin', { p_lead_id: 'lead-1' }))
 expect(await screen.findByText(/Retrato 12 registrado/)).toBeTruthy()
})
it('resposta tardia de outra empresa não sobrescreve a ficha atual', async () => {
 let resolveOld: (value: unknown) => void = () => {}
 const oldRequest = new Promise((resolve) => { resolveOld = resolve })
 state.rpc.mockImplementation((_method: string, args: { p_lead_id: string }) => args.p_lead_id === 'old' ? oldRequest : Promise.resolve({ data: { ...twin, version: { ...twin.version, name: 'Empresa atual' } }, error: null }))
 const view = render(<BusinessDigitalTwin leadId="old" />)
 view.rerender(<BusinessDigitalTwin leadId="new" />)
 await screen.findByText(/Empresa atual/)
 resolveOld({ data: { ...twin, version: { ...twin.version, name: 'Empresa anterior' } }, error: null })
 await waitFor(() => expect(screen.queryByText(/Empresa anterior/)).toBeNull())
 expect(screen.getByText(/Empresa atual/)).toBeTruthy()
})
it('falha de RPC é visível, não mostra dados de sucesso inventados', async () => {
 state.rpc.mockResolvedValue({ data: null, error: { message: 'Sem permissão' } })
 render(<BusinessDigitalTwin leadId="lead-1" />)
 expect(await screen.findByText('Sem permissão')).toBeTruthy()
 expect(screen.queryByText('Digital Opportunity Score')).toBeNull()
})
