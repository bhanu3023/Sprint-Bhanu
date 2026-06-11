import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthSession, getProjectRole, ok, badRequest, unauthorized, forbidden, notFound, serverError } from '@/lib/api-helpers'
import { transitionIssueSchema } from '@/lib/validations/issue.schema'
import { writeAuditLog } from '@/lib/audit'
import { notifyStatusChanged } from '@/lib/notifications'

type Params = { params: { issueKey: string } }

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const session = await getAuthSession()
    if (!session) return unauthorized()

    const issue = await prisma.issue.findUnique({
      where: { key: params.issueKey },
      include: {
        project: true,
        status: true,
        watchers: true,
      },
    })
    if (!issue) return notFound('Issue')

    const projectRole = await getProjectRole(issue.project.key, session.user.id)
    const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(session.user.role)
    const canTransition = isAdmin || (projectRole !== null && projectRole !== 'VIEWER')
    if (!canTransition) return forbidden()

    const body = await req.json()
    const parsed = transitionIssueSchema.safeParse(body)
    if (!parsed.success) return badRequest('Validation failed', parsed.error.errors)

    // Validate transition is allowed
    const transition = await prisma.workflowTransition.findFirst({
      where: {
        projectId: issue.projectId,
        fromStatusId: issue.statusId,
        toStatusId: parsed.data.statusId,
      },
      include: { toStatus: true },
    })

    if (!transition) {
      return badRequest(`Transition from current status to target status is not allowed`)
    }

    // Check required role for transition
    if (transition.requiredRole && !isAdmin) {
      const hasRole = projectRole && ['OWNER', 'ADMIN', 'SCRUM_MASTER', transition.requiredRole].includes(projectRole)
      if (!hasRole) return forbidden(`You need at least ${transition.requiredRole} role to perform this transition`)
    }

    const fromStatusName = issue.status.name
    const toStatusName = transition.toStatus.name

    // Find column for target status
    let columnId = parsed.data.columnId
    if (!columnId) {
      const col = await prisma.boardColumn.findFirst({
        where: { projectId: issue.projectId, statusId: parsed.data.statusId },
      })
      columnId = col?.id
    }

    const updated = await prisma.issue.update({
      where: { key: params.issueKey },
      data: {
        statusId: parsed.data.statusId,
        columnId: columnId ?? null,
      },
      include: {
        status: true,
        column: true,
        assignee: { select: { id: true, name: true, avatarUrl: true, avatarColor: true } },
      },
    })

    await writeAuditLog({
      actorId: session.user.id,
      projectId: issue.projectId,
      issueId: issue.id,
      entityType: 'Issue',
      entityId: issue.id,
      action: 'transitioned',
      changes: { from: fromStatusName, to: toStatusName },
    })

    // Notify watchers
    const watcherIds = issue.watchers
      .map((w) => w.userId)
      .filter((id) => id !== session.user.id)

    if (watcherIds.length > 0) {
      await notifyStatusChanged(watcherIds, issue.key, issue.project.key, fromStatusName, toStatusName)
    }

    return ok(updated)
  } catch (e) {
    return serverError(e)
  }
}
