import { useEffect,useState } from 'react'
import { Moon,Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
export function ThemeToggle(){
 const [dark,setDark]=useState(()=>{try{return localStorage.getItem('jslh:theme')==='dark'}catch{return false}})
 useEffect(()=>{document.documentElement.classList.toggle('dark',dark);try{localStorage.setItem('jslh:theme',dark?'dark':'light')}catch{/* sem armazenamento */}},[dark])
 return <Button variant="ghost" size="icon" aria-label={dark?'Ativar tema claro':'Ativar tema escuro'} onClick={()=>setDark(!dark)}>{dark?<Sun className="h-4 w-4"/>:<Moon className="h-4 w-4"/>}</Button>
}
