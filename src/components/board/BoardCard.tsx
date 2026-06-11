'use client'

import { Draggable } from '@hello-pangea/dnd'
import { MessageSquare, GitBranch, Calendar, AlertCircle, ArrowUp, ArrowDown, Minus } from 'lucide-react'
import { cn, PRIORITY_COLORS, ISSUE_TYPE_COLORS, formatDateShort } from '@/lib/utils'
import { isPast } from 'date-fns'

interface Issue {
  id: string
  key: string
  title: string
  type: string
  priority: string
  status: { id: string; name: string; category: string }
  assignee?: { id: string; name: string; avatarUrl?: string | null; avatarColor: string } | null
  storyPoints?: number | null
  dueDate?: Date | null
  labels: Array<{ label: { id: string; name: string; color: string } }>
  _count: { subtasks: number; comments: number }
}

interface BoardCardProps {
  issue: Issue
  index: number
  onClick: () => void
  projectKey: string
}

const PriorityIcon = ({ priority }: { priority: string }) => {
  switch (priority) {
    case 'HIGHEST': return <AlertCircle className="w-3 h-3 text-red-600" />
    case 'HIGH': return <ArrowUp className="w-3 h-3 text-orange-500" />
    case 'LOW': return <ArrowDown className="w-3 h-3 text-blue-500" />
    case 'LOWEST': return <ArrowDown className="w-3 h-3 text-slate-400" />
    default: return <Minus className="w-3 h-3 text-yellow-500" />
  }
}

const TypeBadge = ({ type }: { type: string }) => {
  const colors = ISSUE_TYPE_COLORS[type as keyof typeof ISSUE_TYPE_COLORS] ?? ISSUE_TYPE_COLORS.TASK
  const labels: Record<string, string> = { EPIC: 'E', STORY: 'S', TASK: 'T', BUG: 'B', SUBTASK: 'ST' }
  return (
    <span className={cn('text-xs font-bold px-1 py-0.5 rounded', colors.bg, colors.text)}>
      {labels[type] ?? 'T'}
    </span>
  )
}

export function BoardCard({ issue, index, onClick }: BoardCardProps) {
  const isDuePast = issue.dueDate && isPast(new Date(issue.dueDate)) && issue.status.category !== 'DONE'

  return (
    <Draggable draggableId={issue.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          onClick={onClick}
          className={cn(
            'bg-card border border-border rounded-lg p-3 cursor-pointer hover:shadow-md transition-all select-none',
            snapshot.isDragging && 'shadow-2xl rotate-1 ring-2 ring-primary/30 opacity-95',
          )}
          style={provided.draggableProps.style}
        >
          {/* Labels */}
          {issue.labels.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {issue.labels.slice(0, 3).map(({ label }) => (
                <span
                  key={label.id}
                  className="text-xs px-1.5 py-0.5 rounded-full font-medium text-white"
                  style={{ backgroundColor: label.color }}
                >
                  {label.name}
                </span>
              ))}
            </div>
          )}

          {/* Title */}
          <p className="text-sm font-medium text-foreground line-clamp-2 mb-2 leading-snug">
            {issue.title}
          </p>

          {/* Footer */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <TypeBadge type={issue.type} />
              <span className="text-xs text-muted-foreground font-mono">{issue.key}</span>
              <PriorityIcon priority={issue.priority} />
            </div>

            <div className="flex items-center gap-2">
              {issue._count.comments > 0 && (
                <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                  <MessageSquare className="w-3 h-3" /> {issue._count.comments}
                </span>
              )}
              {issue._count.subtasks > 0 && (
                <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                  <GitBranch className="w-3 h-3" /> {issue._count.subtasks}
                </span>
              )}
              {issue.storyPoints && (
                <span className="text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded font-mono">
                  {issue.storyPoints}
                </span>
              )}
            </div>
          </div>

          {/* Due date & Assignee */}
          <div className="flex items-center justify-between mt-2">
            {issue.dueDate ? (
              <span className={cn(
                'flex items-center gap-1 text-xs',
                isDuePast ? 'text-red-600' : 'text-muted-foreground',
              )}>
                <Calendar className="w-3 h-3" />
                {formatDateShort(issue.dueDate)}
              </span>
            ) : (
              <span />
            )}

            {issue.assignee ? (
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-semibold ring-2 ring-card"
                style={{ backgroundColor: issue.assignee.avatarColor }}
                title={issue.assignee.name}
              >
                {issue.assignee.avatarUrl ? (
                  <img src={issue.assignee.avatarUrl} className="w-full h-full rounded-full object-cover" alt={issue.assignee.name} />
                ) : (
                  issue.assignee.name[0].toUpperCase()
                )}
              </div>
            ) : (
              <div className="w-6 h-6 rounded-full border-2 border-dashed border-muted" />
            )}
          </div>
        </div>
      )}
    </Draggable>
  )
}
