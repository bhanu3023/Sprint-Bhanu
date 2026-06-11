'use client'

import { useState } from 'react'
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd'
import { CreateIssueDialog } from '@/components/issues/CreateIssueDialog'
import {
  Plus, ChevronDown, ChevronRight, Zap, BookOpen, Play, CheckCircle2,
  Loader2, X, GripVertical, Flag, MessageSquare, GitBranch, Calendar,
  LayoutList, AlertCircle,
} from 'lucide-react'
import { cn, formatDateRange, ISSUE_TYPE_COLORS, PRIORITY_COLORS, SPRINT_STATUS_COLORS } from '@/lib/utils'
import toast from 'react-hot-toast'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { createSprintSchema, type CreateSprintInput } from '@/lib/validations/sprint.schema'
import Link from 'next/link'

interface Issue {
  id: string; key: string; title: string; type: string; priority: string
  status: { id: string; name: string; category: string; color: string }
  assignee?: { id: string; name: string; avatarUrl?: string | null; avatarColor: string } | null
  storyPoints?: number | null
  labels: Array<{ label: { id: string; name: string; color: string } }>
  _count: { subtasks: number; comments: number }
  order: number
}

interface Sprint {
  id: string; name: string; goal?: string | null; status: string
  startDate?: Date | null; endDate?: Date | null
  issues: Issue[]; _count: { issues: number }
}

interface BacklogViewProps {
  project: { id: string; key: string; name: string }
  initialSprints: Sprint[]
  initialBacklogIssues: Issue[]
  members: Array<{ id: string; name: string; avatarUrl?: string | null; avatarColor: string }>
  labels: Array<{ id: string; name: string; color: string }>
  workflowStatuses: Array<{ id: string; name: string; category: string }>
  currentUserId: string
  projectRole: string | null
  isAdmin: boolean
}

const PRIORITY_DOT: Record<string, string> = {
  HIGHEST: 'bg-red-500',
  HIGH: 'bg-orange-500',
  MEDIUM: 'bg-yellow-500',
  LOW: 'bg-blue-400',
  LOWEST: 'bg-slate-400',
}

const TYPE_ICON: Record<string, { bg: string; text: string; label: string }> = {
  EPIC:    { bg: 'bg-purple-100 dark:bg-purple-900/50', text: 'text-purple-700 dark:text-purple-300', label: 'E' },
  STORY:   { bg: 'bg-green-100 dark:bg-green-900/50',  text: 'text-green-700 dark:text-green-300',   label: 'S' },
  TASK:    { bg: 'bg-blue-100 dark:bg-blue-900/50',    text: 'text-blue-700 dark:text-blue-300',     label: 'T' },
  BUG:     { bg: 'bg-red-100 dark:bg-red-900/50',      text: 'text-red-700 dark:text-red-300',       label: 'B' },
  SUBTASK: { bg: 'bg-slate-100 dark:bg-slate-800',     text: 'text-slate-600 dark:text-slate-400',   label: 'S' },
}

