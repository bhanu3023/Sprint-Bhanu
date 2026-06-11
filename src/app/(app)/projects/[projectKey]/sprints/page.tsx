import type { Metadata } from 'next'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { formatDateRange, SPRINT_STATUS_COLORS } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { Zap, CheckCircle2, Clock, BarChart3 } from 'lucide-react'

export const metadata: Metadata = { title: 'Sprints' }

export default async function SprintsPage({ params }: { params: { projectKey: string } }) {
  const session = await getSession()
  if (!session) return null

  const project = await prisma.project.findUnique({ where: { key: params.projectKey } })
  if (!project) notFound()

  const sprints = await prisma.sprint.findMany({
    where: { projectId: project.id },
    include: {
      _count: { select: { issues: true } },
      issues: {
        select: { id: true, storyPoints: true, status: { select: { category: true } } },
      },
    },
    orderBy: { order: 'desc' },
  })

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">{project.name} · Sprints</h1>
        <Link href={`/projects/${project.key}/backlog`} className="text-sm text-primary hover:underline">
          Manage in Backlog →
        </Link>
      </div>

      <div className="space-y-3">
        {sprints.map((sprint) => {
          const totalPoints = sprint.issues.reduce((sum, i) => sum + (i.storyPoints ?? 0), 0)
          const donePoints = sprint.issues.filter((i) => (i.status as any).category === 'DONE').reduce((sum, i) => sum + (i.storyPoints ?? 0), 0)
          const progress = totalPoints > 0 ? Math.round((donePoints / totalPoints) * 100) : 0
          const doneCount = sprint.issues.filter((i) => (i.status as any).category === 'DONE').length

          return (
            <div key={sprint.id} className="bg-card border border-border rounded-xl p-5">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h2 className="font-semibold">{sprint.name}</h2>
                    <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', SPRINT_STATUS_COLORS[sprint.status as keyof typeof SPRINT_STATUS_COLORS])}>
                      {sprint.status}
                    </span>
                  </div>
                  {sprint.goal && <p className="text-sm text-muted-foreground">{sprint.goal}</p>}
                  {(sprint.startDate || sprint.endDate) && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {formatDateRange(sprint.startDate, sprint.endDate)}
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium">{sprint._count.issues} issues</p>
                  <p className="text-xs text-muted-foreground">{totalPoints} pts total</p>
                </div>
              </div>

              {/* Progress */}
              <div className="mt-3">
                <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
                  <span>{doneCount} / {sprint.issues.length} done</span>
                  <span>{progress}%</span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-green-500 rounded-full transition-all"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>

              {sprint.status === 'ACTIVE' && (
                <div className="mt-3 pt-3 border-t border-border flex gap-2">
                  <Link href={`/projects/${project.key}/board`} className="text-xs text-primary hover:underline flex items-center gap-1">
                    <Zap className="w-3 h-3" /> View Board
                  </Link>
                  <span className="text-muted-foreground">·</span>
                  <Link href={`/projects/${project.key}/reports`} className="text-xs text-primary hover:underline flex items-center gap-1">
                    <BarChart3 className="w-3 h-3" /> Reports
                  </Link>
                </div>
              )}
            </div>
          )
        })}

        {sprints.length === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            <Zap className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No sprints yet</p>
            <Link href={`/projects/${project.key}/backlog`} className="text-sm text-primary hover:underline mt-2 block">
              Create your first sprint in Backlog
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
