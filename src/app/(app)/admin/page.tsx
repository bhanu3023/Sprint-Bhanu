import type { Metadata } from 'next'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Shield, Users, FolderKanban, Activity, Settings } from 'lucide-react'

export const metadata: Metadata = { title: 'Admin Panel' }

export default async function AdminPage() {
  const session = await getSession()
  if (!session) return null

  const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(session.user.role)
  if (!isAdmin) redirect('/dashboard')

  const [totalUsers, totalProjects, totalIssues, recentLogs] = await Promise.all([
    prisma.user.count(),
    prisma.project.count(),
    prisma.issue.count(),
    prisma.auditLog.findMany({
      include: {
        actor: { select: { id: true, name: true, avatarColor: true } },
        project: { select: { key: true, name: true } },
        issue: { select: { key: true, title: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
  ])

  const activeUsers = await prisma.user.count({ where: { isActive: true } })
  const activeSprints = await prisma.sprint.count({ where: { status: 'ACTIVE' } })

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-purple-600 rounded-xl flex items-center justify-center">
          <Shield className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Admin Panel</h1>
          <p className="text-muted-foreground text-sm">System-wide administration</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Total Users', value: totalUsers, sub: `${activeUsers} active`, color: 'text-blue-600 bg-blue-50 dark:bg-blue-950', icon: Users },
          { label: 'Total Projects', value: totalProjects, sub: `${activeSprints} active sprints`, color: 'text-green-600 bg-green-50 dark:bg-green-950', icon: FolderKanban },
          { label: 'Total Issues', value: totalIssues, sub: 'across all projects', color: 'text-orange-600 bg-orange-50 dark:bg-orange-950', icon: Activity },
          { label: 'Active Sprints', value: activeSprints, sub: 'currently running', color: 'text-purple-600 bg-purple-50 dark:bg-purple-950', icon: Settings },
        ].map(({ label, value, sub, color, icon: Icon }) => (
          <div key={label} className="bg-card border border-border rounded-xl p-4">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-3 ${color}`}>
              <Icon className="w-5 h-5" />
            </div>
            <p className="text-2xl font-bold">{value}</p>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="text-xs text-muted-foreground mt-0.5 opacity-70">{sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <Link href="/users" className="bg-card border border-border rounded-xl p-5 hover:shadow-md transition-all group">
          <Users className="w-8 h-8 text-blue-500 mb-3" />
          <h3 className="font-semibold group-hover:text-primary transition-colors">User Management</h3>
          <p className="text-sm text-muted-foreground mt-1">Manage users, roles, and permissions</p>
        </Link>
        <Link href="/projects" className="bg-card border border-border rounded-xl p-5 hover:shadow-md transition-all group">
          <FolderKanban className="w-8 h-8 text-green-500 mb-3" />
          <h3 className="font-semibold group-hover:text-primary transition-colors">Project Management</h3>
          <p className="text-sm text-muted-foreground mt-1">View and manage all projects</p>
        </Link>
        <div className="bg-card border border-border rounded-xl p-5">
          <Activity className="w-8 h-8 text-purple-500 mb-3" />
          <h3 className="font-semibold">Audit Logs</h3>
          <p className="text-sm text-muted-foreground mt-1">System-wide activity log below</p>
        </div>
      </div>

      {/* Audit Logs */}
      <div className="bg-card border border-border rounded-xl">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="font-semibold flex items-center gap-2">
            <Activity className="w-4 h-4" /> Recent System Activity
          </h2>
        </div>
        <div className="divide-y divide-border">
          {recentLogs.map((log) => (
            <div key={log.id} className="flex items-start gap-3 px-5 py-3">
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs shrink-0 mt-0.5" style={{ backgroundColor: log.actor.avatarColor }}>
                {log.actor.name[0].toUpperCase()}
              </div>
              <div className="flex-1 text-sm">
                <span className="font-medium">{log.actor.name}</span>{' '}
                <span className="text-muted-foreground">{log.action}</span>{' '}
                <span className="font-medium text-muted-foreground">{log.entityType}</span>
                {log.issue && <Link href={`/projects/${log.project?.key}/issues/${log.issue.key}`} className="text-primary hover:underline ml-1">{log.issue.key}</Link>}
                {log.project && !log.issue && <span className="text-muted-foreground ml-1">in {log.project.name}</span>}
              </div>
              <span className="text-xs text-muted-foreground shrink-0">
                {new Date(log.createdAt).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
