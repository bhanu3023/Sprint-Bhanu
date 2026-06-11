'use client'

import { getSlaStatus, formatTimeLeft, SlaStatus } from '@/lib/sla'
import { cn } from '@/lib/utils'
import { Clock, CheckCircle, AlertTriangle, XCircle } from 'lucide-react'

interface SlaBadgeProps {
  label: string
  deadline: string | null
  breached: boolean
  metAt?: string | null
  className?: string
}

const statusConfig: Record<SlaStatus, { color: string; icon: React.ElementType; label: string }> = {
  ok: { color: 'text-green-600 bg-green-50 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800', icon: Clock, label: 'On track' },
  warning: { color: 'text-amber-600 bg-amber-50 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800', icon: AlertTriangle, label: 'At risk' },
  breached: { color: 'text-red-600 bg-red-50 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800', icon: XCircle, label: 'Breached' },
  met: { color: 'text-blue-600 bg-blue-50 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800', icon: CheckCircle, label: 'Met' },
}

export function SlaBadge({ label, deadline, breached, metAt, className }: SlaBadgeProps) {
  const deadlineDate = deadline ? new Date(deadline) : null
  const metAtDate = metAt ? new Date(metAt) : null
  const status = getSlaStatus(deadlineDate, breached, metAtDate)
  const { color, icon: Icon, label: statusLabel } = statusConfig[status]
  const timeLeft = formatTimeLeft(deadlineDate)

  return (
    <div className={cn('flex items-center gap-1.5 text-xs px-2 py-1 rounded-md border font-medium', color, className)}>
      <Icon className="w-3 h-3 shrink-0" />
      <span>{label}</span>
      <span className="font-semibold">{statusLabel}</span>
      {timeLeft && status !== 'met' && (
        <span className="opacity-75">({timeLeft})</span>
      )}
    </div>
  )
}

interface SlaCardProps {
  responseDeadline: string | null
  resolutionDeadline: string | null
  responseBreached: boolean
  resolutionBreached: boolean
  responseMet?: string | null
}

export function SlaCard({ responseDeadline, resolutionDeadline, responseBreached, resolutionBreached, responseMet }: SlaCardProps) {
  if (!responseDeadline && !resolutionDeadline) return null

  return (
    <div className="flex flex-col gap-1.5">
      {responseDeadline && (
        <SlaBadge
          label="Response:"
          deadline={responseDeadline}
          breached={responseBreached}
          metAt={responseMet}
        />
      )}
      {resolutionDeadline && (
        <SlaBadge
          label="Resolution:"
          deadline={resolutionDeadline}
          breached={resolutionBreached}
        />
      )}
    </div>
  )
}
