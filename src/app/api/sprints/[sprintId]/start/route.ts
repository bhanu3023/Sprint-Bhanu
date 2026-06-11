import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthSession, getProjectRole, ok, badRequest, unauthorized, forbidden, notFound, serverError } from '@/lib/api-helpers'
import { startSprintSchema } from '@/lib/validations/sprint.schema'
import { writeAuditLog } from '@/lib/audit'
import { notifySprintStarted } from '@/lib/notifications'

type Params = { params: { sprintId: string } }

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const session = await getAuthSession()
    if (!session) return unauthorized()

    const sprint = await prisma.sprint.findUnique({
      where: { id: params.sprintId },
      include: { project: { include: { members: true } } },
    })
    if (!sprint) return notFound('Sprint')
    if (sprint.status !== 'PLANNED') return badRequest('Sprint is not in PLANNED state')

    const projectRole = await getProjectRole(sprint.project.key, session.user.id)
    const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(session.user.role)
    if (!isAdmin && !['OWNER', 'ADMIN', 'SCRUM_MASTER'].includes(projectRole ?? '')) return forbidden()

    // Check no other active sprint in this project
    const activeSprint = await prisma.sprint.findFirst({
      where: { projectId: sprint.projectId, status: 'ACTIVE' },
    })
    if (activeSprint) return badRequest('There is already an active sprint in this project')

    const body = await req.json()
    const parsed = startSprintSchema.safeParse(body)
    if (!parsed.success) return badRequest('Validation failed', parsed.error.errors)

    const updated = await prisma.sprint.update({
      where: { id: params.sprintId },
      data: {
        status: 'ACTIVE',
        startDate: new Date(parsed.data.startDate),
        endDate: new Date(parsed.data.endDate),
      },
    })

    await writeAuditLog({
      actorId: session.user.id,
      projectId: sprint.projectId,
      entityType: 'Sprint',
      entityId: sprint.id,
      action: 'started',
      changes: { name: sprint.name },
    })

    // Notify project members
    const memberIds = sprint.project.members.map((m) => m.userId)
    await notifySprintStarted(memberIds, sprint.name, sprint.project.key)

    return ok(updated)
  } catch (e) {
    return serverError(e)
  }
}
