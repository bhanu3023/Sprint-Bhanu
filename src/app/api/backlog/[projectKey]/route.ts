import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthSession, ok, unauthorized, notFound, serverError } from '@/lib/api-helpers'

type Params = { params: { projectKey: string } }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const session = await getAuthSession()
    if (!session) return unauthorized()

    const project = await prisma.project.findUnique({ where: { key: params.projectKey } })
    if (!project) return notFound('Project')

    // Get all sprints with their issues
    const sprints = await prisma.sprint.findMany({
      where: { projectId: project.id, status: { not: 'COMPLETED' } },
      include: {
        issues: {
          include: {
            status: true,
            assignee: { select: { id: true, name: true, avatarUrl: true, avatarColor: true } },
            labels: { include: { label: true } },
            _count: { select: { subtasks: true, comments: true } },
          },
          orderBy: { order: 'asc' },
        },
        _count: { select: { issues: true } },
      },
      orderBy: { order: 'asc' },
    })

    // Get backlog issues (no sprint)
    const backlogIssues = await prisma.issue.findMany({
      where: { projectId: project.id, sprintId: null, parentId: null },
      include: {
        status: true,
        assignee: { select: { id: true, name: true, avatarUrl: true, avatarColor: true } },
        labels: { include: { label: true } },
        _count: { select: { subtasks: true, comments: true } },
      },
      orderBy: { order: 'asc' },
    })

    return ok({ sprints, backlogIssues })
  } catch (e) {
    return serverError(e)
  }
}
