import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthSession, getProjectRole, ok, badRequest, unauthorized, forbidden, notFound, serverError, noContent } from '@/lib/api-helpers'
import { updateIssueSchema } from '@/lib/validations/issue.schema'
import { writeAuditLog } from '@/lib/audit'
import { notifyIssueAssigned } from '@/lib/notifications'

type Params = { params: { issueKey: string } }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const session = await getAuthSession()
    if (!session) return unauthorized()

    const issue = await prisma.issue.findUnique({
      where: { key: params.issueKey },
      include: {
        status: true,
        column: { include: { status: true } },
        sprint: true,
        assignee: { select: { id: true, name: true, email: true, avatarUrl: true, avatarColor: true } },
        reporter: { select: { id: true, name: true, email: true, avatarUrl: true, avatarColor: true } },
        labels: { include: { label: true } },
        parent: {
          select: { id: true, key: true, title: true, type: true, status: true },
        },
        subtasks: {
          include: {
            status: true,
            assignee: { select: { id: true, name: true, avatarUrl: true, avatarColor: true } },
          },
          orderBy: { order: 'asc' },
        },
        epic: { select: { id: true, key: true, title: true, type: true } },
        comments: {
          include: {
            author: { select: { id: true, name: true, avatarUrl: true, avatarColor: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
        attachments: {
          include: {
            uploader: { select: { id: true, name: true, avatarUrl: true, avatarColor: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
        watchers: {
          include: { user: { select: { id: true, name: true, avatarUrl: true, avatarColor: true } } },
        },
        sourceLinkType: {
          include: { target: { select: { id: true, key: true, title: true, type: true, status: true } } },
        },
        project: {
          select: { id: true, key: true, name: true, workflowTransitions: {
            include: { fromStatus: true, toStatus: true },
          }},
        },
      },
    })

    if (!issue) return notFound('Issue')
    return ok(issue)
  } catch (e) {
    return serverError(e)
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const session = await getAuthSession()
    if (!session) return unauthorized()

    const issue = await prisma.issue.findUnique({
      where: { key: params.issueKey },
      include: { project: true },
    })
    if (!issue) return notFound('Issue')

    const projectRole = await getProjectRole(issue.project.key, session.user.id)
    const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(session.user.role)
    const canEdit = isAdmin || (projectRole !== null && projectRole !== 'VIEWER')
    if (!canEdit) return forbidden()

    const body = await req.json()
    const parsed = updateIssueSchema.safeParse(body)
    if (!parsed.success) return badRequest('Validation failed', parsed.error.errors)

    const { labelIds, ...data } = parsed.data

    const changes: Record<string, { from: unknown; to: unknown }> = {}
    if (data.title && data.title !== issue.title) changes.title = { from: issue.title, to: data.title }
    if (data.assigneeId !== undefined && data.assigneeId !== issue.assigneeId) {
      changes.assigneeId = { from: issue.assigneeId, to: data.assigneeId }
    }
    if (data.priority && data.priority !== issue.priority) {
      changes.priority = { from: issue.priority, to: data.priority }
    }
    if (data.storyPoints !== undefined && data.storyPoints !== issue.storyPoints) {
      changes.storyPoints = { from: issue.storyPoints, to: data.storyPoints }
    }

    const updated = await prisma.issue.update({
      where: { key: params.issueKey },
      data: {
        ...data,
        dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
      },
      include: {
        status: true,
        assignee: { select: { id: true, name: true, avatarUrl: true, avatarColor: true } },
        reporter: { select: { id: true, name: true, avatarUrl: true, avatarColor: true } },
        labels: { include: { label: true } },
        _count: { select: { subtasks: true, comments: true } },
      },
    })

    // Update labels
    if (labelIds !== undefined) {
      await prisma.issueLabel.deleteMany({ where: { issueId: issue.id } })
      if (labelIds.length > 0) {
        await prisma.issueLabel.createMany({
          data: labelIds.map((labelId) => ({ issueId: issue.id, labelId })),
        })
      }
    }

    if (Object.keys(changes).length > 0) {
      await writeAuditLog({
        actorId: session.user.id,
        projectId: issue.projectId,
        issueId: issue.id,
        entityType: 'Issue',
        entityId: issue.id,
        action: 'updated',
        changes,
      })
    }

    // Notify new assignee
    if (
      data.assigneeId &&
      data.assigneeId !== issue.assigneeId &&
      data.assigneeId !== session.user.id
    ) {
      await notifyIssueAssigned(data.assigneeId, issue.key, issue.title, issue.project.key)
    }

    return ok(updated)
  } catch (e) {
    return serverError(e)
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const session = await getAuthSession()
    if (!session) return unauthorized()

    const issue = await prisma.issue.findUnique({
      where: { key: params.issueKey },
      include: { project: true },
    })
    if (!issue) return notFound('Issue')

    const projectRole = await getProjectRole(issue.project.key, session.user.id)
    const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(session.user.role)
    const canDelete = isAdmin || ['OWNER', 'ADMIN', 'SCRUM_MASTER'].includes(projectRole ?? '')
    if (!canDelete) return forbidden()

    await prisma.issue.delete({ where: { key: params.issueKey } })

    return noContent()
  } catch (e) {
    return serverError(e)
  }
}
