import React from 'react'
import { beforeEach,expect,it,vi } from 'vitest'
import { render,screen,waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
const state=vi.hoisted(()=>({role:'comercial',rpc:vi.fn(),open:vi.fn()}))
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({profile:{id:'owner'},hasRole:(...r:string[])=>r.includes(state.role)})}))
vi.mock('@/lib/crm',()=>({useOpenLead:()=>state.open,CHANNEL_STATUS:{pendente:{label:'Pendente'}}}))
vi.mock('@/lib/supabase',()=>({supabase:{rpc:state.rpc,from:()=>({select:()=>({eq:()=>({eq:()=>({maybeSingle:async()=>({data:null,error:null})})})})})}}))
import { CompanyMonitoring } from '../src/components/CompanyMonitoring'
beforeEach(()=>{state.role='comercial';state.rpc.mockReset();state.open.mockReset();state.rpc.mockImplementation(async(name:string)=>({data:name==='company_comparables'?{items:[{id:'comparable',empresa:'Comparável cadastral',site_status:null,website_score:null,last_checked_at:null,confidence:null,reason:'Mesmo CNAE e município'}],methodology:'Não comprova concorrência'}:null,error:null}))})
it('registra acompanhamento sem iniciar pesquisa paga por conta própria',async()=>{
 render(<CompanyMonitoring leadId="lead"/>);await screen.findByText('Comparável cadastral');const u=userEvent.setup()
 await u.click(screen.getByRole('button',{name:'Salvar monitoramento'}))
 await waitFor(()=>expect(state.rpc).toHaveBeenCalledWith('set_company_watch',{p_lead_id:'lead',p_enabled:true,p_interval_days:30,p_paused:false}))
 expect(state.rpc.mock.calls.some(([name])=>name==='request_enrichment')).toBe(false)
})
it('abre ficha comparável e esconde gravação para leitura',async()=>{
 state.role='leitura';render(<CompanyMonitoring leadId="lead"/>);await screen.findByText('Comparável cadastral')
 expect(screen.queryByRole('button',{name:'Salvar monitoramento'})).toBeNull()
 await userEvent.setup().click(screen.getByRole('button',{name:/Comparável cadastral/}));expect(state.open).toHaveBeenCalledWith('comparable')
})
