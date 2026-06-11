'use client'

import { useState, useCallback } from 'react'
import { DragDropContext, Droppable, DropResult } from '@hello-pangea/dnd'
import { BoardColumn } from './BoardColumn'
import { CreateIssueDialog } from '@/components/issues/CreateIssueDialog'
import { IssueDetailSheet } from '@/components/issues/IssueDetailSheet'
import { Plus, Zap, AlertCircle, ChevronDown } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/utils'

interface Issue {
  id: string
  key: string
  title: string
  type: string
  priority: string
  status: { id: string; name: string; category: string; color: string }
  assignee?: { id: string; name: string; avatarUrl?: string | null; avatarColor: string } | null
  reporter: { id: string; name: string; avatarUrl?: string | null; avatarColor: string }
  storyPoints?: number | null
  dueDate?: Date | null
  labels: Array<{ label: { id: string; name: string; color: string } }>
  _count: { subtasks: number; comments: number }
  order: number
  columnId?: string | null
}

interface Column {
  id: string
  name: string
  order: number
  color: string
  wipLimit?: number | null
  statusId: string
  status: { id: string; name: string; category: string; color: string }
  issues: Issue[]
}

interface BoardViewProps {
  project: {
    id: string
    key: string
    name: string
    workflowTransitions: Array<{
      fromStatusId: string
      toStatusId: string
      fromStatus: { name: string }
      toStatus: { name: string }
    }>
  }
  initialColumns: Column[]
  activeSprint: { id: string; name: string; startDate?: Date | null; endDate?: Date | null } | null
  sprints: Array<{ id: string; name: string; status: string; startDate?: Date | null; endDate?: Date | null }>
  members: Array<{ id: string; name: string; avatarUrl?: string | null; avatarColor: string }>
  labels: Array<{ id: string; name: string; color: string }>
  workflowStatuses: Array<{ id: string; name: string; category: string; color: string; order: number }>
  workflowTransitions: Array<{ fromStatusId: string; toStatusId: string; fromStatus: { name: string }; toStatus: { name: string } }>
  currentUserId: string
  projectRole: string | null
  isAdmin: boolean
}

