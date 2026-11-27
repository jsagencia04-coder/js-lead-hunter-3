import * as React from 'react'
import { cn } from '@/lib/utils'

export interface TabDef {
  id: string
  label: string
  icon?: React.ComponentType<{ className?: string }>
  badge?: number
}

/** Abas com roving tabindex e navegação por setas/Home/End (WAI-ARIA). */
export function TabList({ tabs, active, onChange, prefix = 'ficha' }: {
  tabs: TabDef[]; active: string; onChange: (id: string) => void; prefix?: string
}) {
  function navigate(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
      : event.key === 'ArrowLeft' ? (index - 1 + tabs.length) % tabs.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1
    if (next < 0) return
    event.preventDefault()
    onChange(tabs[next].id)
    document.getElementById(`${prefix}-tab-${tabs[next].id}`)?.focus()
  }
  return (
    <div role="tablist" aria-label="Seções da empresa" className="flex gap-1 overflow-x-auto border-b px-5 pt-2">
      {tabs.map((t, index) => {
        const isActive = t.id === active
        return (
          <button key={t.id} type="button" role="tab" id={`${prefix}-tab-${t.id}`}
            aria-controls={`${prefix}-panel-${t.id}`} aria-selected={isActive} tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(t.id)} onKeyDown={(e) => navigate(e, index)}
            className={cn('flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              isActive ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}>
            {t.icon && <t.icon className="h-3.5 w-3.5" />}
            {t.label}
            {!!t.badge && <span className={cn('rounded-full px-1.5 text-[10px] font-semibold', isActive ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>{t.badge}</span>}
          </button>
        )
      })}
    </div>
  )
}

/** Mantém os formulários montados: trocar de aba não perde rascunhos não salvos. */
export function TabPanel({ active, id, children, prefix = 'ficha' }: {
  active: string; id: string; children: React.ReactNode; prefix?: string
}) {
  return <div role="tabpanel" id={`${prefix}-panel-${id}`} aria-labelledby={`${prefix}-tab-${id}`}
    hidden={active !== id} tabIndex={0}>{children}</div>
}
