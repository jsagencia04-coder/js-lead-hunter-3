import React from 'react'
import {expect,it,vi} from 'vitest'
import {render,screen} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({hasRole:()=>false})}))
vi.mock('@/lib/supabase',()=>({supabase:{}}))
import {ActivityCalendar} from '../src/components/ActivityCalendar'
import {proposalTotal} from '../src/components/ProposalEditor'
import {createTextPdf} from '../src/lib/pdf'
it('calcula quantidade e desconto por item sem presumir imposto',()=>{expect(proposalTotal([{service_id:'',description:'Site',quantity:2,unit_price:100,discount_percent:10}])).toBe(180)})
it('calendario abre atividade real e alterna visoes',async()=>{const open=vi.fn();const date=new Date().toISOString().slice(0,10);render(<ActivityCalendar activities={[{id:'1',title:'Reuniao real',when:date+'T12:00:00',company:'Empresa real',onOpen:open}]}/>);const u=userEvent.setup();await u.click(screen.getByRole('button',{name:/Reuniao real/}));expect(open).toHaveBeenCalled();await u.click(screen.getByRole('button',{name:'Dia'}));expect(screen.getByText(/Horários no fuso/)).toBeTruthy()})
it('gera PDF valido diretamente e pagina texto longo',()=>{const pdf=createTextPdf('Proposta',[{heading:'Escopo',text:'Entregavel registrado. '.repeat(1000)}]);expect(pdf.output().startsWith('%PDF-')).toBe(true);expect(pdf.getNumberOfPages()).toBeGreaterThan(1)})
