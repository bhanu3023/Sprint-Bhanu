'use client'

import { useState } from 'react'
import { getSlaStatus, formatTimeLeft, SlaStatus } from '@/lib/sla'
import { cn } from '@/lib/utils'
import { Clock, AlertTriangle, XCircle, CheckCircle } from 'lucide-react'
import Link from 'next/link'

interface IssueRow {
  id: string
  key: string
  title: string
  priority: string
  statusName: string
  statusCategory: string
  slaResponseDeadline: string | null
  slaResolutionDeadline: string | null
  slaResponseBreached: boolean
  slaResolutionBreached: boolean
  slaResponseMet: string | null
  createdAt: string
}

interface Props {
  issues: IssueRow[]
  projectKey: string
}

const priorityColors: Record<string, string> = {
  HIGHEST: 'text-red-600',
  HIGH: 'text-orange-500',
  MEDIUM: 'text-yellow-500',
  LOW: 'text-blue-500',
  LOWEST: 'text-slate-400',
}

const slaStatusBadge: Record<SlaStatus, { label: string; className: string; icon: React.ElementType }> = {
  ok: { label: 'On Track', className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400', icon: Clock },
  warning: { label: 'At Risk', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400', icon: AlertTriangle },
  breached: { label: 'Breached', className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400', icon: XCircle },
  met: { label: 'Met', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400', icon: CheckCircle },
}

export function SlaReportView({ issues, projectKey }: Props) {
  const [filter, setFilter] = useState<'all' | 'breached' | 'at_risk' | 'ok'>('all')

  const filtered = issues.filter((i) => {
    if (filter === 'all') return true
    const respStatus = getSlaStatus(
      i.slaResponseDeadline ? new Date(i.slaResponseDeadline) : null,
      i.slaResponseBreached,
      i.slaResponseMet ? new Date(i.slaResponseMet) : null,
    )
    const resStatus = getSlaStatus(
      i.slaResolutionDeadline ? new Date(i.slaResolutionDeadline) : null,
      i.slaResolutionBreached,
    )
    const worst = [respStatus, resStatus].includes('breached') ? 'breached'
      : [respStatus, resStatus].includes('warning') ? 'at_risk' : 'ok'

    if (filter === 'breached') return worst === 'breached'
    if (filter === 'at_risk') return worst === 'at_risk'
    if (filter === 'ok') return worst === 'ok'
    return true
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">SLA Status by Issue</h3>
        <div className="flex items-center gap-1">
          {(['all', 'breached', 'at_risk', 'ok'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                'px-3 py-1 text-xs rounded-full font-medium transition-colors',
                filter === f ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted',
              )}
            >
              {f === 'all' ? 'All' : f === 'at_risk' ? 'At Risk' : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/30">
            <tr>
              <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Issue</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden md:table-cell">Priority</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden md:table-cell">Status</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Response SLA</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Resolution SLA</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No issues match this filter.
                </td>
              </tr>
            )}
            {filtered.map((issue) => {
              const respStatus = getSlaStatus(
                issue.slaResponseDeadline ? new Date(issue.slaResponseDeadline) : null,
                issue.slaResponseBreached,
                issue.slaResponseMet ? new Date(issue.slaResponseMet) : null,
              )
              const resStatus = getSlaStatus(
                issue.slaResolutionDeadline ? new Date(issue.slaResolutionDeadline) : null,
                issue.slaResolutionBreached,
              )

              return (
                <tr key={issue.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-2.5">
                    <Link href={`/projects/${projectKey}/issues/${issue.key}`} className="hover:underline">
                      <span className="font-mono text-xs text-muted-foreground mr-2">{issue.key}</span>
                      <span className="font-medium">{issue.title}</span>
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 hidden md:table-cell">
                    <span className={cn('text-xs font-medium', priorityColors[issue.priority])}>
                      {issue.priority}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 hidden md:table-cell">
                    <span className="text-xs text-muted-foreground">{issue.statusName}</span>
                  </td>
                  <td className="px-4 py-2.5">
                    <SlaStatusCell status={respStatus} deadline={issue.slaResponseDeadline} />
                  </td>
                  <td className="px-4 py-2.5">
                    <SlaStatusCell status={resStatus} deadline={issue.slaResolutionDeadline} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SlaStatusCell({ status, deadline }: { status: SlaStatus; deadline: string | null }) {
  const { label, className, icon: Icon } = slaStatusBadge[status]
  const timeLeft = formatTimeLeft(deadline ? new Date(deadline) : null)

  return (
    <div className={cn('inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium', className)}>
      <Icon className="w-3 h-3" />
      <span>{label}</span>
      {timeLeft && status !== 'met' && <span className="opacity-75">({timeLeft})</span>}
    </div>
  )
}
