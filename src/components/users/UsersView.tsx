'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Search, Users, Shield, User, CheckCircle, XCircle, FolderKanban } from 'lucide-react'
import { cn, ROLE_LABELS, formatDate } from '@/lib/utils'
import toast from 'react-hot-toast'

interface UserRecord {
  id: string; name: string; email: string; avatarUrl?: string | null; avatarColor: string
  role: string; isActive: boolean; jobTitle?: string | null; department?: string | null
  createdAt: Date
  _count: { assignedIssues: number; projectMembers: number }
}

export function UsersView({ users: initial, currentUserId, isAdmin }: {
  users: UserRecord[]
  currentUserId: string
  isAdmin: boolean
}) {
  const [users, setUsers] = useState(initial)
  const [search, setSearch] = useState('')
  const [filterRole, setFilterRole] = useState('')
  const [filterStatus, setFilterStatus] = useState('')

  const filtered = users.filter((u) => {
    const matchSearch = !search || u.name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase())
    const matchRole = !filterRole || u.role === filterRole
    const matchStatus = !filterStatus || (filterStatus === 'active' ? u.isActive : !u.isActive)
    return matchSearch && matchRole && matchStatus
  })

  const toggleActive = async (userId: string, isActive: boolean) => {
    const res = await fetch(`/api/users/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !isActive }),
    })
    if (res.ok) {
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, isActive: !isActive } : u))
      toast.success(isActive ? 'User deactivated' : 'User activated')
    } else {
      toast.error('Failed to update user')
    }
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">People</h1>
          <p className="text-muted-foreground text-sm mt-0.5">{users.length} team members</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search people..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 pr-4 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-ring w-64"
          />
        </div>
        <select
          value={filterRole}
          onChange={(e) => setFilterRole(e.target.value)}
          className="px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">All roles</option>
          {['SUPER_ADMIN', 'ADMIN', 'MEMBER'].map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">All status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {/* Users Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full">
          <thead className="border-b border-border bg-muted/30">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">User</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden md:table-cell">Role</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden lg:table-cell">Department</th>
              <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden lg:table-cell">Issues</th>
              <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden lg:table-cell">Projects</th>
              <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
              {isAdmin && <th className="px-4 py-3" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map((user) => (
              <tr key={user.id} className="hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3">
                  <Link href={`/users/${user.id}`} className="flex items-center gap-3 hover:text-primary transition-colors">
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-semibold shrink-0"
                      style={{ backgroundColor: user.avatarColor }}
                    >
                      {user.avatarUrl ? (
                        <img src={user.avatarUrl} className="w-full h-full rounded-full object-cover" alt={user.name} />
                      ) : (
                        user.name[0].toUpperCase()
                      )}
                    </div>
                    <div>
                      <p className="text-sm font-medium flex items-center gap-1.5">
                        {user.name}
                        {user.id === currentUserId && <span className="text-xs text-muted-foreground">(you)</span>}
                      </p>
                      <p className="text-xs text-muted-foreground">{user.email}</p>
                    </div>
                  </Link>
                </td>
                <td className="px-4 py-3 hidden md:table-cell">
                  <span className={cn(
                    'inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full font-medium',
                    user.role === 'SUPER_ADMIN' ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300' :
                    user.role === 'ADMIN' ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300' :
                    'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300',
                  )}>
                    {['SUPER_ADMIN', 'ADMIN'].includes(user.role) && <Shield className="w-3 h-3" />}
                    {ROLE_LABELS[user.role] ?? user.role}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-muted-foreground hidden lg:table-cell">
                  {user.department ? (
                    <div>
                      <p>{user.jobTitle}</p>
                      <p className="text-xs opacity-70">{user.department}</p>
                    </div>
                  ) : user.jobTitle ?? '—'}
                </td>
                <td className="px-4 py-3 text-center hidden lg:table-cell">
                  <span className="text-sm font-medium">{user._count.assignedIssues}</span>
                </td>
                <td className="px-4 py-3 text-center hidden lg:table-cell">
                  <span className="text-sm font-medium">{user._count.projectMembers}</span>
                </td>
                <td className="px-4 py-3 text-center">
                  {user.isActive ? (
                    <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400 font-medium">
                      <CheckCircle className="w-3.5 h-3.5" /> Active
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground font-medium">
                      <XCircle className="w-3.5 h-3.5" /> Inactive
                    </span>
                  )}
                </td>
                {isAdmin && (
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => toggleActive(user.id, user.isActive)}
                      className="text-xs px-2.5 py-1.5 border border-border rounded-md hover:bg-accent transition-colors"
                    >
                      {user.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>

        {filtered.length === 0 && (
          <div className="text-center py-16">
            <Users className="w-12 h-12 mx-auto mb-3 text-muted-foreground/30" />
            <p className="text-muted-foreground">No users found</p>
          </div>
        )}
      </div>
    </div>
  )
}