export function BoardView({
  project, initialColumns, activeSprint, sprints, members, labels,
  workflowStatuses, workflowTransitions, currentUserId, projectRole, isAdmin,
}: BoardViewProps) {
  const [columns, setColumns] = useState<Column[]>(initialColumns)
  const [selectedSprintId, setSelectedSprintId] = useState(activeSprint?.id ?? '')
  const [filterAssignee, setFilterAssignee] = useState('')
  const [filterPriority, setFilterPriority] = useState('')
  const [filterType, setFilterType] = useState('')
  const [showCreateIssue, setShowCreateIssue] = useState(false)
  const [selectedIssueKey, setSelectedIssueKey] = useState<string | null>(null)
  const [createColumnId, setCreateColumnId] = useState<string | null>(null)

  const canEdit = isAdmin || (projectRole && projectRole !== 'VIEWER')

  const onDragEnd = useCallback(
    async (result: DropResult) => {
      const { source, destination, draggableId } = result
      if (!destination) return
      if (source.droppableId === destination.droppableId && source.index === destination.index) return

      const sourceColumn = columns.find((c) => c.id === source.droppableId)
      const destColumn = columns.find((c) => c.id === destination.droppableId)
      if (!sourceColumn || !destColumn) return

      // Check if transition is allowed
      if (sourceColumn.statusId !== destColumn.statusId) {
        const allowed = workflowTransitions.some(
          (t) => t.fromStatusId === sourceColumn.statusId && t.toStatusId === destColumn.statusId,
        )
        if (!allowed) {
          toast.error(`Cannot move from "${sourceColumn.status.name}" to "${destColumn.status.name}" — workflow transition not allowed`)
          return
        }
      }

      // Optimistic update
      const prevColumns = columns
      const newColumns = columns.map((col) => ({ ...col, issues: [...col.issues] }))
      const srcCol = newColumns.find((c) => c.id === source.droppableId)!
      const dstCol = newColumns.find((c) => c.id === destination.droppableId)!

      const [moved] = srcCol.issues.splice(source.index, 1)
      dstCol.issues.splice(destination.index, 0, {
        ...moved,
        columnId: destination.droppableId,
        status: destColumn.status,
      })

      setColumns(newColumns)

      try {
        const res = await fetch(`/api/board/${project.key}/reorder`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            issueId: draggableId,
            sourceColumnId: source.droppableId,
            destinationColumnId: destination.droppableId,
            newOrder: destination.index,
            statusId: destColumn.statusId,
          }),
        })
        if (!res.ok) {
          const json = await res.json()
          toast.error(json.error || 'Failed to move issue')
          setColumns(prevColumns)
        }
      } catch {
        toast.error('Failed to move issue')
        setColumns(prevColumns)
      }
    },
    [columns, project.key, workflowTransitions],
  )

  const handleIssueCreated = (newIssue: Issue) => {
    setColumns((prev) =>
      prev.map((col) =>
        col.id === newIssue.columnId
          ? { ...col, issues: [...col.issues, newIssue] }
          : col,
      ),
    )
  }

  const filteredColumns = columns.map((col) => ({
    ...col,
    issues: col.issues.filter((issue) => {
      if (filterAssignee && issue.assignee?.id !== filterAssignee) return false
      if (filterPriority && issue.priority !== filterPriority) return false
      if (filterType && issue.type !== filterType) return false
      return true
    }),
  }))

  const totalIssues = columns.reduce((sum, col) => sum + col.issues.length, 0)

  return (
    <div className="flex flex-col h-[calc(100vh-5.5rem)]">
      {/* Board Header */}
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <div>
          <h1 className="text-xl font-bold">{project.name} · Board</h1>
          {activeSprint ? (
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                <Zap className="w-3 h-3" /> {activeSprint.name}
              </span>
              <span className="text-xs text-muted-foreground">{totalIssues} issues</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                <AlertCircle className="w-3 h-3" /> No active sprint
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Filters */}
          <select
            value={filterAssignee}
            onChange={(e) => setFilterAssignee(e.target.value)}
            className="text-xs border border-border rounded-md px-2 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="">All assignees</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>

          <select
            value={filterPriority}
            onChange={(e) => setFilterPriority(e.target.value)}
            className="text-xs border border-border rounded-md px-2 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="">All priorities</option>
            {['HIGHEST', 'HIGH', 'MEDIUM', 'LOW', 'LOWEST'].map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>

          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="text-xs border border-border rounded-md px-2 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="">All types</option>
            {['EPIC', 'STORY', 'TASK', 'BUG', 'SUBTASK'].map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>

          {canEdit && (
            <button
              onClick={() => { setCreateColumnId(null); setShowCreateIssue(true) }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-xs font-medium hover:bg-primary/90 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Create Issue
            </button>
          )}
        </div>
      </div>

      {!activeSprint ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Zap className="w-16 h-16 mx-auto mb-4 text-muted-foreground/30" />
            <h2 className="text-lg font-semibold mb-2">No active sprint</h2>
            <p className="text-muted-foreground text-sm mb-4">
              Start a sprint to see issues on the board.
            </p>
            <a
              href={`/projects/${project.key}/backlog`}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors inline-block"
            >
              Go to Backlog
            </a>
          </div>
        </div>
      ) : (
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="flex gap-4 flex-1 overflow-x-auto pb-4 scrollbar-thin">
            {filteredColumns.map((column) => (
              <BoardColumn
                key={column.id}
                column={column}
                onIssueClick={setSelectedIssueKey}
                onCreateIssue={canEdit ? () => { setCreateColumnId(column.id); setShowCreateIssue(true) } : undefined}
                projectKey={project.key}
              />
            ))}
          </div>
        </DragDropContext>
      )}

      {showCreateIssue && (
        <CreateIssueDialog
          projectKey={project.key}
          projectId={project.id}
          members={members}
          labels={labels}
          sprints={sprints}
          workflowStatuses={workflowStatuses}
          defaultSprintId={activeSprint?.id}
          onClose={() => setShowCreateIssue(false)}
          onCreated={handleIssueCreated}
        />
      )}

      {selectedIssueKey && (
        <IssueDetailSheet
          issueKey={selectedIssueKey}
          projectKey={project.key}
          onClose={() => setSelectedIssueKey(null)}
          members={members}
          labels={labels}
          workflowTransitions={workflowTransitions}
          currentUserId={currentUserId}
          canEdit={!!canEdit}
        />
      )}
    </div>
  )
}
