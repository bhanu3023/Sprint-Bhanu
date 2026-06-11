import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthSession, getProjectRole, ok, badRequest, unauthorized, forbidden, notFound, serverError } from '@/lib/api-helpers'
import { completeSprintSchema } from '@/lib/validations/sprint.schema'
import { writeAuditLog } from '@/lib/audit'
import { notifySprintCompleted } from '@/lib/notifications'

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
    if (sprint.status !== 'ACTIVE') return badRequest('Sprint is not active')

    const projectRole = await getProjectRole(sprint.project.key, session.user.id)
    const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(session.user.role)
    if (!isAdmin && !['OWNER', 'ADMIN', 'SCRUM_MASTER'].includes(projectRole ?? '')) return forbidden()

    const body = await req.json()
    const parsed = completeSprintSchema.safeParse(body)
    if (!parsed.success) return badRequest('Validation failed', parsed.error.errors)

    // Get incomplete issues
    const incompleteIssues = await prisma.issue.findMany({
      where: {
        sprintId: params.sprintId,
        status: { category: { not: 'DONE' } },
      },
      select: { id: true },
    })

    await prisma.$transaction(async (tx) => {
      // Move incomplete issues
      if (incompleteIssues.length > 0) {
        const issueIds = incompleteIssues.map((i) => i.id)
        await tx.issue.updateMany({
          where: { id: { in: issueIds } },
          data: {
            sprintId: parsed.data.moveToSprintId ?? null,
            columnId: null,
          },
        })
      }

      // Complete the sprint
      await tx.sprint.update({
        where: { id: params.sprintId },
        data: { status: 'COMPLETED', completedAt: new Date() },
      })
    })

    await writeAuditLog({
      actorId: session.user.id,
      projectId: sprint.projectId,
      entityType: 'Sprint',
      entityId: sprint.id,
      action: 'completed',
      changes: {
        name: sprint.name,
        incompleteIssuesMoved: incompleteIssues.length,
        movedTo: parsed.data.moveToSprintId ?? 'backlog',
      },
    })

    const memberIds = sprint.project.members.map((m) => m.userId)
    await notifySprintCompleted(memberIds, sprint.name, sprint.project.key)

    const updated = await prisma.sprint.findUnique({
      where: { id: params.sprintId },
      include: { _count: { select: { issues: true } } },
    })

    return ok({ sprint: updated, movedCount: incompleteIssues.length })
  } catch (e) {
    return serverError(e)
  }
}
