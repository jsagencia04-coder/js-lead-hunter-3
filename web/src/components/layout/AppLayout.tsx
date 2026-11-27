import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, Building2, Map, Radar, Target, KanbanSquare, CalendarCheck, FileText, Handshake, Package,
  BarChart3, DatabaseZap, ShieldCheck, LogOut, Menu, X, Crosshair, Search, Loader2, ChevronDown,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { ROLE_LABEL, type AppRole } from '@/lib/types'
import { cn, formatCnpj, normalizeCnpj } from '@/lib/utils'
import { supabase } from '@/lib/supabase'
import { LeadDrawerContext } from '@/lib/crm'
import { LeadDrawer } from '@/components/LeadDrawer'
import { Button } from '@/components/ui/button'
import { ThemeToggle } from '@/components/ThemeToggle'

interface NavItem {
  to: string
  label: string
  icon: typeof LayoutDashboard
  roles?: AppRole[]
  badge?: 'agenda'
}

interface NavGroup {
  id: string
  label: string
  items: NavItem[]
}

// Agrupamento do menu (upgrade v3): preserva todas as rotas atuais, só reorganiza a navegação
// em grupos recolhíveis, conforme os módulos definidos para o JS Lead Hunter 3.0.
const NAV_GROUPS: NavGroup[] = [
  {
    id: 'inteligencia',
    label: 'Inteligência',
    items: [
      { to: '/', label: 'Visão geral', icon: LayoutDashboard },
      { to: '/leads', label: 'Base de empresas', icon: Building2 },
      { to: '/mapa', label: 'Mapa de oportunidades', icon: Map },
      { to: '/mercado', label: 'Inteligência territorial', icon: BarChart3 },
      { to: '/inteligencia', label: 'Inteligência digital', icon: Radar },
      { to: '/radar', label: 'Radar empresarial', icon: Radar },
      { to: '/oportunidades', label: 'Central de oportunidades', icon: Target },
    ],
  },
  {
    id: 'operacao',
    label: 'Operação comercial',
    items: [
      { to: '/minha-operacao', label: 'Minha operação', icon: Crosshair },
      { to: '/crm', label: 'CRM comercial', icon: KanbanSquare },
      { to: '/agenda', label: 'Agenda e tarefas', icon: CalendarCheck, badge: 'agenda' },
      { to: '/campanhas', label: 'Campanhas', icon: Target },
      { to: '/propostas', label: 'Propostas', icon: FileText },
      { to: '/clientes', label: 'Clientes', icon: Handshake },
      { to: '/servicos', label: 'Serviços', icon: Package },
    ],
  },
  {
    id: 'ia',
    label: 'Inteligência assistida',
    items: [{ to: '/assistente', label: 'Assistente comercial', icon: Search }, { to: '/agentes', label: 'Central de agentes', icon: Target }],
  },
  {
    id: 'gestao',
    label: 'Gestão',
    items: [
      { to: '/relatorios', label: 'Relatórios', icon: BarChart3 },
      { to: '/receita', label: 'Inteligência de receita', icon: BarChart3 },
      { to: '/segmentos', label: 'Segmentos e ICP', icon: Target },
      { to: '/automacoes', label: 'Automações e alertas', icon: CalendarCheck },
      { to: '/importacao', label: 'Central de importação', icon: DatabaseZap, roles: ['admin', 'gestor'] },
      { to: '/admin', label: 'Administração', icon: ShieldCheck, roles: ['admin'] },
    ],
  },
]

interface Hit { id: string; cnpj: string; razao_social: string | null; nome_fantasia: string | null; municipio: string | null; uf: string | null }

