'use client'

import { useState, useTransition } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'react-hot-toast'
import { cn } from '@/lib/utils'
import {
  Users, UserPlus, Shield, Search, X, ChevronDown, Pencil, Trash2,
  CheckCircle, XCircle, Eye, Briefcase,
} from 'lucide-react'
import Link from 'next/link'

interface Project { id: string; key: string; name: string; avatarColor: string }

interface Membership {
  projectId: string
  role: string
  project: Project
}

interface User {
  id: string
  name: string
  email: string
  role: string
  isActive: boolean
  avatarColor: string
  avatarUrl: string | null
  jobTitle: string | null
  department: string | null
  createdAt: string
  projectMembers: Membership[]
  _count: { assignedIssues: number }
}

interface Props {
  initialUsers: User[]
  allProjects: Project[]
  currentUserId: string
}

const createSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(['SUPER_ADMIN', 'ADMIN', 'MEMBER']).default('MEMBER'),
  jobTitle: z.string().optional(),
  department: z.string().optional(),
})

type CreateForm = z.infer<typeof createSchema>

const GLOBAL_ROLES = ['SUPER_ADMIN', 'ADMIN', 'MEMBER'] as const
const PROJECT_ROLES = ['OWNER', 'ADMIN', 'SCRUM_MASTER', 'MEMBER', 'VIEWER'] as const

function Avatar({ user }: { user: { name: string; avatarColor: string; avatarUrl: string | null } }) {
  return (
    <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-medium shrink-0"
      style={{ backgroundColor: user.avatarColor }}>
      {user.avatarUrl
        ? <img src={user.avatarUrl} className="w-full h-full rounded-full object-cover" alt={user.name} />
        : user.name[0].toUpperCase()}
    </div>
  )
}

function RoleBadge({ role }: { role: string }) {
  return (
    <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium',
      role === 'SUPER_ADMIN' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300' :
      role === 'ADMIN' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300' :
      'bg-muted text-muted-foreground'
    )}>
      {role.replace('_', ' ')}
    </span>
  )
}

export function AdminUsersView({ initialUsers, allProjects, currentUserId }: Props) {
  const [users, setUsers] = useState<User[]>(initialUsers)
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [managingMemberships, setManagingMemberships] = useState<User | null>(null)
  const [isPending, startTransition] = useTransition()

  const filtered = users.filter((u) =>
    u.name.toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase()) ||
    (u.department ?? '').toLowerCase().includes(search.toLowerCase())
  )

  const refreshUsers = async () => {
    const res = await fetch('/api/admin/users')
    if (res.ok) {
      const json = await res.json()
      setUsers(json.data)
    }
  }

  const handleDeactivate = async (userId: string, active: boolean) => {
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !active }),
    })
    if (res.ok) {
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, isActive: !active } : u))
      toast.success(active ? 'User deactivated' : 'User activated')
    } else {
      toast.error('Failed to update user')
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Shield className="w-5 h-5 text-muted-foreground" />
        <h1 className="text-xl font-bold">User Management</h1>
        <span className="ml-2 text-sm text-muted-foreground">{users.length} users</span>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search users..."
              className="pl-8 pr-3 py-1.5 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40 w-48"
            />
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors"
          >
            <UserPlus className="w-4 h-4" />
            Add User
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/30">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">User</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden md:table-cell">Role</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden lg:table-cell">Projects</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden lg:table-cell">Issues</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Joined</th>
              <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map((user) => (
              <tr key={user.id} className="hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3">
                  <Link href={`/users/${user.id}`} className="flex items-center gap-3 group">
                    <Avatar user={user} />
                    <div>
                      <p className="font-medium group-hover:text-primary transition-colors">{user.name}</p>
                      <p className="text-xs text-muted-foreground">{user.email}</p>
                      {user.jobTitle && <p className="text-xs text-muted-foreground">{user.jobTitle}</p>}
                    </div>
                  </Link>
                </td>
                <td className="px-4 py-3 hidden md:table-cell">
                  <RoleBadge role={user.role} />
                </td>
                <td className="px-4 py-3 text-muted-foreground hidden lg:table-cell">
                  {user.projectMembers.length}
                </td>
                <td className="px-4 py-3 text-muted-foreground hidden lg:table-cell">
                  {user._count.assignedIssues}
                </td>
                <td className="px-4 py-3">
                  <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium',
                    user.isActive
                      ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                      : 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300'
                  )}>
                    {user.isActive ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {new Date(user.createdAt).toLocaleDateString()}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      onClick={() => setEditingUser(user)}
                      title="Edit role"
                      className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setManagingMemberships(user)}
                      title="Manage project memberships"
                      className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                    >
                      <Briefcase className="w-3.5 h-3.5" />
                    </button>
                    {user.id !== currentUserId && (
                      <button
                        onClick={() => handleDeactivate(user.id, user.isActive)}
                        title={user.isActive ? 'Deactivate' : 'Activate'}
                        className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                      >
                        {user.isActive
                          ? <XCircle className="w-3.5 h-3.5 text-red-500" />
                          : <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                        }
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Create User Modal */}
      {showCreate && (
        <CreateUserModal
          onClose={() => setShowCreate(false)}
          onCreated={async (newUser) => {
            await refreshUsers()
            setShowCreate(false)
          }}
        />
      )}

      {/* Edit Role Modal */}
      {editingUser && (
        <EditRoleModal
          user={editingUser}
          onClose={() => setEditingUser(null)}
          onUpdated={(updated) => {
            setUsers((prev) => prev.map((u) => u.id === updated.id ? { ...u, ...updated } : u))
            setEditingUser(null)
          }}
        />
      )}

      {/* Membership Management Modal */}
      {managingMemberships && (
        <MembershipModal
          user={managingMemberships}
          allProjects={allProjects}
          onClose={() => setManagingMemberships(null)}
          onUpdated={async () => {
            await refreshUsers()
            setManagingMemberships(null)
          }}
        />
      )}
    </div>
  )
}

