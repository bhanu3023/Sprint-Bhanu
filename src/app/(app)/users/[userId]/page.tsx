import type { Metadata } from 'next'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { FolderKanban, CheckSquare, Clock } from 'lucide-react'
import { cn, PRIORITY_COLORS, formatDateShort } from '@/lib/utils'

export const metadata: Metadata = { title: 'User Profile' }

export default async function UserProfilePage({ params }: { params: { userId: string } }) {
  const session = await getSession()
  if (!session) return null

  const user = await prisma.user.findUnique({
    where: { id: params.userId },
    include: {
      projectMembers: {
        include: { project: { select: { id: true, key: true, name: true, avatarColor: true } } },
      },
      assignedIssues: {
        include: {
          status: true,
          project: { select: { key: true, name: true } },
          sprint: { select: { name: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: 20,
      },
    },
  })
  if (!user) notFound()

  const openIssues = user.assignedIssues.filter((i) => i.status.category !== 'DONE')
  const doneIssues = user.assignedIssues.filter((i) => i.status.category === 'DONE')

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="bg-card border border-border rounded-xl p-6 mb-6 flex items-start gap-5">
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center text-white text-3xl font-bold shrink-0"
          style={{ backgroundColor: user.avatarColor }}
        >
          {user.avatarUrl ? (
            <img src={user.avatarUrl} className="w-full h-full rounded-full object-cover" alt={user.name} />
          ) : (
            user.name[0].toUpperCase()
          )}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold">{user.name}</h1>
            <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium',
              user.isActive ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' : 'bg-red-100 text-red-700'
            )}>
              {user.isActive ? 'Active' : 'Inactive'}
            </span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">{user.role}</span>
          </div>
          <p className="text-muted-foreground">{user.email}</p>
          {user.bio && <p className="text-sm mt-2">{user.bio}</p>}
          {user.timezone && <p className="text-xs text-muted-foreground mt-1">Timezone: {user.timezone}</p>}
          <p className="text-xs text-muted-foreground mt-1">
            Member since {new Date(user.createdAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
          </p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold">{openIssues.length}</p>
          <p className="text-xs text-muted-foreground">open issues</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Projects */}
        <div className="md:col-span-1">
          <div className="bg-card border border-border rounded-xl">
            <div className="px-4 py-3 border-b border-border flex items-center gap-2">
              <FolderKanban className="w-4 h-4 text-muted-foreground" />
              <h2 className="font-semibold text-sm">Projects ({user.projectMembers.length})</h2>
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
            <div className="px-4 py-3 border-b border-border flex items-center gap-2">
              <CheckSquare className="w-4 h-4 text-muted-foreground" />
              <h2 className="font-semibold text-sm">Assigned Issues</h2>
              <span className="ml-auto text-xs text-muted-foreground">{openIssues.length} open · {doneIssues.length} done</span>
            </div>
            <div className="divide-y divide-border">
              {user.assignedIssues.slice(0, 15).map((issue) => (
                <Link key={issue.id} href={`/projects/${issue.project.key}/issues/${issue.key}`}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50 transition-colors group">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">{issue.title}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs font-mono text-muted-foreground">{issue.key}</span>
                      <span className="text-xs text-muted-foreground">{issue.project.name}</span>
                      {issue.sprint && <span className="text-xs text-muted-foreground">{issue.sprint.name}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={cn('text-xs font-medium', PRIORITY_COLORS[issue.priority as keyof typeof PRIORITY_COLORS]?.text)}>
                      {issue.priority}
                    </span>
                    <span className="text-xs px-1.5 py-0.5 rounded-full text-white" style={{ backgroundColor: issue.status.color }}>
                      {issue.status.name}
                    </span>
                    {issue.dueDate && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" /> {formatDateShort(issue.dueDate)}
                      </span>
                    )}
                  </div>
                </Link>
              ))}
              {user.assignedIssues.length === 0 && (
                <p className="text-sm text-muted-foreground px-4 py-3">No assigned issues</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