function GlobalSearch({ onOpen }: { onOpen: (id: string) => void }) {
  const [term, setTerm] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const timer = useRef<number>()

  useEffect(() => {
    window.clearTimeout(timer.current)
    const t = term.trim()
    if (t.length < 3) { setHits([]); return }
    timer.current = window.setTimeout(async () => {
      setBusy(true)
      const digits = normalizeCnpj(t)
      let q = supabase.from('lead_list_v').select('id,cnpj,razao_social,nome_fantasia,municipio,uf').limit(8)
      q = digits.length >= 8 && /^[0-9A-Z]+$/.test(digits) && /\d/.test(digits)
        ? q.like('cnpj', `${digits}%`)
        : q.or(`razao_social.ilike.%${t.replace(/[,()%]/g, ' ')}%,nome_fantasia.ilike.%${t.replace(/[,()%]/g, ' ')}%`)
      const { data } = await q
      setHits((data as Hit[]) ?? [])
      setBusy(false)
      setOpen(true)
    }, 300)
  }, [term])

  return (
    <div className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
      <input
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        onFocus={() => hits.length && setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 200)}
        placeholder="Pesquisar empresa por nome ou CNPJ"
        aria-label="Pesquisa global"
        className="h-9 w-full rounded-md border bg-background pl-9 pr-8 text-sm outline-none focus:ring-2 focus:ring-primary"
      />
      {busy && <Loader2 className="absolute right-3 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />}
      {open && term.trim().length >= 3 && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border bg-card shadow-lg">
          {hits.length === 0 && !busy && <p className="p-3 text-sm text-muted-foreground">Nenhuma empresa encontrada.</p>}
          {hits.map((h) => (
            <button key={h.id} className="block w-full px-3 py-2 text-left text-sm hover:bg-accent"
              onMouseDown={() => { onOpen(h.id); setOpen(false); setTerm('') }}>
              <p className="truncate font-medium">{h.nome_fantasia || h.razao_social}</p>
              <p className="text-xs text-muted-foreground">{formatCnpj(h.cnpj)} · {h.municipio ?? '—'}/{h.uf ?? '—'}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const GROUPS_COLLAPSED_KEY = 'jslh:menu-recolhido'

export function AppLayout() {
  const { profile, signOut, hasRole } = useAuth()
  const [open, setOpen] = useState(false)
  const [leadId, setLeadId] = useState<string | null>(null)
  const [late, setLate] = useState(0)
  const location = useLocation()

  const groups = NAV_GROUPS
    .map((g) => ({ ...g, items: g.items.filter((i) => !i.roles || hasRole(...i.roles)) }))
    .filter((g) => g.items.length > 0)
  const openLead = useCallback((id: string) => setLeadId(id), [])

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try {
      const value = JSON.parse(localStorage.getItem(GROUPS_COLLAPSED_KEY) ?? '{}')
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
    } catch { return {} }
  })
  const toggleGroup = (id: string) => {
    setCollapsed((prev) => {
      const next = { ...prev, [id]: !prev[id] }
      try { localStorage.setItem(GROUPS_COLLAPSED_KEY, JSON.stringify(next)) } catch { /* navegador sem armazenamento */ }
      return next
    })
  }

  useEffect(() => {
    supabase.rpc('my_agenda', { p_all: false }).then(({ data }) => setLate(Number((data as { atrasadas?: number })?.atrasadas ?? 0)))
  }, [location.pathname])

  const sidebar = (
    <nav className="flex h-full flex-col gap-0.5 overflow-y-auto p-3">
      <div className="mb-3 flex items-center gap-2 px-2 py-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary">
          <Crosshair className="h-4 w-4 text-white" />
        </div>
        <div>
          <p className="text-sm font-semibold text-white">JS Lead Hunter</p>
          <p className="text-[11px] text-sidebar-foreground/60">JS Designer</p>
        </div>
      </div>

      {groups.map((group) => {
        const isCollapsed = !!collapsed[group.id]
        const hasActive = group.items.some((i) => (i.to === '/' ? location.pathname === '/' : location.pathname.startsWith(i.to)))
        return (
          <div key={group.id} className="mb-1">
            <button
              type="button"
              onClick={() => toggleGroup(group.id)}
              aria-expanded={!isCollapsed}
              aria-label={`${isCollapsed ? 'Expandir' : 'Recolher'} ${group.label}`}
              className="flex w-full items-center justify-between rounded-md px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-sidebar-foreground/50 hover:text-sidebar-foreground/80"
            >
              <span>{group.label}</span>
              <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', isCollapsed && '-rotate-90')} />
            </button>
            {!isCollapsed && group.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                    isActive ? 'bg-white/10 font-medium text-white' : 'text-sidebar-foreground hover:bg-white/5 hover:text-white',
                  )
                }
              >
                <item.icon className="h-4 w-4 shrink-0" />
                <span className="flex-1">{item.label}</span>
                {item.badge === 'agenda' && late > 0 && (
                  <span className="rounded-full bg-red-500 px-1.5 text-[11px] font-semibold text-white" title="Tarefas atrasadas">{late}</span>
                )}
              </NavLink>
            ))}
            {isCollapsed && hasActive && <span className="ml-3 block h-1 w-1 rounded-full bg-primary" />}
          </div>
        )
      })}

      <div className="mt-auto border-t border-white/10 px-2 pt-3">
        <p className="truncate text-sm text-white">{profile?.full_name ?? profile?.email}</p>
        <p className="mb-3 text-xs text-sidebar-foreground/60">{profile ? ROLE_LABEL[profile.role] : ''}</p>
        <button
          onClick={signOut}
          className="flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-sm text-sidebar-foreground hover:text-white"
        >
          <LogOut className="h-4 w-4" /> Sair
        </button>
      </div>
    </nav>
  )

  return (
    <LeadDrawerContext.Provider value={openLead}>
      <div className="flex min-h-screen">
        <aside className="hidden w-64 shrink-0 bg-sidebar lg:block">
          <div className="sticky top-0 h-screen">{sidebar}</div>
        </aside>

        {open && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
            <aside className="absolute left-0 top-0 h-full w-64 bg-sidebar">{sidebar}</aside>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-card px-4 md:px-8">
            <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(!open)} aria-label="Abrir menu">
              {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
            <span className="font-semibold lg:hidden">JS Lead Hunter</span>
            <div className="ml-auto flex w-full justify-end lg:ml-0 lg:justify-start">
              <GlobalSearch onOpen={openLead} />
            </div>
            <ThemeToggle />
          </header>
          <main className="flex-1 p-4 md:p-8">
            <Outlet />
          </main>
        </div>
      </div>
      <LeadDrawer leadId={leadId} onClose={() => setLeadId(null)} />
    </LeadDrawerContext.Provider>
  )
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}
