import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthSession, getProjectRole, ok, badRequest, unauthorized, forbidden, notFound, serverError } from '@/lib/api-helpers'
import { reorderBoardSchema } from '@/lib/validations/issue.schema'
import { writeAuditLog } from '@/lib/audit'

type Params = { params: { projectKey: string } }

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const session = await getAuthSession()
    if (!session) return unauthorized()

    const project = await prisma.project.findUnique({ where: { key: params.projectKey } })
    if (!project) return notFound('Project')

    const projectRole = await getProjectRole(params.projectKey, session.user.id)
    const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(session.user.role)
    if (!isAdmin && projectRole === 'VIEWER') return forbidden()

    const body = await req.json()
    const parsed = reorderBoardSchema.safeParse(body)
    if (!parsed.success) return badRequest('Validation failed', parsed.error.errors)

    const issue = await prisma.issue.findUnique({ where: { id: parsed.data.issueId } })
    if (!issue) return notFound('Issue')

    const fromStatusName = (await prisma.boardColumn.findUnique({
      where: { id: parsed.data.sourceColumnId },
      include: { status: true },
    }))?.status.name

    const toColumn = await prisma.boardColumn.findUnique({
      where: { id: parsed.data.destinationColumnId },
      include: { status: true },
    })

    // Validate transition if moving between columns
    if (parsed.data.sourceColumnId !== parsed.data.destinationColumnId && issue.statusId !== parsed.data.statusId) {
      const transition = await prisma.workflowTransition.findFirst({
        where: {
          projectId: project.id,
          fromStatusId: issue.statusId,
          toStatusId: parsed.data.statusId,
        },
      })
      if (!transition) {
        return badRequest('This status transition is not allowed by the workflow configuration')
      }
    }

    await prisma.issue.update({
      where: { id: parsed.data.issueId },
      data: {
        columnId: parsed.data.destinationColumnId,
        statusId: parsed.data.statusId,
        order: parsed.data.newOrder,
      },
    })

    if (fromStatusName && toColumn && fromStatusName !== toColumn.status.name) {
      await writeAuditLog({
        actorId: session.user.id,
        projectId: project.id,
        issueId: issue.id,
        entityType: 'Issue',
        entityId: issue.id,
        action: 'transitioned',
        changes: { from: fromStatusName, to: toColumn.status.name, method: 'drag-drop' },
      })
    }

    return ok({ success: true })
  } catch (e) {
    return serverError(e)
  }
}
