// Design System 3.0: abas simples, sem dependência externa, controladas por estado do pai.
// Usadas na Ficha 360° da empresa (LeadDrawer) e em outras telas que precisam organizar
// várias seções numa só área sem rolagem longa.
import * as React from 'react'
import { cn } from '@/lib/utils'

export interface TabDef {
  id: string
  label: string
  icon?: React.ComponentType<{ className?: string }>
  badge?: number
}

export function TabList({ tabs, active, onChange }: { tabs: TabDef[]; active: string; onChange: (id: string) => void }) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto border-b px-5 pt-2 scrollbar-thin">
      {tabs.map((t) => {
        const isActive = t.id === active
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(t.id)}
            className={cn(
              'flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              isActive ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t.icon && <t.icon className="h-3.5 w-3.5" />}
            {t.label}
            {!!t.badge && (
              <span className={cn('rounded-full px-1.5 text-[10px] font-semibold', isActive ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>
                {t.badge}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export function TabPanel({ active, id, children }: { active: string; id: string; children: React.ReactNode }) {
  if (active !== id) return null
  return <div role="tabpanel">{children}</div>
}
