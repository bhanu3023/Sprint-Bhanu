import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthSession, getProjectRole, ok, badRequest, unauthorized, forbidden, notFound, serverError, noContent } from '@/lib/api-helpers'
import { updateSprintSchema } from '@/lib/validations/sprint.schema'
import { writeAuditLog } from '@/lib/audit'

type Params = { params: { sprintId: string } }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const session = await getAuthSession()
    if (!session) return unauthorized()

    const sprint = await prisma.sprint.findUnique({
      where: { id: params.sprintId },
      include: {
        _count: { select: { issues: true } },
        issues: {
          include: {
            status: true,
            assignee: { select: { id: true, name: true, avatarUrl: true, avatarColor: true } },
            reporter: { select: { id: true, name: true, avatarUrl: true, avatarColor: true } },
            labels: { include: { label: true } },
            _count: { select: { subtasks: true, comments: true } },
          },
          orderBy: { order: 'asc' },
        },
      },
    })

    if (!sprint) return notFound('Sprint')
    return ok(sprint)
  } catch (e) {
    return serverError(e)
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const session = await getAuthSession()
    if (!session) return unauthorized()

    const sprint = await prisma.sprint.findUnique({
      where: { id: params.sprintId },
      include: { project: true },
    })
    if (!sprint) return notFound('Sprint')

    const projectRole = await getProjectRole(sprint.project.key, session.user.id)
    const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(session.user.role)
    const canEdit = isAdmin || ['OWNER', 'ADMIN', 'SCRUM_MASTER'].includes(projectRole ?? '')
    if (!canEdit) return forbidden()

    const body = await req.json()
    const parsed = updateSprintSchema.safeParse(body)
    if (!parsed.success) return badRequest('Validation failed', parsed.error.errors)

    const updated = await prisma.sprint.update({
      where: { id: params.sprintId },
      data: {
        ...parsed.data,
        startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : undefined,
        endDate: parsed.data.endDate ? new Date(parsed.data.endDate) : undefined,
      },
    })

    await writeAuditLog({
      actorId: session.user.id,
      projectId: sprint.projectId,
      entityType: 'Sprint',
      entityId: sprint.id,
      action: 'updated',
      changes: parsed.data,
    })

    return ok(updated)
  } catch (e) {
    return serverError(e)
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const session = await getAuthSession()
    if (!session) return unauthorized()

    const sprint = await prisma.sprint.findUnique({
      where: { id: params.sprintId },
      include: { project: true },
    })
    if (!sprint) return notFound('Sprint')

    if (sprint.status !== 'PLANNED') return badRequest('Can only delete planned sprints')

    const projectRole = await getProjectRole(sprint.project.key, session.user.id)
    const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(session.user.role)
    if (!isAdmin && !['OWNER', 'ADMIN', 'SCRUM_MASTER'].includes(projectRole ?? '')) return forbidden()

    // Move issues back to backlog
    await prisma.issue.updateMany({
      where: { sprintId: params.sprintId },
      data: { sprintId: null },
    })

    await prisma.sprint.delete({ where: { id: params.sprintId } })

    return noContent()
  } catch (e) {
    return serverError(e)
  }
}
