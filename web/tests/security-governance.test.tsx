import React from 'react'
import {beforeEach,expect,it,vi} from 'vitest'
import {render,screen} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
const mock=vi.hoisted(()=>({rpc:vi.fn(),role:'gestor'}))
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({hasRole:(...r:string[])=>r.includes(mock.role)})}))
vi.mock('@/components/layout/AppLayout',()=>({PageHeader:({title,actions}:any)=><><h1>{title}</h1>{actions}</>}))
vi.mock('@/lib/supabase',()=>({supabase:{rpc:mock.rpc,from:()=>({select:()=>({order:()=>{const q:any={then:(f:any)=>Promise.resolve({data:[],error:null}).then(f),limit:()=>q};return q}})})}}))
import SecurityGovernance from '../src/pages/SecurityGovernance'
beforeEach(()=>{mock.role='gestor';mock.rpc.mockReset();mock.rpc.mockImplementation(async(name:string)=>({data:name==='security_overview'?{tables_without_rls:0}: 'request-id',error:null}));vi.spyOn(window,'confirm').mockReturnValue(true)})
it('oposição exige confirmação e usa ferramenta de bloqueio auditada',async()=>{render(<SecurityGovernance/>);await screen.findByText('Estado dos controles');const u=userEvent.setup();await u.selectOptions(screen.getByRole('combobox',{name:'Tipo de solicitação'}),'oposicao');await u.type(screen.getByRole('textbox',{name:'CNPJ básico da solicitação'}),'11222333');await u.type(screen.getByRole('textbox',{name:'Detalhes e fundamento'}),'Solicitação recebida');await u.click(screen.getByRole('button',{name:'Registrar solicitação'}));expect(window.confirm).toHaveBeenCalled();expect(mock.rpc).toHaveBeenCalledWith('record_governance_request',{p_type:'oposicao',p_company:'11222333',p_details:'Solicitação recebida'})})
it('gestor não recebe alteração de política jurídica reservada ao admin',async()=>{render(<SecurityGovernance/>);await screen.findByText('Estado dos controles');expect(screen.queryByRole('button',{name:'Registrar revisão'})).toBeNull();expect(screen.getByText(/não apaga empresas automaticamente/)).toBeTruthy()})
