// Design System 3.0: skeleton loading padrão para cards, listas e tabelas.
import * as React from 'react'
import { cn } from '@/lib/utils'

export function Skeleton({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} {...p} />
}

/** Skeleton de um card de indicador (KPI), no mesmo formato do componente Kpi do Dashboard. */
export function KpiSkeleton() {
  return (
    <div className="rounded-lg border bg-card p-5 shadow-sm">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-2 h-7 w-16" />
    </div>
  )
}

/** Grade de N skeletons de KPI, para substituir uma grade de indicadores enquanto carrega. */
export function KpiGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
      {Array.from({ length: count }, (_, i) => <KpiSkeleton key={i} />)}
    </div>
  )
}

/** Skeleton de linhas de tabela/lista. */
export function RowsSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-9 w-full" />)}
    </div>
  )
}
