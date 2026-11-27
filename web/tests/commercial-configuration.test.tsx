import React from 'react'
import {beforeEach,expect,it,vi} from 'vitest'
import {render,screen} from '@testing-library/react'
const state=vi.hoisted(()=>({role:'gestor'}))
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({hasRole:(...r:string[])=>r.includes(state.role)})}))
vi.mock('@/components/layout/AppLayout',()=>({PageHeader:({title}:any)=><h1>{title}</h1>}))
vi.mock('@/lib/supabase',()=>({supabase:{from:()=>({select:()=>{const q:any={then:(f:any)=>Promise.resolve({data:[],error:null}).then(f),order:()=>q,eq:()=>q};return q}}),rpc:vi.fn()}}))
import CommercialConfiguration from '../src/pages/CommercialConfiguration'
beforeEach(()=>{state.role='gestor'})
it('gestor administra equipe mas não cadastra funil reservado ao admin',async()=>{render(<CommercialConfiguration/>);await screen.findByRole('button',{name:'Salvar equipe'});expect(screen.queryByRole('button',{name:'Salvar funil'})).toBeNull()})
it('admin tem ferramentas de funil e equipe sem mudar permissões por participação',async()=>{state.role='admin';render(<CommercialConfiguration/>);expect(await screen.findByRole('button',{name:'Salvar funil'})).toBeTruthy();expect(screen.getByRole('button',{name:'Salvar equipe'})).toBeTruthy()})
