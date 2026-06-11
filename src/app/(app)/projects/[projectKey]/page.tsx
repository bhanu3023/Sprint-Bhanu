import type { Metadata } from 'next'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { cn, SPRINT_STATUS_COLORS, PRIORITY_COLORS, formatDateShort } from '@/lib/utils'
import { Zap, Users, CheckSquare, BarChart3, Settings } from 'lucide-react'

export const metadata: Metadata = { title: 'Project Overview' }

export default async function ProjectOverviewPage({ params }: { params: { projectKey: string } }) {
  const session = await getSession()
  if (!session) return null

  const project = await prisma.project.findUnique({
    where: { key: params.projectKey },
    include: {
      members: { include: { user: { select: { id: true, name: true, avatarUrl: true, avatarColor: true } } } },
      sprints: { where: { status: { not: 'COMPLETED' } }, orderBy: { order: 'asc' } },
    },
  })
  if (!project) notFound()

  const activeSprint = project.sprints.find((s) => s.status === 'ACTIVE')

  const [totalIssues, openIssues, recentIssues, issuesByPriority] = await Promise.all([
    prisma.issue.count({ where: { projectId: project.id, parentId: null } }),
    prisma.issue.count({ where: { projectId: project.id, parentId: null, status: { category: { not: 'DONE' } } } }),
    prisma.issue.findMany({
      where: { projectId: project.id, parentId: null },
      include: { status: true, assignee: { select: { name: true, avatarColor: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 8,
    }),
    prisma.issue.groupBy({
      by: ['priority'],
      where: { projectId: project.id, parentId: null, status: { category: { not: 'DONE' } } },
      _count: { id: true },
    }),
  ])

  const priorityMap = Object.fromEntries(issuesByPriority.map((r) => [r.priority, r._count.id]))

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-xl flex items-center justify-center text-white text-xl font-bold"
            style={{ backgroundColor: project.avatarColor }}>
            {project.key.slice(0, 2)}
          </div>
          <div>
            <h1 className="text-2xl font-bold">{project.name}</h1>
            <p className="text-muted-foreground text-sm">{project.key}</p>
            {project.description && <p className="text-sm text-muted-foreground mt-0.5">{project.description}</p>}
          </div>
        </div>
        <Link href={`/projects/${project.key}/settings`} className="flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-lg text-sm hover:bg-muted transition-colors">
          <Settings className="w-4 h-4" /> Settings
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Total Issues', value: totalIssues, href: `/projects/${project.key}/issues` },
          { label: 'Open Issues', value: openIssues, href: `/projects/${project.key}/issues` },
          { label: 'Members', value: project.members.length, href: `/projects/${project.key}/settings` },
          { label: 'Sprints', value: project.sprints.length, href: `/projects/${project.key}/sprints` },
        ].map(({ label, value, href }) => (
          <Link key={label} href={href} className="bg-card border border-border rounded-xl p-4 hover:shadow-md transition-all">
            <p className="text-2xl font-bold">{value}</p>
            <p className="text-sm text-muted-foreground">{label}</p>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Active Sprint */}
        <div className="md:col-span-2 space-y-5">
          {activeSprint ? (
            <div className="bg-card border border-border rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-yellow-500" />
                  <h2 className="font-semibold">Active Sprint</h2>
                  <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', SPRINT_STATUS_COLORS['ACTIVE'])}>ACTIVE</span>
                </div>
                <Link href={`/projects/${project.key}/board`} className="text-sm text-primary hover:underline">View Board →</Link>
              </div>
              <p className="font-medium">{activeSprint.name}</p>
              {activeSprint.goal && <p className="text-sm text-muted-foreground mt-1">{activeSprint.goal}</p>}
              {activeSprint.endDate && (
                <p className="text-xs text-muted-foreground mt-1">Ends {formatDateShort(activeSprint.endDate)}</p>
              )}
            </div>
          ) : (
            <div className="bg-card border border-border rounded-xl p-5 text-center text-muted-foreground">
              <Zap className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="font-medium">No active sprint</p>
              <Link href={`/projects/${project.key}/backlog`} className="text-sm text-primary hover:underline mt-1 block">
                Start a sprint from Backlog →
              </Link>
            </div>
          )}

          {/* Recent Issues */}
          <div className="bg-card border border-border rounded-xl">
            <div className="px-5 py-3 border-b border-border flex items-center justify-between">
              <h2 className="font-semibold flex items-center gap-2"><CheckSquare className="w-4 h-4" /> Recent Issues</h2>
              <Link href={`/projects/${project.key}/issues`} className="text-xs text-primary hover:underline">View all →</Link>
            </div>
            <div className="divide-y divide-border">
              {recentIssues.map((issue) => (
                <Link key={issue.id} href={`/projects/${project.key}/issues/${issue.key}`}
                  className="flex items-center gap-3 px-5 py-2.5 hover:bg-muted/50 transition-colors group">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">{issue.title}</p>
                    <span className="text-xs font-mono text-muted-foreground">{issue.key}</span>
                  </div>
                  <span className="text-xs px-1.5 py-0.5 rounded-full text-white shrink-0" style={{ backgroundColor: issue.status.color }}>
                    {issue.status.name}
                  </span>
                  {issue.assignee && (
                    <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-medium shrink-0"
                      style={{ backgroundColor: issue.assignee.avatarColor }}>
                      {issue.assignee.name[0].toUpperCase()}
                    </div>
                  )}
                </Link>
              ))}
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-5">
          {/* Members */}
          <div className="bg-card border border-border rounded-xl p-4">
            <h2 className="font-semibold text-sm flex items-center gap-2 mb-3">
              <Users className="w-4 h-4" /> Team ({project.members.length})
            </h2>
            <div className="space-y-2">
              {project.members.slice(0, 8).map(({ user, role }) => (
                <Link key={user.id} href={`/users/${user.id}`} className="flex items-center gap-2.5 hover:opacity-80 transition-opacity">
                  <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-medium"
                    style={{ backgroundColor: user.avatarColor }}>
                    {user.avatarUrl ? <img src={user.avatarUrl} className="w-full h-full rounded-full object-cover" /> : user.name[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{user.name}</p>
                    <p className="text-xs text-muted-foreground">{role}</p>
                  </div>
                </Link>
              ))}
            </div>
          </div>

          {/* Priority breakdown */}
          <div className="bg-card border border-border rounded-xl p-4">
            <h2 className="font-semibold text-sm flex items-center gap-2 mb-3">
              <BarChart3 className="w-4 h-4" /> Open by Priority
            </h2>
            <div className="space-y-2">
              {['HIGHEST', 'HIGH', 'MEDIUM', 'LOW', 'LOWEST'].map((p) => (
                <div key={p} className="flex items-center justify-between">
                  <span className={cn('text-xs font-medium', PRIORITY_COLORS[p as keyof typeof PRIORITY_COLORS]?.text)}>{p}</span>
                  <span className="text-xs font-mono text-muted-foreground">{priorityMap[p] ?? 0}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Quick links */}
          <div className="bg-card border border-border rounded-xl p-4">
            <h2 className="font-semibold text-sm mb-3">Quick Links</h2>
            <div className="space-y-1.5">
              {[
                { label: 'Board', href: `/projects/${project.key}/board` },
                { label: 'Backlog', href: `/projects/${project.key}/backlog` },
                { label: 'Sprints', href: `/projects/${project.key}/sprints` },
                { label: 'Issues', href: `/projects/${project.key}/issues` },
                { label: 'Reports', href: `/projects/${project.key}/reports` },
                { label: 'Activity', href: `/projects/${project.key}/activity` },
              ].map(({ label, href }) => (
                <Link key={label} href={href} className="block text-sm text-primary hover:underline">{label} →</Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
