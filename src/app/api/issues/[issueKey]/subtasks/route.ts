import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthSession, getProjectRole, ok, created, badRequest, unauthorized, notFound, serverError } from '@/lib/api-helpers'
import { generateIssueKey } from '@/lib/api-helpers'

export async function GET(_req: NextRequest, { params }: { params: { issueKey: string } }) {
  try {
    const session = await getAuthSession()
    if (!session) return unauthorized()

    const issue = await prisma.issue.findUnique({ where: { key: params.issueKey } })
    if (!issue) return notFound()

    const subtasks = await prisma.issue.findMany({
      where: { parentId: issue.id },
      include: {
        status: true,
        assignee: { select: { id: true, name: true, avatarUrl: true, avatarColor: true } },
      },
      orderBy: { order: 'asc' },
    })
    return ok(subtasks)
  } catch (e) {
    return serverError(e)
  }
}

export async function POST(req: NextRequest, { params }: { params: { issueKey: string } }) {
  try {
    const session = await getAuthSession()
    if (!session) return unauthorized()

    const parent = await prisma.issue.findUnique({
      where: { key: params.issueKey },
      include: { project: true },
    })
    if (!parent) return notFound()

    const role = await getProjectRole(parent.project.key, session.user.id)
    const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(session.user.role)
    if (!role && !isAdmin) return unauthorized()

    const body = await req.json()
    const { title, assigneeId, priority } = body
    if (!title?.trim()) return badRequest('title required')

    const defaultStatus = await prisma.workflowStatus.findFirst({
      where: { projectId: parent.projectId, category: 'TODO' },
      orderBy: { order: 'asc' },
    })
    if (!defaultStatus) return badRequest('No TODO status configured')

    const key = await generateIssueKey(parent.projectId, parent.project.key)
    const maxOrder = await prisma.issue.aggregate({ where: { parentId: parent.id }, _max: { order: true } })

    const subtask = await prisma.issue.create({
      data: {
        key,
        title: title.trim(),
        type: 'SUBTASK',
        priority: priority ?? 'MEDIUM',
        projectId: parent.projectId,
        parentId: parent.id,
        statusId: defaultStatus.id,
        reporterId: session.user.id,
        assigneeId: assigneeId ?? null,
        order: (maxOrder._max.order ?? 0) + 1,
      },
      include: {
        status: true,
        assignee: { select: { id: true, name: true, avatarUrl: true, avatarColor: true } },
      },
    })

    await prisma.auditLog.create({
      data: {
        action: 'CREATED',
        entityType: 'ISSUE',
        entityId: subtask.id,
        projectId: parent.projectId,
        issueId: subtask.id,
        actorId: session.user.id,
        changes: { parentKey: parent.key },
      },
    })

    return created(subtask)
  } catch (e) {
    return serverError(e)
  }
}
