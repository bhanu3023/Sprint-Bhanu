'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Settings, Users, LayoutDashboard, GitBranch, Tag, Trash2, Plus, X, Loader2, Save, SlidersHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import toast from 'react-hot-toast'
import { ALL_FILTER_FIELDS } from '@/lib/field-definitions'

type TabId = 'general' | 'members' | 'board' | 'workflow' | 'labels' | 'fields'

interface ProjectSettingsViewProps {
  project: {
    id: string; key: string; name: string; description?: string | null; avatarColor: string
    owner: { id: string; name: string }
    members: Array<{ id: string; userId: string; role: string; user: { id: string; name: string; email: string; avatarUrl?: string | null; avatarColor: string; isActive: boolean } }>
    columns: Array<{ id: string; name: string; order: number; color: string; wipLimit?: number | null; statusId: string; status: { name: string; color: string } }>
    workflowStatuses: Array<{ id: string; name: string; category: string; color: string; order: number; isDefault: boolean }>
    workflowTransitions: Array<{ id: string; fromStatusId: string; toStatusId: string; name: string; fromStatus: { name: string }; toStatus: { name: string } }>
    labels: Array<{ id: string; name: string; color: string }>
    projectFields: Array<{ fieldKey: string; isEnabled: boolean; order: number }>
  }
  allUsers: Array<{ id: string; name: string; email: string; avatarUrl?: string | null; avatarColor: string }>
  isAdmin: boolean
}

const ROLE_OPTIONS = ['OWNER', 'ADMIN', 'SCRUM_MASTER', 'MEMBER', 'VIEWER']

