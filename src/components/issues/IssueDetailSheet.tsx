'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  X, ExternalLink, MessageSquare, Paperclip, Clock, GitBranch, Tag, User,
  Calendar, Hash, Flag, ChevronDown, Send, Edit2, Trash2, Check, Loader2,
} from 'lucide-react'
import { cn, formatDate, formatRelative, ISSUE_TYPE_COLORS, PRIORITY_COLORS } from '@/lib/utils'
import toast from 'react-hot-toast'
import { format } from 'date-fns'

interface IssueDetailSheetProps {
  issueKey: string
  projectKey: string
  onClose: () => void
  members: Array<{ id: string; name: string; avatarUrl?: string | null; avatarColor: string }>
  labels: Array<{ id: string; name: string; color: string }>
  workflowTransitions: Array<{ fromStatusId: string; toStatusId: string; fromStatus: { name: string }; toStatus: { name: string } }>
  currentUserId: string
  canEdit: boolean
}

export function IssueDetailSheet({
  issueKey, projectKey, onClose, members, labels, workflowTransitions, currentUserId, canEdit,
}: IssueDetailSheetProps) {
  const router = useRouter()
  const [issue, setIssue] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [comment, setComment] = useState('')
  const [submittingComment, setSubmittingComment] = useState(false)
  const [editingField, setEditingField] = useState<string | null>(null)
  const [editValue, setEditValue] = useState<any>(null)

  useEffect(() => {
    const fetchIssue = async () => {
      try {
        const res = await fetch(`/api/issues/${issueKey}`)
        const json = await res.json()
        if (res.ok) setIssue(json.data)
      } finally {
        setLoading(false)
      }
    }
    fetchIssue()
  }, [issueKey])

  const updateField = async (field: string, value: unknown) => {
    const res = await fetch(`/api/issues/${issueKey}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    })
    const json = await res.json()
    if (res.ok) {
      setIssue((prev: any) => ({ ...prev, ...json.data }))
      toast.success('Updated')
    } else {
      toast.error(json.error || 'Update failed')
    }
    setEditingField(null)
  }

  const transition = async (statusId: string) => {
    const res = await fetch(`/api/issues/${issueKey}/transitions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ statusId }),
    })
    const json = await res.json()
    if (res.ok) {
      setIssue((prev: any) => ({ ...prev, status: json.data.status, statusId: json.data.statusId }))
      toast.success('Status updated')
    } else {
      toast.error(json.error || 'Failed to transition')
    }
  }

  const submitComment = async () => {
    if (!comment.trim()) return
    setSubmittingComment(true)
    try {
      const res = await fetch(`/api/issues/${issueKey}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: comment }),
      })
      const json = await res.json()
      if (res.ok) {
        setIssue((prev: any) => ({ ...prev, comments: [...(prev.comments || []), json.data] }))
        setComment('')
        toast.success('Comment added')
      } else {
        toast.error(json.error || 'Failed to add comment')
      }
    } finally {
      setSubmittingComment(false)
    }
  }

  const allowedTransitions = issue
    ? workflowTransitions.filter((t) => t.fromStatusId === issue.statusId)
    : []

  const priorityColor = issue ? PRIORITY_COLORS[issue.priority as keyof typeof PRIORITY_COLORS] : null
  const typeColor = issue ? ISSUE_TYPE_COLORS[issue.type as keyof typeof ISSUE_TYPE_COLORS] : null

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="fixed inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-card w-full max-w-2xl h-full shadow-2xl border-l border-border flex flex-col animate-slide-in-from-right">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-muted/30">
          {issue && (
            <div className="flex items-center gap-2">
              <span className={cn('text-xs font-bold px-1.5 py-0.5 rounded', typeColor?.bg, typeColor?.text)}>
                {issue.type[0]}
              </span>
              <span className="font-mono text-sm font-semibold text-muted-foreground">{issue.key}</span>
            </div>
          )}
          <div className="flex items-center gap-1 ml-auto">
            {issue && (
              <Link
                href={`/projects/${projectKey}/issues/${issueKey}`}
                className="p-1.5 rounded-md hover:bg-accent transition-colors text-muted-foreground"
                title="Open full page"
              >
                <ExternalLink className="w-4 h-4" />
              </Link>
            )}
            <button onClick={onClose} className="p-1.5 rounded-md hover:bg-accent transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : !issue ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">Issue not found</div>
        ) : (
          <div className="flex-1 overflow-y-auto scrollbar-thin">
            <div className="p-5">
              {/* Title */}
              <h1 className="text-xl font-semibold leading-tight mb-4">{issue.title}</h1>

              {/* Status + Transitions */}
              <div className="flex items-center gap-2 mb-5 flex-wrap">
                <span
                  className="px-2.5 py-1 rounded-full text-xs font-semibold text-white"
                  style={{ backgroundColor: issue.status.color }}
                >
                  {issue.status.name}
                </span>
                {canEdit && allowedTransitions.map((t) => (
                  <button
                    key={t.toStatusId}
                    onClick={() => transition(t.toStatusId)}
                    className="px-2.5 py-1 rounded-full text-xs font-medium border border-border hover:bg-accent transition-colors"
                  >
                    {t.toStatus.name} →
                  </button>
                ))}
              </div>

              {/* Fields Grid */}
              <div className="grid grid-cols-2 gap-3 mb-5 text-sm">
                {/* Assignee */}
                <div className="bg-muted/40 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1"><User className="w-3 h-3" /> Assignee</p>
                  {canEdit ? (
                    <select
                      defaultValue={issue.assigneeId ?? ''}
                      onChange={(e) => updateField('assigneeId', e.target.value || null)}
                      className="w-full text-sm bg-transparent border-0 focus:outline-none cursor-pointer"
                    >
                      <option value="">Unassigned</option>
                      {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  ) : (
                    <span>{issue.assignee?.name ?? 'Unassigned'}</span>
                  )}
                </div>

                {/* Priority */}
                <div className="bg-muted/40 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1"><Flag className="w-3 h-3" /> Priority</p>
                  {canEdit ? (
                    <select
                      defaultValue={issue.priority}
                      onChange={(e) => updateField('priority', e.target.value)}
                      className="w-full text-sm bg-transparent border-0 focus:outline-none cursor-pointer"
                    >
                      {['HIGHEST', 'HIGH', 'MEDIUM', 'LOW', 'LOWEST'].map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                  ) : (
                    <span className={cn('font-medium', priorityColor?.text)}>{issue.priority}</span>
                  )}
                </div>

                {/* Story Points */}
                <div className="bg-muted/40 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1"><Hash className="w-3 h-3" /> Story Points</p>
                  {canEdit ? (
                    <input
                      type="number"
                      defaultValue={issue.storyPoints ?? ''}
                      onBlur={(e) => updateField('storyPoints', parseInt(e.target.value) || null)}
                      className="w-full text-sm bg-transparent border-0 focus:outline-none"
                      placeholder="—"
                      min={0} max={100}
                    />
                  ) : (
                    <span>{issue.storyPoints ?? '—'}</span>
                  )}
                </div>

                {/* Due Date */}
                <div className="bg-muted/40 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1"><Calendar className="w-3 h-3" /> Due Date</p>
                  {canEdit ? (
                    <input
                      type="date"
                      defaultValue={issue.dueDate ? format(new Date(issue.dueDate), 'yyyy-MM-dd') : ''}
                      onChange={(e) => updateField('dueDate', e.target.value ? new Date(e.target.value).toISOString() : null)}
                      className="w-full text-sm bg-transparent border-0 focus:outline-none cursor-pointer"
                    />
                  ) : (
                    <span>{issue.dueDate ? formatDate(issue.dueDate) : '—'}</span>
                  )}
                </div>

                {/* Reporter */}
                <div className="bg-muted/40 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground mb-1.5">Reporter</p>
                  <div className="flex items-center gap-1.5">
                    <div
                      className="w-5 h-5 rounded-full flex items-center justify-center text-white text-xs"
                      style={{ backgroundColor: issue.reporter.avatarColor }}
                    >
                      {issue.reporter.name[0].toUpperCase()}
                    </div>
                    <span>{issue.reporter.name}</span>
                  </div>
                </div>

                {/* Sprint */}
                <div className="bg-muted/40 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground mb-1.5">Sprint</p>
                  <span>{issue.sprint?.name ?? 'Backlog'}</span>
                </div>
              </div>

              {/* Description */}
              <div className="mb-5">
                <h3 className="text-sm font-semibold mb-2">Description</h3>
                {issue.description ? (
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed bg-muted/30 rounded-lg p-3">
                    {issue.description}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground/50 italic">No description</p>
                )}
              </div>

              {/* Subtasks */}
              {issue.subtasks && issue.subtasks.length > 0 && (
                <div className="mb-5">
                  <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                    <GitBranch className="w-4 h-4" /> Subtasks ({issue.subtasks.length})
                  </h3>
                  <div className="space-y-1.5">
                    {issue.subtasks.map((st: any) => (
                      <div key={st.id} className="flex items-center gap-2 p-2 rounded-lg bg-muted/30 text-sm">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: st.status.color }}
                        />
                        <span className="text-xs font-mono text-muted-foreground">{st.key}</span>
                        <span className="flex-1 truncate">{st.title}</span>
                        {st.assignee && (
                          <div
                            className="w-5 h-5 rounded-full flex items-center justify-center text-white text-xs shrink-0"
                            style={{ backgroundColor: st.assignee.avatarColor }}
                          >
                            {st.assignee.name[0].toUpperCase()}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Labels */}
              {issue.labels && issue.labels.length > 0 && (
                <div className="mb-5">
                  <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                    <Tag className="w-4 h-4" /> Labels
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {issue.labels.map(({ label }: any) => (
                      <span
                        key={label.id}
                        className="text-xs px-2 py-1 rounded-full font-medium text-white"
                        style={{ backgroundColor: label.color }}
                      >
                        {label.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Attachments */}
              {issue.attachments && issue.attachments.length > 0 && (
                <div className="mb-5">
                  <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                    <Paperclip className="w-4 h-4" /> Attachments ({issue.attachments.length})
                  </h3>
                  <div className="space-y-1.5">
                    {issue.attachments.map((att: any) => (
                      <a
                        key={att.id}
                        href={att.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 p-2 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors text-sm"
                      >
                        <Paperclip className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        <span className="flex-1 truncate">{att.filename}</span>
                        <span className="text-xs text-muted-foreground">{(att.size / 1024).toFixed(0)} KB</span>
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* Comments */}
              <div>
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
                  <MessageSquare className="w-4 h-4" /> Comments ({issue.comments?.length ?? 0})
                </h3>

                <div className="space-y-3 mb-4">
                  {issue.comments?.map((c: any) => (
                    <div key={c.id} className="flex gap-3">
                      <div
                        className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs shrink-0 mt-0.5"
                        style={{ backgroundColor: c.author.avatarColor }}
                      >
                        {c.author.name[0].toUpperCase()}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-baseline gap-2 mb-1">
                          <span className="text-sm font-semibold">{c.author.name}</span>
                          <span className="text-xs text-muted-foreground">{formatRelative(c.createdAt)}</span>
                          {c.isEdited && <span className="text-xs text-muted-foreground">(edited)</span>}
                        </div>
                        <p className="text-sm bg-muted/40 rounded-lg px-3 py-2 leading-relaxed">{c.body}</p>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Add comment */}
                <div className="flex gap-2">
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Add a comment..."
                    rows={2}
                    className="flex-1 px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-ring resize-none"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                        submitComment()
                      }
                    }}
                  />
                  <button
                    onClick={submitComment}
                    disabled={!comment.trim() || submittingComment}
                    className="px-3 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors self-end"
                  >
                    {submittingComment ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground mt-1">Cmd+Enter to submit</p>
              </div>

              {/* Metadata */}
              <div className="mt-6 pt-4 border-t border-border text-xs text-muted-foreground space-y-1">
                <p>Created {formatDate(issue.createdAt)}</p>
                <p>Updated {formatRelative(issue.updatedAt)}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
