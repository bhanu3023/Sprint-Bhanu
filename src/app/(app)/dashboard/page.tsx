import type { Metadata } from 'next'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import { formatRelative, formatDateRange, SPRINT_STATUS_COLORS, ISSUE_TYPE_COLORS, PRIORITY_COLORS } from '@/lib/utils'
import {
  FolderKanban, Zap, CheckCircle2, Clock, TrendingUp, Activity, ChevronRight,
  Users, AlertCircle, BarChart3,
} from 'lucide-react'

export const metadata: Metadata = { title: 'Dashboard' }

export default async function DashboardPage() {
  const session = await getSession()
  if (!session) return null
  const userId = session.user.id
  const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(session.user.role)

  const projectFilter = isAdmin ? { isArchived: false } : {
    isArchived: false,
    OR: [
      { ownerId: userId },
      { members: { some: { userId } } },
    ],
  }

  const [totalProjects, activeSprints, myOpenIssues, myInProgressIssues, projects, recentLogs, myIssues] =
    await Promise.all([
      prisma.project.count({ where: projectFilter }),
      prisma.sprint.count({ where: { status: 'ACTIVE', project: projectFilter } }),
      prisma.issue.count({ where: { assigneeId: userId, status: { category: 'TODO' } } }),
      prisma.issue.count({ where: { assigneeId: userId, status: { category: 'IN_PROGRESS' } } }),
      prisma.project.findMany({
        where: projectFilter,
        include: {
          owner: { select: { id: true, name: true, avatarColor: true } },
          _count: { select: { issues: true, members: true } },
          sprints: { where: { status: 'ACTIVE' }, take: 1, select: { id: true, name: true, endDate: true } },
          members: {
            take: 5,
            include: { user: { select: { id: true, name: true, avatarUrl: true, avatarColor: true } } },
          },
        },
        orderBy: { updatedAt: 'desc' },
        take: 6,
      }),
      prisma.auditLog.findMany({
        where: { OR: [{ project: projectFilter }, { actorId: userId }] },
        include: {
          actor: { select: { id: true, name: true, avatarColor: true } },
          project: { select: { key: true, name: true } },
          issue: { select: { key: true, title: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 12,
      }),
      prisma.issue.findMany({
        where: { assigneeId: userId, status: { category: { not: 'DONE' } } },
        include: {
          status: true,
          project: { select: { key: true, name: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: 8,
      }),
    ])

  const stats = [
    { label: 'Projects', value: totalProjects, icon: FolderKanban, color: 'text-blue-600 bg-blue-50 dark:bg-blue-950' },
    { label: 'Active Sprints', value: activeSprints, icon: Zap, color: 'text-green-600 bg-green-50 dark:bg-green-950' },
    { label: 'My Open Issues', value: myOpenIssues, icon: AlertCircle, color: 'text-orange-600 bg-orange-50 dark:bg-orange-950' },
    { label: 'In Progress', value: myInProgressIssues, icon: TrendingUp, color: 'text-purple-600 bg-purple-50 dark:bg-purple-950' },
  ]

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">
          Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'},{' '}
          {session.user.name.split(' ')[0]} 👋
        </h1>
        <p className="text-muted-foreground mt-1">Here&apos;s what&apos;s happening across your projects.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {stats.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-card border border-border rounded-xl p-4 flex items-center gap-4">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${color}`}>
              <Icon className="w-5 h-5" />
            </div>
            <div>
              <p className="text-2xl font-bold">{value}</p>
              <p className="text-xs text-muted-foreground">{label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Projects */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Projects</h2>
            <Link href="/projects" className="text-sm text-primary hover:underline flex items-center gap-1">
              View all <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {projects.map((project) => (
              <Link
                key={project.id}
                href={`/projects/${project.key}/board`}
                className="bg-card border border-border rounded-xl p-4 hover:shadow-md transition-shadow group"
              >
                <div className="flex items-start gap-3 mb-3">
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center text-white font-bold text-sm shrink-0"
                    style={{ backgroundColor: project.avatarColor }}
                  >
                    {project.key.slice(0, 2)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-sm truncate group-hover:text-primary transition-colors">
                      {project.name}
                    </h3>
                    <span className="text-xs font-mono text-muted-foreground">{project.key}</span>
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{project._count.issues} issues</span>
                  <span>{project._count.members} members</span>
                </div>
                {project.sprints[0] && (
                  <div className="mt-2 pt-2 border-t border-border">
                    <span className="text-xs bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-300 px-2 py-0.5 rounded-full">
                      Sprint active
                    </span>
                  </div>
                )}
                <div className="flex -space-x-1.5 mt-2">
                  {project.members.slice(0, 4).map((m) => (
                    <div
                      key={m.userId}
                      className="w-6 h-6 rounded-full border-2 border-card flex items-center justify-center text-white text-xs font-medium"
                      style={{ backgroundColor: m.user.avatarColor }}
                      title={m.user.name}
                    >
                      {m.user.avatarUrl ? (
                        <img src={m.user.avatarUrl} className="w-full h-full rounded-full object-cover" />
                      ) : (
                        m.user.name[0].toUpperCase()
                      )}
                    </div>
                  ))}
                </div>
              </Link>
            ))}

            {projects.length === 0 && (
              <div className="sm:col-span-2 text-center py-12 text-muted-foreground">
                <FolderKanban className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p className="font-medium">No projects yet</p>
                <Link href="/projects" className="text-sm text-primary hover:underline mt-1 block">
                  Create your first project
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-4">
          {/* My Issues */}
          <div className="bg-card border border-border rounded-xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <Clock className="w-4 h-4 text-orange-500" /> My Issues
              </h2>
              <span className="text-xs text-muted-foreground">{myIssues.length} open</span>
            </div>
            <div className="divide-y divide-border">
              {myIssues.slice(0, 6).map((issue) => (
                <Link
                  key={issue.id}
                  href={`/projects/${issue.project.key}/issues/${issue.key}`}
                  className="flex items-start gap-3 px-4 py-2.5 hover:bg-accent/50 transition-colors"
                >
                  <span
                    className={`text-xs font-semibold px-1.5 py-0.5 rounded mt-0.5 shrink-0 ${ISSUE_TYPE_COLORS[issue.type].bg} ${ISSUE_TYPE_COLORS[issue.type].text}`}
                  >
                    {issue.type[0]}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{issue.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {issue.project.key} · {issue.status.name}
                    </p>
                  </div>
                </Link>
              ))}
              {myIssues.length === 0 && (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-green-500 opacity-60" />
                  All caught up!
                </div>
              )}
            </div>
          </div>

          {/* Recent Activity */}
          <div className="bg-card border border-border rounded-xl">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
              <Activity className="w-4 h-4 text-blue-500" />
              <h2 className="text-sm font-semibold">Recent Activity</h2>
            </div>
            <div className="divide-y divide-border">
              {recentLogs.slice(0, 8).map((log) => (
                <div key={log.id} className="px-4 py-2.5 flex items-start gap-2.5">
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-medium shrink-0 mt-0.5"
                    style={{ backgroundColor: log.actor.avatarColor }}
                  >
                    {log.actor.name[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs">
                      <span className="font-medium">{log.actor.name.split(' ')[0]}</span>{' '}
                      <span className="text-muted-foreground">{log.action}</span>{' '}
                      {log.issue && (
                        <Link
                          href={`/projects/${log.project?.key}/issues/${log.issue.key}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {log.issue.key}
                        </Link>
                      )}
                      {!log.issue && log.project && (
                        <span className="font-medium">{log.entityType.toLowerCase()}</span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">{formatRelative(log.createdAt)}</p>
                  </div>
                </div>
              ))}
              {recentLogs.length === 0 && (
                <div className="px-4 py-6 text-center text-xs text-muted-foreground">No recent activity</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