export function ProjectSettingsView({ project: initialProject, allUsers, isAdmin }: ProjectSettingsViewProps) {
  const router = useRouter()
  const [project, setProject] = useState(initialProject)
  const [activeTab, setActiveTab] = useState<TabId>('general')
  const [saving, setSaving] = useState(false)
  const [generalForm, setGeneralForm] = useState({
    name: project.name,
    description: project.description ?? '',
  })

  // Build enabled fields state from stored project fields (default all enabled if none configured)
  const fieldMap = new Map(project.projectFields.map((f) => [f.fieldKey, f]))
  const initialFieldsEnabled = Object.fromEntries(
    ALL_FILTER_FIELDS.map((f) => [f.key, project.projectFields.length === 0 ? true : (fieldMap.get(f.key)?.isEnabled ?? false)])
  )
  const [fieldsEnabled, setFieldsEnabled] = useState<Record<string, boolean>>(initialFieldsEnabled)
  const [savingFields, setSavingFields] = useState(false)

  const tabs = [
    { id: 'general' as TabId, label: 'General', icon: Settings },
    { id: 'members' as TabId, label: 'Members', icon: Users },
    { id: 'board' as TabId, label: 'Board Columns', icon: LayoutDashboard },
    { id: 'workflow' as TabId, label: 'Workflow', icon: GitBranch },
    { id: 'labels' as TabId, label: 'Labels', icon: Tag },
    { id: 'fields' as TabId, label: 'Filter Fields', icon: SlidersHorizontal },
  ]

  const saveFields = async () => {
    setSavingFields(true)
    try {
      const body = ALL_FILTER_FIELDS.map((f, i) => ({ key: f.key, isEnabled: fieldsEnabled[f.key] ?? false, order: i }))
      const res = await fetch(`/api/projects/${project.key}/fields`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) toast.success('Filter fields saved')
      else toast.error('Failed to save fields')
    } finally { setSavingFields(false) }
  }

  const saveGeneral = async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/projects/${project.key}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(generalForm),
      })
      if (res.ok) { toast.success('Settings saved'); router.refresh() }
      else toast.error('Failed to save')
    } finally { setSaving(false) }
  }

  const updateMemberRole = async (userId: string, role: string) => {
    const res = await fetch(`/api/projects/${project.key}/members`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, role }),
    })
    if (res.ok) {
      setProject((prev) => ({
        ...prev,
        members: prev.members.map((m) => m.userId === userId ? { ...m, role } : m),
      }))
      toast.success('Role updated')
    } else toast.error('Failed to update role')
  }

  const removeMember = async (userId: string) => {
    const res = await fetch(`/api/projects/${project.key}/members?userId=${userId}`, { method: 'DELETE' })
    if (res.ok) {
      setProject((prev) => ({ ...prev, members: prev.members.filter((m) => m.userId !== userId) }))
      toast.success('Member removed')
    } else toast.error('Failed to remove member')
  }

  const addMember = async (userId: string) => {
    const res = await fetch(`/api/projects/${project.key}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, role: 'MEMBER' }),
    })
    const json = await res.json()
    if (res.ok) {
      setProject((prev) => ({ ...prev, members: [...prev.members, json.data] }))
      toast.success('Member added')
    } else toast.error(json.error || 'Failed to add member')
  }

  const nonMembers = allUsers.filter((u) => !project.members.some((m) => m.userId === u.id))

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-xl font-bold mb-6">{project.name} · Settings</h1>

      <div className="flex gap-6">
        {/* Sidebar tabs */}
        <nav className="w-48 space-y-0.5 shrink-0">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={cn(
                'flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                activeTab === id ? 'bg-primary text-primary-foreground' : 'hover:bg-accent text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="w-4 h-4 shrink-0" /> {label}
            </button>
          ))}
        </nav>

        {/* Content */}
        <div className="flex-1 bg-card border border-border rounded-xl p-6">
          {/* General Tab */}
          {activeTab === 'general' && (
            <div className="space-y-4">
              <h2 className="text-base font-semibold">General Settings</h2>
              <div>
                <label className="block text-sm font-medium mb-1.5">Project Name</label>
                <input
                  value={generalForm.name}
                  onChange={(e) => setGeneralForm((p) => ({ ...p, name: e.target.value }))}
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">Project Key</label>
                <input
                  value={project.key}
                  disabled
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-muted font-mono opacity-70"
                />
                <p className="text-xs text-muted-foreground mt-1">Project key cannot be changed after creation</p>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">Description</label>
                <textarea
                  value={generalForm.description}
                  onChange={(e) => setGeneralForm((p) => ({ ...p, description: e.target.value }))}
                  rows={3}
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring resize-none"
                />
              </div>
              <button
                onClick={saveGeneral}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save Changes
              </button>
            </div>
          )}

          {/* Members Tab */}
          {activeTab === 'members' && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-semibold">Members ({project.members.length})</h2>
                {nonMembers.length > 0 && (
                  <select
                    onChange={(e) => { if (e.target.value) { addMember(e.target.value); e.target.value = '' } }}
                    className="text-sm border border-border rounded-lg px-2 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="">+ Add member...</option>
                    {nonMembers.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
                  </select>
                )}
              </div>
              <div className="space-y-2">
                {project.members.map((member) => (
                  <div key={member.id} className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-medium shrink-0"
                      style={{ backgroundColor: member.user.avatarColor }}>
                      {member.user.name[0].toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{member.user.name}</p>
                      <p className="text-xs text-muted-foreground">{member.user.email}</p>
                    </div>
                    <select
                      value={member.role}
                      onChange={(e) => updateMemberRole(member.userId, e.target.value)}
                      className="text-xs border border-border rounded px-2 py-1 bg-background focus:outline-none"
                    >
                      {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                    <button
                      onClick={() => removeMember(member.userId)}
                      className="p-1.5 rounded-md hover:bg-destructive hover:text-destructive-foreground transition-colors text-muted-foreground"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Board Columns Tab */}
          {activeTab === 'board' && (
            <div>
              <h2 className="text-base font-semibold mb-4">Board Columns</h2>
              <div className="space-y-2">
                {project.columns.map((col) => (
                  <div key={col.id} className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg">
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: col.status.color }} />
                    <span className="flex-1 text-sm font-medium">{col.name}</span>
                    <span className="text-xs text-muted-foreground">{col.status.name}</span>
                    {col.wipLimit && (
                      <span className="text-xs bg-amber-100 dark:bg-amber-900/40 text-amber-700 px-2 py-0.5 rounded">
                        WIP: {col.wipLimit}
                      </span>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-sm text-muted-foreground mt-3">Column management is tied to workflow statuses. Add or modify statuses in the Workflow tab.</p>
            </div>
          )}

          {/* Workflow Tab */}
          {activeTab === 'workflow' && (
            <div>
              <h2 className="text-base font-semibold mb-1">Workflow Statuses</h2>
              <p className="text-sm text-muted-foreground mb-4">Define the statuses issues can move through</p>
              <div className="space-y-2 mb-6">
                {project.workflowStatuses.map((status) => (
                  <div key={status.id} className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg">
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: status.color }} />
                    <span className="flex-1 text-sm font-medium">{status.name}</span>
                    <span className={cn(
                      'text-xs px-2 py-0.5 rounded font-medium',
                      status.category === 'TODO' ? 'bg-slate-100 dark:bg-slate-800 text-slate-600' :
                      status.category === 'IN_PROGRESS' ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700' :
                      'bg-green-100 dark:bg-green-900/40 text-green-700',
                    )}>
                      {status.category.replace('_', ' ')}
                    </span>
                    {status.isDefault && <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded">Default</span>}
                  </div>
                ))}
              </div>

              <h3 className="text-sm font-semibold mb-3">Transitions</h3>
              <div className="space-y-1.5">
                {project.workflowTransitions.map((t) => (
                  <div key={t.id} className="flex items-center gap-2 text-sm text-muted-foreground p-2 bg-muted/20 rounded">
                    <span className="font-medium text-foreground">{t.fromStatus.name}</span>
                    <span className="text-xs">→</span>
                    <span className="font-medium text-foreground">{t.toStatus.name}</span>
                    <span className="ml-1 text-xs italic">({t.name})</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Labels Tab */}
          {activeTab === 'labels' && (
            <div>
              <h2 className="text-base font-semibold mb-4">Labels</h2>
              <div className="flex flex-wrap gap-2">
                {project.labels.map((label) => (
                  <span
                    key={label.id}
                    className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-full font-medium text-white"
                    style={{ backgroundColor: label.color }}
                  >
                    {label.name}
                  </span>
                ))}
                {project.labels.length === 0 && (
                  <p className="text-sm text-muted-foreground">No labels defined yet.</p>
                )}
              </div>
            </div>
          )}

          {/* Filter Fields Tab */}
          {activeTab === 'fields' && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-base font-semibold">Filter Fields</h2>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    Choose which fields appear in the Issues filter panel for this board.
                  </p>
                </div>
                <button
                  onClick={saveFields}
                  disabled={savingFields}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {savingFields ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Save
                </button>
              </div>
              <div className="border border-border rounded-xl overflow-hidden">
                {ALL_FILTER_FIELDS.map((field, idx) => (
                  <div
                    key={field.key}
                    className={cn('flex items-center justify-between px-4 py-3', idx !== 0 && 'border-t border-border')}
                  >
                    <span className="text-sm font-medium">{field.label}</span>
                    <button
                      onClick={() => setFieldsEnabled((prev) => ({ ...prev, [field.key]: !prev[field.key] }))}
                      className={cn(
                        'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
                        fieldsEnabled[field.key] ? 'bg-primary' : 'bg-muted-foreground/30'
                      )}
                    >
                      <span
                        className={cn(
                          'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform',
                          fieldsEnabled[field.key] ? 'translate-x-4' : 'translate-x-0.5'
                        )}
                      />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
