import React from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
const state = vi.hoisted(() => ({ role: 'admin' }))
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ profile: { full_name: 'Teste', role: state.role },
  hasRole: (...roles: string[]) => roles.includes(state.role), signOut: vi.fn() }) }))
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn().mockResolvedValue({ data: { atrasadas: 2 } }) } }))
vi.mock('@/components/LeadDrawer', () => ({ LeadDrawer: () => null }))
import { AppLayout } from '../src/components/layout/AppLayout'
function fixture() {
  render(<MemoryRouter initialEntries={['/']}><Routes><Route element={<AppLayout />}>
    <Route index element={<h1>Dashboard teste</h1>} />
    <Route path="minha-operacao" element={<h1>Painel pessoal teste</h1>} />
  </Route></Routes></MemoryRouter>)
}
beforeEach(() => { state.role = 'admin'; localStorage.clear() })
it('navega para Minha Operação com o router atualizado', async () => {
  fixture()
  await userEvent.setup().click(screen.getByRole('link', { name: 'Minha operação' }))
  expect(screen.getByRole('heading', { name: 'Painel pessoal teste' })).toBeTruthy()
})
it('recolhe grupos e persiste a preferência', async () => {
  fixture()
  await userEvent.setup().click(screen.getByRole('button', { name: 'Recolher Operação comercial' }))
  expect(screen.queryByRole('link', { name: 'Minha operação' })).toBeNull()
  expect(JSON.parse(localStorage.getItem('jslh:menu-recolhido')!).operacao).toBe(true)
})
it('preserva restrições de menu e tolera preferência inválida', () => {
  state.role = 'leitura'; localStorage.setItem('jslh:menu-recolhido', 'null'); fixture()
  expect(screen.queryByRole('link', { name: 'Administração' })).toBeNull()
  expect(screen.queryByRole('link', { name: 'Central de importação' })).toBeNull()
  expect(screen.getByRole('link', { name: 'Base de empresas' })).toBeTruthy()
})