export function BacklogView({
  project, initialSprints, initialBacklogIssues, members, labels,
  workflowStatuses, currentUserId, projectRole, isAdmin,
}: BacklogViewProps) {
  const [sprints, setSprints] = useState(initialSprints)
  const [backlogIssues, setBacklogIssues] = useState(initialBacklogIssues)
  const [collapsedSprints, setCollapsedSprints] = useState<Set<string>>(new Set())
  const [backlogCollapsed, setBacklogCollapsed] = useState(false)
  const [showCreateIssue, setShowCreateIssue] = useState(false)
  const [createForSprint, setCreateForSprint] = useState<string | null>(null)
  const [showCreateSprint, setShowCreateSprint] = useState(false)
  const [creatingSprintId, setCreatingSprintId] = useState<string | null>(null)
  const [completingSprintId, setCompletingSprintId] = useState<string | null>(null)
  const [showCompleteDialog, setShowCompleteDialog] = useState<string | null>(null)
  const [showStartDialog, setShowStartDialog] = useState<string | null>(null)

  const canEdit = isAdmin || (projectRole && projectRole !== 'VIEWER')
  const canManageSprint = isAdmin || ['OWNER', 'ADMIN', 'SCRUM_MASTER'].includes(projectRole ?? '')

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<CreateSprintInput>({
    resolver: zodResolver(createSprintSchema),
    defaultValues: { projectKey: project.key },
  })

  const totalIssues = sprints.reduce((s, sp) => s + sp.issues.length, 0) + backlogIssues.length

  const toggleSprint = (id: string) => {
    setCollapsedSprints((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const onDragEnd = async (result: DropResult) => {
    const { source, destination, draggableId } = result
    if (!destination) return
    if (source.droppableId === destination.droppableId && source.index === destination.index) return

    const targetSprintId = destination.droppableId === 'backlog' ? null : destination.droppableId
    let movedIssue: Issue | undefined

    if (source.droppableId === 'backlog') {
      const newBacklog = [...backlogIssues]
      ;[movedIssue] = newBacklog.splice(source.index, 1)
      setBacklogIssues(newBacklog)
    } else {
      setSprints((prev) => prev.map((s) => {
        if (s.id !== source.droppableId) return s
        const issues = [...s.issues]
        ;[movedIssue] = issues.splice(source.index, 1)
        return { ...s, issues }
      }))
    }

    if (!movedIssue) return

    if (targetSprintId === null) {
      setBacklogIssues((prev) => { const i = [...prev]; i.splice(destination.index, 0, movedIssue!); return i })
    } else {
      setSprints((prev) => prev.map((s) => {
        if (s.id !== targetSprintId) return s
        const issues = [...s.issues]; issues.splice(destination.index, 0, movedIssue!); return { ...s, issues }
      }))
    }

    try {
      const res = await fetch(`/api/backlog/${project.key}/move`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueIds: [draggableId], targetSprintId }),
      })
      if (!res.ok) toast.error('Failed to move issue')
    } catch { toast.error('Failed to move issue') }
  }

  const createSprint = async (data: CreateSprintInput) => {
    const res = await fetch('/api/sprints', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    const json = await res.json()
    if (res.ok) {
      setSprints((prev) => [...prev, { ...json.data, issues: [] }])
      setShowCreateSprint(false)
      reset()
      toast.success('Sprint created!')
    } else {
      toast.error(json.error || 'Failed to create sprint')
    }
  }

  const startSprint = async (sprintId: string) => {
    if (sprints.find((s) => s.status === 'ACTIVE')) {
      toast.error('Complete the active sprint first.')
      return
    }
    setCreatingSprintId(sprintId)
    const startDate = new Date().toISOString()
    const endDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
    try {
      const res = await fetch(`/api/sprints/${sprintId}/start`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startDate, endDate }),
      })
      const json = await res.json()
      if (res.ok) {
        const sp = sprints.find((s) => s.id === sprintId)
        setSprints((prev) => prev.map((s) => s.id === sprintId ? { ...s, status: 'ACTIVE', startDate: new Date(startDate), endDate: new Date(endDate) } : s))
        toast.success(`${sp?.name} started!`)
      } else toast.error(json.error || 'Failed to start sprint')
    } finally { setCreatingSprintId(null); setShowStartDialog(null) }
  }

  const completeSprint = async (sprintId: string, moveToSprintId: string | null) => {
    setCompletingSprintId(sprintId)
    try {
      const res = await fetch(`/api/sprints/${sprintId}/complete`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ moveToSprintId }),
      })
      const json = await res.json()
      if (res.ok) {
        setSprints((prev) => prev.filter((s) => s.id !== sprintId))
        toast.success(`Sprint completed! ${json.data?.movedCount ?? 0} issues moved.`)
      } else toast.error(json.error || 'Failed to complete sprint')
    } finally { setCompletingSprintId(null); setShowCompleteDialog(null) }
  }

  const handleIssueCreated = (issue: Issue) => {
    if (createForSprint) {
      setSprints((prev) => prev.map((s) => s.id === createForSprint ? { ...s, issues: [...s.issues, issue] } : s))
    } else {
      setBacklogIssues((prev) => [...prev, issue])
    }
  }

  const moveIssue = async (issue: Issue, fromSprintId: string | null, toSprintId: string | null) => {
    const res = await fetch(`/api/backlog/${project.key}/move`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issueIds: [issue.id], targetSprintId: toSprintId }),
    })
    if (!res.ok) { toast.error('Failed to move issue'); return }

    if (fromSprintId === null) {
      setBacklogIssues((prev) => prev.filter((i) => i.id !== issue.id))
    } else {
      setSprints((prev) => prev.map((s) => s.id === fromSprintId ? { ...s, issues: s.issues.filter((i) => i.id !== issue.id) } : s))
    }

    if (toSprintId === null) {
      setBacklogIssues((prev) => [...prev, issue])
    } else {
      setSprints((prev) => prev.map((s) => s.id === toSprintId ? { ...s, issues: [...s.issues, issue] } : s))
    }
    toast.success('Issue moved')
  }

  return (
    <div className="max-w-5xl mx-auto space-y-1">
      {/* Page Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Backlog</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {totalIssues} {totalIssues === 1 ? 'issue' : 'issues'} · {sprints.length} sprint{sprints.length !== 1 ? 's' : ''}
          </p>
        </div>
        {canManageSprint && (
          <button
            onClick={() => setShowCreateSprint(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" /> Create Sprint
          </button>
        )}
      </div>

      <DragDropContext onDragEnd={onDragEnd}>
        <div className="space-y-3">
          {/* Sprint Sections */}
          {sprints.map((sprint) => {
            const isCollapsed = collapsedSprints.has(sprint.id)
            const totalPoints = sprint.issues.reduce((s, i) => s + (i.storyPoints ?? 0), 0)
            const doneCount = sprint.issues.filter((i) => i.status.category === 'DONE').length
            const donePoints = sprint.issues.filter((i) => i.status.category === 'DONE').reduce((s, i) => s + (i.storyPoints ?? 0), 0)
            const progress = totalPoints > 0 ? Math.round((donePoints / totalPoints) * 100) : (sprint.issues.length > 0 ? Math.round((doneCount / sprint.issues.length) * 100) : 0)
            const isActive = sprint.status === 'ACTIVE'

            return (
              <div key={sprint.id} className={cn(
                'rounded-xl border overflow-hidden transition-all',
                isActive ? 'border-primary/40 shadow-sm' : 'border-border',
              )}>
                {/* Sprint Header */}
                <div className={cn(
                  'px-4 py-3 flex items-center gap-3',
                  isActive ? 'bg-primary/5 dark:bg-primary/10' : 'bg-muted/30',
                )}>
                  <button
                    onClick={() => toggleSprint(sprint.id)}
                    className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                  >
                    {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{sprint.name}</span>
                      <span className={cn(
                        'text-xs px-2 py-0.5 rounded-full font-medium',
                        SPRINT_STATUS_COLORS[sprint.status as keyof typeof SPRINT_STATUS_COLORS]
                      )}>
                        {sprint.status}
                      </span>
                      {sprint.startDate && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Calendar className="w-3 h-3" />
                          {formatDateRange(sprint.startDate, sprint.endDate)}
                        </span>
                      )}
                    </div>
                    {sprint.goal && (
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">{sprint.goal}</p>
                    )}
                    <div className="flex items-center gap-3 mt-1.5">
                      <span className="text-xs text-muted-foreground">
                        {sprint.issues.length} issues · {totalPoints} pts
                      </span>
                      <span className="text-xs font-medium text-green-600 dark:text-green-400">
                        {doneCount} done
                      </span>
                      {sprint.issues.length > 0 && (
                        <div className="flex items-center gap-1.5 flex-1 max-w-32">
                          <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full bg-green-500 rounded-full transition-all"
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                          <span className="text-xs text-muted-foreground shrink-0">{progress}%</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {canEdit && (
                      <button
                        onClick={() => { setCreateForSprint(sprint.id); setShowCreateIssue(true) }}
                        className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-border hover:bg-accent transition-colors text-muted-foreground font-medium"
                      >
                        <Plus className="w-3 h-3" /> Add
                      </button>
                    )}
                    {canManageSprint && sprint.status === 'PLANNED' && (
                      <button
                        onClick={() => setShowStartDialog(sprint.id)}
                        disabled={creatingSprintId === sprint.id}
                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 shadow-sm"
                      >
                        {creatingSprintId === sprint.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                        Start Sprint
                      </button>
                    )}
                    {canManageSprint && sprint.status === 'ACTIVE' && (
                      <button
                        onClick={() => setShowCompleteDialog(sprint.id)}
                        disabled={completingSprintId === sprint.id}
                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 shadow-sm"
                      >
                        {completingSprintId === sprint.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                        Complete
                      </button>
                    )}
                  </div>
                </div>

                {/* Sprint Issues */}
                {!isCollapsed && (
                  <Droppable droppableId={sprint.id}>
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        className={cn(
                          'transition-colors divide-y divide-border/50',
                          snapshot.isDraggingOver ? 'bg-primary/5' : 'bg-background',
                        )}
                      >
                        {sprint.issues.map((issue, idx) => (
                          <BacklogIssueRow
                            key={issue.id}
                            issue={issue}
                            index={idx}
                            projectKey={project.key}
                            sprints={sprints}
                            currentSprintId={sprint.id}
                            onMoveToSprint={(toId) => moveIssue(issue, sprint.id, toId)}
                          />
                        ))}
                        {provided.placeholder}
                        {sprint.issues.length === 0 && (
                          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground/50 gap-2">
                            <LayoutList className="w-8 h-8 opacity-30" />
                            <p className="text-sm">No issues yet — drag here or click Add</p>
                          </div>
                        )}
                      </div>
                    )}
                  </Droppable>
                )}
              </div>
            )
          })}

          {/* Backlog Section */}
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="px-4 py-3 flex items-center gap-3 bg-muted/30">
              <button
                onClick={() => setBacklogCollapsed((v) => !v)}
                className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
              >
                {backlogCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              <div className="flex items-center gap-2 flex-1">
                <BookOpen className="w-4 h-4 text-muted-foreground" />
                <span className="font-semibold text-sm">Backlog</span>
                <span className="text-xs bg-muted border border-border text-muted-foreground px-2 py-0.5 rounded-full font-medium">
                  {backlogIssues.length}
                </span>
              </div>
              {canEdit && (
                <button
                  onClick={() => { setCreateForSprint(null); setShowCreateIssue(true) }}
                  className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-border hover:bg-accent transition-colors text-muted-foreground font-medium"
                >
                  <Plus className="w-3 h-3" /> Add
                </button>
              )}
            </div>

            {!backlogCollapsed && (
              <Droppable droppableId="backlog">
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={cn(
                      'transition-colors divide-y divide-border/50',
                      snapshot.isDraggingOver ? 'bg-primary/5' : 'bg-background',
                    )}
                  >
                    {backlogIssues.map((issue, idx) => (
                      <BacklogIssueRow
                        key={issue.id}
                        issue={issue}
                        index={idx}
                        projectKey={project.key}
                        sprints={sprints}
                        currentSprintId={null}
                        onMoveToSprint={(toId) => moveIssue(issue, null, toId)}
                      />
                    ))}
                    {provided.placeholder}
                    {backlogIssues.length === 0 && (
                      <div className="flex flex-col items-center justify-center py-10 text-muted-foreground/50 gap-2">
                        <CheckCircle2 className="w-8 h-8 opacity-30" />
                        <p className="text-sm">All issues are in sprints!</p>
                      </div>
                    )}
                  </div>
                )}
              </Droppable>
            )}
          </div>
        </div>
      </DragDropContext>

      {/* Create Issue Dialog */}
      {showCreateIssue && (
        <CreateIssueDialog
          projectKey={project.key}
          projectId={project.id}
          members={members}
          labels={labels}
          sprints={sprints}
          workflowStatuses={workflowStatuses}
          defaultSprintId={createForSprint ?? undefined}
          onClose={() => { setShowCreateIssue(false); setCreateForSprint(null) }}
          onCreated={handleIssueCreated}
        />
      )}

      {/* Create Sprint Modal */}
      {showCreateSprint && (
        <Modal title="Create Sprint" onClose={() => { setShowCreateSprint(false); reset() }}>
          <form onSubmit={handleSubmit(createSprint)} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">Sprint Name <span className="text-red-500">*</span></label>
              <input
                {...register('name')}
                placeholder="e.g. Sprint 1"
                className="input-field"
                autoFocus
              />
              {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name.message}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Sprint Goal</label>
              <textarea
                {...register('goal')}
                rows={2}
                placeholder="What will be achieved in this sprint?"
                className="input-field resize-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1.5">Start Date</label>
                <input type="date" {...register('startDate')} className="input-field" />
                {errors.startDate && <p className="text-red-500 text-xs mt-1">{errors.startDate.message as string}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">End Date</label>
                <input type="date" {...register('endDate')} className="input-field" />
                {errors.endDate && <p className="text-red-500 text-xs mt-1">{errors.endDate.message as string}</p>}
              </div>
            </div>
            <div className="flex gap-3 pt-1 border-t border-border">
              <button type="button" onClick={() => { setShowCreateSprint(false); reset() }}
                className="flex-1 py-2 border border-border rounded-lg text-sm hover:bg-muted transition-colors">
                Cancel
              </button>
              <button type="submit" disabled={isSubmitting}
                className="flex-1 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
                {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                Create Sprint
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Start Sprint Dialog */}
      {showStartDialog && (() => {
        const sprint = sprints.find((s) => s.id === showStartDialog)!
        return (
          <Modal title="Start Sprint" onClose={() => setShowStartDialog(null)}>
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-3 bg-muted/40 rounded-lg">
                <div className="w-9 h-9 rounded-lg bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                  <Zap className="w-5 h-5 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <p className="font-medium text-sm">{sprint?.name}</p>
                  <p className="text-xs text-muted-foreground">{sprint?.issues.length} issues in this sprint</p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                The sprint will start now with a default 2-week duration. You can update dates anytime from sprint settings.
              </p>
              <div className="flex gap-3 pt-1 border-t border-border">
                <button onClick={() => setShowStartDialog(null)}
                  className="flex-1 py-2 border border-border rounded-lg text-sm hover:bg-muted transition-colors">
                  Cancel
                </button>
                <button
                  onClick={() => startSprint(showStartDialog)}
                  disabled={creatingSprintId === showStartDialog}
                  className="flex-1 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
                >
                  {creatingSprintId === showStartDialog && <Loader2 className="w-4 h-4 animate-spin" />}
                  Start Sprint
                </button>
              </div>
            </div>
          </Modal>
        )
      })()}

      {/* Complete Sprint Dialog */}
      {showCompleteDialog && (() => {
        const sprint = sprints.find((s) => s.id === showCompleteDialog)!
        const incomplete = sprint?.issues.filter((i) => i.status.category !== 'DONE').length ?? 0
        let moveTarget = ''
        return (
          <Modal title="Complete Sprint" onClose={() => setShowCompleteDialog(null)}>
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-3 bg-muted/40 rounded-lg">
                <div className="w-9 h-9 rounded-lg bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center">
                  <CheckCircle2 className="w-5 h-5 text-violet-600 dark:text-violet-400" />
                </div>
                <div>
                  <p className="font-medium text-sm">{sprint?.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {sprint?.issues.filter(i => i.status.category === 'DONE').length} done · {incomplete} incomplete
                  </p>
                </div>
              </div>

              {incomplete > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 text-sm text-amber-600 dark:text-amber-400 mb-2">
                    <AlertCircle className="w-4 h-4" />
                    {incomplete} incomplete issue{incomplete !== 1 ? 's' : ''} will be moved to:
                  </div>
                  <select
                    onChange={(e) => { moveTarget = e.target.value }}
                    className="input-field"
                    defaultValue=""
                  >
                    <option value="">Backlog</option>
                    {sprints.filter((s) => s.id !== showCompleteDialog && s.status !== 'COMPLETED').map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex gap-3 pt-1 border-t border-border">
                <button onClick={() => setShowCompleteDialog(null)}
                  className="flex-1 py-2 border border-border rounded-lg text-sm hover:bg-muted transition-colors">
                  Cancel
                </button>
                <button
                  onClick={() => {
                    const sel = document.querySelector('#complete-move-select') as HTMLSelectElement
                    completeSprint(showCompleteDialog, sel?.value || moveTarget || null)
                  }}
                  disabled={completingSprintId === showCompleteDialog}
                  className="flex-1 py-2 bg-violet-600 text-white rounded-lg text-sm font-medium hover:bg-violet-700 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
                >
                  {completingSprintId === showCompleteDialog && <Loader2 className="w-4 h-4 animate-spin" />}
                  Complete Sprint
                </button>
              </div>
            </div>
          </Modal>
        )
      })()}
    </div>
  )
}

// ─── Issue Row ────────────────────────────────────────────────────────────────

function BacklogIssueRow({
  issue, index, projectKey, sprints, currentSprintId, onMoveToSprint,
}: {
  issue: Issue
  index: number
  projectKey: string
  sprints: Sprint[]
  currentSprintId: string | null
  onMoveToSprint: (targetSprintId: string | null) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const type = TYPE_ICON[issue.type] ?? TYPE_ICON.TASK
  const priorityDot = PRIORITY_DOT[issue.priority] ?? PRIORITY_DOT.MEDIUM

  return (
    <Draggable draggableId={issue.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          style={provided.draggableProps.style}
          className={cn(
            'group flex items-center gap-2 px-3 py-2.5 text-sm select-none transition-colors',
            snapshot.isDragging ? 'bg-card shadow-xl rounded-lg border border-border opacity-95' : 'hover:bg-muted/40',
          )}
        >
          {/* Drag handle */}
          <div {...provided.dragHandleProps} className="text-muted-foreground/30 group-hover:text-muted-foreground/60 cursor-grab active:cursor-grabbing shrink-0">
            <GripVertical className="w-3.5 h-3.5" />
          </div>

          {/* Priority dot */}
          <div className={cn('w-2 h-2 rounded-full shrink-0', priorityDot)} title={issue.priority} />

          {/* Type badge */}
          <span className={cn('w-5 h-5 text-xs font-bold flex items-center justify-center rounded shrink-0', type.bg, type.text)}>
            {type.label}
          </span>

          {/* Issue key */}
          <span className="font-mono text-xs text-muted-foreground shrink-0 w-16">{issue.key}</span>

          {/* Title */}
          <Link
            href={`/projects/${projectKey}/issues/${issue.key}`}
            className="flex-1 truncate font-medium hover:text-primary transition-colors"
            onClick={(e) => e.stopPropagation()}
          >
            {issue.title}
          </Link>

          {/* Labels */}
          <div className="hidden lg:flex items-center gap-1 shrink-0">
            {issue.labels.slice(0, 2).map(({ label }) => (
              <span key={label.id} className="text-xs px-1.5 py-0.5 rounded-full font-medium text-white" style={{ backgroundColor: label.color }}>
                {label.name}
              </span>
            ))}
          </div>

          {/* Metadata */}
          <div className="hidden md:flex items-center gap-2 text-muted-foreground shrink-0">
            {issue._count.subtasks > 0 && (
              <span className="flex items-center gap-0.5 text-xs">
                <GitBranch className="w-3 h-3" /> {issue._count.subtasks}
              </span>
            )}
            {issue._count.comments > 0 && (
              <span className="flex items-center gap-0.5 text-xs">
                <MessageSquare className="w-3 h-3" /> {issue._count.comments}
              </span>
            )}
          </div>

          {/* Story points */}
          {issue.storyPoints != null && (
            <span className="text-xs bg-muted border border-border px-1.5 py-0.5 rounded font-mono shrink-0">
              {issue.storyPoints}
            </span>
          )}

          {/* Status pill */}
          <span
            className="hidden sm:block text-xs px-2 py-0.5 rounded-full font-medium text-white shrink-0 max-w-24 truncate"
            style={{ backgroundColor: issue.status.color }}
            title={issue.status.name}
          >
            {issue.status.name}
          </span>

          {/* Assignee avatar */}
          {issue.assignee ? (
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-semibold shrink-0 ring-2 ring-background"
              style={{ backgroundColor: issue.assignee.avatarColor }}
              title={issue.assignee.name}
            >
              {issue.assignee.avatarUrl
                ? <img src={issue.assignee.avatarUrl} className="w-full h-full rounded-full object-cover" alt={issue.assignee.name} />
                : issue.assignee.name[0].toUpperCase()}
            </div>
          ) : (
            <div className="w-6 h-6 rounded-full border-2 border-dashed border-muted-foreground/30 shrink-0" />
          )}

          {/* Move menu */}
          <div className="relative shrink-0">
            <button
              onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v) }}
              className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-muted transition-all"
              title="Move to sprint"
            >
              <svg className="w-3.5 h-3.5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l4-4 4 4M8 15l4 4 4-4" />
              </svg>
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-full mt-1 w-52 bg-popover border border-border rounded-xl shadow-xl z-50 overflow-hidden text-xs py-1">
                  <div className="px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border mb-1">
                    Move to
                  </div>
                  {sprints.filter((s) => s.id !== currentSprintId).map((s) => (
                    <button key={s.id} onClick={() => { onMoveToSprint(s.id); setMenuOpen(false) }}
                      className="flex items-center gap-2 w-full px-3 py-2 hover:bg-accent transition-colors text-left">
                      <Zap className="w-3.5 h-3.5 text-primary shrink-0" />
                      <span className="truncate">{s.name}</span>
                      <span className={cn('ml-auto text-xs px-1.5 rounded-full', SPRINT_STATUS_COLORS[s.status as keyof typeof SPRINT_STATUS_COLORS])}>
                        {s.status}
                      </span>
                    </button>
                  ))}
                  {currentSprintId !== null && (
                    <button onClick={() => { onMoveToSprint(null); setMenuOpen(false) }}
                      className="flex items-center gap-2 w-full px-3 py-2 hover:bg-accent transition-colors text-left border-t border-border mt-1">
                      <BookOpen className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      Move to Backlog
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </Draggable>
  )
}

// ─── Shared Modal ─────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border border-border rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  )
}
