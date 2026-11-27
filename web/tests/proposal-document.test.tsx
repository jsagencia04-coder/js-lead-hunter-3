import React from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
const mock=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('react-router-dom',()=>({useParams:()=>({id:'proposal-real'})}))
vi.mock('@/components/layout/AppLayout',()=>({PageHeader:({title,actions}:any)=><><h1>{title}</h1>{actions}</>}))
vi.mock('@/lib/supabase',()=>({supabase:{rpc:mock.rpc,from:()=>({select:()=>({eq:()=>({order:()=>({limit:async()=>({data:[],error:null})})})})})}}))
import ProposalDocument from '../src/pages/ProposalDocument'
beforeEach(()=>{mock.rpc.mockReset();vi.spyOn(window,'print').mockImplementation(()=>{})})
it('documento usa registro real e imprime sem registrar envio',async()=>{
 mock.rpc.mockResolvedValue({data:{issuer:'JS Designer',generated_at:'2026-11-27T12:00:00Z',revision:2,company:{name:'Empresa autorizada',legal_name:'Empresa autorizada LTDA',cnpj:'11222333000181'},proposal:{title:'Proposta comercial',amount:1000,scope:'Escopo cadastrado',payment_terms:'2 parcelas',delivery_terms:'30 dias',valid_until:null,notes:null,status:'rascunho'},services:[]},error:null})
 render(<ProposalDocument/>);await screen.findByText('Escopo cadastrado');await userEvent.setup().click(screen.getByRole('button',{name:'Imprimir / Salvar PDF'}))
 expect(window.print).toHaveBeenCalled();expect(mock.rpc).toHaveBeenCalledTimes(1)
 expect(mock.rpc).toHaveBeenCalledWith('proposal_document',{p_id:'proposal-real'})
})
it('não permite imprimir resultado não autorizado',async()=>{
 mock.rpc.mockResolvedValue({data:null,error:{message:'Proposta indisponível'}});render(<ProposalDocument/>);await screen.findByText('Proposta indisponível')
 expect((screen.getByRole('button',{name:'Imprimir / Salvar PDF'}) as HTMLButtonElement).disabled).toBe(true)
})
