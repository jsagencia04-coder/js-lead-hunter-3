import React from 'react'
import { beforeEach,expect,it } from 'vitest'
import { render,screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeToggle } from '../src/components/ThemeToggle'
beforeEach(()=>{localStorage.clear();document.documentElement.classList.remove('dark')})
it('alterna tema com preferência persistida sem afetar dados',async()=>{
 render(<ThemeToggle/>);await userEvent.setup().click(screen.getByRole('button',{name:'Ativar tema escuro'}))
 expect(document.documentElement.classList.contains('dark')).toBe(true);expect(localStorage.getItem('jslh:theme')).toBe('dark')
 await userEvent.setup().click(screen.getByRole('button',{name:'Ativar tema claro'}));expect(document.documentElement.classList.contains('dark')).toBe(false)
})
it('restaura tema escolhido anteriormente',()=>{localStorage.setItem('jslh:theme','dark');render(<ThemeToggle/>);expect(screen.getByRole('button',{name:'Ativar tema claro'})).toBeTruthy()})
