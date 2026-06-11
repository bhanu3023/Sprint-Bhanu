import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthSession, getProjectRole, ok, created, badRequest, unauthorized, forbidden, notFound, serverError, generateIssueKey } from '@/lib/api-helpers'
import { createIssueSchema } from '@/lib/validations/issue.schema'
import { writeAuditLog } from '@/lib/audit'
import { notifyIssueAssigned } from '@/lib/notifications'
import { IssueType, Priority } from '@prisma/client'
import { getResponseHours, getResolutionHours, calcDeadline } from '@/lib/sla'

export async function GET(req: NextRequest) {
  try {
    const session = await getAuthSession()
    if (!session) return unauthorized()

    const { searchParams } = new URL(req.url)
    const projectKey = searchParams.get('projectKey')
    const sprintId = searchParams.get('sprintId')
    const assigneeId = searchParams.get('assigneeId')
    const type = searchParams.get('type') as IssueType | null
    const priority = searchParams.get('priority') as Priority | null
    const statusId = searchParams.get('statusId')
    const search = searchParams.get('search') || ''
    const backlog = searchParams.get('backlog') === 'true'
    const page = parseInt(searchParams.get('page') || '1')
    const pageSize = parseInt(searchParams.get('pageSize') || '50')

    const where: Record<string, unknown> = {}

    if (projectKey) {
      const project = await prisma.project.findUnique({ where: { key: projectKey } })
      if (!project) return notFound('Project')
      where.projectId = project.id
    }

    if (sprintId) where.sprintId = sprintId
    if (backlog) where.sprintId = null
    if (assigneeId) where.assigneeId = assigneeId
    if (type) where.type = type
    if (priority) where.priority = priority
    if (statusId) where.statusId = statusId
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { key: { contains: search, mode: 'insensitive' } },
      ]
    }

    const [issues, total] = await Promise.all([
      prisma.issue.findMany({
        where,
        include: {
          status: true,
          assignee: { select: { id: true, name: true, avatarUrl: true, avatarColor: true } },
          reporter: { select: { id: true, name: true, avatarUrl: true, avatarColor: true } },
          labels: { include: { label: true } },
          _count: { select: { subtasks: true, comments: true } },
        },
        orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.issue.count({ where }),
    ])

    return ok({ issues, total, page, pageSize, totalPages: Math.ceil(total / pageSize) })
  } catch (e) {
    return serverError(e)
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getAuthSession()
    if (!session) return unauthorized()

    const body = await req.json()
    const parsed = createIssueSchema.safeParse(body)
    if (!parsed.success) return badRequest('Validation failed', parsed.error.errors)

    const project = await prisma.project.findUnique({ where: { key: parsed.data.projectKey } })
    if (!project) return notFound('Project')

    const projectRole = await getProjectRole(parsed.data.projectKey, session.user.id)
    const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(session.user.role)
    const isMember = project.ownerId === session.user.id || projectRole !== null
    if (!isAdmin && !isMember) return forbidden()

    // Get default status (To Do)
    const defaultStatus = await prisma.workflowStatus.findFirst({
      where: { projectId: project.id, isDefault: true },
    })
    if (!defaultStatus) return badRequest('Project has no default workflow status')

    // Get default column for "To Do" status
    const defaultColumn = await prisma.boardColumn.findFirst({
      where: { projectId: project.id, statusId: defaultStatus.id },
    })

    const issueKey = await generateIssueKey(project.id, project.key)

    // Compute SLA deadlines if project has a policy
    const slaPolicy = await prisma.slaPolicy.findUnique({ where: { projectId: project.id } })
    const now = new Date()
    const slaResponseDeadline = slaPolicy
      ? calcDeadline(now, getResponseHours(slaPolicy, parsed.data.priority))
      : null
    const slaResolutionDeadline = slaPolicy
      ? calcDeadline(now, getResolutionHours(slaPolicy, parsed.data.priority))
      : null

    const issue = await prisma.issue.create({
      data: {
        key: issueKey,
        projectId: project.id,
        sprintId: parsed.data.sprintId ?? null,
        columnId: defaultColumn?.id ?? null,
        parentId: parsed.data.parentId ?? null,
        epicId: parsed.data.epicId ?? null,
        statusId: defaultStatus.id,
        type: parsed.data.type,
        priority: parsed.data.priority,
        title: parsed.data.title,
        description: parsed.data.description ?? null,
        assigneeId: parsed.data.assigneeId ?? null,
        reporterId: session.user.id,
        storyPoints: parsed.data.storyPoints ?? null,
        dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null,
        slaResponseDeadline,
        slaResolutionDeadline,
      },
      include: {
        status: true,
        assignee: { select: { id: true, name: true, avatarUrl: true, avatarColor: true } },
        reporter: { select: { id: true, name: true, avatarUrl: true, avatarColor: true } },
        labels: { include: { label: true } },
        _count: { select: { subtasks: true, comments: true } },
      },
    })

    // Add labels
    if (parsed.data.labelIds?.length) {
      await prisma.issueLabel.createMany({
        data: parsed.data.labelIds.map((labelId) => ({ issueId: issue.id, labelId })),
      })
    }

    // Auto-watch for reporter
    await prisma.issueWatcher.create({
      data: { issueId: issue.id, userId: session.user.id },
    })

    await writeAuditLog({
      actorId: session.user.id,
      projectId: project.id,
      issueId: issue.id,
      entityType: 'Issue',
      entityId: issue.id,
      action: 'created',
      changes: { key: issueKey, title: parsed.data.title, type: parsed.data.type },
    })

    // Notify assignee
    if (parsed.data.assigneeId && parsed.data.assigneeId !== session.user.id) {
      await notifyIssueAssigned(parsed.data.assigneeId, issueKey, parsed.data.title, project.key)
    }

    return created(issue)
  } catch (e) {
    return serverError(e)
  }
}
