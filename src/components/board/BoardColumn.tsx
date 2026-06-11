'use client'

import { Droppable } from '@hello-pangea/dnd'
import { BoardCard } from './BoardCard'
import { Plus, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Issue {
  id: string
  key: string
  title: string
  type: string
  priority: string
  status: { id: string; name: string; category: string; color: string }
  assignee?: { id: string; name: string; avatarUrl?: string | null; avatarColor: string } | null
  storyPoints?: number | null
  dueDate?: Date | null
  labels: Array<{ label: { id: string; name: string; color: string } }>
  _count: { subtasks: number; comments: number }
}

interface BoardColumnProps {
  column: {
    id: string
    name: string
    color: string
    wipLimit?: number | null
    status: { category: string; color: string }
    issues: Issue[]
  }
  onIssueClick: (key: string) => void
  onCreateIssue?: () => void
  projectKey: string
}

export function BoardColumn({ column, onIssueClick, onCreateIssue, projectKey }: BoardColumnProps) {
  const issueCount = column.issues.length
  const isAtWipLimit = column.wipLimit !== null && column.wipLimit !== undefined && issueCount >= column.wipLimit
  const isOverWipLimit = column.wipLimit !== null && column.wipLimit !== undefined && issueCount > column.wipLimit

  return (
    <div className="flex-shrink-0 w-72 flex flex-col rounded-xl bg-muted/50 dark:bg-muted/20 border border-border overflow-hidden">
      {/* Column Header */}
      <div
        className="px-3 py-3 border-b border-border"
        style={{ borderTopColor: column.status.color, borderTopWidth: 3 }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">{column.name}</h3>
            <span
              className={cn(
                'text-xs font-mono px-1.5 py-0.5 rounded-full font-semibold',
                isOverWipLimit
                  ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400'
                  : isAtWipLimit
                  ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400'
                  : 'bg-muted text-muted-foreground',
              )}
            >
              {issueCount}
            </span>
            {column.wipLimit && (
              <span className="text-xs text-muted-foreground">/ {column.wipLimit}</span>
            )}
          </div>
          {onCreateIssue && (
            <button
              onClick={onCreateIssue}
              className="p-1 rounded-md hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        {isOverWipLimit && (
          <div className="flex items-center gap-1 mt-1.5 text-xs text-red-600 dark:text-red-400">
            <AlertCircle className="w-3 h-3" />
            WIP limit exceeded
          </div>
        )}
      </div>

      {/* Droppable Area */}
      <Droppable droppableId={column.id}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={cn(
              'flex-1 overflow-y-auto p-2 space-y-2 min-h-[200px] scrollbar-thin transition-colors',
              snapshot.isDraggingOver ? 'bg-primary/5' : '',
            )}
          >
            {column.issues.map((issue, index) => (
              <BoardCard
                key={issue.id}
                issue={issue}
                index={index}
                onClick={() => onIssueClick(issue.key)}
                projectKey={projectKey}
              />
            ))}
            {provided.placeholder}

            {column.issues.length === 0 && !snapshot.isDraggingOver && (
              <div className="flex items-center justify-center h-20 text-xs text-muted-foreground/50 border-2 border-dashed border-muted rounded-lg">
                Drop issues here
              </div>
            )}
          </div>
        )}
      </Droppable>
    </div>
  )
}
