import type { Metadata } from 'next'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { FolderKanban, Shield } from 'lucide-react'
import { cn, SPRINT_STATUS_COLORS } from '@/lib/utils'

export const metadata: Metadata = { title: 'Project Management' }

export default async function AdminProjectsPage() {
  const session = await getSession()
  if (!session) return null
  if (!['SUPER_ADMIN', 'ADMIN'].includes(session.user.role)) redirect('/dashboard')

  const projects = await prisma.project.findMany({
    include: {
      _count: { select: { members: true, issues: true, sprints: true } },
      sprints: { where: { status: 'ACTIVE' }, select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Shield className="w-5 h-5 text-muted-foreground" />
        <h1 className="text-xl font-bold">Project Management</h1>
        <span className="ml-auto text-sm text-muted-foreground">{projects.length} projects</span>
      </div>

      <div className="grid gap-4">
        {projects.map((project) => (
          <div key={project.id} className="bg-card border border-border rounded-xl p-5 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold"
              style={{ backgroundColor: project.avatarColor }}>
              {project.key.slice(0, 2)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <Link href={`/projects/${project.key}`} className="font-semibold hover:text-primary transition-colors">{project.name}</Link>
                <span className="text-xs font-mono text-muted-foreground">{project.key}</span>
                {project.sprints.length > 0 && (
                  <span className={cn('text-xs px-1.5 py-0.5 rounded-full font-medium', SPRINT_STATUS_COLORS['ACTIVE'])}>
                    {project.sprints[0].name}
                  </span>
                )}
              </div>
              {project.description && <p className="text-sm text-muted-foreground truncate">{project.description}</p>}
            </div>
            <div className="flex items-center gap-6 text-sm text-muted-foreground shrink-0">
              <div className="text-center">
                <p className="font-semibold text-foreground">{project._count.members}</p>
                <p className="text-xs">members</p>
              </div>
              <div className="text-center">
                <p className="font-semibold text-foreground">{project._count.issues}</p>
                <p className="text-xs">issues</p>
              </div>
              <div className="text-center">
                <p className="font-semibold text-foreground">{project._count.sprints}</p>
                <p className="text-xs">sprints</p>
              </div>
              <Link href={`/projects/${project.key}/settings`}
                className="px-3 py-1.5 border border-border rounded-lg text-xs hover:bg-muted transition-colors">
                Settings
              </Link>
            </div>
          </div>
        ))}

        {projects.length === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            <FolderKanban className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>No projects yet</p>
            <Link href="/projects/new" className="text-sm text-primary hover:underline mt-2 block">Create first project →</Link>
          </div>
        )}
      </div>
    </div>
  )
}
