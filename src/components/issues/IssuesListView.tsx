'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { Search, Filter, Plus, SlidersHorizontal, X } from 'lucide-react'
import { cn, ISSUE_TYPE_COLORS, PRIORITY_COLORS, formatDateShort } from '@/lib/utils'
import { CreateIssueDialog } from './CreateIssueDialog'
import toast from 'react-hot-toast'
import { isPast } from 'date-fns'

interface Issue {
  id: string; key: string; title: string; type: string; priority: string
  status: { id: string; name: string; color: string; category: string }
  assignee?: { id: string; name: string; avatarUrl?: string | null; avatarColor: string } | null
  reporter: { id: string; name: string }
  sprint?: { id: string; name: string } | null
  storyPoints?: number | null; dueDate?: Date | null
  labels: Array<{ label: { id: string; name: string; color: string } }>
  _count: { subtasks: number; comments: number }
  createdAt: Date; updatedAt: Date
}

interface EnabledField {
  key: string
  label: string
}

export function IssuesListView({ project, initialIssues, members, labels, statuses, sprints, enabledFields }: {
  project: { id: string; key: string; name: string }
  initialIssues: Issue[]
  members: Array<{ id: string; name: string; avatarUrl?: string | null; avatarColor: string }>
  labels: Array<{ id: string; name: string; color: string }>
  statuses: Array<{ id: string; name: string; color: string; category: string }>
  sprints: Array<{ id: string; name: string; status: string }>
  enabledFields: EnabledField[]
}) {
  const [issues, setIssues] = useState(initialIssues)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterPriority, setFilterPriority] = useState('')
  const [filterType, setFilterType] = useState('')
  const [filterAssignee, setFilterAssignee] = useState('')
  const [filterReporter, setFilterReporter] = useState('')
  const [filterSprint, setFilterSprint] = useState('')
  const [filterLabel, setFilterLabel] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [showFieldsPanel, setShowFieldsPanel] = useState(false)
  // Tracks which extra fields the user has added as active filters
  const [activeExtraFields, setActiveExtraFields] = useState<string[]>([])
  const fieldsPanelRef = useRef<HTMLDivElement>(null)

  // Default always-visible filter keys
  const defaultKeys = new Set(['status', 'priority', 'type', 'assignee'])
  // Extra fields from the board config (exclude default ones)
  const extraEnabledFields = enabledFields.filter((f) => !defaultKeys.has(f.key))
  // Fields not yet added as active filters
  const availableToAdd = extraEnabledFields.filter((f) => !activeExtraFields.includes(f.key))

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (fieldsPanelRef.current && !fieldsPanelRef.current.contains(e.target as Node)) {
        setShowFieldsPanel(false)
      }
    }
    if (showFieldsPanel) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showFieldsPanel])

  const filtered = issues.filter((i) => {
    if (search && !i.title.toLowerCase().includes(search.toLowerCase()) && !i.key.toLowerCase().includes(search.toLowerCase())) return false
    if (filterStatus && i.status.id !== filterStatus) return false
    if (filterPriority && i.priority !== filterPriority) return false
    if (filterType && i.type !== filterType) return false
    if (filterAssignee && i.assignee?.id !== filterAssignee) return false
    if (filterReporter && i.reporter.id !== filterReporter) return false
    if (filterSprint && i.sprint?.id !== filterSprint) return false
    if (filterLabel && !i.labels.some((l) => l.label.id === filterLabel)) return false
    return true
  })

  const handleCreated = (issue: Issue) => {
    setIssues((prev) => [issue, ...prev])
    toast.success(`Issue ${issue.key} created`)
  }

  const addField = (key: string) => {
    setActiveExtraFields((prev) => [...prev, key])
    setShowFieldsPanel(false)
  }

  const removeExtraField = (key: string) => {
    setActiveExtraFields((prev) => prev.filter((k) => k !== key))
    // Reset the filter value when removing the field
    if (key === 'reporter') setFilterReporter('')
    if (key === 'sprint') setFilterSprint('')
    if (key === 'label') setFilterLabel('')
  }

  const renderExtraFilter = (key: string) => {
    const field = enabledFields.find((f) => f.key === key)
    if (!field) return null

    const selectClass = 'px-2.5 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-ring'

    let control: React.ReactNode = null
    if (key === 'reporter') {
      control = (
        <select value={filterReporter} onChange={(e) => setFilterReporter(e.target.value)} className={selectClass}>
          <option value="">All reporters</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      )
    } else if (key === 'sprint') {
      control = (
        <select value={filterSprint} onChange={(e) => setFilterSprint(e.target.value)} className={selectClass}>
          <option value="">All sprints</option>
          {sprints.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      )
    } else if (key === 'label') {
      control = (
        <select value={filterLabel} onChange={(e) => setFilterLabel(e.target.value)} className={selectClass}>
          <option value="">All labels</option>
          {labels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      )
    } else {
      // Fields like storyPoints, dueDate, createdAt, updatedAt — display-only for now
      return null
    }

    return (
      <div key={key} className="flex items-center gap-1">
        {control}
        <button
          onClick={() => removeExtraField(key)}
          className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          title={`Remove ${field.label} filter`}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold">{project.name} · Issues</h1>
          <p className="text-muted-foreground text-sm">{filtered.length} of {issues.length} issues</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors">
          <Plus className="w-4 h-4" /> Create Issue
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input type="text" placeholder="Search issues..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="pl-8 pr-3 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-ring w-52"
          />
        </div>

        {/* Default always-visible filters — only if that field is enabled for this board */}
        {enabledFields.some((f) => f.key === 'status') && (
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="px-2.5 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-ring">
            <option value="">All statuses</option>
            {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        {enabledFields.some((f) => f.key === 'priority') && (
          <select value={filterPriority} onChange={(e) => setFilterPriority(e.target.value)} className="px-2.5 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-ring">
            <option value="">All priorities</option>
            {['HIGHEST', 'HIGH', 'MEDIUM', 'LOW', 'LOWEST'].map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        )}
        {enabledFields.some((f) => f.key === 'type') && (
          <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="px-2.5 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-ring">
            <option value="">All types</option>
            {['EPIC', 'STORY', 'TASK', 'BUG', 'SUBTASK'].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        {enabledFields.some((f) => f.key === 'assignee') && (
          <select value={filterAssignee} onChange={(e) => setFilterAssignee(e.target.value)} className="px-2.5 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-ring">
            <option value="">All assignees</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        )}

        {/* Active extra field filters */}
        {activeExtraFields.map((key) => renderExtraFilter(key))}

        {/* Fields button — only shown if there are extra enabled fields available to add */}
        {availableToAdd.length > 0 && (
          <div className="relative" ref={fieldsPanelRef}>
            <button
              onClick={() => setShowFieldsPanel((v) => !v)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-lg transition-colors',
                showFieldsPanel
                  ? 'border-primary bg-primary/5 text-primary'
                  : 'border-border bg-background text-muted-foreground hover:text-foreground hover:border-foreground/30'
              )}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              Fields
            </button>

            {showFieldsPanel && (
              <div className="absolute top-full left-0 mt-1 z-50 bg-popover border border-border rounded-xl shadow-lg min-w-[200px] py-1.5">
                <p className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b border-border mb-1">
                  Add filter field
                </p>
                {availableToAdd.map((field) => (
                  <button
                    key={field.key}
                    onClick={() => addField(field.key)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted transition-colors text-left"
                  >
                    <Plus className="w-3.5 h-3.5 text-muted-foreground" />
                    {field.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Issues Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full">
          <thead className="border-b border-border bg-muted/30">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Issue</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden md:table-cell">Status</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden lg:table-cell">Priority</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden lg:table-cell">Sprint</th>
              <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden xl:table-cell">SP</th>
              <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Assignee</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map((issue) => {
              const typeColor = ISSUE_TYPE_COLORS[issue.type as keyof typeof ISSUE_TYPE_COLORS] ?? ISSUE_TYPE_COLORS.TASK
              const isDue = issue.dueDate && isPast(new Date(issue.dueDate)) && issue.status.category !== 'DONE'
              return (
                <tr key={issue.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3">
                    <Link href={`/projects/${project.key}/issues/${issue.key}`} className="flex items-start gap-2.5 group">
                      <span className={cn('text-xs font-bold px-1 py-0.5 rounded shrink-0 mt-0.5', typeColor.bg, typeColor.text)}>
                        {issue.type[0]}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium group-hover:text-primary transition-colors truncate">{issue.title}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs font-mono text-muted-foreground">{issue.key}</span>
                          {issue.labels.slice(0, 2).map(({ label }) => (
                            <span key={label.id} className="text-xs px-1.5 py-0.5 rounded-full text-white" style={{ backgroundColor: label.color }}>{label.name}</span>
                          ))}
                          {isDue && <span className="text-xs text-red-600">⚠ Due {formatDateShort(issue.dueDate)}</span>}
                        </div>
                      </div>
                    </Link>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <span className="text-xs px-2 py-1 rounded-full font-medium text-white" style={{ backgroundColor: issue.status.color }}>
                      {issue.status.name}
                    </span>
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    <span className={cn('text-xs font-medium', PRIORITY_COLORS[issue.priority as keyof typeof PRIORITY_COLORS]?.text)}>
                      {issue.priority}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground hidden lg:table-cell">
                    {issue.sprint?.name ?? <span className="italic opacity-60">Backlog</span>}
                  </td>
                  <td className="px-4 py-3 text-center hidden xl:table-cell">
                    {issue.storyPoints ? (
                      <span className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">{issue.storyPoints}</span>
                    ) : <span className="text-muted-foreground/30">—</span>}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {issue.assignee ? (
                      <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-medium mx-auto" style={{ backgroundColor: issue.assignee.avatarColor }} title={issue.assignee.name}>
                        {issue.assignee.avatarUrl ? <img src={issue.assignee.avatarUrl} className="w-full h-full rounded-full object-cover" /> : issue.assignee.name[0].toUpperCase()}
                      </div>
                    ) : <div className="w-7 h-7 rounded-full border-2 border-dashed border-muted mx-auto" />}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            <Filter className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>No issues match your filters</p>
          </div>
        )}
      </div>

      {showCreate && (
        <CreateIssueDialog
          projectKey={project.key}
          projectId={project.id}
          members={members}
          labels={labels}
          sprints={sprints}
          workflowStatuses={statuses}
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  )
}
