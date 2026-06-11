'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { createIssueSchema, type CreateIssueInput } from '@/lib/validations/issue.schema'
import { X, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'

interface CreateIssueDialogProps {
  projectKey: string
  projectId: string
  members: Array<{ id: string; name: string; avatarUrl?: string | null; avatarColor: string }>
  labels: Array<{ id: string; name: string; color: string }>
  sprints: Array<{ id: string; name: string; status: string }>
  workflowStatuses: Array<{ id: string; name: string; category: string }>
  defaultSprintId?: string
  defaultColumnId?: string
  onClose: () => void
  onCreated: (issue: any) => void
}

export function CreateIssueDialog({
  projectKey, projectId, members, labels, sprints,
  workflowStatuses, defaultSprintId, onClose, onCreated,
}: CreateIssueDialogProps) {
  const [isCreating, setIsCreating] = useState(false)
  const [selectedLabels, setSelectedLabels] = useState<string[]>([])

  const { register, handleSubmit, formState: { errors } } = useForm<CreateIssueInput>({
    resolver: zodResolver(createIssueSchema),
    defaultValues: {
      projectKey,
      type: 'TASK',
      priority: 'MEDIUM',
      sprintId: defaultSprintId ?? null,
    },
  })

  const onSubmit = async (data: CreateIssueInput) => {
    setIsCreating(true)
    try {
      const res = await fetch('/api/issues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, labelIds: selectedLabels }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error || 'Failed to create issue')
        return
      }
      toast.success(`Issue ${json.data.key} created`)
      onCreated(json.data)
      onClose()
    } finally {
      setIsCreating(false)
    }
  }

  const toggleLabel = (id: string) => {
    setSelectedLabels((prev) => prev.includes(id) ? prev.filter((l) => l !== id) : [...prev, id])
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-card border border-border rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold">Create Issue · {projectKey}</h2>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-accent"><X className="w-4 h-4" /></button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)}>
          <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto scrollbar-thin">
            {/* Type & Priority */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1 text-muted-foreground uppercase tracking-wide">Type</label>
                <select {...register('type')} className="w-full px-2.5 py-2 border border-border rounded-lg text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring">
                  {['EPIC', 'STORY', 'TASK', 'BUG', 'SUBTASK'].map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1 text-muted-foreground uppercase tracking-wide">Priority</label>
                <select {...register('priority')} className="w-full px-2.5 py-2 border border-border rounded-lg text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring">
                  {['HIGHEST', 'HIGH', 'MEDIUM', 'LOW', 'LOWEST'].map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Title */}
            <div>
              <label className="block text-xs font-medium mb-1 text-muted-foreground uppercase tracking-wide">Title *</label>
              <input
                {...register('title')}
                placeholder="Issue summary..."
                className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              />
              {errors.title && <p className="text-destructive text-xs mt-1">{errors.title.message}</p>}
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs font-medium mb-1 text-muted-foreground uppercase tracking-wide">Description</label>
              <textarea
                {...register('description')}
                placeholder="Add a description..."
                rows={4}
                className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring resize-none"
              />
            </div>

            {/* Assignee & Sprint */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1 text-muted-foreground uppercase tracking-wide">Assignee</label>
                <select {...register('assigneeId')} className="w-full px-2.5 py-2 border border-border rounded-lg text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring">
                  <option value="">Unassigned</option>
                  {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1 text-muted-foreground uppercase tracking-wide">Sprint</label>
                <select {...register('sprintId')} className="w-full px-2.5 py-2 border border-border rounded-lg text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring">
                  <option value="">Backlog</option>
                  {sprints.filter((s) => s.status !== 'COMPLETED').map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Story Points & Due Date */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1 text-muted-foreground uppercase tracking-wide">Story Points</label>
                <input
                  {...register('storyPoints', { valueAsNumber: true })}
                  type="number"
                  min={0}
                  max={100}
                  placeholder="0"
                  className="w-full px-2.5 py-2 border border-border rounded-lg text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1 text-muted-foreground uppercase tracking-wide">Due Date</label>
                <input
                  {...register('dueDate')}
                  type="date"
                  className="w-full px-2.5 py-2 border border-border rounded-lg text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            </div>

            {/* Labels */}
            {labels.length > 0 && (
              <div>
                <label className="block text-xs font-medium mb-1.5 text-muted-foreground uppercase tracking-wide">Labels</label>
                <div className="flex flex-wrap gap-1.5">
                  {labels.map((label) => (
                    <button
                      key={label.id}
                      type="button"
                      onClick={() => toggleLabel(label.id)}
                      className={`text-xs px-2 py-1 rounded-full font-medium transition-all border ${
                        selectedLabels.includes(label.id)
                          ? 'text-white border-transparent'
                          : 'border-current'
                      }`}
                      style={{
                        backgroundColor: selectedLabels.includes(label.id) ? label.color : 'transparent',
                        color: selectedLabels.includes(label.id) ? 'white' : label.color,
                      }}
                    >
                      {label.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-3 px-5 py-4 border-t border-border bg-muted/30">
            <button type="button" onClick={onClose} className="flex-1 py-2 border border-border rounded-lg text-sm hover:bg-accent transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={isCreating}
              className="flex-1 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
            >
              {isCreating && <Loader2 className="w-4 h-4 animate-spin" />}
              Create Issue
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
