import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthSession, ok, unauthorized, notFound, serverError } from '@/lib/api-helpers'

type Params = { params: { projectKey: string } }

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const session = await getAuthSession()
    if (!session) return unauthorized()

    const { searchParams } = new URL(req.url)
    const sprintId = searchParams.get('sprintId')

    const project = await prisma.project.findUnique({ where: { key: params.projectKey } })
    if (!project) return notFound('Project')

    // If no sprint specified, get active sprint
    let activeSprint = null
    if (sprintId) {
      activeSprint = await prisma.sprint.findUnique({ where: { id: sprintId } })
    } else {
      activeSprint = await prisma.sprint.findFirst({
        where: { projectId: project.id, status: 'ACTIVE' },
      })
    }

    const columns = await prisma.boardColumn.findMany({
      where: { projectId: project.id },
      include: {
        status: true,
        issues: {
          where: activeSprint ? { sprintId: activeSprint.id } : { sprintId: null },
          include: {
            status: true,
            assignee: { select: { id: true, name: true, avatarUrl: true, avatarColor: true } },
            reporter: { select: { id: true, name: true, avatarUrl: true, avatarColor: true } },
            labels: { include: { label: true } },
            _count: { select: { subtasks: true, comments: true } },
          },
          orderBy: { order: 'asc' },
        },
        _count: { select: { issues: true } },
      },
      orderBy: { order: 'asc' },
    })

    return ok({ columns, sprint: activeSprint })
  } catch (e) {
    return serverError(e)
  }
}
