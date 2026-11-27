import React, { useState } from 'react'
import { expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TabList, TabPanel } from '../src/components/ui/tabs'
function Fixture() {
  const [active, setActive] = useState('a')
  return <>
    <TabList tabs={[{ id: 'a', label: 'Cadastro' }, { id: 'b', label: 'CRM' }]} active={active} onChange={setActive} />
    <TabPanel id="a" active={active}><input aria-label="Rascunho" defaultValue="" /></TabPanel>
    <TabPanel id="b" active={active}>Oportunidades</TabPanel>
  </>
}
it('preserva rascunhos quando o usuário alterna abas', async () => {
  const user = userEvent.setup(); render(<Fixture />)
  await user.type(screen.getByLabelText('Rascunho'), 'Anotação em andamento')
  await user.click(screen.getByRole('tab', { name: 'CRM' }))
  expect(screen.getByRole('tabpanel').textContent).toBe('Oportunidades')
  await user.click(screen.getByRole('tab', { name: 'Cadastro' }))
  expect((screen.getByLabelText('Rascunho') as HTMLInputElement).value).toBe('Anotação em andamento')
})
it('suporta teclado, foco e relação entre aba e painel', async () => {
  const user = userEvent.setup(); render(<Fixture />)
  screen.getByRole('tab', { name: 'Cadastro' }).focus()
  await user.keyboard('{ArrowRight}')
  const crm = screen.getByRole('tab', { name: 'CRM' })
  expect(document.activeElement).toBe(crm)
  expect(crm.getAttribute('aria-selected')).toBe('true')
  expect(screen.getByRole('tabpanel').id).toBe(crm.getAttribute('aria-controls'))
  await user.keyboard('{Home}')
  expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Cadastro' }))
})