// ─── Create User Modal ────────────────────────────────────────────────────────

function CreateUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: (u: User) => void }) {
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: { role: 'MEMBER' },
  })

  const onSubmit = async (data: CreateForm) => {
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (res.ok) {
      const json = await res.json()
      toast.success('User created successfully')
      onCreated(json.data)
    } else {
      const json = await res.json()
      toast.error(json.error ?? 'Failed to create user')
    }
  }

  return (
    <Modal title="Add New User" onClose={onClose}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium mb-1">Full Name *</label>
            <input {...register('name')} className="input-field" placeholder="Jane Doe" />
            {errors.name && <p className="text-xs text-red-500 mt-0.5">{errors.name.message}</p>}
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Email *</label>
            <input {...register('email')} type="email" className="input-field" placeholder="jane@example.com" />
            {errors.email && <p className="text-xs text-red-500 mt-0.5">{errors.email.message}</p>}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium mb-1">Password * (min 8 chars)</label>
          <input {...register('password')} type="password" className="input-field" />
          {errors.password && <p className="text-xs text-red-500 mt-0.5">{errors.password.message}</p>}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium mb-1">Job Title</label>
            <input {...register('jobTitle')} className="input-field" placeholder="Software Engineer" />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Department</label>
            <input {...register('department')} className="input-field" placeholder="Engineering" />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium mb-1">Global Role</label>
          <select {...register('role')} className="input-field">
            {GLOBAL_ROLES.map((r) => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}
          </select>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-muted transition-colors">
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {isSubmitting ? 'Creating…' : 'Create User'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ─── Edit Role Modal ──────────────────────────────────────────────────────────

function EditRoleModal({ user, onClose, onUpdated }: { user: User; onClose: () => void; onUpdated: (u: Partial<User>) => void }) {
  const [role, setRole] = useState(user.role)
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    const res = await fetch(`/api/admin/users/${user.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    })
    setSaving(false)
    if (res.ok) {
      const json = await res.json()
      toast.success('Role updated')
      onUpdated(json.data)
    } else {
      toast.error('Failed to update role')
    }
  }

  return (
    <Modal title={`Edit Role – ${user.name}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg">
          <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-medium shrink-0"
            style={{ backgroundColor: user.avatarColor }}>
            {user.name[0].toUpperCase()}
          </div>
          <div>
            <p className="font-medium">{user.name}</p>
            <p className="text-xs text-muted-foreground">{user.email}</p>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium mb-2">Global Role</label>
          <div className="space-y-2">
            {GLOBAL_ROLES.map((r) => (
              <label key={r} className={cn(
                'flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
                role === r ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/30'
              )}>
                <input type="radio" value={r} checked={role === r} onChange={() => setRole(r)} className="sr-only" />
                <div className={cn('w-4 h-4 rounded-full border-2 flex items-center justify-center',
                  role === r ? 'border-primary' : 'border-muted-foreground/30'
                )}>
                  {role === r && <div className="w-2 h-2 rounded-full bg-primary" />}
                </div>
                <div>
                  <p className="text-sm font-medium">{r.replace('_', ' ')}</p>
                  <p className="text-xs text-muted-foreground">
                    {r === 'SUPER_ADMIN' ? 'Full system access, can manage everything' :
                     r === 'ADMIN' ? 'Can manage users and all projects' :
                     'Regular user with project-based permissions'}
                  </p>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-muted transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || role === user.role}
            className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : 'Save Role'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Membership Management Modal ──────────────────────────────────────────────

function MembershipModal({ user, allProjects, onClose, onUpdated }: {
  user: User
  allProjects: Project[]
  onClose: () => void
  onUpdated: () => void
}) {
  const currentMemberships = Object.fromEntries(
    user.projectMembers.map((m) => [m.projectId, m.role])
  )
  const [memberships, setMemberships] = useState<Record<string, string>>(currentMemberships)
  const [saving, setSaving] = useState(false)

  const handleToggle = (projectId: string) => {
    setMemberships((prev) => {
      if (prev[projectId]) {
        const { [projectId]: _, ...rest } = prev
        return rest
      }
      return { ...prev, [projectId]: 'MEMBER' }
    })
  }

  const handleRoleChange = (projectId: string, role: string) => {
    setMemberships((prev) => ({ ...prev, [projectId]: role }))
  }

  const handleSave = async () => {
    setSaving(true)
    const changes: { projectId: string; role: string; action: 'add' | 'update' | 'remove' }[] = []

    for (const p of allProjects) {
      const current = currentMemberships[p.id]
      const next = memberships[p.id]
      if (!current && next) changes.push({ projectId: p.id, role: next, action: 'add' })
      else if (current && !next) changes.push({ projectId: p.id, role: current, action: 'remove' })
      else if (current && next && current !== next) changes.push({ projectId: p.id, role: next, action: 'update' })
    }

    if (changes.length === 0) {
      setSaving(false)
      onClose()
      return
    }

    const res = await fetch(`/api/admin/users/${user.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberships: changes }),
    })

    setSaving(false)
    if (res.ok) {
      toast.success('Memberships updated')
      onUpdated()
    } else {
      toast.error('Failed to update memberships')
    }
  }

  return (
    <Modal title={`Project Memberships – ${user.name}`} onClose={onClose} wide>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Toggle projects and set roles. Changes apply on save.</p>

        <div className="space-y-2 max-h-80 overflow-y-auto">
          {allProjects.map((project) => {
            const isMember = !!memberships[project.id]
            return (
              <div key={project.id} className={cn(
                'flex items-center gap-3 p-3 rounded-lg border transition-colors',
                isMember ? 'border-primary/40 bg-primary/5' : 'border-border hover:bg-muted/30'
              )}>
                <input
                  type="checkbox"
                  checked={isMember}
                  onChange={() => handleToggle(project.id)}
                  className="w-4 h-4 accent-primary"
                />
                <div className="w-6 h-6 rounded text-white text-xs flex items-center justify-center font-bold shrink-0"
                  style={{ backgroundColor: project.avatarColor }}>
                  {project.key[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{project.name}</p>
                  <p className="text-xs text-muted-foreground">{project.key}</p>
                </div>
                {isMember && (
                  <select
                    value={memberships[project.id]}
                    onChange={(e) => handleRoleChange(project.id, e.target.value)}
                    className="text-xs px-2 py-1 bg-background border border-border rounded focus:outline-none"
                  >
                    {PROJECT_ROLES.map((r) => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}
                  </select>
                )}
              </div>
            )
          })}
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-muted transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : 'Save Memberships'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Generic Modal ────────────────────────────────────────────────────────────

function Modal({ title, children, onClose, wide }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className={cn('bg-card border border-border rounded-2xl shadow-2xl w-full', wide ? 'max-w-2xl' : 'max-w-md')}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-6 py-4">{children}</div>
      </div>
    </div>
  )
}
