import React from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
const mocks=vi.hoisted(()=>({role:'admin',rpc:vi.fn(),open:vi.fn(),failure:false}))
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({hasRole:(...r:string[])=>r.includes(mocks.role)})}))
vi.mock('@/lib/crm',()=>({useOpenLead:()=>mocks.open}))
vi.mock('@/components/layout/AppLayout',()=>({PageHeader:({title,actions}:any)=><><h1>{title}</h1>{actions}</>}))
vi.mock('@/lib/supabase',()=>({supabase:{rpc:mocks.rpc,from:(table:string)=>({select:()=>({order:()=> table==='sales_automation_rules'?Promise.resolve({data:[{code:'proposal_due',label:'Proposta vencendo',enabled:false,days:3}],error:mocks.failure?{message:'Falha real'}:null}):{limit:async()=>({data:table==='operation_alerts'?[{id:'alert',lead_id:'lead',title:'Alerta real',reason:'Prazo registrado',created_at:'2026-11-27T12:00:00Z',read_at:null}]:[],error:null})}})})}}))
import SalesAutomations from '../src/pages/SalesAutomations'
beforeEach(()=>{mocks.role='admin';mocks.rpc.mockReset();mocks.open.mockReset();mocks.failure=false;vi.spyOn(window,'confirm').mockReturnValue(true)})
it('comercial consulta alertas mas não configura nem executa regras',async()=>{
 mocks.role='comercial';render(<SalesAutomations/>);await screen.findByText('Alerta real')
 expect(screen.queryByRole('button',{name:'Salvar regra'})).toBeNull()
 expect(screen.queryByRole('button',{name:'Executar rodada'})).toBeNull()
 await userEvent.setup().click(screen.getByRole('button',{name:'Alerta real'}));expect(mocks.open).toHaveBeenCalledWith('lead')
})
it('configuração exige confirmação e usa RPC autorizada',async()=>{
 mocks.rpc.mockResolvedValue({data:null,error:null});render(<SalesAutomations/>);await screen.findByText('Proposta vencendo')
 const u=userEvent.setup();await u.click(screen.getByRole('checkbox'));await u.click(screen.getByRole('button',{name:'Salvar regra'}))
 expect(window.confirm).toHaveBeenCalled()
 await waitFor(()=>expect(mocks.rpc).toHaveBeenCalledWith('configure_sales_automation',{p_code:'proposal_due',p_enabled:true,p_days:3}))
})
it('rodada manual apresenta resultado real, não atividade simulada',async()=>{
 mocks.rpc.mockImplementation(async(name:string)=>({data:name==='schedule_company_watches'?2:{status:'concluido',created:3,errors:0},error:null}))
 render(<SalesAutomations/>);await screen.findByText('Proposta vencendo');await userEvent.setup().click(screen.getByRole('button',{name:'Executar rodada'}))
 expect(await screen.findByText(/3 ações internas, 0 erros; 2 pesquisas agendadas/)).toBeTruthy()
})
it('falha de consulta permanece explícita',async()=>{mocks.failure=true;render(<SalesAutomations/>);expect(await screen.findByText('Falha real')).toBeTruthy()})
