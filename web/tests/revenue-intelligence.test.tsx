import React from 'react'
import { beforeEach,expect,it,vi } from 'vitest'
import { render,screen } from '@testing-library/react'
const state=vi.hoisted(()=>({role:'comercial',rpc:vi.fn()}))
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({hasRole:(...r:string[])=>r.includes(state.role)})}))
vi.mock('@/components/layout/AppLayout',()=>({PageHeader:({title,actions}:any)=><><h1>{title}</h1>{actions}</>}))
vi.mock('@/lib/supabase',()=>({supabase:{rpc:state.rpc,from:()=>({select:()=>({order:()=>({limit:async()=>({data:[],error:null})}),gte:()=>({lte:()=>({order:()=>({limit:async()=>({data:[],error:null})})})})})})}}))
import RevenueIntelligence from '../src/pages/RevenueIntelligence'
beforeEach(()=>{state.role='comercial';state.rpc.mockReset()})
it('separa receita potencial, contratada e recebida sem inferir pagamento',async()=>{
 state.rpc.mockResolvedValue({data:{potential_open:5000,contracted_period:3000,received_period:500,receipt_count:1,methodology:'Recebido apenas por lançamentos reais'},error:null})
 render(<RevenueIntelligence/>);await screen.findByText('Recebido apenas por lançamentos reais')
 expect(screen.getByText('Potencial aberto (atual)')).toBeTruthy();expect(screen.getByText('Recebido no período')).toBeTruthy()
 expect(screen.queryByRole('button',{name:'Registrar valor recebido'})).toBeNull()
})
it('erro financeiro não apresenta saldo inventado',async()=>{
 state.rpc.mockResolvedValue({data:null,error:{message:'Sem acesso aos dados'}});render(<RevenueIntelligence/>);expect(await screen.findByText('Sem acesso aos dados')).toBeTruthy();expect(screen.queryByText('Recebido no período')).toBeNull()
})
