import {test,expect} from '@playwright/test'
test('login real carrega e rota protegida não abre sem sessão',async({page})=>{
 await page.goto('/crm');await expect(page.getByRole('heading',{name:'JS Lead Hunter',exact:true})).toBeVisible()
 await expect(page.getByLabel('E-mail',{exact:true})).toBeVisible();await expect(page.getByLabel('Senha',{exact:true})).toBeVisible()
 await expect(page.getByRole('button',{name:'Entrar',exact:true})).toBeVisible();expect(page.url()).toContain('/login')
})
test('login cabe em viewport móvel sem rolagem horizontal',async({page})=>{
 await page.setViewportSize({width:375,height:812});await page.goto('/login');await expect(page.getByRole('button',{name:'Entrar',exact:true})).toBeVisible()
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth);expect(overflow).toBe(false)
})
