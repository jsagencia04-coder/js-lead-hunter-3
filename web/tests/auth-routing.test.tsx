import React from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
const auth = vi.hoisted(() => ({ session: null as unknown, profile: null as unknown, loading: false, allowed: false }))
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ ...auth, hasRole: () => auth.allowed }) }))
import { RequireAuth, RequireRole } from '../src/components/layout/RequireAuth'
function fixture() {
  render(<MemoryRouter initialEntries={['/privado']}><Routes>
    <Route path="/login" element={<h1>Entrar no sistema</h1>} />
    <Route path="/privado" element={<RequireAuth><RequireRole roles={['admin']}><h1>Área restrita</h1></RequireRole></RequireAuth>} />
  </Routes></MemoryRouter>)
}
beforeEach(() => { auth.session = null; auth.profile = null; auth.loading = false; auth.allowed = false })
it('redireciona visitante para login com o router atualizado', () => {
  fixture(); expect(screen.getByRole('heading', { name: 'Entrar no sistema' })).toBeTruthy()
})
it('bloqueia perfil inativo', () => {
  auth.session = {}; auth.profile = { active: false }; fixture()
  expect(screen.getByText('Acesso desativado')).toBeTruthy()
  expect(screen.queryByRole('heading', { name: 'Área restrita' })).toBeNull()
})
it('bloqueia rota administrativa sem papel autorizado', () => {
  auth.session = {}; auth.profile = { active: true }; fixture()
  expect(screen.getByText('Sem permissão')).toBeTruthy()
})
it('libera usuário ativo com o papel necessário', () => {
  auth.session = {}; auth.profile = { active: true }; auth.allowed = true; fixture()
  expect(screen.getByRole('heading', { name: 'Área restrita' })).toBeTruthy()
})
