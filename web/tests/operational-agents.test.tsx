import React from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
const state=vi.hoisted(()=>({role:'comercial',rpc:vi.fn()}))
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({profile:{id:'user'},hasRole:(...r:string[])=>r.includes(state.role)})}))
vi.mock('@/components/layout/AppLayout',()=>({PageHeader:({title,actions}:any)=><><h1>{title}</h1>{actions}</>}))
vi.mock('@/lib/supabase',()=>({supabase:{rpc:state.rpc,from:(table:string)=>({select:()=>({order:()=>table==='operational_agents'?Promise.resolve({data:[{code:'followup_assistant',name:'Follow-up Assistant',objective:'Consulta real',requires_lead:false,manager_only:false,paused:false},{code:'executive_analyst',name:'Executive Analyst',objective:'Gestão',requires_lead:false,manager_only:true,paused:false}],error:null}):{limit:async()=>({data:[],error:null})}})})}}))
import OperationalAgents from '../src/pages/OperationalAgents'
beforeEach(()=>{state.role='comercial';state.rpc.mockReset()})
it('solicita ferramenta real e não simula execução concluída',async()=>{
 state.rpc.mockResolvedValue({data:'job-persistente',error:null});render(<OperationalAgents/>);await screen.findByText('Follow-up Assistant')
 const buttons=screen.getAllByRole('button',{name:'Solicitar execução'})
 expect((buttons[1] as HTMLButtonElement).disabled).toBe(true)
 await userEvent.setup().click(buttons[0])
 expect(state.rpc).toHaveBeenCalledWith('request_operational_agent',{p_code:'followup_assistant',p_lead_id:null})
 expect(await screen.findByText(/job-persistente registrada na fila/)).toBeTruthy()
})
it('leitura não recebe botões de execução nem pausa',async()=>{
 state.role='leitura';render(<OperationalAgents/>);await screen.findByText('Follow-up Assistant')
 expect(screen.queryByRole('button',{name:'Solicitar execução'})).toBeNull();expect(screen.queryByRole('button',{name:'Pausar'})).toBeNull()
})
