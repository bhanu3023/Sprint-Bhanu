'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, GitBranch, Tag, Paperclip, MessageSquare, Clock, User,
  Calendar, Hash, Flag, Send, Loader2, CheckCircle2, AlertCircle, ShieldAlert,
} from 'lucide-react'
import { cn, formatDate, formatRelative, ISSUE_TYPE_COLORS, PRIORITY_COLORS } from '@/lib/utils'
import toast from 'react-hot-toast'
import { format } from 'date-fns'
import { SlaCard } from '@/components/sla/SlaBadge'
import { IssueDateCard } from '@/components/issues/IssueDateCard'

interface IssueDetailPageProps {
  issue: any
  activityLogs: any[]
  members: Array<{ id: string; name: string; email: string; avatarUrl?: string | null; avatarColor: string }>
  labels: Array<{ id: string; name: string; color: string }>
  currentUserId: string
  canEdit: boolean
}

export function IssueDetailPage({ issue: initialIssue, activityLogs, members, labels, currentUserId, canEdit }: IssueDetailPageProps) {
  const router = useRouter()
  const [issue, setIssue] = useState(initialIssue)
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [activeTab, setActiveTab] = useState<'comments' | 'activity'>('comments')

  const updateField = async (field: string, value: unknown) => {
    const res = await fetch(`/api/issues/${issue.key}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    })
    if (res.ok) {
      const json = await res.json()
      setIssue((prev: any) => ({ ...prev, ...json.data }))
      toast.success('Updated')
    } else {
      toast.error('Update failed')
    }
  }

  const transition = async (statusId: string) => {
    const res = await fetch(`/api/issues/${issue.key}/transitions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ statusId }),
    })
    if (res.ok) {
      const json = await res.json()
      setIssue((prev: any) => ({ ...prev, status: json.data.status, statusId: json.data.statusId }))
      toast.success('Status updated')
    } else {
      const j = await res.json()
      toast.error(j.error || 'Transition failed')
    }
  }

  const addComment = async () => {
    if (!comment.trim()) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/issues/${issue.key}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: comment }),
      })
      if (res.ok) {
        const json = await res.json()
        setIssue((prev: any) => ({ ...prev, comments: [...prev.comments, json.data] }))
        setComment('')
      } else toast.error('Failed to add comment')
    } finally {
      setSubmitting(false)
    }
  }

  const allowedTransitions = issue.project.workflowTransitions?.filter((t: any) => t.fromStatusId === issue.statusId) ?? []
  const typeColor = ISSUE_TYPE_COLORS[issue.type as keyof typeof ISSUE_TYPE_COLORS] ?? ISSUE_TYPE_COLORS.TASK
  const priorityColor = PRIORITY_COLORS[issue.priority as keyof typeof PRIORITY_COLORS] ?? PRIORITY_COLORS.MEDIUM

  return (
    <div className="max-w-6xl mx-auto">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
        <Link href={`/projects/${issue.project.key}/board`} className="hover:text-foreground transition-colors">
          <ArrowLeft className="w-4 h-4 inline mr-1" />{issue.project.name}
        </Link>
        <span>/</span>
        <Link href={`/projects/${issue.project.key}/issues`} className="hover:text-foreground transition-colors">Issues</Link>
        <span>/</span>
        <span className="text-foreground font-medium">{issue.key}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-5">
          {/* Header */}
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <span className={cn('text-xs font-bold px-1.5 py-0.5 rounded', typeColor.bg, typeColor.text)}>
                {issue.type}
              </span>
              <span className="text-xs font-mono text-muted-foreground">{issue.key}</span>
            </div>
            <h1 className="text-xl font-bold leading-tight mb-4">{issue.title}</h1>

            {/* Status & Transitions */}
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="px-3 py-1.5 rounded-full text-sm font-semibold text-white"
                style={{ backgroundColor: issue.status.color }}
              >
                {issue.status.name}
              </span>
              {canEdit && allowedTransitions.map((t: any) => (
                <button
                  key={t.toStatusId}
                  onClick={() => transition(t.toStatusId)}
                  className="px-3 py-1.5 rounded-full text-sm font-medium border border-border hover:bg-accent transition-colors"
                >
                  {t.name} →
                </button>
              ))}
            </div>
          </div>

          {/* Description */}
          <div className="bg-card border border-border rounded-xl p-5">
            <h2 className="text-sm font-semibold mb-3">Description</h2>
            {issue.description ? (
              <div className="text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">{issue.description}</div>
            ) : (
              <p className="text-sm text-muted-foreground/50 italic">No description provided.</p>
            )}
          </div>

          {/* Subtasks */}
          {issue.subtasks?.length > 0 && (
            <div className="bg-card border border-border rounded-xl p-5">
              <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <GitBranch className="w-4 h-4" /> Subtasks ({issue.subtasks.length})
              </h2>
              <div className="space-y-2">
                {issue.subtasks.map((st: any) => (
                  <Link
                    key={st.id}
                    href={`/projects/${issue.project.key}/issues/${st.key}`}
                    className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
                  >
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: st.status.color }} />
                    <span className="text-xs font-mono text-muted-foreground">{st.key}</span>
                    <span className="flex-1 text-sm truncate">{st.title}</span>
                    {st.assignee && (
                      <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs" style={{ backgroundColor: st.assignee.avatarColor }}>
                        {st.assignee.name[0].toUpperCase()}
                      </div>
                    )}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Comments / Activity */}
          <div className="bg-card border border-border rounded-xl">
            <div className="flex border-b border-border">
              {[
                { id: 'comments', label: `Comments (${issue.comments?.length ?? 0})`, icon: MessageSquare },
                { id: 'activity', label: `Activity (${activityLogs.length})`, icon: Clock },
              ].map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setActiveTab(id as any)}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors',
                    activeTab === id
                      ? 'text-primary border-b-2 border-primary'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Icon className="w-4 h-4" /> {label}
                </button>
              ))}
            </div>

            <div className="p-5">
              {activeTab === 'comments' && (
                <div className="space-y-4">
                  {issue.comments?.map((c: any) => (
                    <div key={c.id} className="flex gap-3">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm shrink-0" style={{ backgroundColor: c.author.avatarColor }}>
                        {c.author.name[0].toUpperCase()}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-baseline gap-2 mb-1">
                          <span className="text-sm font-semibold">{c.author.name}</span>
                          <span className="text-xs text-muted-foreground">{formatRelative(c.createdAt)}</span>
                          {c.isEdited && <span className="text-xs text-muted-foreground">(edited)</span>}
                        </div>
                        <p className="text-sm bg-muted/40 rounded-xl px-4 py-3 leading-relaxed">{c.body}</p>
                      </div>
                    </div>
                  ))}

                  <div className="flex gap-3 mt-4">
                    <textarea
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      placeholder="Write a comment..."
                      rows={3}
                      className="flex-1 px-3 py-2.5 text-sm border border-border rounded-xl bg-background focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                      onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addComment() }}
                    />
                    <button
                      onClick={addComment}
                      disabled={!comment.trim() || submitting}
                      className="px-4 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 disabled:opacity-50 self-end py-3 transition-colors"
                    >
                      {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              )}

              {activeTab === 'activity' && (
                <div className="space-y-3">
                  {activityLogs.map((log: any) => (
                    <div key={log.id} className="flex items-start gap-3 text-sm">
                      <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs shrink-0 mt-0.5" style={{ backgroundColor: log.actor.avatarColor }}>
                        {log.actor.name[0].toUpperCase()}
                      </div>
                      <div>
                        <span className="font-medium">{log.actor.name.split(' ')[0]}</span>{' '}
                        <span className="text-muted-foreground">{log.action}</span>{' '}
                        {log.changes && typeof log.changes === 'object' && !Array.isArray(log.changes) && (log.changes as any).from && (
                          <span className="text-muted-foreground">
                            <span className="line-through">{(log.changes as any).from}</span> → <strong>{(log.changes as any).to}</strong>
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground ml-2">{formatRelative(log.createdAt)}</span>
                      </div>
                    </div>
                  ))}
                  {activityLogs.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No activity yet</p>}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <div className="bg-card border border-border rounded-xl p-4 space-y-4">
            <h3 className="text-sm font-semibold">Details</h3>

            {/* Assignee */}
            <Field icon={<User className="w-3.5 h-3.5" />} label="Assignee">
              {canEdit ? (
                <select
                  defaultValue={issue.assigneeId ?? ''}
                  onChange={(e) => updateField('assigneeId', e.target.value || null)}
                  className="w-full text-sm bg-transparent border-0 focus:outline-none cursor-pointer -ml-1"
                >
                  <option value="">Unassigned</option>
                  {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              ) : (
                <span className="text-sm">{issue.assignee?.name ?? 'Unassigned'}</span>
              )}
            </Field>

            {/* Reporter */}
            <Field icon={<User className="w-3.5 h-3.5" />} label="Reporter">
              <div className="flex items-center gap-1.5">
                <div className="w-5 h-5 rounded-full flex items-center justify-center text-white text-xs" style={{ backgroundColor: issue.reporter.avatarColor }}>
                  {issue.reporter.name[0].toUpperCase()}
                </div>
                <span className="text-sm">{issue.reporter.name}</span>
              </div>
            </Field>

            {/* Priority */}
            <Field icon={<Flag className="w-3.5 h-3.5" />} label="Priority">
              {canEdit ? (
                <select defaultValue={issue.priority} onChange={(e) => updateField('priority', e.target.value)} className="w-full text-sm bg-transparent border-0 focus:outline-none cursor-pointer -ml-1">
                  {['HIGHEST', 'HIGH', 'MEDIUM', 'LOW', 'LOWEST'].map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              ) : (
                <span className={cn('text-sm font-medium', priorityColor.text)}>{issue.priority}</span>
              )}
            </Field>

            {/* Story Points */}
            <Field icon={<Hash className="w-3.5 h-3.5" />} label="Story Points">
              {canEdit ? (
                <input
                  type="number"
                  defaultValue={issue.storyPoints ?? ''}
                  onBlur={(e) => updateField('storyPoints', parseInt(e.target.value) || null)}
                  className="w-full text-sm bg-transparent border-0 focus:outline-none -ml-1"
                  placeholder="—"
                  min={0} max={100}
                />
              ) : (
                <span className="text-sm">{issue.storyPoints ?? '—'}</span>
              )}
            </Field>

            {/* Sprint */}
            <Field icon={<Flag className="w-3.5 h-3.5" />} label="Sprint">
              <span className="text-sm">{issue.sprint?.name ?? 'Backlog'}</span>
            </Field>

            {/* Due Date */}
            <Field icon={<Calendar className="w-3.5 h-3.5" />} label="Due Date">
              {canEdit ? (
                <input
                  type="date"
                  defaultValue={issue.dueDate ? format(new Date(issue.dueDate), 'yyyy-MM-dd') : ''}
                  onChange={(e) => updateField('dueDate', e.target.value ? new Date(e.target.value).toISOString() : null)}
                  className="w-full text-sm bg-transparent border-0 focus:outline-none cursor-pointer -ml-1"
                />
              ) : (
                <span className="text-sm">{issue.dueDate ? formatDate(issue.dueDate) : '—'}</span>
              )}
            </Field>

            {/* Epic */}
            {issue.epic && (
              <Field icon={<Tag className="w-3.5 h-3.5" />} label="Epic">
                <Link href={`/projects/${issue.project.key}/issues/${issue.epic.key}`} className="text-sm text-primary hover:underline">
                  {issue.epic.key}: {issue.epic.title}
                </Link>
              </Field>
            )}
          </div>

          {/* Date Calendar Card */}
          <IssueDateCard
            sprint={issue.sprint}
            dueDate={issue.dueDate}
            createdAt={issue.createdAt}
          />

          {/* SLA Status */}
          {(issue.slaResponseDeadline || issue.slaResolutionDeadline) && (
            <div className="bg-card border border-border rounded-xl p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2.5 flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5 text-amber-500" /> SLA Status
              </h3>
              <SlaCard
                responseDeadline={issue.slaResponseDeadline}
                resolutionDeadline={issue.slaResolutionDeadline}
                responseBreached={issue.slaResponseBreached}
                resolutionBreached={issue.slaResolutionBreached}
                responseMet={issue.slaResponseMet}
              />
            </div>
          )}

          {/* Labels */}
          {issue.labels?.length > 0 && (
            <div className="bg-card border border-border rounded-xl p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2.5">Labels</h3>
              <div className="flex flex-wrap gap-1.5">
                {issue.labels.map(({ label }: any) => (
                  <span key={label.id} className="text-xs px-2 py-1 rounded-full font-medium text-white" style={{ backgroundColor: label.color }}>
                    {label.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Watchers */}
          {issue.watchers?.length > 0 && (
            <div className="bg-card border border-border rounded-xl p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2.5">Watchers</h3>
              <div className="flex -space-x-1.5">
                {issue.watchers.map(({ user }: any) => (
                  <div key={user.id} className="w-7 h-7 rounded-full border-2 border-card flex items-center justify-center text-white text-xs" style={{ backgroundColor: user.avatarColor }} title={user.name}>
                    {user.name[0].toUpperCase()}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Metadata */}
          <div className="text-xs text-muted-foreground space-y-1 px-1">
            <p>Created {formatDate(issue.createdAt)}</p>
            <p>Updated {formatRelative(issue.updatedAt)}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground flex items-center gap-1 mb-1">{icon} {label}</p>
      {children}
    </div>
  )
}
