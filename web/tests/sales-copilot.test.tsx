import React from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
const mock=vi.hoisted(()=>({role:'comercial',rpc:vi.fn(),open:vi.fn()}))
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({hasRole:(...r:string[])=>r.includes(mock.role)})}))
vi.mock('@/lib/crm',()=>({useOpenLead:()=>mock.open}))
vi.mock('@/lib/supabase',()=>({supabase:{rpc:mock.rpc}}))
vi.mock('@/components/layout/AppLayout',()=>({PageHeader:({title}:any)=><h1>{title}</h1>}))
import SalesCopilot from '../src/pages/SalesCopilot'
beforeEach(()=>{mock.role='comercial';mock.rpc.mockReset();mock.open.mockReset()})
it('usa intenção permitida e abre referência real',async()=>{
 mock.rpc.mockResolvedValue({data:{intent:'priorities',data:{records:[{lead_id:'real-lead',empresa:'Empresa real'}],methodology:'Prioridade observada'},note:'Sem SQL livre'},error:null})
 render(<SalesCopilot/>);const u=userEvent.setup();await u.click(screen.getByRole('button',{name:'Quais empresas devo priorizar?'}))
 expect(mock.rpc).toHaveBeenCalledWith('sales_copilot_query',{p_intent:'priorities'})
 await u.click(await screen.findByRole('button',{name:'Abrir empresa'}));expect(mock.open).toHaveBeenCalledWith('real-lead')
 expect(screen.queryByRole('button',{name:'Quais oportunidades estão sem responsável?'})).toBeNull()
})
it('falha não é convertida em resposta de sucesso',async()=>{
 mock.rpc.mockResolvedValue({data:null,error:{message:'Consulta indisponível'}});render(<SalesCopilot/>);await userEvent.setup().click(screen.getByRole('button',{name:'Quais propostas estão em aberto?'}));expect(await screen.findByText('Consulta indisponível')).toBeTruthy()
})
