// Design System 3.0: estado vazio padrão (lista/pesquisa sem resultado), distinto do Alert
// (que comunica status de carregamento/erro dos dados). Usar quando a consulta deu certo
// mas não há nada a mostrar — nunca para simular dados ou mascarar um erro real.
import * as React from 'react'
import { cn } from '@/lib/utils'

export function EmptyState({
  icon: Icon, title, description, action, className,
}: {
  icon?: React.ComponentType<{ className?: string }>
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center', className)}>
      {Icon && <Icon className="h-8 w-8 text-muted-foreground/60" />}
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="max-w-sm text-xs text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
