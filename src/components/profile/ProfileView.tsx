'use client'

import { useState } from 'react'
import Link from 'next/link'
import { User, Mail, Globe, Edit2, Check, X, FolderKanban } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn, PRIORITY_COLORS } from '@/lib/utils'

interface UserData {
  id: string; name: string; email: string; role: string; avatarColor: string
  avatarUrl?: string | null; bio?: string | null; timezone?: string | null; isActive: boolean
  projectMembers: Array<{
    role: string
    project: { id: string; key: string; name: string; avatarColor: string }
  }>
  assignedIssues: Array<{
    id: string; key: string; title: string; priority: string
    status: { id: string; name: string; color: string; category: string }
    project: { key: string; name: string }
  }>
}

export function ProfileView({ user, currentUserId }: { user: UserData; currentUserId: string }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(user.name)
  const [bio, setBio] = useState(user.bio ?? '')
  const [timezone, setTimezone] = useState(user.timezone ?? '')
  const [saving, setSaving] = useState(false)

  const isOwn = user.id === currentUserId

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, bio, timezone }),
      })
      if (!res.ok) throw new Error()
      toast.success('Profile updated')
      setEditing(false)
    } catch {
      toast.error('Failed to update profile')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="bg-card border border-border rounded-xl p-6 mb-6">
        <div className="flex items-start gap-5">
          <div className="w-20 h-20 rounded-full flex items-center justify-center text-white text-3xl font-bold shrink-0"
            style={{ backgroundColor: user.avatarColor }}>
            {user.avatarUrl ? (
              <img src={user.avatarUrl} className="w-full h-full rounded-full object-cover" alt={user.name} />
            ) : user.name[0].toUpperCase()}
          </div>
          <div className="flex-1">
            {editing ? (
              <div className="space-y-3">
                <input value={name} onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-1.5 border border-border rounded-lg bg-background text-lg font-bold focus:outline-none focus:ring-1 focus:ring-ring" />
                <textarea value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Bio (optional)" rows={2}
                  className="w-full px-3 py-1.5 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-1 focus:ring-ring resize-none" />
                <input value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="Timezone (e.g. UTC, America/New_York)"
                  className="w-full px-3 py-1.5 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
                <div className="flex gap-2">
                  <button onClick={handleSave} disabled={saving}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50">
                    <Check className="w-3.5 h-3.5" /> Save
                  </button>
                  <button onClick={() => { setEditing(false); setName(user.name); setBio(user.bio ?? ''); setTimezone(user.timezone ?? '') }}
                    className="flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-lg text-sm hover:bg-muted">
                    <X className="w-3.5 h-3.5" /> Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3 mb-1">
                  <h1 className="text-2xl font-bold">{user.name}</h1>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">{user.role}</span>
                  {isOwn && (
                    <button onClick={() => setEditing(true)}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                      <Edit2 className="w-3.5 h-3.5" /> Edit
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-1.5 text-muted-foreground text-sm">
                  <Mail className="w-3.5 h-3.5" /> {user.email}
                </div>
                {user.bio && <p className="text-sm mt-2">{user.bio}</p>}
                {user.timezone && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1">
                    <Globe className="w-3.5 h-3.5" /> {user.timezone}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Projects */}
        <div>
          <div className="bg-card border border-border rounded-xl">
            <div className="px-4 py-3 border-b border-border">
              <h2 className="font-semibold text-sm flex items-center gap-2">
                <FolderKanban className="w-4 h-4" /> Projects
              </h2>
            </div>
            <div className="divide-y divide-border">
              {user.projectMembers.map(({ project, role }) => (
                <Link key={project.id} href={`/projects/${project.key}/board`}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50 transition-colors">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-bold"
                    style={{ backgroundColor: project.avatarColor }}>
                    {project.key.slice(0, 2)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{project.name}</p>
                    <p className="text-xs text-muted-foreground">{role}</p>
                  </div>
                </Link>
              ))}
              {user.projectMembers.length === 0 && (
                <p className="text-sm text-muted-foreground px-4 py-3">No projects</p>
              )}
            </div>
          </div>
        </div>

        {/* Assigned Issues */}
        <div className="md:col-span-2">
          <div className="bg-card border border-border rounded-xl">
            <div className="px-4 py-3 border-b border-border">
              <h2 className="font-semibold text-sm">My Open Issues ({user.assignedIssues.length})</h2>
            </div>
            <div className="divide-y divide-border">
              {user.assignedIssues.map((issue) => (
                <Link key={issue.id} href={`/projects/${issue.project.key}/issues/${issue.key}`}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50 transition-colors group">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">{issue.title}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs font-mono text-muted-foreground">{issue.key}</span>
                      <span className="text-xs text-muted-foreground">{issue.project.name}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={cn('text-xs font-medium', PRIORITY_COLORS[issue.priority as keyof typeof PRIORITY_COLORS]?.text)}>
                      {issue.priority}
                    </span>
                    <span className="text-xs px-1.5 py-0.5 rounded-full text-white" style={{ backgroundColor: issue.status.color }}>
                      {issue.status.name}
                    </span>
                  </div>
                </Link>
              ))}
              {user.assignedIssues.length === 0 && (
                <p className="text-sm text-muted-foreground px-4 py-3">No open issues assigned to you</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
