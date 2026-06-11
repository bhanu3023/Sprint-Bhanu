import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthSession, ok, unauthorized, notFound, serverError } from '@/lib/api-helpers'

export async function GET(_req: NextRequest, { params }: { params: { projectKey: string } }) {
  try {
    const session = await getAuthSession()
    if (!session) return unauthorized()

    const project = await prisma.project.findUnique({ where: { key: params.projectKey } })
    if (!project) return notFound()

    const sprints = await prisma.sprint.findMany({
      where: { projectId: project.id, status: { not: 'PLANNED' } },
      include: {
        issues: {
          include: { status: true },
          select: { id: true, storyPoints: true, status: { select: { category: true } } },
        },
      },
      orderBy: { order: 'asc' },
    })

    const data = sprints.map((sprint) => {
      const committed = sprint.issues.reduce((sum, i) => sum + (i.storyPoints ?? 0), 0)
      const completed = sprint.issues
        .filter((i) => (i.status as any).category === 'DONE')
        .reduce((sum, i) => sum + (i.storyPoints ?? 0), 0)
      return {
        sprint: sprint.name,
        committed,
        completed,
        velocity: completed,
        completionRate: committed > 0 ? Math.round((completed / committed) * 100) : 0,
      }
    })

    const avgVelocity = data.length > 0
      ? Math.round(data.reduce((sum, d) => sum + d.velocity, 0) / data.length)
      : 0

    return ok({ sprints: data, avgVelocity })
  } catch (e) {
    return serverError(e)
  }
}
