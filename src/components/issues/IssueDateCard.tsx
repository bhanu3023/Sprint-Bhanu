'use client'

import { useState } from 'react'
import { ChevronLeft, ChevronRight, Calendar, Zap, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'

interface IssueDateCardProps {
  sprint?: { name: string; startDate?: Date | string | null; endDate?: Date | string | null; status: string } | null
  dueDate?: Date | string | null
  createdAt?: Date | string | null
}

function toMidnight(d: Date | string | null | undefined): Date | null {
  if (!d) return null
  const dt = new Date(d)
  dt.setHours(0, 0, 0, 0)
  return dt
}

export function IssueDateCard({ sprint, dueDate, createdAt }: IssueDateCardProps) {
  const today = toMidnight(new Date())!
  const due = toMidnight(dueDate)
  const sprintStart = toMidnight(sprint?.startDate)
  const sprintEnd = toMidnight(sprint?.endDate)

  const initDate = due ?? sprintStart ?? today
  const [viewDate, setViewDate] = useState(() => new Date(initDate.getFullYear(), initDate.getMonth(), 1))

  const year = viewDate.getFullYear()
  const month = viewDate.getMonth()
  const monthLabel = viewDate.toLocaleString('default', { month: 'long', year: 'numeric' })

  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const cells: (number | null)[] = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  const prevMonth = () => setViewDate(new Date(year, month - 1, 1))
  const nextMonth = () => setViewDate(new Date(year, month + 1, 1))

  const dayInfo = (day: number) => {
    const date = new Date(year, month, day)
    date.setHours(0, 0, 0, 0)
    const t = date.getTime()

    const isToday = t === today.getTime()
    const isDue = due && t === due.getTime()
    const inSprint = sprintStart && sprintEnd && date >= sprintStart && date <= sprintEnd
    const isSprintStart = sprintStart && t === sprintStart.getTime()
    const isSprintEnd = sprintEnd && t === sprintEnd.getTime()

    return { isToday, isDue, inSprint, isSprintStart, isSprintEnd }
  }

  // Days remaining / overdue
  const dueStatus = () => {
    if (!due) return null
    const diff = Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    if (diff < 0) return { label: `${Math.abs(diff)}d overdue`, cls: 'text-red-500' }
    if (diff === 0) return { label: 'Due today', cls: 'text-orange-500 font-semibold' }
    if (diff <= 3) return { label: `${diff}d left`, cls: 'text-orange-400' }
    return { label: `${diff}d left`, cls: 'text-muted-foreground' }
  }

  const sprintProgress = () => {
    if (!sprintStart || !sprintEnd) return null
    const total = sprintEnd.getTime() - sprintStart.getTime()
    const elapsed = Math.max(0, today.getTime() - sprintStart.getTime())
    return Math.min(100, Math.round((elapsed / total) * 100))
  }

  const progress = sprintProgress()
  const dueInfo = dueStatus()

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
        <Calendar className="w-3.5 h-3.5" /> Dates
      </h3>

      {/* Mini Calendar */}
      <div>
        {/* Month nav */}
        <div className="flex items-center justify-between mb-2">
          <button onClick={prevMonth} className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground">
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <span className="text-xs font-semibold">{monthLabel}</span>
          <button onClick={nextMonth} className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground">
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Day headers */}
        <div className="grid grid-cols-7 mb-1">
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
            <div key={i} className="text-center text-xs text-muted-foreground/60 py-0.5 font-medium">{d}</div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7 gap-y-0.5">
          {cells.map((day, i) => {
            if (!day) return <div key={i} />
            const { isToday, isDue, inSprint, isSprintStart, isSprintEnd } = dayInfo(day)

            return (
              <div key={i} className="relative flex items-center justify-center">
                {/* Sprint range highlight band */}
                {inSprint && !isDue && (
                  <div className={cn(
                    'absolute inset-y-0 bg-primary/12 dark:bg-primary/20',
                    isSprintStart ? 'left-1/2 right-0 rounded-l-full' :
                    isSprintEnd ? 'left-0 right-1/2 rounded-r-full' :
                    'left-0 right-0'
                  )} />
                )}

                <div className={cn(
                  'relative z-10 w-6 h-6 flex items-center justify-center text-[11px] rounded-full transition-all',
                  isDue
                    ? 'bg-orange-500 text-white font-bold shadow-sm ring-1 ring-orange-400/50'
                    : isToday
                    ? 'bg-primary text-primary-foreground font-bold'
                    : (isSprintStart || isSprintEnd)
                    ? 'bg-primary/30 text-primary font-semibold'
                    : inSprint
                    ? 'text-primary font-medium'
                    : 'text-foreground',
                )}>
                  {day}
                </div>
              </div>
            )
          })}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-3 mt-2.5 flex-wrap">
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <div className="w-3 h-3 rounded-full bg-primary/25 border border-primary/40" />
            Sprint
          </div>
          {due && (
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <div className="w-3 h-3 rounded-full bg-orange-500" />
              Due date
            </div>
          )}
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <div className="w-3 h-3 rounded-full bg-primary" />
            Today
          </div>
        </div>
      </div>

      {/* Date details */}
      <div className="mt-3 space-y-2 border-t border-border pt-3">
        {sprint?.startDate && sprint?.endDate && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1 text-muted-foreground">
                <Zap className="w-3 h-3 text-primary" />
                {sprint.name}
              </span>
              <span className={cn(
                'text-xs px-1.5 py-0.5 rounded-full font-medium',
                sprint.status === 'ACTIVE' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                sprint.status === 'COMPLETED' ? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400' :
                'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
              )}>
                {sprint.status}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{new Date(sprint.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
              <span className="text-muted-foreground/50">→</span>
              <span>{new Date(sprint.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
            </div>
            {progress !== null && (
              <div>
                <div className="flex justify-between text-[10px] text-muted-foreground mb-0.5">
                  <span>Sprint progress</span>
                  <span>{progress}%</span>
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className={cn('h-full rounded-full transition-all', progress >= 80 ? 'bg-orange-500' : 'bg-primary')}
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {dueInfo && (
          <div className="flex items-center justify-between text-xs pt-1">
            <span className="flex items-center gap-1 text-muted-foreground">
              <Clock className="w-3 h-3" /> Due date
            </span>
            <div className="text-right">
              <div className="text-xs text-muted-foreground">
                {due?.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </div>
              <div className={cn('text-[10px] font-medium', dueInfo.cls)}>{dueInfo.label}</div>
            </div>
          </div>
        )}

        {!sprint && !dueDate && (
          <p className="text-xs text-muted-foreground/50 text-center py-1">No dates set</p>
        )}
      </div>
    </div>
  )
}
